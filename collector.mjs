import fs from 'node:fs';
import path from 'node:path';
import { finite, counterRate, percentUsed, uptimeSeconds } from './telemetry.mjs';
import { createGeoConnections } from './geo-connections.mjs';
const { analyzeConnections, aggregateHistory, quality, wanHealth }=await import('./analysis.mjs?version='+Date.now());
const { crossedQuality }=await import('./cross-quality.mjs?version='+Date.now());

export function createCollector({root,dataDir=path.join(root,'data'),config,inventory,request,emit,performance,isAuthorized=()=>Boolean(process.env.MIKROTIK_USER&&process.env.MIKROTIK_PASSWORD),enabled=true,unavailableReason=''}) {
  const baseInterval=Math.max(2,Number(config.intervalSeconds)||2);
  const connectionInterval=Math.max(5,Number(config.connectionSeconds)||5);
  const detailsInterval=Math.max(20,Number(config.detailsSeconds)||30);
  const keepDays=Math.max(1,Math.min(30,Number(config.retentionDays)||7));
  if(enabled)fs.mkdirSync(dataDir,{recursive:true,mode:0o700});
  const qualitySeconds=config.crossQuality?.intervalSeconds??10;
  const monitoredInterfaces=new Set([...Object.values(config.wan),...(config.monitoredInterfaces||[])]);
  if(config.lanInterface)monitoredInterfaces.add(config.lanInterface);
  const history=[],details={},events=[],flowHistory=[];
  const geo=createGeoConnections({root,config:config.geoConnections||{}});
  let state=enabled?'pending':unavailableReason?'error':'disabled',error=enabled?'':unavailableReason||'Integração RouterOS desabilitada.',lastSuccess=null,latest=null,previous=new Map(),previousFlows=new Map(),lastUptime=null;
  let connections={state:enabled?'pending':'disabled',error:'',rows:[],count:null},lastDefaults=null,lastLinks=null,detailsPersisted=0;
  let generation=0,timers=[],running=false,lastCoreDuration=null,ipv6Failed=0;
  const authorized=()=>enabled&&isAuthorized();
  const interval=()=>latest?.cpu>60?Math.max(5,baseInterval):baseInterval;
  const pushEvent=(message,level='info')=>{events.push({time:Date.now(),message,level});if(events.length>200)events.shift();};
  const later=(fn,seconds,gen)=>{const timer=setTimeout(()=>{if(gen===generation)fn(gen);},seconds*1000);timer.unref();timers.push(timer);if(timers.length>100)timers=timers.slice(-30);};
  if(enabled)for(const name of fs.readdirSync(dataDir).filter(n=>/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n)).sort().slice(-2)){
    for(const line of fs.readFileSync(path.join(dataDir,name),'utf8').split('\n')){try{const sample=JSON.parse(line);if(sample.time>Date.now()-86400000)history.push(sample);}catch{}}
  }
  if(history.length>50000)history.splice(0,history.length-50000);
  function prune(){
    const cutoff=Date.now()-keepDays*86400000;
    for(const name of fs.readdirSync(dataDir))if(/^(?:details-)?\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)&&Date.parse(name.replace(/^details-/,'').slice(0,10)+'T00:00:00Z')+86400000<cutoff)fs.unlinkSync(path.join(dataDir,name));
  }
  let pruneTimer=null;if(enabled){prune();pruneTimer=setInterval(prune,3600000);pruneTimer.unref();}
  function append(prefix,value){try{fs.appendFileSync(path.join(dataDir,prefix+new Date().toISOString().slice(0,10)+'.jsonl'),JSON.stringify(value)+'\n');}catch(e){pushEvent('Não foi possível salvar o histórico no diretório de dados.','error');}}
  const health=()=>wanHealth({status:state,latest,details,inventory,coreMaxAgeMs:Math.max(20000,interval()*4000)});
  function alerts(healthRows=health()){
    const output=[];
    if(state==='error')output.push({severity:'critical',title:'Coleta indisponível',message:error});
    if(state==='live'&&latest?.cpu>=75)output.push({severity:'warning',title:'CPU elevada',message:latest.cpu+'% na última amostra'});
    if(state==='live'&&latest?.memoryPercent>=85)output.push({severity:'warning',title:'Memória elevada',message:Math.round(latest.memoryPercent)+'% em uso'});
    if(state==='live')for(const [name,iface] of Object.entries(config.wan)){
      const physical=latest?.interfaces.find(i=>i.name===iface),client=details.dhcpClients?.rows?.find(i=>i.interface===iface);
      if(physical?.running===false)output.push({severity:'warning',title:'Link físico indisponível: '+name,message:iface+' está sem link. Confira cabo, porta e equipamento da operadora.'});
      else if(details.dhcpClients?.state==='live'&&client&&client.status!=='bound')output.push({severity:'warning',title:'WAN sem endereço DHCP: '+name,message:iface+' · estado '+client.status});
    }
    if(state==='live')for(const i of latest?.interfaces||[])if(i.dropPps>0)output.push({severity:'warning',title:'Descartes recentes: '+i.name,message:i.dropPps.toFixed(2)+' pacotes/s na fila TX'});
    if(connections.fasttrack||connections.offloaded)output.push({severity:'info',title:'Cobertura de fluxos',message:'Há conexões FastTrack ou offload. Bytes observados podem ter cobertura parcial.'});
    if(connections.state==='error')output.push({severity:'warning',title:'Connection tracking indisponível',message:connections.error});
    if(state==='live')for(const h of healthRows){
      if(h.physicalUp&&h.state==='down')output.push({severity:'critical',title:h.link+': '+h.label,message:h.reason+(h.failoverTo?' Failover ativo para '+h.failoverTo+'.':'')});
      else if(h.state==='degraded')output.push({severity:'warning',title:h.link+': sonda degradada',message:h.reason});
      else if(h.state==='unknown')output.push({severity:'info',title:h.link+': estado não confirmado',message:h.reason});
    }
    return output;
  }
  const sampleState=()=>{const wanHealth=health();return {status:state,error,lastSuccess,latest,wanHealth,crossQuality:state==='live'&&config.crossQuality?.links?.length?crossedQuality(details,Date.now(),config.crossQuality.links):null,performance:performance(),alerts:alerts(wanHealth),cadence:{interfaces:interval(),connections:connectionInterval,details:detailsInterval,quality:qualitySeconds},credentialsReady:authorized()};};
  async function core(gen){
    if(gen!==generation)return;
    if(!authorized()){state='pending';error='Conecte a conta de leitura configurada para iniciar a coleta.';emit('sample',sampleState());return;}
    const started=Date.now();
    try{
      const resources=await request('system/resource');
      const raw=await request('interface/print',{stats:''});
      if(gen!==generation)return;
      const resource=Array.isArray(resources)?resources[0]:resources;
      if(!resource||!Array.isArray(raw))throw new Error('Formato de recursos/interfaces inesperado.');
      const now=Date.now(),up=uptimeSeconds(resource.uptime);
      if(lastUptime!==null&&up<lastUptime){previous.clear();previousFlows.clear();pushEvent('Reinicialização do MikroTik observada','warning');}
      lastUptime=up;
      const next=new Map();
      const interfaces=raw.map(i=>{
        const rx=finite(i['rx-byte']),tx=finite(i['tx-byte']),rxPackets=finite(i['rx-packet']),txPackets=finite(i['tx-packet']),drops=finite(i['tx-queue-drop']),old=previous.get(i.name),elapsed=old?(now-old.time)/1000:0;
        const rate=(value,key)=>old?counterRate(value,old[key],elapsed,Math.max(20,interval()*4)):null;
        const rxRate=rate(rx,'rx'),txRate=rate(tx,'tx');
        next.set(i.name,{rx,tx,rxPackets,txPackets,drops,time:now});
        return {name:i.name,type:i.type,running:String(i.running)==='true',rxBytes:rx,txBytes:tx,rxPackets,txPackets,drops,
          rxMbps:rxRate===null?null:rxRate*8/1e6,txMbps:txRate===null?null:txRate*8/1e6,
          rxPps:rate(rxPackets,'rxPackets'),txPps:rate(txPackets,'txPackets'),dropPps:rate(drops,'drops'),
          fastPathRxBytes:finite(i['fp-rx-byte']),fastPathTxBytes:finite(i['fp-tx-byte'])};
      });
      previous=next;
      const linkSignature=JSON.stringify(interfaces.filter(i=>Object.values(config.wan).includes(i.name)).map(i=>[i.name,i.running]));
      if(lastLinks&&lastLinks!==linkSignature)pushEvent('Mudança de estado físico nas WANs: '+linkSignature,'warning');lastLinks=linkSignature;
      const sensor=details.health?.rows||[];
      latest={time:now,cpu:finite(resource['cpu-load']),memoryPercent:percentUsed(resource['free-memory'],resource['total-memory']),
        freeMemory:finite(resource['free-memory']),totalMemory:finite(resource['total-memory']),freeDisk:finite(resource['free-hdd-space']),totalDisk:finite(resource['total-hdd-space']),
        diskPercent:percentUsed(resource['free-hdd-space'],resource['total-hdd-space']),badBlocks:finite(resource['bad-blocks']),writeSectors:finite(resource['write-sect-total']),
        model:resource['board-name'],version:resource.version,architecture:resource['architecture-name'],uptime:resource.uptime,interfaces,
        temperature:finite(sensor.find(s=>String(s.name).includes('temperature'))?.value),voltage:finite(sensor.find(s=>s.name==='voltage')?.value),
        quality:quality(details.netwatch?.rows||[],inventory,details.allRoutes?.rows||[]),crossQuality:crossedQuality(details,now)};
      history.push(latest);if(history.length>50000)history.shift();append('',latest);
      if(state==='error')pushEvent('Conexão com o MikroTik restabelecida');
      state='live';error='';lastSuccess=now;lastCoreDuration=Date.now()-started;
    }catch(e){if(gen!==generation)return;const message=e.message;if(state!=='error'||error!==message)pushEvent('Falha na coleta: '+message,'error');state='error';error=message;}
    emit('sample',sampleState());later(core,interval(),gen);
  }
  const connectionFields=['.id','protocol','src-address','src-port','dst-address','dst-port','reply-dst-address','reply-dst-port','connection-mark','tcp-state','timeout','orig-bytes','repl-bytes','orig-packets','repl-packets','fasttrack','hw-offload','srcnat','dstnat','seen-reply'];
  async function flows(gen){
    if(!authorized()||gen!==generation)return;
    try{
      const ipv4=await request('ip/firewall/connection/print',{'.proplist':connectionFields});
      let ipv6=[];
      if(ipv6Failed<3||Date.now()%60000<connectionInterval*1000){
        try{ipv6=await request('ipv6/firewall/connection/print',{'.proplist':connectionFields});details.ipv6Connections={state:'live',time:Date.now(),count:ipv6.length,error:''};ipv6Failed=0;}
        catch(e){ipv6Failed++;details.ipv6Connections={state:'error',error:e.message};}
      }
      if(!Array.isArray(ipv4)||!Array.isArray(ipv6))throw new Error('Formato de connection tracking inesperado.');
      const addresses={};for(const link of inventory.links){const client=details.dhcpClients?.rows?.find(r=>r.interface===link.interface);if(client?.address)addresses[client.address.split('/')[0]]=link.name;}
      const raw=[...ipv4.map(r=>({...r,family:'IPv4'})),...ipv6.map(r=>({...r,family:'IPv6'}))];
      const analyzed=analyzeConnections(raw,previousFlows,Date.now(),addresses,Math.max(30,connectionInterval*4));
      if(gen!==generation)return;
      previousFlows=analyzed.next;connections={state:'live',error:'',...analyzed.view};
      flowHistory.push({time:connections.time,count:connections.count,observedBps:connections.observedBps});if(flowHistory.length>1800)flowHistory.shift();
    }catch(e){connections={...connections,state:'error',error:e.message};}
    emit('connections',connections);
    try{const geoConnections=await geo.observe(connections,details);if(gen===generation)emit('geo',{geoConnections});}catch{if(gen===generation)emit('geo',{geoConnections:geo.snapshot('error')});}
    later(flows,latest?.cpu>60?Math.max(15,connectionInterval):connectionInterval,gen);
  }
  async function readDetails(gen){
    if(!authorized()||gen!==generation)return;
    const endpoints=[
      ['allRoutes','ip/route/print',{'.proplist':['.id','dst-address','routing-table','gateway','immediate-gw','active','disabled','blackhole','distance','check-gateway','comment']}],
      ['pcc','ip/firewall/mangle/print',{stats:''}],['pccDefinitions','ip/firewall/mangle'],
      ['nat','ip/firewall/nat/print',{stats:''}],['natDefinitions','ip/firewall/nat'],
      ['dhcpClients','ip/dhcp-client'],['leases','ip/dhcp-server/lease'],['arp','ip/arp'],['addresses','ip/address'],
      ['addressLists','ip/firewall/address-list/print',{'.proplist':['list','address','disabled','dynamic','comment']}],
      ['health','system/health'],['cpuCores','system/resource/cpu'],
      ['ethernet','interface/ethernet/print',{stats:''}],['ethernetConfig','interface/ethernet'],
      ['filter','ip/firewall/filter/print',{stats:''}],['filterDefinitions','ip/firewall/filter'],
      ['queues','queue/simple/print',{stats:''}],['queueDefinitions','queue/simple'],['queueTree','queue/tree/print',{stats:''}],['queueTreeDefinitions','queue/tree'],['netwatch','tool/netwatch/print',{stats:''}],
      ['logs','log/print',{'.proplist':['.id','time','topics','message']}],['dnsCache','ip/dns/cache'],
      ['tracking','ip/firewall/connection/tracking'],['trafficFlow','ip/traffic-flow']
    ];
    for(const [name,route,body] of endpoints){
      if(gen!==generation)return;
      try{
        const value=await request(route,body),rows=Array.isArray(value)?value:[value];
        details[name]={state:'live',time:Date.now(),rows:name==='logs'?rows.slice(-100):name==='dnsCache'?rows.slice(0,1000):rows,error:''};
      }catch(e){details[name]={...details[name],state:'error',error:e.message};}
    }
    for(const [name,definitions] of [['pcc','pccDefinitions'],['nat','natDefinitions'],['filter','filterDefinitions'],['ethernet','ethernetConfig'],['queues','queueDefinitions'],['queueTree','queueTreeDefinitions']]){
      if(details[name]?.state==='live'&&details[definitions]?.state==='live'){const stats=new Map(details[name].rows.map(r=>[r[".id"],r]));details[name].rows=details[definitions].rows.map(r=>({...r,...stats.get(r[".id"])}));}
    }
    if(details.ethernetConfig?.state==='live'){
      try{
        const rows=[];
        for(const item of details.ethernetConfig.rows.filter(r=>!monitoredInterfaces.size||monitoredInterfaces.has(r.name))){
          const value=await request('interface/ethernet/monitor',{numbers:item['.id'],once:''});
          rows.push(...(Array.isArray(value)?value:[value]).map(r=>({name:item.name,...r})));
        }
        details.ethernetMonitor={state:'live',time:Date.now(),rows,error:''};
      }catch(e){details.ethernetMonitor={...details.ethernetMonitor,state:'error',error:e.message};}
    }
    const all=details.allRoutes;
    if(all){details.routes={...all,rows:all.rows?.filter(r=>r['dst-address']==='0.0.0.0/0')||[]};
      if(all.state==='live'){const active=JSON.stringify(details.routes.rows.filter(r=>String(r.active)==='true').map(r=>[r['routing-table'],r['immediate-gw']||r.gateway]));if(lastDefaults&&active!==lastDefaults)pushEvent('Mudança nas rotas default ativas: '+active,'warning');lastDefaults=active;}}
    if(Date.now()-detailsPersisted>60000){append('details-',{time:Date.now(),details,events,connections:{state:connections.state,count:connections.count,protocols:connections.protocols,sources:connections.sources,destinations:connections.destinations}});detailsPersisted=Date.now();}
    emit('details',{details,events});later(readDetails,detailsInterval,gen);
  }
  async function probes(gen){
    if(!authorized()||gen!==generation)return;
    if(details.netwatch?.rows?.some(r=>String(r.comment).startsWith('ORBIT qualidade ')||String(r.comment).startsWith('ORBIT RTT '))){
      try{const rows=await request('tool/netwatch/print',{stats:''});if(gen!==generation)return;details.netwatch={state:'live',time:Date.now(),rows:Array.isArray(rows)?rows:[rows],error:''};}
      catch(e){if(gen!==generation)return;details.netwatch={...details.netwatch,state:'error',error:e.message};}
      if(gen!==generation)return;
      try{const rows=await request('ip/route/print',{'.proplist':['.id','dst-address','routing-table','gateway','immediate-gw','active','disabled','blackhole','distance','check-gateway','comment']});if(gen!==generation)return;details.allRoutes={state:'live',time:Date.now(),rows:Array.isArray(rows)?rows:[rows],error:''};details.routes={...details.allRoutes,rows:details.allRoutes.rows.filter(r=>r['dst-address']==='0.0.0.0/0')};}
      catch(e){if(gen!==generation)return;details.allRoutes={...details.allRoutes,state:'error',error:e.message};}
      if(gen===generation)emit('sample',sampleState());
    }
    later(probes,qualitySeconds,gen);
  }
  return {
    authenticationFailed(message){this.stop();state='auth-error';error=message;pushEvent(message,'error');emit('sample',sampleState());},
    start(){if(!enabled||running)return;if(!pruneTimer){pruneTimer=setInterval(prune,3600000);pruneTimer.unref();}running=true;generation++;const gen=generation;core(gen);flows(gen);readDetails(gen);probes(gen);},
    stop(){running=false;generation++;for(const t of timers)clearTimeout(t);timers=[];clearInterval(pruneTimer);pruneTimer=null;},
    snapshot(minutes=60){return {...sampleState(),revision:2,wan:config.wan,inventory,details,events,connections,geoConnections:geo.snapshot(connections.state),flowHistory,history:aggregateHistory(history,minutes),collector:{lastCoreDuration,retentionDays:keepDays}};},
    history(minutes){return aggregateHistory(history,minutes);}
  };
}
