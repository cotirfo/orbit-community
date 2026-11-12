import fs from 'node:fs/promises';
import path from 'node:path';

export const TIMEZONE='America/Sao_Paulo';
const calendar=new Intl.DateTimeFormat('en-CA',{timeZone:TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit'});
export function dayKey(time){const p=Object.fromEntries(calendar.formatToParts(time).map(p=>[p.type,p.value]));return `${p.year}-${p.month}-${p.day}`;}
export function decodeDps(value,time=Date.now()){
  const d=value?.dps||value;
  if(!d||typeof d['1']!=='boolean'||!Number.isSafeInteger(time)||time<=0||![18,19,20].every(k=>Number.isSafeInteger(d[k])&&d[k]>=0))throw new Error('invalid-data');
  return {time,relay:d['1'],amps:d['18']/1000,watts:d['19']/10,volts:d['20']/10};
}
const empty=()=>({version:1,startedAt:null,totalWh:0,observedSeconds:0,lastValid:null,continuity:null,history:[],daily:{},monthly:{}});
function boundary(a,b){const key=dayKey(a);if(dayKey(b)===key)return b;let lo=a,hi=b;while(hi-lo>1){const mid=Math.floor((lo+hi)/2);if(dayKey(mid)===key)lo=mid;else hi=mid;}return hi;}
function bucket(map,key,wh,seconds){const b=map[key]||{wh:0,seconds:0};map[key]={wh:b.wh+wh,seconds:b.seconds+seconds};}
export function integrate(state,sample,maxGapMs){
  const next={...state,history:state.history.slice(),daily:structuredClone(state.daily),monthly:structuredClone(state.monthly)},previous=state.continuity;
  if(state.lastValid&&sample.time<=state.lastValid.time)return next;
  next.startedAt??=sample.time;
  if(previous&&sample.time>previous.time&&sample.time-previous.time<=maxGapMs){
    const span=sample.time-previous.time,power=t=>previous.watts+(sample.watts-previous.watts)*(t-previous.time)/span;
    let start=previous.time;
    while(start<sample.time){const end=boundary(start,sample.time),seconds=(end-start)/1000,wh=(power(start)+power(end))/2*seconds/3600,key=dayKey(start);
      next.totalWh+=wh;next.observedSeconds+=seconds;bucket(next.daily,key,wh,seconds);bucket(next.monthly,key.slice(0,7),wh,seconds);start=end;
    }
  }
  next.lastValid={...sample};next.continuity={...sample};next.history.push({...sample,dayWh:next.daily[dayKey(sample.time)]?.wh||0,connected:Boolean(previous&&sample.time-previous.time<=maxGapMs)});return next;
}
function validState(s){
  const nonnegative=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
  const sample=v=>v===null||(v&&Number.isSafeInteger(v.time)&&v.time>0&&typeof v.relay==='boolean'&&[v.watts,v.amps,v.volts].every(nonnegative));
  return s?.version===1&&nonnegative(s.totalWh)&&nonnegative(s.observedSeconds)&&(s.startedAt===null||Number.isSafeInteger(s.startedAt))&&sample(s.lastValid)&&sample(s.continuity)&&Array.isArray(s.history)&&s.history.length<=50000&&s.history.every(p=>p&&sample(p))&&['daily','monthly'].every(name=>s[name]&&typeof s[name]==='object'&&!Array.isArray(s[name])&&Object.entries(s[name]).every(([key,b])=>(name==='daily'?/^\d{4}-\d{2}-\d{2}$/:/^\d{4}-\d{2}$/).test(key)&&b&&nonnegative(b.wh)&&nonnegative(b.seconds)));
}
export async function createEnergyMetrics({directory,retentionDays=7,maxGapMs=30000,now=Date.now,io=fs}){
  await io.mkdir(directory,{recursive:true,mode:0o700});const file=path.join(directory,'state.json'),journal=path.join(directory,'journal.jsonl');let state={...empty(),sequence:0},tail=Promise.resolve(),view,poisoned=false,checkpointAt=now(),storageWarning='';
  try{state=JSON.parse(await io.readFile(file,'utf8'));if(!validState(state))throw new Error('invalid');state.sequence??=0;if(!Number.isSafeInteger(state.sequence)||state.sequence<0)throw new Error('invalid');}catch(e){if(e.code!=='ENOENT')throw new Error('energy-storage');}
  try{const content=await io.readFile(journal,'utf8'),end=content.lastIndexOf('\n')+1;
    for(const line of content.slice(0,end).split('\n').filter(Boolean)){const r=JSON.parse(line);if(!Number.isSafeInteger(r.sequence)||r.sequence<=0)throw new Error('invalid');if(r.sequence<=state.sequence)continue;if(r.sequence!==state.sequence+1)throw new Error('invalid');
      if(r.type==='gap')state={...state,continuity:null};else if(r.type==='sample'&&r.sample&&validState({...empty(),lastValid:r.sample})){
        if(r.previousTime===null)state={...state,continuity:null};else if(r.previousTime!==undefined&&r.previousTime!==state.continuity?.time)throw new Error('invalid');
        state=integrate(state,r.sample,maxGapMs);
      }else throw new Error('invalid');state.sequence=r.sequence;
    }
    // A partial last write is uncommitted. Never join a new record onto it.
    if(end<content.length){await io.truncate(journal,Buffer.byteLength(content.slice(0,end)));storageWarning='Cauda incompleta do journal descartada na recuperação.';}
  }catch(e){if(e.code!=='ENOENT')throw new Error('energy-storage');}
  // Restart is an unobserved interval, even when the saved baseline is recent.
  state.continuity=null;
  function trim(s){
    const cutoff=now()-Math.max(1,Math.min(30,retentionDays))*86400000;s.history=s.history.filter(p=>p.time>=cutoff).slice(-50000);
    for(const [map,limit]of [[s.daily,400],[s.monthly,36]])for(const key of Object.keys(map).sort().slice(0,-limit))delete map[key];
  }
  trim(state);
  async function checkpoint(){
    const temp=file+'.tmp';let handle;
    try{handle=await io.open(temp,'w',0o600);await handle.writeFile(JSON.stringify(state));await handle.sync();await handle.close();handle=null;await io.rename(temp,file);
      // Flush directory metadata on Linux, so a power loss cannot resurrect a
      // superseded checkpoint. Windows does not expose fsync on directories.
      if(process.platform!=='win32'){const dir=await io.open(directory,'r');try{await dir.sync();}finally{await dir.close();}}
      // The checkpoint sequence makes replay idempotent even if truncation fails.
      await io.truncate(journal,0).catch(e=>{if(e.code!=='ENOENT')throw e;});checkpointAt=now();
    }finally{if(handle)await handle.close().catch(()=>{});}
  }
  async function commit(s,record){
    if(poisoned)throw new Error('energy-storage');trim(s);let handle,size=0;
    try{handle=await io.open(journal,'a+',0o600);size=(await handle.stat()).size;record.sequence=state.sequence+1;await handle.writeFile(JSON.stringify(record)+'\n');await handle.sync();await handle.close();handle=null;
      if(size===0&&process.platform!=='win32'){const dir=await io.open(directory,'r');try{await dir.sync();}finally{await dir.close();}}
      s.sequence=record.sequence;state=s;view=null;
    }catch{if(handle){try{await handle.truncate(size);await handle.sync();}catch{poisoned=true;}}state.continuity=null;throw new Error('energy-storage');}finally{if(handle)await handle.close().catch(()=>{});}
    // Hourly compaction bounds replay work without rewriting the entire power
    // history on every ten-second reading. The journal remains authoritative.
    if(now()-checkpointAt>=3600000||state.sequence%1000===0)try{await checkpoint();storageWarning='';}catch{storageWarning='Compactação pendente; journal preservado para recuperação.';}
  }
  function serialize(job){const result=tail.then(job);tail=result.catch(()=>{});return result;}
  return {
    accept(sample){return serialize(()=>commit(integrate(state,sample,maxGapMs),{type:'sample',sample,previousTime:state.continuity?.time??null}));},
    gap(){return serialize(()=>commit({...state,continuity:null},{type:'gap'}));},
    async close(){await tail;try{await checkpoint();}catch{storageWarning='Compactação pendente; journal preservado para recuperação.';}},
    snapshot(){
      const today=dayKey(now()),month=today.slice(0,7),date=new Date(today+'T12:00:00Z');date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);const monday=date.toISOString().slice(0,10);
      if(!view){
        const daily=Object.entries(state.daily).sort().map(([date,b])=>({date,wh:b.wh,kwh:b.wh/1000,observedSeconds:b.seconds,averageWatts:b.seconds?b.wh*3600/b.seconds:null}));
        const monthly=Object.entries(state.monthly).sort().map(([month,b])=>({month,wh:b.wh,kwh:b.wh/1000,observedSeconds:b.seconds}));
        // Keep full precision on disk. Send bounded minute buckets over SSE.
        const bins=new Map();for(const p of state.history){const key=Math.floor(p.time/60000),b=bins.get(key)||{sum:0,count:0,connected:true};b.time=p.time;b.dayWh=p.dayWh;b.sum+=p.watts;b.count++;b.connected=b.connected&&p.connected;bins.set(key,b);}
        const history=[...bins.values()].map(b=>({time:b.time,watts:b.sum/b.count,dayWh:b.dayWh,connected:b.connected}));
        view={startedAt:state.startedAt,totalWh:state.totalWh,totalKwh:state.totalWh/1000,observedSeconds:state.observedSeconds,lastValid:state.lastValid,daily,monthly,history};
      }
      const averages={};
      for(const minutes of [60,1440,10080]){const cutoff=now()-minutes*60000;let wh=0,seconds=0;
        for(let i=state.history.length-1;i>0;i--){const b=state.history[i],a=state.history[i-1];if(b.time<cutoff)break;if(!b.connected||b.time<=a.time||b.time-a.time>maxGapMs)continue;
          const start=Math.max(cutoff,a.time),end=Math.min(now(),b.time);if(end<=start)continue;
          const power=t=>a.watts+(b.watts-a.watts)*(t-a.time)/(b.time-a.time),span=(end-start)/1000;seconds+=span;wh+=(power(start)+power(end))/2*span/3600;
        }averages[minutes]={watts:seconds?wh*3600/seconds:null,seconds};
      }
      return {...view,storageWarning,averages,todayWh:state.daily[today]?.wh||0,weekWh:Object.entries(state.daily).filter(([d])=>d>=monday&&d<=today).reduce((sum,[,b])=>sum+b.wh,0),monthWh:state.monthly[month]?.wh||0,timezone:TIMEZONE,retentionDays:Math.max(1,Math.min(30,retentionDays))};
    }
  };
}
