import {setTimeout as delay} from 'node:timers/promises';
import https from 'node:https';
import {measureInternet,transfer,median,latencyVariation} from './speedtest.mjs';
import {publicIPv4,resolveServer,rankCandidates,validateCatalog} from './server-selection.mjs';
const yes=value=>value===true||value==='true'||value==='yes';
const enabled=row=>row&&!yes(row.disabled)&&!yes(row.invalid);
const plainIp=value=>String(value||'').replace(/\/32$/,'');

export function inspectWanSetup(state,profile,now=Date.now()){
 const fail=reason=>({configured:false,ready:false,reason});
 if(state?.status!=='live'||!state.credentialsReady||now-state.lastSuccess>15000)return fail('Coleta do MikroTik indisponível ou desatualizada.');
 const definitions=state.details?.pccDefinitions,routes=state.details?.allRoutes;
 if(definitions?.state!=='live'||routes?.state!=='live'||now-definitions.time>90000||now-routes.time>90000)return fail('Aguardando leitura atual das regras e rotas.');
 const rules=definitions.rows||[],prefix='ORBIT speed '+profile.name+' ';
 const connections=rules.filter(r=>r.comment===prefix+'connection'),routing=rules.filter(r=>r.comment===prefix+'routing');
 if(connections.length!==1||routing.length!==1)return fail('Importe ORBIT-VELOCIDADE-LINKS.rsc no MikroTik.');
 const [connection]=connections,[routeRule]=routing;
 if(!enabled(connection)||!enabled(routeRule))return fail('Regras do teste desabilitadas ou inválidas.');
 const ports=profile.localPorts||[profile.localPort],actualPorts=String(connection['src-port']).split(',').map(Number);
 let destinationOk=plainIp(connection['dst-address'])===profile.serverAddress;
 if(profile.serverList){
  const list=state.details?.addressLists;if(list?.state!=='live'||now-list.time>90000)return fail('Aguardando lista de servidores autorizados.');
  const entries=(list.rows||[]).filter(r=>r.list===profile.serverList&&enabled(r));
  if(!entries.length||entries.some(r=>!publicIPv4(plainIp(r.address))&&!profile.serverHosts?.includes(r.address)))return fail('Lista de servidores ausente ou contém destinos não autorizados.');
  destinationOk=connection['dst-address-list']===profile.serverList&&['','0.0.0.0/0'].includes(String(connection['dst-address']||''))&&(!profile.serverAddress||entries.some(r=>plainIp(r.address)===profile.serverAddress));
 }
 if(connection.chain!=='prerouting'||connection.action!=='mark-connection'||connection['in-interface']!=='bridge'||plainIp(connection['src-address'])!==profile.routerSource||!destinationOk||connection.protocol!=='tcp'||actualPorts.length!==ports.length||!ports.every(p=>actualPorts.includes(p))||!ports.includes(profile.localPort)||Number(connection['dst-port'])!==443||connection['connection-state']!=='new'||connection['connection-mark']!=='no-mark'||connection['new-connection-mark']!==profile.table||!yes(connection.passthrough))return fail('Identificação do tráfego difere da configuração do medidor.');
 if(routeRule.chain!=='prerouting'||routeRule['in-interface']!=='bridge'||routeRule.action!=='mark-routing'||routeRule['connection-mark']!==profile.table||routeRule['new-routing-mark']!==profile.table||yes(routeRule.passthrough))return fail('Regra de roteamento do teste não confirmada.');
 const firstPcc=rules.findIndex(r=>r['per-connection-classifier']);
 if(firstPcc<0||rules.indexOf(connection)>=firstPcc||rules.indexOf(routeRule)>=firstPcc||rules.indexOf(connection)>=rules.indexOf(routeRule))return fail('As regras do teste precisam preceder os classificadores PCC.');
 const defaults=(routes.rows||[]).filter(r=>r['routing-table']===profile.table&&r['dst-address']==='0.0.0.0/0'&&enabled(r));
 const primary=defaults.find(r=>r.comment===prefix+'route'),block=defaults.find(r=>r.comment===prefix+'block');
 if(defaults.length!==2||!primary||!block||!(block.blackhole===''||yes(block.blackhole))||Number(block.distance)!==254||Number(primary.distance)!==1||!([profile.probe,profile.probe+'@main'].includes(primary.gateway)))return fail('Tabela exclusiva ou rota de bloqueio não confirmada.');
 const probe=(routes.rows||[]).filter(r=>r['routing-table']==='main'&&r['dst-address']===profile.probe+'/32'&&enabled(r));
 if(probe.length!==1||!([profile.gateway,profile.gateway+'%'+profile.interface].includes(probe[0].gateway)))return fail('Rota recursiva da operadora não confirmada.');
 const path=profile.gateway+'%'+profile.interface;
 const ready=yes(primary.active)&&primary['immediate-gw']===path&&yes(probe[0].active)&&probe[0]['immediate-gw']===path;
 return {configured:true,ready,reason:ready?'Roteamento exclusivo confirmado.':'Link sem rota ativa pela interface esperada.'};
}

export function confirmTestConnection(state,profile,after,now=Date.now(),allowClosing=false){
 if(state?.connections?.state!=='live'||state.connections.time<after||now-state.connections.time>12000)return null;
 const rows=state.connections.rows.filter(r=>r.protocol==='tcp'&&r.source===profile.routerSource&&r.sourcePort===profile.localPort&&r.destination===profile.serverAddress&&r.destinationPort===443);
 if(rows.length!==1)return null;
 const row=rows[0];
 if(row.mark!==profile.table||row.wan!==profile.name||row.fasttrack||row.offloaded)throw new Error('Caminho não confirmado: esperado '+profile.name+', observado '+(row.wan||'desconhecido')+' / '+row.mark+'. Resultado descartado.');
 if(row.state!=='established'&&!(allowClosing&&['close','close-wait','fin-wait','last-ack','time-wait'].includes(row.state)))return null;
 return {wan:row.wan,mark:row.mark,sourcePort:row.sourcePort,serverAddress:profile.serverAddress,verifiedAt:state.connections.time,routerId:row.routerId,state:row.state,origBytes:row.origBytes,replBytes:row.replBytes};
}

function verifiedContext({profile,getRouterSnapshot,signal,onProgress=()=>{},server=null}){
  const setup=inspectWanSetup(getRouterSnapshot(),profile);if(!setup.ready)throw new Error(profile.name+': '+setup.reason);
  let proof=null,observedProof=null,lastSocketProof=null,bulkStartedAt=null,observationError=null,activeDirection=null;const sockets=new WeakSet();
  function observe(){
   if(!lastSocketProof)return;
   try{const found=confirmTestConnection(getRouterSnapshot(),profile,lastSocketProof.verifiedAt,Date.now(),true);
    const payloadSeen=activeDirection==='upload'?found?.origBytes>65536:found?.replBytes>65536;
    if(found&&found.routerId===lastSocketProof.routerId&&payloadSeen&&found.verifiedAt>=bulkStartedAt)observedProof={...found,observedDirection:activeDirection};
   }catch(error){observationError=error;}
  }
  async function verify(after,allowClosing=false){
   onProgress({phase:'verification',message:'Confirmando saída pela '+profile.name+' no MikroTik…'});
   const until=Date.now()+11000;
   while(Date.now()<until){
    if(signal?.aborted)throw signal.reason;
    const state=getRouterSnapshot(),current=inspectWanSetup(state,profile);
    if(!current.ready)throw new Error(profile.name+': '+current.reason);
    const found=confirmTestConnection(state,profile,after,Date.now(),allowClosing);if(found){proof=found;return;}
    await delay(300,undefined,{signal});
   }
   throw new Error('Não foi possível confirmar a conexão '+profile.name+' no MikroTik. NAT/telemetria sem confirmação; resultado descartado.');
  }
  const options={signal,server:server||undefined,onProgress:update=>{if(['download','upload'].includes(update.phase))activeDirection=update.phase;if(update.phase==='download'&&bulkStartedAt===null)bulkStartedAt=Date.now();observe();onProgress(update);},
   agentOptions:{localPort:profile.localPort,family:4,lookup:(host,dnsOptions,callback)=>callback(null,profile.serverAddress,4)},
   verifySocket:async socket=>{if(sockets.has(socket))return;if(socket.localPort!==profile.localPort)throw new Error('Porta de origem do teste incorreta.');await verify(Date.now());lastSocketProof=proof;observedProof=null;sockets.add(socket);},
   verifyResult:async()=>{
    // The provider can close TCP before the next 5s RouterOS snapshot. Retain a
    // real bulk-transfer observation for the last verified session, not a label.
    observe();if(observationError)throw observationError;
    const state=getRouterSnapshot(),setup=inspectWanSetup(state,profile);if(!setup.ready)throw new Error(profile.name+': '+setup.reason);
    if(observedProof&&Date.now()-observedProof.verifiedAt<=12000){proof={...observedProof,verification:'connection-observed-during-transfer',routeCheckedAt:state.details.allRoutes.time};return;}
    await verify(Date.now(),true);proof={...proof,verification:'connection-confirmed-after-transfer',routeCheckedAt:getRouterSnapshot().details.allRoutes.time};
   }};
  const agent=new https.Agent({keepAlive:true,maxSockets:1,minVersion:'TLSv1.2',...options.agentOptions});options.externalAgent=agent;
  let warmTimer=null,warmPromise=null;
  const probe=()=>transfer({direction:'download',bytes:0,agent,signal,server:server||undefined,verifySocket:options.verifySocket,timeoutMs:15000});
  return {options,agent,probe,proof:()=>proof,
   keepWarm(){warmTimer=setInterval(()=>{if(warmPromise||signal?.aborted)return;warmPromise=probe().catch(()=>{}).finally(()=>{warmPromise=null;});},1000);warmTimer.unref();},
   async stopWarm(){clearInterval(warmTimer);await warmPromise;},
   async close(){await this.stopWarm();agent.destroy();}};
}

export function createWanMeasurement({profiles,getRouterSnapshot,measure=measureInternet,catalog=[],resolve=resolveServer}){
 if(catalog.length)validateCatalog(catalog);
 return async({link,signal,onProgress=()=>{},serverSelection='auto'})=>{
  const base=profiles.find(p=>p.name===link);if(!base)throw new Error('Operadora inválida.');
  if(!catalog.length){const context=verifiedContext({profile:base,getRouterSnapshot,signal,onProgress});try{const result=await measure(context.options),proof=context.proof();if(!proof)throw new Error('Medição sem comprovação da WAN.');return {...result,link:base.name,interface:base.interface,scope:'Coletor / '+base.name+' confirmada no MikroTik',pathVerified:true,pathProof:proof};}finally{await context.close();}}
  if(serverSelection!=='auto'&&!catalog.some(s=>s.id===serverSelection))throw new Error('Servidor inválido.');
  const candidates=[],contexts=new Map();
  try{
   for(let index=0;index<catalog.length;index++){
    const item=catalog[index];if(serverSelection!=='auto'&&item.id!==serverSelection)continue;
    if(signal?.aborted)throw signal.reason;
    onProgress({phase:'selection',progress:0,message:'Comparando '+item.name+' pela '+base.name+'…'});
    let context;
    try{
     const server=await resolve(item),profile={...base,serverAddress:server.address,localPort:base.localPorts[index]};
     context=verifiedContext({profile,getRouterSnapshot,signal,onProgress,server});
     const latencies=[];for(let sample=0;sample<4;sample++){const result=await context.probe();if(sample)latencies.push(result.latencyMs);}
     const row={id:server.id,name:server.name,address:server.address,eligible:true,latencyMs:median(latencies),jitterMs:latencyVariation(latencies),wanConfirmed:true};candidates.push(row);contexts.set(server.id,{context,server,profile});context.keepWarm();
    }catch(error){await context?.close();if(signal?.aborted)throw signal.reason;candidates.push({id:item.id,name:item.name,eligible:false,error:error.message});}
   }
   const ranked=rankCandidates(candidates),winner=ranked[0];if(!winner)throw new Error('Nenhum servidor respondeu com WAN confirmada. '+candidates.map(r=>r.name+': '+r.error).join(' | '));
   const {context,server,profile}=contexts.get(winner.id);await context.stopWarm();
   onProgress({phase:'selection',message:'Selecionado '+server.name+' · HTTP '+winner.latencyMs.toFixed(2)+' ms · '+base.name});
   const result=await measure(context.options),proof=context.proof();if(!proof)throw new Error('Medição sem comprovação da WAN.');
   return {...result,link:base.name,interface:base.interface,scope:'Coletor / '+base.name+' confirmada no MikroTik',pathVerified:true,pathProof:proof,serverId:server.id,serverName:server.name,serverAddress:profile.serverAddress,serverSelection,serverCandidates:candidates,selectionMetric:'Mediana de 3 respostas HTTP após aquecimento; menor latência entre disponíveis'};
  }finally{await Promise.all([...contexts.values()].map(c=>c.context.close()));}
 };
}
