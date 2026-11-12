import { lineChart,donut,colors } from './charts.js';
import { initHuawei } from './huawei-ui.js';
import { initActivityMonitor,decorateTrafficCell } from './activity.js';
import { createActivityClock } from './activity-model.mjs';
import { initNavigation } from './navigation.js';
import { initHostPanel } from './host-panel.js';
import { initEnergyPanel } from './energy-panel.js';
import { initGeoConnections } from './geo-connections.js';
import { initListControls } from './list-controls.js';
import { displayText, sanitizeExport } from './display-sanitize.js';
import { CROSS_TARGETS } from '../cross-quality.mjs';
const el=id=>document.getElementById(id);
const role=document.querySelector('meta[name="orbit-role"]')?.content||'monitor';
const localAdministration=role!=='lan';
const collectorAdministration=role==='monitor'||role==='lan'&&location.protocol==='https:';
let data=null,history=[],paused=false,buffer=null,stream=null,flowHistory=[],dnsNames=new Map(),pollTimer=null,pollBusy=false,lastStreamEvent=0;
let speedData=null,speedBusy=false;
let activityMonitor=null;
const activityClock=createActivityClock();
let hostPanel=null;
let huaweiInitialized=false;
let energyPanel=null;
let geoPanel=null;
const fmt=(v,d=1)=>Number.isFinite(v)?v.toLocaleString('pt-BR',{maximumFractionDigits:d}):'—';
const numeric=v=>v===null||v===undefined||String(v).trim()===''?null:Number.isFinite(Number(v))?Number(v):null;
const mbps=v=>fmt(v,Number.isFinite(v)&&v<1?3:2);
const rate=v=>Number.isFinite(v)?(v>0&&v<.1?fmt(v*1000,2)+' kbps':mbps(v)+' Mbps'):'—';
const bytes=v=>!Number.isFinite(v)?'—':v>=1e9?fmt(v/1e9,2)+' GB':v>=1e6?fmt(v/1e6,1)+' MB':v>=1000?fmt(v/1000,1)+' kB':fmt(v,0)+' B';
const throughput=v=>Number.isFinite(v)?rate(v*8/1e6):'—';
const sumBytes=entry=>Number.isFinite(entry.origBytes)&&Number.isFinite(entry.replBytes)?entry.origBytes+entry.replBytes:null;
const namesFor=ip=>(dnsNames.get(ip)||[]).slice(0,3).join(', ');
const time=v=>v?new Date(v).toLocaleTimeString('pt-BR'):'—';
const text=(id,value)=>{el(id).textContent=displayText(value);};
const div=(className,value)=>{const node=document.createElement('div');node.className=className;if(value!==undefined)node.textContent=displayText(value);return node;};
function closeDialog(dialog){if(typeof dialog.close==='function')dialog.close();else{dialog.removeAttribute('open');dialog.classList.remove('dialog-fallback');document.querySelectorAll('.dialog-shade').forEach(node=>node.remove());}}
function openDialog(dialog){if(typeof dialog.showModal==='function'){dialog.showModal();return;}const shade=div('dialog-shade');shade.onclick=()=>closeDialog(dialog);document.body.append(shade);dialog.setAttribute('open','');dialog.classList.add('dialog-fallback');dialog.querySelector('button')?.focus();}
document.addEventListener('keydown',event=>{if(event.key==='Escape')document.querySelectorAll('dialog[open]').forEach(closeDialog);});
function table(id,rows,empty='Aguardando leitura',columns=5){
 const body=el(id);body.replaceChildren();
 if(!rows.length){const cell=body.insertRow().insertCell();cell.colSpan=columns;cell.className='empty';cell.textContent=empty;return;}
 for(const values of rows){const row=body.insertRow();for(const value of values)row.insertCell().textContent=displayText(value);}
}
const viewModeSelect=el('view-mode'),hideIdentifiersToggle=el('hide-identifiers'),deviceFilter=el('device-filter');
function renderRouterAddress(){text('router-address',hideIdentifiersToggle.checked?'•••.•••.•••.•••':data?.inventory?.router?.ip||'Roteador');}
function applyDisplaySettings(){
 const mode=viewModeSelect.value==='detailed'?'detailed':'summary';
 const wasMasking=document.body.classList.contains('mask-identifiers');
 document.body.dataset.viewMode=mode;
 try{localStorage.setItem('orbit-display-mode',mode);localStorage.setItem('orbit-display-hide-identifiers',String(hideIdentifiersToggle.checked));}catch{}
 document.body.classList.toggle('mask-identifiers',hideIdentifiersToggle.checked);
 if(wasMasking!==hideIdentifiersToggle.checked){document.querySelectorAll('dialog[open]').forEach(closeDialog);document.querySelectorAll('.chart-tooltip').forEach(node=>{node.hidden=true;});}
 renderRouterAddress();
 renderDetails();
 document.dispatchEvent(new CustomEvent('orbit-display-change'));
}
try{viewModeSelect.value=localStorage.getItem('orbit-display-mode')==='detailed'?'detailed':'summary';hideIdentifiersToggle.checked=localStorage.getItem('orbit-display-hide-identifiers')==='true';}catch{}
document.body.dataset.viewMode=viewModeSelect.value;
document.body.classList.toggle('mask-identifiers',hideIdentifiersToggle.checked);
renderRouterAddress();
viewModeSelect.onchange=applyDisplaySettings;
hideIdentifiersToggle.onchange=applyDisplaySettings;
deviceFilter.onchange=renderDetails;
function stamp(detail){return !detail?'Pendente':detail.state==='live'?'Leitura '+time(detail.time):'Falha · anterior '+time(detail.time);}
function sampleInterface(sample,name){return sample?.interfaces?.find(i=>i.name===name);}
function wan(name,sample=data?.latest){return sampleInterface(sample,data?.wan?.[name]);}
function renderQuality(){
 const container=el('quality-rows');container.replaceChildren();
 for(const link of data?.inventory?.links||[]){const health=data.wanHealth?.find(h=>h.link===link.name),q=health?.probe,node=div('quality-cell'),title=document.createElement('h4'),body=document.createElement('p');title.textContent=link.name+' / '+(q?.host||link.probe);
   body.textContent=data.status==='live'&&q?.fresh&&q.configured?'RTT '+fmt(q.rttMs,2)+' ms · jitter '+fmt(q.jitterMs,2)+' ms\nPerda '+fmt(q.lossPercent)+'% · '+health.label+'\n'+(q.pathVerified?'Caminho da sonda confirmado':'Caminho da sonda não confirmado')+(health.failoverTo?' · Failover para '+health.failoverTo:''):'Sem resultado atual confirmado. '+(health?.reason||'Aguardando leitura.');node.append(title,body);container.append(node);}
}
function renderCrossQuality(){
 const q=data?.crossQuality,live=data?.status==='live';
 const healthy=q?.complete&&q.links.every(l=>l.state==='up');
 text('cross-state',!live?'SEM LEITURA':!q?.configured?'AGUARDANDO INSTALAÇÃO':healthy?'3 DESTINOS COMPARÁVEIS':q.complete?'SONDAS DEGRADADAS':'COMPARAÇÃO PARCIAL');
 el('cross-state').className='tag '+(live&&q?.configured?(healthy?'up':'warn'):'');
 text('cross-method',!q?.configured?'Aguardando as seis sondas ORBIT RTT no MikroTik. As sondas originais permanecem disponíveis no seletor do gráfico.':'Média dos mesmos destinos com resposta nas duas WANs · '+q.commonTargets.length+'/3 comparáveis · perda inclui os pacotes sem resposta. Falhas permanecem visíveis abaixo.');
 for(const name of ['WAN1','WAN2']){
   const prefix=name.toLowerCase(),link=q?.links.find(l=>l.link===name);
   text('cross-'+prefix+'-mean',live?fmt(link?.meanRttMs,2)+' ms':'—');
   text('cross-'+prefix+'-coverage',live&&q?.configured?(link?.respondingTargets??0)+'/3 destinos respondendo · '+(link?.comparableTargets??0)+'/3 na média':'Sondas cruzadas ainda não confirmadas');
   text('cross-'+prefix+'-loss',live&&q?.configured?'Perda '+fmt(link?.lossPercent,2)+'% · '+(link?.verifiedTargets??0)+'/3 sondas verificadas'+(!link?.lossComplete?' · PARCIAL':''):'Perda: aguardando testes');
 }
 table('cross-rows',CROSS_TARGETS.map(target=>{
   const v=live?q?.samples.find(s=>s.link==='WAN1'&&s.target===target.id):null,f=live?q?.samples.find(s=>s.link==='WAN2'&&s.target===target.id):null;
   const label=s=>!s?.verified?'Não confirmado':s.received===0?'Sem resposta':s.state==='degraded'?'Degradado':'Respondendo';
   return [target.name,target.host,fmt(v?.verified?v.rttMs:null,2)+' ms',fmt(f?.verified?f.rttMs:null,2)+' ms',fmt(v?.verified?v.lossPercent:null,1)+'%',fmt(f?.verified?f.lossPercent:null,1)+'%',v?.verified&&f?.verified&&Number.isFinite(v.rttMs)&&Number.isFinite(f.rttMs)?fmt(v.rttMs-f.rttMs,2)+' ms':'—','WAN1: '+label(v)+' · WAN2: '+label(f)];
 }),'Aguardando sondas',8);
 [...el('cross-rows').rows].forEach((row,index)=>{row.onclick=()=>{const target=CROSS_TARGETS[index];if(!target)return;const samples=q?.samples.filter(s=>s.target===target.id)||[];text('flow-detail',JSON.stringify(sanitizeExport({destino:target.name,ip:target.host,metodo:q?.method,sondas:samples}),null,2));openDialog(el('flow-dialog'));};});
 text('cross-time',q?.time?'Última leitura '+time(q.time):'Testes a cada 10 segundos');
}
function latencyValue(sample,link,key,view){
 if(view==='legacy'){const probe=sample.quality?.find(q=>q.link===link);return probe?.pathVerified?probe[key]:null;}
 const crossed=sample.crossQuality;if(!crossed?.configured)return null;
 if(view==='mean'){const summary=crossed.links.find(l=>l.link===link);return key==='rttMs'?summary?.meanRttMs:summary?.lossPercent;}
 const probe=crossed.samples.find(s=>s.link===link&&s.target===view);return probe?.verified?probe[key]:null;
}
function miniStat(container,label,value){const node=div('');const small=document.createElement('small');small.textContent=label;addHelp(small,label);const b=document.createElement('b');b.textContent=value;node.append(small,b);container.append(node);}
function ranked(id,entries,byCount=false){
 const body=el(id);body.replaceChildren();if(!entries?.length){body.append(div('hint','Sem registros disponíveis'));return;}
 const shown=entries.slice(0,6),hasRates=shown.some(e=>Number.isFinite(e.rateBps))&&!byCount,max=Math.max(1,...shown.map(e=>hasRates?e.rateBps||0:e.connections));
 for(const entry of shown){const row=div('rank-row'),label=div('rank-label'),name=document.createElement('span'),value=document.createElement('b');name.textContent=displayText(entry.name);name.title=displayText(entry.name);value.textContent=hasRates?throughput(entry.rateBps):fmt(entry.connections,0)+' conex.';label.append(name,value);const track=div('rank-track'),bar=document.createElement('i');bar.style.width=Math.max(0,Math.min(100,(hasRates?entry.rateBps||0:entry.connections)/max*100))+'%';track.append(bar);row.append(label,track,div('rank-note',fmt(entry.connections,0)+' conexões · '+bytes(sumBytes(entry))+' nas sessões presentes'));body.append(row);}
}
function charts(){
 if(!data)return;const minutes=Number(el('range').value),get=(label,key)=>s=>wan(label,s)?.[key];
 lineChart(el('wan-chart'),history,[{name:'WAN1 RX / download',get:get('WAN1','rxMbps'),color:colors[0]},{name:'WAN1 TX / upload',get:get('WAN1','txMbps'),color:colors[0],dash:true},{name:'WAN2 RX / download',get:get('WAN2','rxMbps'),color:colors[1]},{name:'WAN2 TX / upload',get:get('WAN2','txMbps'),color:colors[1],dash:true}],{minutes,unit:'Mbps'});
 lineChart(el('resource-chart'),history,[{name:'CPU',get:s=>s.cpu,color:colors[0]},{name:'Memória',get:s=>s.memoryPercent,color:colors[1]}],{minutes,unit:'%',ceiling:100});
 const name=el('pps-interface').value;
 lineChart(el('pps-chart'),history,[{name:name+' RX',get:s=>sampleInterface(s,name)?.rxPps,color:colors[0]},{name:name+' TX',get:s=>sampleInterface(s,name)?.txPps,color:colors[1],dash:true}],{minutes,unit:'pps'});
 lineChart(el('connections-chart'),flowHistory,[{name:'Conexões IPv4 + IPv6',get:s=>s.count,color:colors[2]}],{minutes,unit:'conex.'});
 const view=el('latency-view').value,target=CROSS_TARGETS.find(t=>t.id===view),suffix=view==='mean'?' / média comum':view==='legacy'?' / sonda original':' / '+target?.name;
 const pointNote=s=>(view==='legacy'?'Sondas originais · '+(data?.inventory?.links||[]).filter(l=>l.probe).map(l=>l.name+' → '+l.probe).join(' / '):view==='mean'?'Média de '+(s.crossQuality?.commonTargets.length??0)+'/3 destinos comuns; '+(s.crossQuality?.complete?'comparação completa':'comparação parcial; consulte perdas e falhas'):'Mesmo destino nas duas WANs: '+target.name+' / '+target.host)+(view==='legacy'?'':' · Sondas lidas '+time(s.crossQuality?.time));
 text('latency-legend',view==='mean'?'Média dos mesmos destinos · sondas 10s':view==='legacy'?(data?.inventory?.links||[]).filter(l=>l.probe).map(l=>l.name+' → '+l.probe).join(' / '):target.name+' / '+target.host+' nas duas WANs');
 text('loss-legend',view==='mean'?'Perda agregada · inclui destinos sem resposta':view==='legacy'?'Sondas originais · destinos diferentes':target.name+' · 5 pacotes por teste / WAN');
 lineChart(el('latency-chart'),history,[{name:'WAN1 RTT'+suffix,get:s=>latencyValue(s,'WAN1','rttMs',view),color:colors[0]},{name:'WAN2 RTT'+suffix,get:s=>latencyValue(s,'WAN2','rttMs',view),color:colors[1]}],{minutes,unit:'ms',pointNote});
 lineChart(el('loss-chart'),history,[{name:'WAN1 perda'+suffix,get:s=>latencyValue(s,'WAN1','lossPercent',view),color:colors[0]},{name:'WAN2 perda'+suffix,get:s=>latencyValue(s,'WAN2','lossPercent',view),color:colors[1]}],{minutes,unit:'%',ceiling:100,pointNote});
 for(const [id,key,color]of [['rx-spark','rxMbps',colors[0]],['tx-spark','txMbps',colors[1]]])lineChart(el(id),history,[{name:id==='rx-spark'?'Download total WAN':'Upload total WAN',get:s=>{const a=wan('WAN1',s)?.[key],b=wan('WAN2',s)?.[key];return Number.isFinite(a)&&Number.isFinite(b)?a+b:null;},color}],{minutes:5,unit:'Mbps'});
 text('history-count',fmt(history.length,0)+' pontos');
}
function renderCore(){
 renderRouterAddress();
 energyPanel?.render(data?.energy);
 hostPanel?.render(data?.host);
 if(!data)return;const live=data.status==='live',s=data.latest,details=data.details||{};
 const panel=data.panel||{};
 if(panel.controlEnabled&&!huaweiInitialized){huaweiInitialized=true;initHuawei({role,settings:panel,onTelemetry:value=>{activityMonitor?.setHuawei(value);geoPanel?.setHuawei(value);}});}
 el('connection-panel').hidden=Boolean(data.credentialsReady)||!collectorAdministration||panel.routerReady!==true;
 const labels={live:'● COLETA ATIVA',disabled:'ROUTEROS DESATIVADO',pending:'● AGUARDANDO LOGIN','auth-error':'● LOGIN RECUSADO',error:'● FALHA NA COLETA'};
 text('status',labels[data.status]||'SEM LEITURA');el('status').className='pill '+(live?'live':['pending','disabled'].includes(data.status)?'':'error');
 text('notice',data.error||(data.status==='pending'?'Conecte a conta de leitura configurada no RouterOS para iniciar a coleta.':'Telemetria do RouterOS e das integrações habilitadas.'));
 el('notice').className='notice '+(['error','auth-error'].includes(data.status)?'error':'');
 if(role==='control'&&panel.routerReady&&!data.credentialsReady){
   const login=document.createElement('a');login.textContent='Conectar ao RouterOS';
   const collectorUrl=new URL(location.href);collectorUrl.port=panel.localPort;collectorUrl.pathname='/';collectorUrl.search='';collectorUrl.hash='connection-panel';
   login.href=collectorUrl.href;el('notice').append(document.createTextNode(' '),login);
 }
 const speedLink=el('speed-lan-link');
 if(speedLink){speedLink.hidden=!panel.lanUrl||!panel.speedTestEnabled;if(!speedLink.hidden)speedLink.href=new URL('#speedtest',panel.lanUrl);}
 text('last-seen',data.lastSuccess?new Date(data.lastSuccess).toLocaleString('pt-BR'):'Nenhuma coleta nesta sessão');
 text('cadence','Interfaces '+data.cadence?.interfaces+'s · Conexões '+data.cadence?.connections+'s · Inventário '+data.cadence?.details+'s'+(paused?' · VISÃO PAUSADA':''));
 const links=Object.keys(data.wan||{}).map(name=>wan(name));
 for(const [id,key]of [['download','rxMbps'],['upload','txMbps']])text(id,live&&links.length>0&&links.every(i=>i&&Number.isFinite(i[key]))?rate(links.reduce((n,i)=>n+i[key],0)):'—');
 text('download-sub','RX '+fmt(live&&links.length>0&&links.every(i=>Number.isFinite(i?.rxPps))?links.reduce((n,i)=>n+i.rxPps,0):null,0)+' pps nas WANs');
 text('upload-sub','TX '+fmt(live&&links.length>0&&links.every(i=>Number.isFinite(i?.txPps))?links.reduce((n,i)=>n+i.txPps,0):null,0)+' pps nas WANs');
 text('cpu',live&&Number.isFinite(s?.cpu)?fmt(s.cpu,0)+'%':'—');text('memory',live&&Number.isFinite(s?.memoryPercent)?fmt(s.memoryPercent,1)+'%':'—');
 el('cpu-meter').style.width=(live?s.cpu||0:0)+'%';el('memory-meter').style.width=(live?s.memoryPercent||0:0)+'%';
 text('cpu-sub',s?s.model+' / '+s.architecture:'Sem leitura atual');text('memory-sub',live?bytes(s.totalMemory-s.freeMemory)+' / '+bytes(s.totalMemory):'—');
 text('temperature',live&&s.temperature!==null&&s.temperature!==undefined?fmt(s.temperature)+' °C':'—');text('hardware-sub',live?fmt(s.voltage)+' V · Disco '+fmt(s.diskPercent)+'%':'Sem leitura atual');text('uptime','Uptime '+(s?.uptime||'—'));
 if(s)text('side-model',s.model+' / ROS '+s.version);
 for(const name of ['WAN1','WAN2']){
   const prefix=name.toLowerCase(),i=wan(name),contract=data.inventory?.links.find(l=>l.name===name)?.contractMbps;
   const health=data.wanHealth?.find(h=>h.link===name);
   text(prefix+'-state',live?(health?.label||'SEM CONFIRMAÇÃO'):'SEM LEITURA');el(prefix+'-state').className='tag '+(live?(health?.state==='up'?'up':health?.state==='down'?'down':health?.state==='degraded'?'warn':''):'');
   text(prefix+'-physical',live&&i?'Link físico: '+(i.running?'UP':'DOWN')+' · '+(health?.routeVerified?(health.ownRouteActive?'Rota pela operadora ativa':health.failoverTo?'Failover para '+health.failoverTo:'Sem rota pela operadora'):'Rota sem confirmação'):'Link físico / roteamento: sem leitura atual');
   text(prefix+'-health',live?(health?.reason||'Aguardando confirmação da sonda e da rota.'):'Aguardando coleta atualizada.');
   text(prefix+'-rx',live?mbps(i?.rxMbps):'—');text(prefix+'-tx',live?mbps(i?.txMbps):'—');text(prefix+'-pps',live?fmt(i?.rxPps,0):'—');text(prefix+'-drop',live?fmt(i?.dropPps,2):'—');
   const utilization=live&&Number.isFinite(i?.rxMbps)&&contract?i.rxMbps/contract*100:null;
   el(prefix+'-util').style.width=utilization===null?'0%':Math.min(100,utilization)+'%';text(prefix+'-util-label',contract?fmt(utilization,2)+'% da referência contratada RX · '+contract+' Mbps':'Capacidade contratada não informada');
   const probe=health?.probe;text(prefix+'-probe',live&&probe?.configured?'Alvo '+probe.host+' · RTT '+fmt(probe.rttMs,2)+' ms · Jitter '+fmt(probe.jitterMs,2)+' ms · Perda '+fmt(probe.lossPercent)+'%'+(!probe.fresh?' · LEITURA ANTIGA':!probe.pathVerified?' · CAMINHO NÃO CONFIRMADO':'')+' · Lido '+time(probe.time):'RTT / jitter / perda: aguardando leitura atual');
 }
 const problems=live?(data.wanHealth||[]).filter(h=>['down','degraded'].includes(h.state)):[];
 el('wan-notice').hidden=!problems.length;el('wan-notice').className='notice '+(problems.some(h=>h.state==='down')?'error':'wan-warning');
 text('wan-notice',problems.map(h=>h.link+': '+h.reason+(h.failoverTo?' Failover ativo para '+h.failoverTo+'.':'')).join(' '));
 renderQuality();
 renderCrossQuality();
 text('interface-time',s?'Amostra '+time(s.time)+(live?'':' · anterior'):'Pendente');
 const eth=details.ethernet?.rows||[],monitor=details.ethernetMonitor?.rows||[];
 table('interface-rows',(s?.interfaces||[]).map(i=>{const physical=eth.find(e=>e.name===i.name),link=monitor.find(e=>e.name===i.name);return [i.name,live?(i.running?'UP':'DOWN'):'ANTERIOR',link?.rate||'—',live?fmt(i.rxMbps):'—',live?fmt(i.txMbps):'—',live?fmt(i.rxPps,0):'—',live?fmt(i.txPps,0):'—',live?fmt(i.dropPps,2):'—',bytes(i.rxBytes)+' / '+bytes(i.txBytes),fmt(Number.isFinite(Number(physical?.['rx-fcs-error']))?Number(physical['rx-fcs-error']):null,0)+' / '+fmt(Number.isFinite(Number(physical?.['rx-align-error']))?Number(physical['rx-align-error']):null,0)];}),'Sem leitura de interfaces',10);
 const cpu=el('cores');cpu.replaceChildren();for(const row of details.cpuCores?.rows||[]){const node=div('core'),label=document.createElement('small'),value=document.createElement('strong'),load=row.load===null||row.load===''||row.load===undefined?null:Number(row.load);label.textContent='CPU '+(row.cpu||row['.id']||'—');value.textContent=fmt(Number.isFinite(load)?load:null,0)+'%';node.append(label,value);cpu.append(node);}if(!cpu.children.length)cpu.append(div('hint','CPU por núcleo indisponível; carga total é exibida acima.'));
 const storage=el('storage');storage.replaceChildren();if(s){miniStat(storage,'Disco em uso',fmt(s.diskPercent)+'%');miniStat(storage,'Livre / total',bytes(s.freeDisk)+' / '+bytes(s.totalDisk));miniStat(storage,'Bad blocks',fmt(s.badBlocks)+'%');miniStat(storage,'Setores escritos (acumulado)',fmt(s.writeSectors,0));}
 text('sensor-list',(details.health?.rows||[]).map(h=>h.name+': '+h.value+' '+h.type).join(' · ')||'Sensores pendentes');
 const performance=data.performance||{};text('collector-stats','Fila '+(performance.queue??'—')+' · Streams '+(performance.streams??'—'));
 table('endpoint-rows',(performance.endpoints||[]).map(r=>[r.route,fmt(r.lastMs,0)+' ms',fmt(r.p95Ms,0)+' ms',r.success+' / '+r.failures,r.error||'OK']),'Aguardando consultas',5);
 const alerts=el('alerts');alerts.replaceChildren();for(const alert of data.alerts||[]){const node=div('alert '+alert.severity),title=document.createElement('b'),message=document.createElement('span');title.textContent=alert.title;message.textContent=alert.message;node.append(title,message);alerts.append(node);}if(!alerts.children.length)alerts.append(div('hint',live?'Nenhum limiar local de alerta atingido na última amostra.':'Aguardando coleta para avaliar alertas.'));
 charts();
}
function renderFlows(){
 const f=data?.connections||{},live=f.state==='live';text('connection-count',live?fmt(f.count,0):'—');text('connection-sub',live?fmt(f.rateKnown,0)+' com taxa comparável · '+fmt(f.fasttrack,0)+' FastTrack':f.error||'Aguardando tabela IPv4/IPv6');text('flow-time',live?'Snapshot '+time(f.time):f.error?'Falha · anterior '+time(f.time):'Pendente');
 const container=el('connection-mini');container.replaceChildren();const latestFlow=flowHistory.slice(-20),max=Math.max(1,...latestFlow.map(s=>s.count));for(const sample of latestFlow){const bar=document.createElement('i');bar.style.height=Math.max(2,sample.count/max*23)+'px';bar.style.flex='1';container.append(bar);}
 donut(el('protocol-donut'),f.protocols||[]);const protocolList=el('protocol-list');protocolList.replaceChildren();(f.protocols||[]).forEach((p,index)=>{const node=div('protocol-item'),name=document.createElement('span'),value=document.createElement('span');name.textContent=p.name.toUpperCase();name.style.color=colors[index%colors.length];value.textContent=fmt(p.connections,0)+' · '+fmt(f.count?p.connections/f.count*100:null)+'%';node.append(name,value);protocolList.append(node);});
 ranked('source-bars',f.sources);ranked('destination-bars',f.destinations);ranked('state-bars',f.states,true);ranked('port-bars',f.ports,true);
 const coverage=el('flow-coverage');coverage.replaceChildren();miniStat(coverage,'Taxa nos registros comparáveis',live?throughput(f.observedBps):'—');miniStat(coverage,'Cobertura de deltas',live?fmt(f.rateKnown,0)+' / '+fmt(f.count,0):'—');miniStat(coverage,'FastTrack / offload',fmt(f.fasttrack,0)+' / '+fmt(f.offloaded,0));miniStat(coverage,'IPv6',data.details?.ipv6Connections?.state==='live'?fmt(data.details.ipv6Connections.count,0)+' conex.':'Não disponível');
 renderConversations();
}
function filteredFlows(){const query=el('flow-search').value.toLowerCase(),protocol=el('flow-protocol').value;return (data?.connections?.rows||[]).filter(r=>(!protocol||r.protocol===protocol)&&(!query||[r.source,r.destination,namesFor(r.destination),r.sourcePort,r.destinationPort,r.protocol,r.mark,r.state,r.wan].join(' ').toLowerCase().includes(query)));}
function renderConversations(){
 const rows=filteredFlows(),shown=rows.slice(0,200);table('flow-rows',shown.map(r=>[r.protocol.toUpperCase(),r.source+(r.sourcePort?':'+r.sourcePort:''),r.destination+(namesFor(r.destination)?' [cache DNS: '+namesFor(r.destination)+']':''),r.destinationPort,r.wan||'Não determinada',r.mark,r.state,data.connections.state==='live'?throughput(r.rateBps):'Anterior',bytes(r.origBytes)+' / '+bytes(r.replBytes),r.timeout]),'Nenhuma conexão disponível para este filtro',10);
 let animated=0;
 [...el('flow-rows').rows].forEach((node,index)=>{const record=shown[index];if(!record)return;const motion={status:data?.connections?.state,time:data?.connections?.time,enabled:!['unreplied','time-wait','close','closed'].includes(record.state),paused,animate:animated<12,maxAgeMs:Math.max(15000,(data?.cadence?.connections||5)*3000)};decorateTrafficCell(node.cells[7],{...motion,rate:Number.isFinite(record.origBps)?record.origBps*8/1e6:null,directionLabel:'Origem → destino'});decorateTrafficCell(node.cells[7],{...motion,rate:Number.isFinite(record.replBps)?record.replBps*8/1e6:null,reverse:true,directionLabel:'Destino → origem'});if(node.cells[7].querySelector('.mini-flow'))animated++;node.onclick=()=>{text('flow-detail',JSON.stringify(sanitizeExport(record),null,2));openDialog(el('flow-dialog'));};});text('flow-count',shown.length+' exibidas / '+rows.length+' após filtro · '+(data?.connections?.count??'—')+' registros no snapshot'+(data?.connections?.displayLimited?' · Detalhes limitados às 1000 primeiras conversas':'')+' · Movimento: taxa positiva na amostra recente · Clique em uma linha para inspecionar.');
}
function renderDetails(){
 if(!data)return;const d=data.details||{};
 dnsNames=new Map();for(const record of d.dnsCache?.rows||[]){if(!['A','AAAA'].includes(record.type))continue;const ip=String(record.data||'');if(!ip)continue;const names=dnsNames.get(ip)||[];if(record.name&&!names.includes(record.name))names.push(record.name);dnsNames.set(ip,names);}
 text('route-time',stamp(d.routes));table('route-rows',(d.routes?.rows||[]).map(r=>[r['routing-table'],r['immediate-gw']||r.gateway,r.distance,String(r.active)==='true'?'ATIVA':String(r.disabled)==='true'?'DESATIVADA':'RESERVA']),'Rotas pendentes',4);
 text('pcc-time',stamp(d.pcc));table('pcc-rows',(d.pcc?.rows||[]).filter(r=>r.action?.startsWith('mark-')).map(r=>[r.comment||r['.id'],r.action,r['new-connection-mark']||r['new-routing-mark'],r['per-connection-classifier']||'—',bytes(numeric(r.bytes)),fmt(numeric(r.packets),0)]),'Contadores PCC pendentes',6);
 const allocation=el('pcc-allocation');allocation.replaceChildren();for(const link of data.inventory?.links||[]){const node=div(''),value=document.createElement('strong'),caption=document.createElement('small');value.textContent=fmt(link.pccBuckets/data.inventory.pcc.totalBuckets*100,2)+'%';caption.textContent=link.name+' · grupos configurados';node.append(value,caption);allocation.append(node);}
 renderQuality();
 text('filter-time',stamp(d.filter));table('filter-rows',(d.filter?.rows||[]).map(r=>[r.comment||r['.id'],r.chain,r.action,bytes(numeric(r.bytes)),fmt(numeric(r.packets),0)]),d.filter?.error||'Sem regras recebidas',5);
 text('queue-time',stamp(d.queues));const queues=[...(d.queues?.rows||[]).map(r=>({...r,kind:'simple'})),...(d.queueTree?.rows||[]).map(r=>({...r,kind:'tree'}))];table('queue-rows',queues.map(r=>[r.name,r.kind,r.target||r.parent,r['max-limit'],r.rate||'—',r.dropped||'—']),d.queues?.state==='live'&&d.queueTree?.state==='live'?'Nenhuma fila configurada':d.queues?.error||'Filas pendentes',6);
 const devices=new Map();for(const a of d.arp?.rows||[])if(a.address)devices.set(a.address,{ip:a.address,mac:a['mac-address'],name:a['host-name']||'—',state:a.status||'—',iface:a.interface||'—'});for(const l of d.leases?.rows||[]){const ip=l['active-address']||l.address;if(!ip)continue;const old=devices.get(ip)||{};devices.set(ip,{...old,ip,mac:l['active-mac-address']||l['mac-address']||old.mac,name:l['host-name']||old.name||'—',state:[l.status,old.state].filter(Boolean).join(' / ')||'—'});}text('discovery-time',stamp(d.leases));
 const deviceRows=[...devices.values()].filter(r=>{const filter=deviceFilter.value,online=/\bbound\b|\breachable\b/i.test(r.state);return filter==='all'||(filter==='online'?online:!online);}).sort((a,b)=>String(a.name).localeCompare(String(b.name),'pt-BR')||String(a.ip).localeCompare(String(b.ip),'pt-BR'));
 text('device-count',deviceRows.length+' exibidos / '+devices.size+' aparelhos');
 table('device-rows',deviceRows.map(r=>[r.ip,r.mac,r.name,r.state,r.iface]),'Nenhum aparelho para este filtro',5);
 text('logs-time',stamp(d.logs));table('log-rows',(d.logs?.rows||[]).slice().reverse().map(r=>[r.time,r.topics,r.message]),d.logs?.error||'Nenhum log recebido',3);
 const events=el('events');events.replaceChildren();for(const event of (data.events||[]).slice(-25).reverse()){const node=div('event'),clock=document.createElement('time'),message=document.createElement('span');clock.textContent=time(event.time);message.textContent=event.message;node.append(clock,message);events.append(node);}
 text('coverage-footer','REST HTTPS · SSE · Flow '+(d.trafficFlow?.rows?.[0]?.enabled==='true'?'habilitado / receptor pendente':'desabilitado')+' · Clientes atrás do Huawei agregados por NAT');
}
function render(){hostPanel?.render(data?.host);geoPanel?.update();renderCore();renderFlows();renderDetails();}
function receive(kind,value){
 if(paused){buffer=buffer||structuredClone(data);if(kind==='snapshot')buffer=value;else if(kind==='connections')buffer.connections=value;else Object.assign(buffer,value);return;}
 if(kind==='snapshot'){data={...data,...value};flowHistory=value.flowHistory||flowHistory;render();}
 else if(kind==='sample'){data={...data,...value};if(value.latest&&value.status==='live'&&history.at(-1)?.time!==value.latest.time){history.push(value.latest);const cutoff=Date.now()-Number(el('range').value)*60000;history=history.filter(s=>s.time>=cutoff);if(history.length>2400)history=history.slice(-2400);}renderCore();}
 else if(kind==='connections'){data.connections=value;if(value.state==='live'){flowHistory.push({time:value.time,count:value.count});if(flowHistory.length>1800)flowHistory.shift();}renderFlows();charts();}
 else if(kind==='geo'){Object.assign(data,value);geoPanel?.update();}
 else if(kind==='energy'){data={...data,...value};energyPanel?.render(data.energy);}
 else{Object.assign(data,value);renderDetails();renderCore();}
}
async function refresh(){try{const response=await fetch('/api/status?minutes='+el('range').value);if(response.status===401&&!localAdministration){location.replace('/');return;}if(!response.ok)throw new Error();activityClock.synchronize(response.headers.get('Date'));const snapshot=await response.json();history=snapshot.history||[];flowHistory=snapshot.flowHistory||[];receive('snapshot',snapshot);}catch{text('status','● COLETOR LOCAL DESCONECTADO');el('status').className='pill error';text('notice','O servidor local não respondeu. As leituras exibidas podem estar antigas.');}}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
function startStream(){
 stream?.close();lastStreamEvent=Date.now();
 if(typeof EventSource!=='function'){startPolling();return;}
 try{stream=new EventSource('/api/stream');}catch{startPolling();return;}
 stream.onopen=()=>{lastStreamEvent=Date.now();text('stream-status','SSE / CONECTADO');};stream.onerror=()=>startPolling();
 for(const kind of ['snapshot','sample','connections','details','geo','energy'])stream.addEventListener(kind,event=>{try{lastStreamEvent=Date.now();if(pollTimer){clearInterval(pollTimer);pollTimer=null;}text('stream-status','SSE / CONECTADO');receive(kind,JSON.parse(event.data));}catch(error){console.error('Não foi possível renderizar a telemetria:',error.message);startPolling();}});
}
function startPolling(){
 if(pollTimer)return;text('stream-status','ATUALIZAÇÃO / 5s');
 const poll=async()=>{
   if(pollBusy||paused)return;pollBusy=true;
   try{
     const response=await fetch('/api/status?minutes=1');
     if(response.status===401&&!localAdministration){location.replace('/');return;}if(!response.ok)throw new Error('HTTP '+response.status);
     activityClock.synchronize(response.headers.get('Date'));
     const snapshot=await response.json(),cutoff=Date.now()-Number(el('range').value)*60000;
     if(snapshot.latest&&snapshot.status==='live'&&history.at(-1)?.time!==snapshot.latest.time){history.push(snapshot.latest);history=history.filter(s=>s.time>=cutoff);if(history.length>2400)history=history.slice(-2400);}
     if(Array.isArray(snapshot.flowHistory)){const after=flowHistory.at(-1)?.time??0;snapshot.flowHistory=flowHistory.concat(snapshot.flowHistory.filter(point=>point.time>after)).filter(point=>point.time>=cutoff);}
     delete snapshot.history;receive('snapshot',snapshot);text('stream-status','ATUALIZAÇÃO / 5s');
   }catch{
     text('stream-status','ATUALIZAÇÃO / RECONECTANDO');text('status','● FALHA NA ATUALIZAÇÃO');el('status').className='pill error';text('notice','O navegador não conseguiu atualizar os dados. Tente recarregar a página.');
   }finally{pollBusy=false;}
 };
 pollTimer=setInterval(poll,5000);void poll();
}
setInterval(()=>{if(!pollTimer&&Date.now()-lastStreamEvent>20000)startPolling();},5000);
el('refresh').onclick=refresh;
el('range').onchange=refresh;el('pps-interface').onchange=charts;el('latency-view').onchange=charts;el('flow-search').oninput=renderConversations;el('flow-protocol').onchange=renderConversations;
el('pause').onclick=()=>{paused=!paused;text('pause',paused?'▶ Retomar visão':'Ⅱ Pausar visão');activityMonitor?.update();if(!paused){if(buffer){data=buffer;buffer=null;}refresh();}else renderCore();};
el('close-dialog').onclick=()=>closeDialog(el('flow-dialog'));
function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
el('export').onclick=()=>data&&download('orbit-telemetria-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json',JSON.stringify(sanitizeExport({...data,history}),null,2),'application/json');
el('flow-export').onclick=()=>{const rows=filteredFlows(),fields=['protocol','source','sourcePort','destination','destinationPort','wan','mark','state','origBytes','replBytes','rateBps'];const csv=[fields.join(';'),...rows.map(r=>fields.map(k=>'"'+String(displayText(r[k]??'')).replaceAll('"','""').replace(/^[=+@-]/,"'")+'"').join(';'))].join('\r\n');download('orbit-conexoes.csv','\uFEFF'+csv,'text/csv;charset=utf-8');};
el('connection-form').onsubmit=async event=>{event.preventDefault();if(!collectorAdministration)return;const button=el('connection-submit'),password=el('connection-password');button.disabled=true;text('connection-message','Verificando login e certificado HTTPS…');try{const response=await fetch('/api/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user:el('connection-user').value,password:password.value})});password.value='';const result=await response.json();text('connection-message',result.message);if(response.ok)await refresh();}catch{password.value='';text('connection-message','Não foi possível consultar o coletor local.');}finally{button.disabled=false;}};
setInterval(()=>{text('side-clock',new Date().toLocaleTimeString('pt-BR'));const age=data?.lastSuccess?Math.max(0,(Date.now()-data.lastSuccess)/1000):null;text('data-age',age===null?'Nenhuma amostra':'Idade da última leitura '+fmt(age,0)+'s'+(age>Math.max(15,(data?.cadence?.interfaces||2)*4)?' · DADO ANTIGO':''));},1000);
setInterval(async()=>{if(paused)return;try{const response=await fetch('/api/history?minutes='+el('range').value);if(response.ok){history=(await response.json()).history;charts();}}catch{}},60000);
window.addEventListener('resize',()=>{charts();if(data)donut(el('protocol-donut'),data.connections?.protocols||[]);});
const helpText={
 'Geo Connections':'Mostra os destinos públicos observados no connection tracking do MikroTik, enriquecidos pelas bases locais GeoLite2 City e ASN. Para que serve: localizar aproximadamente a infraestrutura acessada e relacionar destinos, provedores, portas, protocolos e WANs. Como ler: as linhas partem de um ponto ilustrativo; cada linha representa uma conexão contabilizada com coordenadas. Os pulsos indicam direção, sem medir pacotes nem velocidade. Passe o cursor, use Tab ou toque em um ponto para ver seu resumo; vários destinos podem compartilhar coordenadas. Os filtros também alteram mapa e rankings. Histórico usa a última contagem de cada combinação e fica estático. Limites: geolocalização de CDN, VPN e anycast é aproximada; destinos sem coordenadas ficam na tabela. Conexões atrás do Huawei são agregadas por NAT e não identificam qual aparelho interno acessou um destino.',
 'Motor da medição':'Escolhe o método usado no PC coletor: cliente oficial Speedtest by Ookla ou transferências HTTP do ORBIT. A preferência é compartilhada pelos aparelhos e pela agenda automática. Os históricos/gráficos ficam separados por motor para interpretar os resultados.',
 'Latência da medição':'No modo Ookla, é a latência ociosa informada pelo cliente oficial. No modo HTTP, inclui a resposta e o processamento do servidor. São métodos diferentes; o RTT ICMP do Netwatch também é independente.',
 'Jitter / variação':'No modo Ookla, é o jitter ocioso do teste oficial. No modo HTTP, é a mediana das diferenças absolutas entre respostas sucessivas. Valores altos indicam maior variação naquele método/caminho.',
 'Latência durante download':'Latência sob carga de download reportada pela Ookla, usando seu indicador IQM. Ajuda a perceber atraso quando a banda de recebimento é usada. Sem valor quando o servidor ou cliente não informa.',
 'Latência durante upload':'Latência sob carga de upload reportada pela Ookla, usando seu indicador IQM. Ajuda a perceber atraso quando a banda de envio é usada. Sem valor quando não informado.',
 'Perda de pacotes no teste':'Percentual de perda reportado pela Ookla, quando disponível. Refere-se ao servidor/caminho deste teste e não substitui as sondas ICMP do roteador.',
 'Velocidade da internet':'Medição ativa do PC até o servidor selecionado, direcionada à WAN1 ou à WAN2 por tabelas exclusivas. O MikroTik confirma a marca da conexão e a WAN por NAT antes e durante as transferências, com rotas revalidadas ao término. Ajuda a comparar cada link ao longo do tempo. Usa banda durante o teste e não soma os planos. A capacidade do PC, Huawei e servidor também influencia.',
 'Teste por operadora':'Último teste concluído com a WAN confirmada. Download e upload pertencem à operadora indicada. A tabela do teste possui bloqueio de reserva, sem trocar de operadora durante uma queda. Uma falha mantém o último resultado com data e hora e registra a tentativa no histórico.',
 'Operadora confirmada':'Operadora comprovada pela conexão observada no MikroTik, com marca exclusiva e endereço NAT da WAN correspondente. A interface é exibida nos testes concluídos. Resultados antigos do modo geral permanecem sem WAN atribuída.',
 'Histórico de velocidade':'Pontos dos testes concluídos e confirmados da operadora e do motor selecionados nos menus. Ajuda a comparar download e upload ao longo dos dias. Não descreve velocidade contínua entre os pontos. A tabela inclui ambas as operadoras, falhas, cancelamentos e medições gerais anteriores.',
 'Download medido':'Taxa de recebimento do PC até o servidor selecionado, em Mbps. No modo Ookla é o resultado do cliente oficial; no modo HTTP é a mediana de três transferências do tamanho escolhido. Ajuda a acompanhar a velocidade obtida nesse caminho; não é o tráfego atual RX das WANs.',
 'Upload medido':'Taxa de envio do PC até o servidor selecionado, em Mbps. No modo Ookla é o resultado do cliente oficial; no modo HTTP é a mediana de três transferências, incluindo a confirmação HTTP. Ajuda a acompanhar capacidade de envio nesse caminho, sem comprovar a velocidade máxima teórica da operadora.',
 'Latência HTTP':'Mediana de sete tempos de resposta HTTPS após aquecimento da conexão. Ajuda a comparar resposta ao servidor do teste. Inclui processamento HTTP e não é o mesmo RTT ICMP das sondas WAN1/WAN2.',
 'Variação HTTP':'Mediana da diferença absoluta entre latências HTTP consecutivas, em milissegundos. Ajuda a perceber instabilidade nas respostas ao servidor de teste. Não é perda de pacotes nem o jitter ICMP informado pelo Netwatch.',
 'Horário do teste':'Horário em que o teste terminou no PC coletor. Ajuda a relacionar o resultado com tráfego e ocorrências da rede.',
 'Servidor de medição':'Provedor e servidor efetivamente usados nesta medição. A Cloudflare informa também seu identificador de centro de dados quando disponível. Ajuda a interpretar diferenças entre rotas, métodos e capacidade do servidor. Métodos e servidores diferentes podem produzir resultados distintos.',
 'Escolha do servidor':'No modo Ookla, cada WAN tem três servidores regionais distintos e a comparação usa RTT TCP; no modo HTTP, usa respostas HTTP. A escolha é salva separadamente para WAN1 e WAN2 e vale também nos testes automáticos. No modo automático, três serviços autorizados são sondados pela operadora escolhida: o menor tempo mediano válido do método escolhido vence. Servidores com falha ou WAN não confirmada são excluídos. Isso reduz a influência de uma rota ruim, sem garantir a velocidade máxima contratada.',
 'Comparação de servidores':'O modo Ookla compara RTT TCP; a latência ociosa final é medida pelo cliente oficial. Sondas leves realizadas na última medição da operadora selecionada. HTTP é a mediana de três respostas após aquecer a conexão; a variação é a mediana das diferenças consecutivas. No modo manual, só o servidor escolhido é sondado. Os resultados não são ICMP nem medições produzidas pela Ookla.',
 'Resultado':'Indica teste concluído, falha ou cancelamento. Uma falha não equivale a velocidade zero. Os últimos valores válidos continuam identificados por seu horário.',
 'WAN RX / DOWNLOAD':'Volume por segundo recebido nas interfaces das operadoras, somando WAN1 e WAN2. Ajuda a acompanhar downloads e ocupação dos links. Não inclui novamente a bridge, evitando contar o mesmo tráfego duas vezes.',
 'WAN TX / UPLOAD':'Volume por segundo enviado pelas duas WANs. Ajuda a identificar uploads, backups e saturação de envio. As taxas são calculadas pela diferença de contadores entre leituras.',
 'PROCESSAMENTO':'Percentual de uso total da CPU do MikroTik. Ajuda a detectar sobrecarga do roteador e correlacionar picos de processamento com tráfego ou lentidão.',
 'MEMÓRIA':'Percentual da RAM usada pelo MikroTik. Ajuda a perceber pressão de memória e acompanhar o espaço disponível para conexões, serviços e caches.',
 'CONNECTION TRACKING':'Quantidade de conexões IPv4 e IPv6 presentes na tabela do roteador. Ajuda a avaliar a carga de sessões e investigar aumentos incomuns. Uma conexão não equivale a um dispositivo.',
 'HARDWARE':'Temperatura, tensão, armazenamento e tempo ligado do roteador, quando disponíveis. Ajuda a investigar aquecimento, alimentação e reinícios. Ausência de sensor não significa valor zero.',
 'WAN1':'Estado da WAN WAN1 a partir do link físico, rota ativa e sonda ICMP pela interface configurada. SONDA OK exige resposta recente pelo caminho confirmado; não comprova todos os sites ou serviços. Falha da sonda, falta de rota e failover aparecem em destaque. RX é entrada da operadora e TX é saída. A capacidade de referência vem do inventário quando informada.',
 'WAN2':'Estado da WAN WAN2 a partir do link físico, rota ativa e sonda ICMP pela interface configurada. SONDA OK exige resposta recente pelo caminho confirmado; não comprova todos os sites ou serviços. Falha da sonda, falta de rota e failover aparecem em destaque. RX é entrada da operadora e TX é saída. A capacidade de referência vem do inventário quando informada.',
 'Estado da WAN':'Combina porta física, rota efetiva e último teste ICMP. SONDA OK confirma somente o alvo monitorado, com rota própria ativa. SONDA DEGRADADA sinaliza perda maior que 0%, RTT a partir de 150 ms ou jitter a partir de 30 ms; são limiares visuais locais, não alteram o MikroTik. Sem leitura recente ou caminho confirmado, o estado permanece desconhecido. Failover identifica a outra operadora na tabela PCC.',
 'Teste cruzado de RTT':'Mede Cloudflare 1.1.1.1, Google 8.8.8.8 e Quad9 9.9.9.9 pelas duas operadoras. São seis sondas ICMP com origens e rotas exclusivas, sem reserva cruzada. Não muda o failover do roteador. Ajuda a separar diferença de operadora de diferença de destino.',
 'Média cruzada WAN1':'Média aritmética dos RTTs dos mesmos destinos que responderam e tiveram caminho validado nas duas WANs. Se algum destino não responder, a média fica parcial e mostra a cobertura. Timeout não vira zero. A perda considera pacotes sem resposta e permanece separada.',
 'Média cruzada WAN2':'Média aritmética dos RTTs dos mesmos destinos que responderam e tiveram caminho validado nas duas WANs. Se algum destino não responder, a média fica parcial e mostra a cobertura. Timeout não vira zero. A perda considera pacotes sem resposta e permanece separada.',
 'Throughput das WANs':'Velocidade de entrada e saída de cada operadora, em Mbps, ao longo do tempo. Ajuda a comparar uso e localizar picos. Linhas contínuas representam RX/download; tracejadas, TX/upload. Passe o cursor, toque ou use as setas no gráfico para consultar uma amostra.',
 'CPU e memória':'Histórico do uso de CPU e RAM, em porcentagem. Ajuda a relacionar sobrecarga do roteador com momentos de lentidão. O marcador mostra os dois valores na amostra selecionada.',
 'Pacotes por segundo':'Quantidade de pacotes recebidos (RX) e enviados (TX) por segundo na interface selecionada. Ajuda a identificar pressão de processamento: muitos pacotes pequenos podem exigir CPU mesmo com poucos Mbps.',
 'Conexões monitoradas':'Histórico da quantidade de registros presentes no connection tracking. Ajuda a localizar picos de sessões. São snapshots periódicos; conexões curtas entre leituras podem não aparecer.',
 'RTT por operadora':'Tempo de ida e volta em milissegundos. O seletor permite comparar os mesmos destinos ou a média dos destinos que responderam nas duas WANs. Uma média com menos de três destinos fica identificada como parcial; timeout não vira zero. Sondas originais conserva a medição anterior, com alvos diferentes. O histórico anterior à instalação não é misturado com as médias novas.',
 'Perda de pacotes por operadora':'Percentual de pacotes sem resposta nas sondas da comparação selecionada. Na média cruzada, a perda soma enviados e recebidos das três sondas de cada WAN, incluindo destinos sem resposta. Cada sonda envia cinco pacotes por rodada; uma leitura sem caminho validado fica ausente. Consulte a cobertura e os destinos individuais na tabela.',
 'Interfaces e qualidade física':'Estado, negociação, taxas e contadores de cada interface. Ajuda a localizar gargalos, portas sem link e erros físicos. Bytes e erros são acumulados; Mbps, pps e Drop/s são calculados entre amostras.',
 'Mix de protocolos':'Distribuição das conexões atuais por protocolo, como TCP, UDP e ICMP. Ajuda a caracterizar as sessões presentes. A participação é por quantidade de conexões, não por volume de bytes. Toque em um segmento ou use as setas para ver detalhes.',
 'Origens observadas':'Origens com mais atividade entre as conexões recebidas. Ajuda a encontrar quem inicia o tráfego visível ao MikroTik. Clientes atrás do NAT do Huawei aparecem agregados no IP do Huawei.',
 'Destinos observados':'Destinos mais relevantes nas conexões presentes. Ajuda a localizar servidores e investigar padrões de tráfego. Nomes do cache DNS são indícios, sem garantir qual aplicativo gerou a conexão.',
 'Estados TCP / resposta':'Agrupamento das conexões por estado TCP ou situação de resposta. Ajuda a distinguir sessões estabelecidas, encerrando ou ainda sem resposta. A contagem descreve o snapshot atual.',
 'Portas de destino':'Agrupamento das conexões por protocolo e porta de destino. Ajuda a reconhecer tipos de serviço, como TCP 443. Uma porta não identifica com certeza um aplicativo nem revela conteúdo criptografado.',
 'Cobertura da leitura':'Indica quantos registros permitem calcular taxas entre snapshots, além de FastTrack/offload e IPv6. Ajuda a avaliar quanto do tráfego a leitura consegue descrever. Tráfego que não passa pelo MikroTik fica fora desta visão.',
 'Conversas em curso':'Detalhes das conexões presentes: origem, destino, porta, estado, marca, bytes e taxa observada. Ajuda a investigar uma conversa específica. Filtre a tabela e clique em uma linha para abrir o registro completo.',
 'Rotas default':'Rotas usadas para destinos sem rota mais específica, por tabela de roteamento. Ajuda a verificar a operadora escolhida e o failover. Gateway efetivo indica o caminho resolvido; distância menor tem preferência entre rotas elegíveis.',
 'PCC e sondas independentes':'PCC distribui novas conexões entre as operadoras; os percentuais indicam os grupos configurados, não uma divisão garantida de bytes. RTT é o tempo de ida e volta; jitter é a variação desses tempos; perda é a proporção de pacotes sem resposta. Essas métricas ajudam a avaliar estabilidade e só são atribuídas à WAN com caminho confirmado.',
 'Mangle / contadores PCC':'Regras que marcam conexões e roteamento, com seus contadores. Ajuda a conferir classificação PCC e regras utilizadas. Bytes e pacotes são acumulados por regra e não devem ser somados como consumo total.',
 'Regras e descartes':'Regras de filtro do firewall e seus contadores. Ajuda a identificar quais regras estão aceitando ou descartando pacotes. Contadores de etapas diferentes podem representar o mesmo tráfego.',
 'Filas e limites':'Filas configuradas, alvos, limites, taxas e descartes quando disponíveis. Ajuda a investigar controle de banda e congestionamento. Tabela vazia significa que nenhuma fila foi recebida naquela consulta.',
 'Descoberta DHCP / ARP':'Combina leases DHCP e vizinhos ARP para relacionar IP, MAC, nome e interface. Ajuda a identificar os dispositivos visíveis ao MikroTik. ARP pode incluir registros antigos ou sem resposta; clientes atrás do Huawei não são individualizados.',
 'CPU por núcleo / armazenamento':'Uso de cada núcleo e indicadores do armazenamento. Ajuda a detectar carga concentrada em um núcleo, pouco espaço ou desgaste da memória flash. Os valores são do roteador, não deste PC.',
 'Saúde da coleta':'Tempo de resposta e resultados das consultas REST ao MikroTik. Ajuda a separar falhas de coleta de problemas das operadoras. P95 resume a latência das consultas recentes; essa latência não é RTT da internet.',
 'Alertas e mudanças observadas':'Limiar de CPU, RAM, descartes, link e DHCP, além de mudanças de rotas e estado observadas pelo coletor. Ajuda a relacionar eventos com os gráficos. É uma observação periódica, não um registro completo de todos os eventos da rede.',
 'Eventos do roteador':'Mensagens do buffer de logs do RouterOS. Ajuda a investigar link, DHCP, autenticação e alterações. O painel consulta o buffer periodicamente; ainda não é um receptor de syslog contínuo.',
 'Autenticar o coletor':'Conecta a conta dedicada de leitura ao MikroTik para iniciar a coleta. A senha fica apenas na memória da sessão. Essa operação é feita no próprio PC, pelo endereço 127.0.0.1.',
 'Interface':'Porta física ou interface lógica à qual o registro se refere. Use para localizar onde uma taxa ou evento foi observado.',
 'Link':'Indica se a interface está em execução. UP comprova o link/interface ativo, mas não comprova acesso à internet.',
 'Negociação':'Velocidade Ethernet negociada entre os equipamentos. Ajuda a detectar uma porta operando abaixo da velocidade esperada.',
 'RX Mbps':'Megabits por segundo recebidos pela interface. Na WAN corresponde ao download; na LAN o sentido depende do equipamento conectado.',
 'TX Mbps':'Megabits por segundo enviados pela interface. Na WAN corresponde ao upload. Ajuda a acompanhar ocupação de saída.',
 'RX pps':'Pacotes recebidos por segundo. Ajuda a perceber muitos pacotes pequenos e relacionar tráfego à carga de CPU.',
 'TX pps':'Pacotes enviados por segundo. Ajuda a acompanhar volume de processamento na saída da interface.',
 'DESCARTES/s':'Diferença do contador de descartes da fila de transmissão dividida pelo tempo entre leituras. Ajuda a investigar congestionamento da saída.',
 'Drop/s':'Taxa de descartes na fila de transmissão entre amostras. Não é o mesmo indicador de perda das sondas ICMP.',
 'RX / TX acumulado':'Bytes recebidos e enviados no contador da interface. Ajuda a observar volume acumulado; reinício ou reset pode zerar os contadores. Não é consumo faturável do período selecionado.',
 'FCS / alinhamento':'Contadores de erros de integridade e alinhamento Ethernet. Ajuda a investigar problemas físicos de cabo, porta ou negociação. Campo ausente indica falta de leitura, não zero.',
 'Protocolo':'Protocolo da conexão, como TCP, UDP ou ICMP. Ajuda a distinguir tipos de comunicação.',
 'Origem':'Endereço e, quando disponível, porta do iniciador da conexão. Atrás de NAT pode representar um roteador que agrega vários clientes.',
 'Destino':'Endereço remoto e eventuais nomes encontrados no cache DNS. Ajuda a localizar o servidor observado; não revela o conteúdo de HTTPS ou VPN.',
 'Porta':'Porta de destino da conexão. Ajuda a reconhecer tipos de serviço; vários aplicativos podem usar a mesma porta.',
 'WAN por NAT':'Operadora inferida pela comparação do endereço NAT de resposta com os IPs das WANs. Ajuda a estimar a saída efetiva da conversa; pode ficar não determinada.',
 'Marca PCC':'Marca de conexão usada pelo roteamento PCC. Ajuda a conferir a classificação. Durante failover ela pode diferir da WAN que realmente transporta a conexão.',
 'Estado':'Estado informado para este registro. Em conexões descreve a sessão; em rotas, sua atividade; em consultas, sucesso ou falha. Ajuda a interpretar a situação junto aos demais campos.',
 'Taxa observada':'Bytes por segundo calculados entre dois registros comparáveis e convertidos para uma unidade de taxa. Ajuda a identificar conversas ativas; sessões curtas ou não comparáveis não têm taxa calculável.',
 'Bytes orig. / resposta':'Bytes acumulados nas direções original e de resposta da sessão. Ajuda a comparar envio e retorno. São bytes da vida das conexões presentes, não total do intervalo do gráfico.',
 'TTL da sessão':'Timeout restante do registro no connection tracking. Ajuda a acompanhar expiração de sessões. Não é o campo TTL dos pacotes IP.',
 'Tabela':'Tabela de roteamento à qual a rota pertence. Ajuda a diferenciar a decisão principal da decisão das conexões marcadas pelo PCC.',
 'Gateway efetivo':'Próximo salto resolvido, com interface quando disponível. Ajuda a conferir por qual caminho a rota será encaminhada.',
 'Dist.':'Distância administrativa da rota. Valores menores têm preferência entre rotas elegíveis para o mesmo destino e tabela.',
 'Regra':'Nome/comentário ou identificador da regra do RouterOS. Ajuda a localizar a configuração responsável pelo contador.',
 'Ação':'Operação realizada pela regra, como aceitar, descartar ou marcar. Ajuda a entender o efeito da regra no processamento.',
 'Marca':'Marca de conexão ou roteamento atribuída pela regra. Ajuda a relacionar classificação PCC e tabela de saída.',
 'Classificador':'Critério PCC e grupo usado para distribuir conexões. Ajuda a conferir quais combinações de endereços e portas participam da classificação.',
 'Bytes acumulados':'Contador de bytes que passaram pela regra desde seu reset. Ajuda a verificar uso da regra; não some regras de etapas diferentes como consumo de rede.',
 'Pacotes':'Contador acumulado de pacotes da regra. Ajuda a observar atividade e alcance da regra.',
 'Chain':'Etapa do firewall, como input para o roteador ou forward para tráfego encaminhado. Ajuda a interpretar onde a regra atua.',
 'Bytes':'Contador de bytes do registro. Nas regras é acumulado desde o reset, não uma taxa por segundo.',
 'Fila':'Nome da fila de controle de tráfego. Ajuda a localizar uma política de banda aplicada.',
 'Tipo':'Tipo de fila: simple ou queue tree. Ajuda a entender como a política de controle está organizada.',
 'Alvo / parent':'Endereço alvo ou fila/interface pai. Ajuda a identificar qual tráfego recebe o controle de banda.',
 'Limite':'Limite máximo de taxa configurado na fila. Ajuda a comparar a política com a taxa observada.',
 'Taxa':'Taxa informada pela fila, quando disponível. Ajuda a acompanhar o uso atual da política de banda.',
 'Drop':'Descartes informados pela fila. Ajuda a investigar congestionamento ou limitações de banda; unidade e formato dependem da leitura do RouterOS.',
 'IP':'Endereço do dispositivo no registro observado. Ajuda a relacionar leases, vizinhos e conexões.',
 'MAC':'Endereço físico da interface do dispositivo. Ajuda a identificar o equipamento no segmento local; pode mudar com privacidade de MAC.',
 'Nome':'Nome informado pelo dispositivo no DHCP. Ajuda a identificação, mas não é garantia de identidade.',
 'Lease / ARP':'Situação do lease DHCP e do vizinho ARP. Ajuda a distinguir endereço concedido e alcance local observado.',
 'Consulta':'Endpoint REST consultado no MikroTik. Ajuda a identificar qual fonte de dados está lenta ou com falha.',
 'Última':'Duração da última consulta, em milissegundos. Ajuda a acompanhar a resposta do MikroTik ao coletor.',
 'P95':'Percentil 95 da duração das consultas recentes: cerca de 95% das observações ficam até esse tempo. Ajuda a perceber lentidão recorrente além da média.',
 'OK / falhas':'Contadores de consultas bem-sucedidas e malsucedidas nesta sessão. Ajuda a avaliar estabilidade da coleta.',
 'Horário no roteador':'Horário do evento segundo o relógio do MikroTik. Ajuda a comparar logs e ocorrências, considerando eventual diferença entre os relógios.',
 'Tópicos':'Categorias da mensagem de log do RouterOS. Ajuda a localizar eventos de interface, DHCP, sistema e autenticação.',
 'Mensagem':'Texto do evento registrado pelo RouterOS. Ajuda a identificar a ocorrência e os objetos envolvidos.',
 'Taxa nos registros comparáveis':'Soma das taxas calculadas para conexões comparáveis entre duas leituras. Ajuda a avaliar atividade observada; não equivale necessariamente à taxa total das interfaces.',
 'Cobertura de deltas':'Quantidade de registros com comparação válida entre snapshots em relação ao total presente. Ajuda a avaliar a cobertura do cálculo de taxas.',
 'FastTrack / offload':'Quantidade de conexões marcadas como FastTrack ou descarregadas por hardware na leitura. Ajuda a avaliar possíveis limites de visibilidade dos contadores.',
 'IPv6':'Quantidade de conexões IPv6 recebidas do MikroTik. Ajuda a verificar presença de tráfego IPv6 no snapshot.',
 'Disco em uso':'Percentual de armazenamento ocupado no roteador. Ajuda a acompanhar espaço para configurações e arquivos.',
 'Livre / total':'Espaço livre e capacidade total de armazenamento do roteador. Ajuda a avaliar capacidade disponível.',
 'Bad blocks':'Percentual de blocos de armazenamento indicados como defeituosos pelo RouterOS. Ajuda a acompanhar a condição da flash; um valor isolado não determina a causa.',
 'Setores escritos (acumulado)':'Contador de setores escritos na flash informado pelo roteador. Ajuda a acompanhar a atividade de gravação ao longo do uso.',
 'CPU por núcleo':'Percentual de carga deste núcleo do MikroTik. Ajuda a encontrar tarefas concentradas em um núcleo mesmo quando a média total parece baixa.'
};
const helpDialog=document.createElement('dialog');helpDialog.id='telemetry-help';helpDialog.setAttribute('aria-labelledby','telemetry-help-title');helpDialog.setAttribute('aria-describedby','telemetry-help-body');
const helpHeading=div('panel-heading'),helpTitle=document.createElement('h2'),helpClose=document.createElement('button'),helpBody=document.createElement('p');helpTitle.id='telemetry-help-title';helpClose.textContent='Fechar';helpBody.id='telemetry-help-body';helpHeading.append(helpTitle,helpClose);helpDialog.append(helpHeading,helpBody);document.body.append(helpDialog);helpClose.onclick=()=>closeDialog(helpDialog);helpDialog.addEventListener('click',event=>{if(event.target===helpDialog){const b=helpDialog.getBoundingClientRect();if(event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom)closeDialog(helpDialog);}});
function addHelp(target,label){
 if(!helpText[label]||target.querySelector('.help-button'))return;
 const button=document.createElement('button');button.type='button';button.className='help-button';button.textContent='i';button.title='O que é e para que serve: '+label;button.setAttribute('aria-label','Sobre '+label);button.setAttribute('aria-haspopup','dialog');
 button.onclick=event=>{event.stopPropagation();helpTitle.textContent=label;helpBody.textContent=helpText[label];openDialog(helpDialog);};target.dataset.telemetryName=label;target.classList.add('telemetry-label');target.append(button);
}
for(const panel of document.querySelectorAll('article.panel,section.panel,.kpis article')){const heading=panel.querySelector('h2,h3')||panel.querySelector('p');if(heading)addHelp(heading,heading.textContent.trim().replace(/\s+/g,' '));}
for(const label of document.querySelectorAll('th,.wan-values small,[data-help]'))addHelp(label,label.dataset.help||label.textContent.trim());
for(const label of document.querySelectorAll('.speed-stats small,.speed-history-heading h3,.server-choice h3,.speed-comparison h3'))addHelp(label,label.textContent.trim());
function speedChart(){
 if(!el('speed-chart')||!speedData)return;
 const pc=speedData.mode==='pc',link=pc?'PC coletor':el('speed-link').value;
 const samples=(speedData.history||[]).filter(r=>r.status==='complete'&&(pc?!r.link:r.link===link&&r.pathVerified)&&(r.engine||'http')===speedData.engine);
 el('speed-chart').dataset.telemetryName='Histórico de velocidade / '+el('speed-link').value;
 lineChart(el('speed-chart'),samples,[{name:link+' / Download medido',get:r=>r.downloadMbps,color:colors[0]},{name:link+' / Upload medido',get:r=>r.uploadMbps,color:colors[1]}],{minutes:Number(el('speed-range').value),unit:'Mbps',pointsOnly:true,pointNote:r=>(r.serverName||r.provider||'Servidor não informado')+' · '+(r.engine==='ookla'?'Ociosa':'HTTP')+' '+fmt(r.latencyMs,2)+' ms · '+(r.method||'Teste HTTP')+' · WAN '+r.interface+' confirmada; sem interpolação'});
}
async function configureSpeedEngine(){
 el('speed-engine').disabled=true;try{const response=await fetch('/api/speedtest/engine',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({engineId:el('speed-engine').value})}),result=await response.json();await loadSpeed();text('speed-message',result.message||'Motor atualizado.');}catch{text('speed-message','Não foi possível salvar o motor.');}finally{el('speed-engine').disabled=speedData?.status==='running';}
}
function renderSpeed(){
 if(!el('speedtest')||!speedData)return;
 const s=speedData,pc=s.mode==='pc',profiles=s.profiles||[],selector=el('speed-link');
 const names=pc?['all']:profiles.map(p=>p.name),signatureLinks=names.join('|');
 if(selector.dataset.links!==signatureLinks){const selected=selector.value;selector.replaceChildren(...names.map(name=>{const option=document.createElement('option');option.value=name;option.textContent=pc?'PC coletor':name;return option;}));selector.dataset.links=signatureLinks;if(names.includes(selected))selector.value=selected;}
 const profile=pc?{name:'PC coletor',configured:true,ready:true,latest:s.latest,cooldownUntil:s.cooldownUntil}:profiles.find(p=>p.name===selector.value);
 const last=profile?.latest,running=s.status==='running',cooldown=Math.max(0,Math.ceil(((profile?.cooldownUntil||0)-Date.now())/1000));
 text('speed-state',running?'TESTANDO '+(s.activeLink||''):!profile?.configured?'CONFIGURAÇÃO PENDENTE':!profile.ready?'LINK INDISPONÍVEL':last?'ÚLTIMO TESTE / '+profile.name:'NÃO MEDIDO / '+profile.name);el('speed-state').className='tag '+(profile?.ready?'up':'down');
 el('speed-run').textContent='▶ Testar '+(profile?.name||'WAN');el('speed-run').disabled=running||cooldown>0||!profile?.configured;el('speed-cancel').hidden=!running;
 el('speed-both').hidden=pc||profiles.length<2;el('speed-both').disabled=running||!profiles.some(p=>p.configured&&(p.cooldownUntil||0)<=Date.now());
 const native=s.engine==='ookla',engineSelect=el('speed-engine');if(document.activeElement!==engineSelect)engineSelect.value=s.engine||'http';engineSelect.disabled=running;
 text('speed-engine-hint',s.engineName+' · Preferência compartilhada por todos os visualizadores e pela agenda automática.');text('speed-server-hint',native?'Cliente oficial Ookla no PC. Automático compara RTT TCP de três servidores regionais autorizados desta WAN; depois o cliente Ookla mede velocidade, latência ociosa/sob carga e perda quando disponível. Os grupos de servidores são distintos para garantir o direcionamento por operadora.':'Teste HTTP próprio do ORBIT, com uma conexão. Automático compara os servidores do catálogo por latência HTTP. Método diferente de Ookla.');text('speed-comparison-metric',native?'TCP mediano':'HTTP mediano');el('speed-ookla-extra').hidden=!native;
 text('speed-loaded-download',Number.isFinite(last?.downloadLatencyMs)?fmt(last.downloadLatencyMs,2)+' ms':'—');text('speed-loaded-upload',Number.isFinite(last?.uploadLatencyMs)?fmt(last.uploadLatencyMs,2)+' ms':'—');text('speed-packet-loss',Number.isFinite(last?.packetLossPercent)?fmt(last.packetLossPercent,2)+'%':'—');el('speed-result').replaceChildren();if(last?.resultUrl){const a=document.createElement('a');a.href=last.resultUrl;a.textContent='Abrir resultado oficial no Speedtest';a.target='_blank';a.rel='noopener noreferrer';el('speed-result').append(a);}
 const available=(s.servers||[]).filter(v=>!v.links||v.links.includes(el('speed-link').value)),serverSelect=el('speed-server'),signature=s.engine+'|'+el('speed-link').value+'|'+available.map(v=>v.id).join(',');
 if(serverSelect.dataset.catalog!==signature){serverSelect.replaceChildren();for(const server of [{id:'auto',name:native?'Automático — menor RTT TCP':'Automático — menor latência HTTP'},...available]){const option=document.createElement('option');option.value=server.id;option.textContent=server.name;serverSelect.append(option);}serverSelect.dataset.catalog=signature;}
 if(document.activeElement!==serverSelect)serverSelect.value=s.serverSelections?.[el('speed-link').value]||'auto';serverSelect.disabled=running||pc;
 el('speed-links').replaceChildren();for(const p of s.profiles||[]){const card=div('wan-speed-card'),heading=document.createElement('h3');heading.textContent=p.name+' / '+p.interface;card.append(heading);addHelp(heading,'Teste por operadora');card.append(div('hint',p.reason));const result=p.latest;card.append(div('wan-speed-rate',result?fmt(result.downloadMbps,2)+' ↓ / '+fmt(result.uploadMbps,2)+' ↑ Mbps':'Ainda sem medição confirmada'));card.append(div('hint',result?new Date(result.time).toLocaleString('pt-BR')+' · '+(result.engine==='ookla'?'Ociosa':'HTTP')+' '+fmt(result.latencyMs,2)+' ms · '+(result.serverName||result.provider)+' · WAN confirmada':'Resultados gerais antigos não são atribuídos a este link.'));if(p.lastAttempt?.status==='error')card.append(div('hint warning','Última tentativa falhou: '+p.lastAttempt.error));el('speed-links').append(card);}
 text('speed-download',last?fmt(last.downloadMbps,2)+' Mbps':'—');text('speed-upload',last?fmt(last.uploadMbps,2)+' Mbps':'—');text('speed-latency',last?fmt(last.latencyMs,2)+' ms':'—');text('speed-jitter',last?fmt(last.jitterMs,2)+' ms':'—');
 el('speed-progress').style.width=(running?s.progress:s.status==='complete'?100:0)+'%';
 const current=s.current&&running?' · '+bytes(s.current.bytes)+(Number.isFinite(s.current.targetBytes)?' / '+bytes(s.current.targetBytes):'')+(Number.isFinite(s.current.mbps)?' · '+fmt(s.current.mbps,2)+' Mbps':''):'';
 text('speed-message',(!profile?.configured?profile?.reason||'Aguardando confirmação no MikroTik.':s.message||'')+current+(cooldown&&!running?' · '+profile.name+': teste manual disponível em '+cooldown+'s.':'')+(s.storageError?' · '+s.storageError:''));
 text('speed-last',last?'Último '+profile.name+': '+new Date(last.time).toLocaleString('pt-BR')+' · '+(last.serverName||last.provider)+(last.colo?' / '+last.colo:'')+' · '+bytes(last.bytes)+' transferidos · '+fmt(last.durationSeconds)+'s · '+last.interface+' confirmada'+(last.shortSamples?' · Amostras curtas; interpretar como estimativa.':''):'Nenhum teste desta operadora concluído. Os valores não medidos permanecem ausentes.');
 text('speed-schedule',s.automaticIntervalSeconds?(pc?'PC coletor':profiles.map(p=>p.name).join(' e '))+' a cada '+(s.automaticIntervalSeconds%3600===0?fmt(s.automaticIntervalSeconds/3600,0)+' horas':fmt(s.automaticIntervalSeconds/60,0)+' min')+' · '+(running?'Próximo agendado após concluir esta rodada':'Próximo previsto: '+new Date(s.nextAutomaticAt).toLocaleString('pt-BR'))+' · Testes sequenciais.':'Teste manual · Intervalo mínimo de '+(s.cooldownSeconds??300)+' s entre medições.');
 const states={complete:'Concluído',error:'Falhou',cancelled:'Cancelado'};
 table('speed-rows',(s.history||[]).filter(r=>(r.engine||'http')===s.engine).slice(-12).reverse().map(r=>[new Date(r.time).toLocaleString('pt-BR'),r.pathVerified?r.link+' / '+r.interface:r.link||'PC / sem WAN atribuída',r.status==='complete'?fmt(r.downloadMbps,2)+' Mbps':'—',r.status==='complete'?fmt(r.uploadMbps,2)+' Mbps':'—',r.status==='complete'?fmt(r.latencyMs,2)+' ms':'—',r.status==='complete'?fmt(r.jitterMs,2)+' ms':'—',r.provider?((r.serverName||r.provider)+(r.colo?' / '+r.colo:'')):'—',(states[r.status]||r.status)+(r.error?' · '+r.error:'')]),'Nenhum teste registrado.',8);
 table('speed-server-rows',(last?.serverCandidates||[]).map(r=>[r.name,r.eligible?fmt(r.latencyMs,2)+' ms':'—',r.eligible?fmt(r.jitterMs,2)+' ms':'—',r.eligible?(r.id===last.serverId?(last.serverSelection==='auto'?'Selecionado automaticamente':'Escolhido manualmente'):'Disponível / WAN confirmada'):r.error||'Indisponível']),'A comparação aparecerá após o próximo teste. A escolha é por operadora.',4);
 speedChart();
}
async function loadSpeed(){
 if(!el('speedtest')||speedBusy)return;
 if(role!=='lan'||data?.panel?.speedTestEnabled===false){text('speed-state','DESABILITADO');text('speed-message','A medição de velocidade está desabilitada neste gateway.');el('speed-run').disabled=true;el('speed-both').disabled=true;return;}
 speedBusy=true;try{const response=await fetch('/api/speedtest');if(!response.ok)throw new Error();activityClock.synchronize(response.headers.get('Date'));speedData=await response.json();renderSpeed();}catch{text('speed-state','SEM LEITURA');text('speed-message','Não foi possível consultar o serviço de teste de velocidade.');el('speed-run').disabled=true;}finally{speedBusy=false;}
}
async function speedAction(action,link=el('speed-link').value){
 el('speed-run').disabled=true;text('speed-message',action==='start'?'Solicitando teste no PC…':'Cancelando teste…');
 try{const response=await fetch('/api/speedtest/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({link})});const result=await response.json();await loadSpeed();if(!response.ok)text('speed-message',result.message||'Não foi possível iniciar o teste.');}catch{text('speed-message','Falha de comunicação com o serviço de velocidade.');}
}
async function configureSpeedServer(){
 const select=el('speed-server');select.disabled=true;
 try{const response=await fetch('/api/speedtest/server',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({link:el('speed-link').value,serverId:select.value})}),result=await response.json();await loadSpeed();text('speed-message',result.message||'Preferência atualizada.');}catch{text('speed-message','Não foi possível salvar o servidor.');}finally{select.disabled=speedData?.status==='running';}
}
if(localAdministration&&el('speedtest')){
 const heading=document.createElement('h2');heading.textContent='Velocidade da internet';
 const description=div('hint','A medição e o histórico ficam no gateway de rede quando a integração estiver habilitada.');
 const link=document.createElement('a');link.id='speed-lan-link';link.textContent='Abrir teste de velocidade no gateway';link.hidden=true;
 el('speedtest').replaceChildren(heading,description,link);
}
if(el('speed-run')){el('speed-run').onclick=()=>speedAction('start');el('speed-both').onclick=()=>speedAction('start','all');el('speed-cancel').onclick=()=>speedAction('cancel');el('speed-link').onchange=renderSpeed;el('speed-server').onchange=configureSpeedServer;el('speed-engine').onchange=configureSpeedEngine;el('speed-range').onchange=speedChart;loadSpeed();setInterval(loadSpeed,2000);window.addEventListener('resize',speedChart);}
refresh().then(()=>{
 initNavigation();
 startStream();
});
activityMonitor=initActivityMonitor(()=>data,()=>paused,()=>activityClock.now());
hostPanel=initHostPanel();
geoPanel=initGeoConnections({getSnapshot:()=>data,now:()=>activityClock.now(),isPaused:()=>paused,addHelp});
energyPanel=initEnergyPanel({now:()=>activityClock.now(),isPaused:()=>paused});
initListControls();
