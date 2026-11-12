import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {performance} from 'node:perf_hooks';

const MiB=1024*1024;
const defaultServer={origin:'https://speed.cloudflare.com',protocol:'cloudflare',pingPath:'/__down?bytes=0',downloadPath:'/__down',uploadPath:'/__up',provider:'Cloudflare'};
export function median(values){const sorted=values.filter(Number.isFinite).slice().sort((a,b)=>a-b);if(!sorted.length)return null;const i=Math.floor(sorted.length/2);return sorted.length%2?sorted[i]:(sorted[i-1]+sorted[i])/2;}
export function measuredMbps(bytes,milliseconds){return bytes>0&&milliseconds>0?bytes*8/milliseconds/1000:null;}
export function latencyVariation(values){return median(values.slice(1).map((v,i)=>Math.abs(v-values[i])));}

// Only synthetic transfer bytes are sent. No router credentials or telemetry leave the PC.
export function transfer({direction,bytes,agent,signal,onProgress=()=>{},request=https.request,timeoutMs=20000,verifySocket=null,server=defaultServer}){
  return new Promise((resolve,reject)=>{
    let settled=false,received=0,sent=0,firstByte=null,start=performance.now(),lastUpdate=0;
    const url=new URL(direction==='upload'?server.uploadPath:bytes===0?server.pingPath:server.downloadPath,server.origin);
    url.searchParams.set('orbit',crypto.randomUUID());
    if(direction==='download'&&bytes>0)url.searchParams.set(server.protocol==='librespeed'?'ckSize':'bytes',server.protocol==='librespeed'?bytes/MiB:bytes);
    const headers={'Accept-Encoding':'identity','Cache-Control':'no-cache','User-Agent':'ORBIT-Local-Speed-Measurement/1.0'};
    if(direction==='upload'){headers['Content-Type']='application/octet-stream';headers['Content-Length']=bytes;}
    const req=request({hostname:url.hostname,protocol:url.protocol,path:url.pathname+url.search,port:443,family:4,method:direction==='upload'?'POST':'GET',headers,agent,signal},res=>{
      const headersAt=performance.now(),colo=String(res.headers['cf-ray']||'').split('-').at(-1)||null;
      if(res.statusCode!==200){res.resume();finish(new Error('Servidor de medição respondeu HTTP '+res.statusCode+'.'));return;}
      if(res.headers['content-encoding']&&res.headers['content-encoding']!=='identity'){res.resume();finish(new Error('Resposta comprimida não permite medir bytes corretamente.'));return;}
      res.on('data',chunk=>{
        const now=performance.now();if(firstByte===null)firstByte=now;received+=chunk.length;
        if(direction==='download'&&received>bytes){req.destroy(new Error('Resposta excedeu o tamanho solicitado.'));return;}
        if(direction==='upload'&&received>65536){req.destroy(new Error('Resposta de upload excessiva.'));return;}
        if(now-lastUpdate>=250&&direction==='download'){lastUpdate=now;onProgress({bytes:received,targetBytes:bytes,mbps:measuredMbps(received,now-firstByte)});}
      });
      res.on('end',()=>{
        const ended=performance.now(),elapsed=direction==='download'?ended-(firstByte??headersAt):ended-start;
        if(direction==='download'&&received!==bytes){finish(new Error('Download incompleto; resultado descartado.'));return;}
        if(direction==='upload'&&(sent!==bytes||!req.writableFinished)){finish(new Error('Upload incompleto; resultado descartado.'));return;}
        finish(null,{direction,bytes:direction==='upload'?sent:received,durationMs:elapsed,latencyMs:headersAt-start,mbps:measuredMbps(direction==='upload'?sent:received,elapsed),colo});
      });
      res.on('aborted',()=>finish(new Error('Transferência interrompida; resultado descartado.')));res.on('error',finish);
    });
    const timer=setTimeout(()=>req.destroy(new Error('Tempo limite da transferência.')),timeoutMs);timer.unref();
    function finish(error,result){if(settled)return;settled=true;clearTimeout(timer);if(error){req.destroy();reject(error);}else resolve(result);}
    req.on('error',finish);
    const payload=crypto.randomBytes(65536);
    function send(){
      if(settled||req.destroyed)return;
      while(sent<bytes){const size=Math.min(payload.length,bytes-sent);sent+=size;const ok=req.write(payload.subarray(0,size));const now=performance.now();if(now-lastUpdate>=250){lastUpdate=now;onProgress({bytes:sent,targetBytes:bytes,mbps:null});}if(!ok){req.once('drain',send);return;}}
      req.end();
    }
    req.on('socket',socket=>{
      const begin=async()=>{try{await verifySocket?.(socket);if(settled||req.destroyed)return;start=performance.now();if(direction==='upload')send();else req.end();}catch(error){finish(error);}};
      if(socket.connecting)socket.once(socket.encrypted?'secureConnect':'connect',begin);else void begin();
    });
  });
}

export async function measureInternet({signal,onProgress=()=>{},performTransfer=transfer,agentOptions={},verifySocket=null,verifyResult=null,server=defaultServer,externalAgent=null}){
  const agent=externalAgent||new https.Agent({keepAlive:true,maxSockets:1,minVersion:'TLSv1.2',...agentOptions});
  const perform=options=>performTransfer({...options,verifySocket,server});
  const latencies=[],downloads=[],uploads=[];let totalBytes=0,colo=null;
  try{
    // Exclude the first probe, which warms DNS/TCP/TLS, from HTTP latency statistics.
    for(let i=0;i<8;i++){
      onProgress({phase:'latency',progress:Math.round(i/8*15),message:'Medindo latência HTTP ('+Math.min(i,7)+'/7)…'});
      const result=await perform({direction:'download',bytes:0,agent,signal});colo=result.colo||colo;if(i>0)latencies.push(result.latencyMs);
    }
    async function ramp(direction,sizes,base){
      const rows=direction==='download'?downloads:uploads;let size=sizes[0];
      for(let i=0;i<sizes.length;i++){
        size=sizes[i];onProgress({phase:direction,progress:base+Math.round(i/sizes.length*25),message:'Medindo '+direction+'…'});
        const result=await perform({direction,bytes:size,agent,signal,onProgress:value=>onProgress({phase:direction,progress:base+Math.round(i/sizes.length*25),message:'Medindo '+direction+'…',current:value})});
        rows.push(result);totalBytes+=result.bytes;colo=result.colo||colo;
        if(result.durationMs>=1250)break;
      }
      // Repeat the chosen size; report a median rather than an isolated peak.
      for(let i=0;i<2;i++){
        onProgress({phase:direction,progress:base+25+i*5,message:'Confirmando '+direction+' ('+(i+1)+'/2)…'});
        const result=await perform({direction,bytes:size,agent,signal,onProgress:value=>onProgress({phase:direction,progress:base+25+i*5,message:'Confirmando '+direction+'…',current:value})});
        rows.push(result);totalBytes+=result.bytes;colo=result.colo||colo;
      }
      const repeated=rows.slice(-3),valid=repeated.filter(r=>Number.isFinite(r.mbps));
      if(valid.length!==3)throw new Error('Não há três transferências válidas para '+direction+'.');
      return {mbps:median(valid.map(r=>r.mbps)),shortSamples:valid.some(r=>r.durationMs<250)};
    }
    const download=await ramp('download',[1*MiB,8*MiB,32*MiB,64*MiB],15);
    const upload=await ramp('upload',[1*MiB,4*MiB,16*MiB,32*MiB],55);
    await verifyResult?.();
    return {downloadMbps:download.mbps,uploadMbps:upload.mbps,latencyMs:median(latencies),jitterMs:latencyVariation(latencies),bytes:totalBytes,colo,provider:server.provider,serverId:server.id||null,serverName:server.name||null,serverAddress:server.address||null,method:'HTTP single connection / mediana de 3 transferências',scope:'PC via Huawei / caminho definido pelo PCC',shortSamples:download.shortSamples||upload.shortSamples};
  }finally{if(!externalAgent)agent.destroy();}
}

export function createSpeedTestService({root,dataDir=path.join(root,'data'),runMeasurement=measureInternet,cooldownSeconds=300,automaticIntervalSeconds=0,retentionDays=30,now=Date.now,onUpdate=()=>{},profiles=[],catalog=[],profileStatus=()=>({configured:false,ready:false,reason:'Aguardando configuração.'}),engines=null}){
  const filename=path.join(dataDir,'speedtest-history.json');let history=[],active=null,timer=null;
  const definitions=engines||[{id:'http',name:'ORBIT / HTTP',catalog,profileStatus,runMeasurement}],byEngine=Object.fromEntries(definitions.map(e=>[e.id,Object.fromEntries(profiles.map(p=>[p.name,'auto']))]));let engine=definitions[0].id;
  const settingsFile=path.join(dataDir,'speedtest-settings.json');
  try{const saved=JSON.parse(fs.readFileSync(settingsFile,'utf8'));if(definitions.some(e=>e.id===saved.engine))engine=saved.engine;for(const e of definitions){const choices=saved.servers?.[e.id]||(e.id==='http'?saved:{});for(const p of profiles)if(choices[p.name]==='auto'||e.catalog.some(s=>s.id===choices[p.name]&&(!s.links||s.links.includes(p.name))))byEngine[e.id][p.name]=choices[p.name];}}catch{}
  const definition=()=>definitions.find(e=>e.id===engine),serverSelections=()=>byEngine[engine];
  try{const saved=JSON.parse(fs.readFileSync(filename,'utf8'));if(Array.isArray(saved))history=saved.filter(r=>r&&Number.isFinite(r.time)&&['complete','error','cancelled'].includes(r.status));}catch{}
  history=history.filter(r=>r.time>=now()-retentionDays*86400000).slice(-2000);
  let state={status:'idle',phase:null,progress:0,message:history.length?'Último teste disponível.':'Nenhum teste realizado.',error:null};
  const lastAttempt=link=>history.slice().reverse().find(r=>link===undefined||r.link===link)||null;
  const successful=link=>history.slice().reverse().find(r=>r.status==='complete'&&(r.engine||'http')===engine&&(link===undefined||r.link===link))||null;
  const cooldownUntil=link=>{const last=lastAttempt(link);return last?last.time+cooldownSeconds*1000:null;};
  function snapshot(){const last=lastAttempt(),selected=definition();return {...state,engine,engineName:selected.name,engines:definitions.map(e=>({id:e.id,name:e.name,configured:profiles.every(p=>e.profileStatus(p).configured)})),mode:profiles.length?'per-wan':'pc',servers:selected.catalog.map(({id,name,provider,links})=>({id,name,provider,links})),serverSelections:{...serverSelections()},latest:successful(),history:history.slice(-2000),profiles:profiles.map(p=>({...p,...selected.profileStatus(p),serverChoice:serverSelections()[p.name],latest:successful(p.name),lastAttempt:lastAttempt(p.name),cooldownUntil:cooldownUntil(p.name)})),cooldownUntil:active?null:cooldownUntil(),cooldownSeconds,automaticIntervalSeconds,nextAutomaticAt:automaticIntervalSeconds>0?(last?.time??startedAt)+automaticIntervalSeconds*1000:null};}
  function publish(){onUpdate(snapshot());}
  function save(){history=history.filter(r=>r.time>=now()-retentionDays*86400000).slice(-2000);fs.mkdirSync(path.dirname(filename),{recursive:true});fs.writeFileSync(filename+'.tmp',JSON.stringify(history));fs.renameSync(filename+'.tmp',filename);}
  function saveSettings(nextEngine=engine){fs.mkdirSync(path.dirname(settingsFile),{recursive:true});fs.writeFileSync(settingsFile+'.tmp',JSON.stringify({engine:nextEngine,servers:byEngine}));fs.renameSync(settingsFile+'.tmp',settingsFile);}
  const startedAt=now();
  function start(trigger='manual',selection='all'){
    if(active)return {accepted:false,reason:'running',message:'Já há um teste em andamento.'};
    if(profiles.length&&selection!=='all'&&!profiles.some(p=>p.name===selection))return {accepted:false,reason:'selection',message:'Operadora inválida.'};
    let selected=profiles.length?profiles.filter(p=>selection==='all'||p.name===selection).map(p=>p.name):[undefined];
    const selectedEngine=definition(),jobEngine=engine;
    if(profiles.length){selected=selected.filter(name=>selectedEngine.profileStatus(profiles.find(p=>p.name===name)).configured);if(!selected.length)return {accepted:false,reason:'setup',message:'Configuração por operadora não confirmada no MikroTik.'};}
    selected=selected.filter(name=>(cooldownUntil(name)||0)<=now());if(!selected.length)return {accepted:false,reason:'cooldown',message:'Aguarde o intervalo mínimo entre testes desta operadora.'};
    const controller=new AbortController(),job={controller,promise:null};active=job;
    state={status:'running',phase:'latency',progress:0,message:'Iniciando medição…',error:null,startedAt:now(),activeLink:selected[0]||null,pendingLinks:selected};publish();
    job.promise=Promise.resolve().then(async()=>{
      let completed=0,failed=0;
      for(const link of selected){
        if(controller.signal.aborted)break;
        const begin=now(),deadlineController=new AbortController(),signal=AbortSignal.any([controller.signal,deadlineController.signal]);
        const timeoutSeconds=selectedEngine.timeoutSeconds||90,deadline=setTimeout(()=>deadlineController.abort(new Error('Teste excedeu '+timeoutSeconds+' segundos.')),timeoutSeconds*1000);deadline.unref();
        state={...state,activeLink:link||null,phase:'latency',progress:0,current:null,message:'Iniciando '+(link||'teste no PC')+'…'};publish();
        try{
          const result=await selectedEngine.runMeasurement({link,serverSelection:byEngine[jobEngine][link]||'auto',signal,onProgress:update=>{if(active!==job||signal.aborted)return;state={...state,...update};publish();}});
          if(signal.aborted)throw signal.reason||new Error('Teste cancelado.');
          if(!['downloadMbps','uploadMbps','latencyMs','jitterMs'].every(k=>Number.isFinite(result[k])&&result[k]>=0))throw new Error('Resultado de medição inválido.');
          if(profiles.length&&(result.link!==link||result.pathVerified!==true))throw new Error('Resultado sem confirmação da operadora; descartado.');
          history.push({...result,engine:jobEngine,time:now(),durationSeconds:(now()-begin)/1000,status:'complete',trigger});completed++;
        }catch(error){
          const cancelled=controller.signal.aborted, message=signal.aborted?signal.reason?.message||'Teste interrompido.':error.message;
          history.push({link,engine:jobEngine,time:now(),status:cancelled?'cancelled':'error',error:message,trigger,durationSeconds:(now()-begin)/1000});failed++;
          state={...state,error:message};
        }finally{clearTimeout(deadline);try{save();}catch(error){state={...state,storageError:'Não foi possível salvar o histórico: '+error.message};}}
      }
      const cancelled=controller.signal.aborted;
      state={...state,status:cancelled?'cancelled':completed?'complete':'error',phase:null,progress:completed?100:0,current:null,activeLink:null,pendingLinks:[],message:cancelled?'Teste cancelado pelo usuário.':failed?(completed+' concluído(s), '+failed+' falhou(aram). Confira o histórico.'):'Teste concluído.',error:failed?state.error:null};
    }).finally(()=>{
      if(active===job)active=null;
      try{save();}catch(error){state={...state,storageError:'Não foi possível salvar o histórico: '+error.message};}
      publish();
    });
    return {accepted:true,message:'Teste iniciado no PC coletor.'};
  }
  function cancel(){if(!active)return false;active.controller.abort(new Error('Teste cancelado pelo usuário.'));return true;}
  function setServer(link,id){
    if(active)return {accepted:false,message:'Aguarde terminar o teste para mudar de servidor.'};
    if(!profiles.some(p=>p.name===link)||(id!=='auto'&&!definition().catalog.some(s=>s.id===id&&(!s.links||s.links.includes(link)))))return {accepted:false,message:'Operadora ou servidor inválido.'};
    const previous=byEngine[engine][link];byEngine[engine][link]=id;try{saveSettings();}catch{byEngine[engine][link]=previous;return {accepted:false,message:'Não foi possível salvar a escolha de servidor.'};}
    publish();return {accepted:true,message:'Servidor salvo para '+link+'.'};
  }
  function setEngine(id){if(active)return {accepted:false,message:'Aguarde terminar o teste para mudar de motor.'};if(!definitions.some(e=>e.id===id))return {accepted:false,message:'Motor inválido.'};try{saveSettings(id);}catch{return {accepted:false,message:'Não foi possível salvar o motor.'};}engine=id;state={status:'idle',phase:null,progress:0,message:'Motor selecionado: '+definition().name+'.',error:null};publish();return {accepted:true,message:state.message};}
  if(automaticIntervalSeconds>0){timer=setInterval(()=>{const last=history.at(-1);if(now()-(last?.time??startedAt)>=automaticIntervalSeconds*1000)start('automatic');},Math.min(30000,automaticIntervalSeconds*1000));timer.unref();}
  return {snapshot,start,cancel,setServer,setEngine,async wait(){await active?.promise;},async close(){clearInterval(timer);if(active){cancel();await active.promise;}}};
}
