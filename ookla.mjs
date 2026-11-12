import {processSocketsLinux} from './linux-sockets.mjs';
import fs from 'node:fs';
import dns from 'node:dns/promises';
import net from 'node:net';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {performance} from 'node:perf_hooks';
import {median,latencyVariation} from './speedtest.mjs';
import {publicIPv4,rankCandidates} from './server-selection.mjs';
import {inspectWanSetup} from './wan-speed.mjs';

const execute=promisify(execFile),yes=v=>v===true||v==='true'||v==='yes',enabled=r=>r&&!yes(r.disabled)&&!yes(r.invalid),plain=v=>String(v||'').replace(/\/32$/,'');
export function validateOoklaCatalog(catalog){
 if(!Array.isArray(catalog)||!catalog.length||catalog.length>20)throw new Error('Catálogo Ookla inválido.');
 const ids=new Set(),hosts=new Set();for(const row of catalog){if(!/^\d{1,8}$/.test(row.id)||ids.has(row.id)||typeof row.host!=='string'||!/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(row.host)||hosts.has(row.host)||row.port!==8080||!Array.isArray(row.links)||row.links.length!==1||!['WAN1','WAN2'].includes(row.links[0]))throw new Error('Servidor Ookla inválido ou compartilhado entre WANs.');ids.add(row.id);hosts.add(row.host);}return catalog;
}
export function inspectOoklaSetup(state,profile,catalog,now=Date.now()){
 const base=inspectWanSetup(state,profile,now);if(!base.configured)return base;
 const fail=reason=>({configured:false,ready:false,reason}),rules=state.details.pccDefinitions.rows,list=state.details.addressLists;
 if(list?.state!=='live'||now-list.time>90000)return fail('Aguardando listas de servidores Ookla.');
 const candidates=catalog.filter(s=>s.links.includes(profile.name)),listName='orbit-ookla-'+profile.name.toLowerCase(),otherName='orbit-ookla-'+(profile.name==='WAN1'?'wan2':'wan1');
 const entries=list.rows.filter(r=>r.list===listName&&enabled(r)),otherIPs=new Set(list.rows.filter(r=>r.list===otherName&&enabled(r)&&publicIPv4(plain(r.address))).map(r=>plain(r.address)));
 if(!candidates.length||!entries.length||entries.some(r=>!publicIPv4(plain(r.address))&&!candidates.some(s=>s.host===r.address))||candidates.some(s=>!entries.some(r=>r.address===s.host))||entries.some(r=>otherIPs.has(plain(r.address))))return fail('Listas Ookla ausentes, não autorizadas ou com IP compartilhado entre WANs.');
 const prefix='ORBIT Ookla '+profile.name+' ',pcc=rules.findIndex(r=>r['per-connection-classifier']);
 const routeRows=rules.filter(r=>r.comment===prefix+'routing');if(routeRows.length!==1)return fail('Importe ORBIT-OOKLA-LINKS.rsc uma vez.');const routing=routeRows[0];
 if(!enabled(routing)||routing.chain!=='prerouting'||routing['in-interface']!=='bridge'||plain(routing['src-address'])!==profile.routerSource||routing.action!=='mark-routing'||routing['connection-mark']!==profile.table||routing['new-routing-mark']!==profile.table||yes(routing.passthrough)||pcc<0||rules.indexOf(routing)>=pcc)return fail('Roteamento Ookla não confirmado.');
 for(const protocol of ['tcp','udp']){
  const rows=rules.filter(r=>r.comment===prefix+protocol.toUpperCase());if(rows.length!==1)return fail('Regras TCP/UDP Ookla não encontradas.');const r=rows[0];
  if(!enabled(r)||r.chain!=='prerouting'||r['in-interface']!=='bridge'||plain(r['src-address'])!==profile.routerSource||r.protocol!==protocol||Number(r['dst-port'])!==8080||r['dst-address-list']!==listName||!['','0.0.0.0/0'].includes(String(r['dst-address']||''))||String(r['src-port']||'')!==''||r['connection-state']!=='new'||r['connection-mark']!=='no-mark'||r.action!=='mark-connection'||r['new-connection-mark']!==profile.table||!yes(r.passthrough)||rules.indexOf(r)>=rules.indexOf(routing)||rules.indexOf(r)>=pcc)return fail('Classificação '+protocol.toUpperCase()+' Ookla não confirmada.');
 }
 return {...base,reason:base.ready?'Ookla: regras, destinos e rota exclusiva confirmados.':base.reason};
}
export function nativeConnectionProof(state,profile,server,ports,after,now=Date.now()){
 if(state?.connections?.state!=='live'||state.connections.time<after||now-state.connections.time>12000)return [];
 return state.connections.rows.filter(r=>r.protocol==='tcp'&&r.source===profile.routerSource&&ports.includes(r.sourcePort)&&server.addresses.includes(r.destination)&&r.destinationPort===server.port).map(r=>{
  if(r.mark!==profile.table||r.wan!==profile.name||r.fasttrack||r.offloaded)throw new Error('Ookla: conexão do processo observada pela WAN/marca incorreta; resultado descartado.');
  return {wan:r.wan,mark:r.mark,sourcePort:r.sourcePort,serverAddress:r.destination,routerId:r.routerId,origBytes:r.origBytes,replBytes:r.replBytes,verifiedAt:state.connections.time,state:r.state};
 });
}
export function normalizeOoklaResult(raw,server){
 if(raw?.type!=='result'||String(raw.server?.id)!==server.id||!server.addresses.includes(raw.server?.ip)||Number(raw.server?.port)!==server.port)throw new Error('Ookla retornou servidor/IP diferente do autorizado.');
 const number=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
 const download=number(raw.download?.bandwidth),upload=number(raw.upload?.bandwidth),latency=number(raw.ping?.latency),jitter=number(raw.ping?.jitter);
 if([download,upload,latency,jitter].some(v=>v===null))throw new Error('Resultado Ookla incompleto ou inválido.');
 let resultUrl=null;try{const url=new URL(raw.result?.url);if(url.origin==='https://www.speedtest.net'&&/^\/result\/c\/[a-f0-9-]+$/.test(url.pathname)&&!url.search&&!url.hash)resultUrl=url.href;}catch{}
 return {downloadMbps:download*8/1e6,uploadMbps:upload*8/1e6,latencyMs:latency,jitterMs:jitter,downloadLatencyMs:number(raw.download?.latency?.iqm),uploadLatencyMs:number(raw.upload?.latency?.iqm),downloadJitterMs:number(raw.download?.latency?.jitter),uploadJitterMs:number(raw.upload?.latency?.jitter),packetLossPercent:number(raw.packetLoss),bytes:(number(raw.download?.bytes)||0)+(number(raw.upload?.bytes)||0),provider:'Ookla',serverId:server.id,serverName:server.name,serverAddress:raw.server.ip,resultUrl,method:'Speedtest by Ookla / cliente oficial',latencyMetric:'Ookla / latência ociosa'};
}
export async function processSockets(pid){
 if(process.platform==='linux')return processSocketsLinux(pid);
 if(!Number.isInteger(pid)||pid<=0)throw new Error('PID inválido.');
 const script='@(Get-NetTCPConnection -OwningProcess '+pid+' -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,RemoteAddress,RemotePort) | ConvertTo-Json -Compress';
 const {stdout}=await execute('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:6000,maxBuffer:65536});
 if(!stdout.trim())return [];const parsed=JSON.parse(stdout);return Array.isArray(parsed)?parsed:[parsed];
}
export async function runOokla({binary,server,sourceIp,signal,onProgress=()=>{},observe=async()=>{},spawnProcess=spawn}){
 if(!fs.existsSync(binary))throw new Error('Instale o cliente oficial Ookla no caminho configurado.');
 return new Promise((resolve,reject)=>{
  const child=spawnProcess(binary,['--server-id='+server.id,'--ip='+sourceIp,'--format=jsonl','--progress=yes','--progress-update-interval=1000'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let buffer='',stderr='',result=null,total=0,phase=null,observerBusy=false,observerPromise=null,failure=null,closed=false;
  function stop(error){failure=failure||error;child.kill();}
  const abort=()=>stop(signal.reason||new Error('Teste Ookla cancelado.'));if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>stop(new Error('Tempo limite do cliente Ookla.')),120000);timer.unref();
  function observePhase(){if(observerBusy||closed||!['download','upload'].includes(phase))return;const observedPhase=phase;observerBusy=true;observerPromise=Promise.resolve().then(()=>observe(child.pid,observedPhase)).catch(stop).finally(()=>{observerBusy=false;});}
  const watcher=setInterval(observePhase,250);watcher.unref();
  function frame(text){let row;try{row=JSON.parse(text);}catch{return;}if(row.type==='result'){result=row;return;}if(row.type==='log'&&row.level==='error'){stop(new Error(String(row.message||'Erro no cliente Ookla.').slice(0,250)));return;}
   if(['ping','download','upload'].includes(row.type)){phase=row.type==='ping'?'latency':row.type;observePhase();const progress=row[row.type]?.progress;onProgress({phase,progress:phase==='latency'?5:phase==='download'?15+Math.round((progress||0)*40):55+Math.round((progress||0)*40),message:'Ookla: '+(phase==='latency'?'latência':phase==='download'?'download':'upload')+' · '+server.name,current:row[row.type]?{bytes:row[row.type].bytes,mbps:Number.isFinite(row[row.type].bandwidth)?row[row.type].bandwidth*8/1e6:null}:null});}
  }
  child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{total+=Buffer.byteLength(chunk);if(total>2e6){stop(new Error('Saída Ookla excessiva.'));return;}buffer+=chunk;let i;while((i=buffer.indexOf('\n'))!==-1){frame(buffer.slice(0,i));buffer=buffer.slice(i+1);}});
  child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-4000);});
  child.on('error',error=>{failure=error;});child.on('close',async code=>{closed=true;clearInterval(watcher);clearTimeout(timer);signal?.removeEventListener('abort',abort);if(buffer.trim())frame(buffer.trim());await observerPromise;
   if(failure||code!==0||!result){const message=failure?.message||(/license|accept|GDPR/i.test(stderr)?'Aceite os termos no terminal do PC antes de usar Ookla.':stderr.trim().slice(0,250)||'Cliente Ookla não retornou resultado completo.');reject(new Error(message));}else resolve(normalizeOoklaResult(result,server));
  });
 });
}

async function candidateProbe({server,profile,getRouterSnapshot,signal}){
 const sockets=[],samples=[],ports=[];const after=Date.now();
 try{
  for(let i=0;i<3;i++){
   const started=performance.now();const socket=net.connect({host:server.addresses[0],port:server.port,signal});sockets.push(socket);socket.on('error',()=>{});socket.setKeepAlive(true,1000);
   await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Servidor não respondeu à conexão TCP.')),3500);socket.once('connect',()=>{clearTimeout(timer);ports.push(socket.localPort);samples.push(performance.now()-started);resolve();});socket.once('error',error=>{clearTimeout(timer);reject(error);});});
  }
  const until=Date.now()+11000;while(Date.now()<until){if(signal?.aborted)throw signal.reason;const proofs=nativeConnectionProof(getRouterSnapshot(),profile,server,ports,after);if(new Set(proofs.map(p=>p.sourcePort)).size===ports.length)return {latencyMs:median(samples),jitterMs:latencyVariation(samples)};await delay(300,undefined,{signal});}
  throw new Error('Sonda TCP sem confirmação da WAN no MikroTik.');
 }finally{for(const socket of sockets)socket.destroy();}
}
export function createOoklaMeasurement({profiles,catalog,binary,sourceIp,getRouterSnapshot,resolve=dns.lookup,probe=candidateProbe,measure=runOokla,sockets=processSockets}){
 validateOoklaCatalog(catalog);
 return async({link,serverSelection='auto',signal,onProgress=()=>{}})=>{
  const profile=profiles.find(p=>p.name===link);if(!profile)throw new Error('Operadora inválida.');const setup=inspectOoklaSetup(getRouterSnapshot(),profile,catalog);if(!setup.ready)throw new Error(setup.reason);
  const allowed=catalog.filter(s=>s.links.includes(link)&&(serverSelection==='auto'||s.id===serverSelection));if(!allowed.length)throw new Error('Servidor não autorizado para esta operadora.');
  const candidates=[],resolved=new Map();for(const item of allowed){if(signal?.aborted)throw signal.reason;onProgress({phase:'selection',progress:0,message:'Comparando TCP: '+item.name+' pela '+link+'…'});
   try{const addresses=(await resolve(item.host,{family:4,all:true})).map(r=>r.address);if(!addresses.length||addresses.some(ip=>!publicIPv4(ip)))throw new Error('DNS Ookla não retornou somente IPv4 públicos.');const list=getRouterSnapshot().details.addressLists.rows.filter(r=>r.list==='orbit-ookla-'+link.toLowerCase()&&enabled(r));if(addresses.some(ip=>!list.some(r=>plain(r.address)===ip)))throw new Error('IPv4 do servidor ausente da lista autorizada no MikroTik.');const server={...item,addresses};const comparison=await probe({server,profile,getRouterSnapshot,signal});candidates.push({...comparison,id:item.id,name:item.name,eligible:true,wanConfirmed:true,metric:'TCP'});resolved.set(item.id,server);}catch(error){if(signal?.aborted)throw signal.reason;candidates.push({id:item.id,name:item.name,eligible:false,error:error.message,metric:'TCP'});}
  }
  const ranked=rankCandidates(candidates);if(!ranked.length)throw new Error('Nenhum servidor Ookla respondeu com WAN confirmada. '+candidates.map(c=>c.error).join(' | '));const attempts=[];let totalBytes=0;
  for(const winner of ranked.slice(0,serverSelection==='auto'?2:1)){
  const server=resolved.get(winner.id),proofs={},observations={},phasePorts={download:new Set(),upload:new Set()},began=Date.now();
  try{
  const result=await measure({binary,server,sourceIp,signal,onProgress,observe:async(pid,phase)=>{
   const state=getRouterSnapshot(),current=inspectOoklaSetup(state,profile,catalog);if(!current.ready)throw new Error(current.reason);
   const processRows=await sockets(pid),own=processRows.filter(s=>String(s.LocalAddress).replace(/^::ffff:/,'')===sourceIp&&server.addresses.includes(String(s.RemoteAddress).replace(/^::ffff:/,''))&&Number(s.RemotePort)===server.port),ports=own.map(s=>Number(s.LocalPort));
   // Keep ports actually seen on this process in this direction. RouterOS may
   // publish its next snapshot after Ookla has already closed those sockets.
   for(const port of ports)phasePorts[phase].add(port);
   const matches=nativeConnectionProof(getRouterSnapshot(),profile,server,[...phasePorts[phase]],began),payload=phase==='download'?'replBytes':'origBytes',found=matches.find(p=>p[payload]>65536);observations[phase]={samples:(observations[phase]?.samples||0)+1,ports:ports.length,observedPorts:phasePorts[phase].size,matches:matches.length,otherEndpoints:processRows.filter(r=>!own.includes(r)).map(r=>({local:r.LocalAddress,remote:r.RemoteAddress,port:r.RemotePort})).slice(0,8)};if(found)proofs[phase]={...found,processId:pid,verification:'own-process-connection-during-'+phase};
  }});
  totalBytes+=result.bytes||0;
  const finalState=getRouterSnapshot();if(!inspectOoklaSetup(finalState,profile,catalog).ready)throw new Error('Rota Ookla indisponível ao terminar; resultado descartado.');
  // Ookla closes transfer sockets before completing its packet-loss phase.
  // Require real per-direction process/socket observations and an active final
  // route; permit the following short loss-measurement interval in the age check.
  if(!proofs.download||!proofs.upload||Date.now()-proofs.upload.verifiedAt>30000){const error=new Error('Ookla sem prova recente das conexões do processo; download='+Boolean(proofs.download)+', upload='+Boolean(proofs.upload)+', observações='+JSON.stringify(observations)+'. Resultado descartado.');error.retryable=true;throw error;}
  return {...result,bytes:totalBytes,link,interface:profile.interface,pathVerified:true,pathProof:{download:proofs.download,upload:proofs.upload,routeCheckedAt:finalState.details.allRoutes.time},scope:'Coletor / '+link+' confirmada no MikroTik',serverSelection,serverCandidates:candidates,serverAttempts:attempts,selectionMetric:'Mediana de 3 conexões TCP; menor latência entre servidores autorizados desta WAN com medição confirmada'};
  }catch(error){if(signal?.aborted||!error.retryable||serverSelection!=='auto')throw error;attempts.push({id:server.id,name:server.name,error:error.message});const row=candidates.find(c=>c.id===server.id);row.eligible=false;row.error='Medição não confirmou ambas as transferências; resultado descartado.';onProgress({phase:'selection',progress:0,message:'Medição descartada em '+server.name+'. Tentando o próximo servidor autorizado desta WAN…'});}
  }
  throw new Error('Servidores Ookla testados sem comprovação das duas etapas; '+attempts.map(a=>a.name+': '+a.error).join(' | '));
 };
}
