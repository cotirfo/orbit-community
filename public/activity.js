import {freshActivity,trafficActivity,wanActivity} from './activity-model.mjs';
import {createTopologyScene} from './topology-scene.js';
const fmt=v=>Number.isFinite(v)&&v>=0?v.toLocaleString('pt-BR',{maximumFractionDigits:v<1?3:2})+' Mbps':'—';
let motionObserver=null;
export function watchMotionRegion(region){
 if(typeof IntersectionObserver==='function'){
   if(!motionObserver)motionObserver=new IntersectionObserver(entries=>entries.forEach(e=>e.target.classList.toggle('motion-outside',!e.isIntersecting)),{rootMargin:'60px'});
   motionObserver.observe(region);
 }
}
export function decorateTrafficCell(cell,{reverse=false,animate=true,directionLabel='',...options}){
 const activity=trafficActivity(options);if(!activity.moving)return;
 const track=document.createElement('span');track.className='mini-flow flow-track '+(reverse?'flow-reverse ':'')+(animate?'flow-active':'flow-static');track.setAttribute('aria-hidden','true');
 const packets=document.createElement('i');packets.className='flow-packets';packets.style.animationDuration=activity.duration+'s';track.append(packets);track.title=directionLabel;cell.append(track);cell.title=(cell.title?cell.title+' · ':'')+(directionLabel?directionLabel+': ':'')+'tráfego positivo observado nesta amostra. Movimento ilustrativo; não representa pacotes individuais.';
}
export function initActivityMonitor(getSnapshot,isPaused,getNow=Date.now){
 const panel=document.createElement('section');panel.id='live-traffic';panel.className='panel traffic-map';
 panel.innerHTML=`<div class="panel-heading"><div><p class="eyebrow">NETWORK DIGITAL TWIN / TELEMETRIA AO VIVO</p><h2>Topologia 3D da rede</h2></div><button id="motion-toggle" type="button" aria-pressed="true">Animações: ativadas</button></div><p class="hint">As cores identificam cada rota. Os cartões mostram as taxas reais da última amostra; o pulso só aparece quando há tráfego positivo em uma leitura recente e caminho confirmado.</p><div id="traffic-paths"></div><div class="traffic-bottom"><span id="traffic-summary" role="status">Aguardando coleta…</span><span>↓ Entrada / download · ↑ Saída / upload</span></div><details><summary>Como interpretar a cena?</summary><p class="hint">A representação 3D é esquemática. Ciano identifica WAN1, violeta identifica WAN2 e azul identifica LAN / Huawei. As taxas em Mbps vêm das interfaces do MikroTik e da telemetria agregada do Huawei. O pulso animado exige taxa positiva e amostra recente; a velocidade do pulso ajuda a distinguir a intensidade, mas não representa pacotes individuais. Nas WANs, a animação também exige sonda recente e rota pela própria operadora; o failover não faz uma WAN indisponível parecer ativa. Âmbar indica caminho degradado; cinza indica leitura ausente, antiga ou pausada. O trecho LAN não identifica qual WAN cada cliente utiliza, e o trecho Huawei mostra apenas dados agregados da rede interna.</p></details>`;
 document.querySelector('.wan-grid').after(panel);
 const nav=document.createElement('a');nav.href='#live-traffic';nav.append(document.createTextNode('09 '));const name=document.createElement('span');name.textContent='Fluxo ao vivo';nav.append(name);document.querySelector('aside nav').append(nav);
 const paths=document.getElementById('traffic-paths'),rows=new Map();
 for(const [id,source,sourceNote,destination,destinationNote] of [['WAN1','WAN1','Interface da WAN1','MikroTik','Entrada WAN'],['WAN2','WAN2','Interface da WAN2','MikroTik','Entrada WAN'],['LAN','MikroTik','Interface da LAN','Huawei','Rede local / clientes']]){
   const row=document.createElement('article');row.className='traffic-path topology-path';row.dataset.path=id;row.innerHTML=`<div class="topology-path-head"><b class="flow-source"></b><span class="flow-state"></span></div><small class="topology-path-note"></small><div class="flow-lanes"><div class="flow-lane"><span class="flow-direction">↓</span><div class="flow-track"><i class="flow-packets"></i></div><b class="flow-rate"></b></div><div class="flow-lane flow-reverse"><span class="flow-direction">↑</span><div class="flow-track flow-reverse"><i class="flow-packets"></i></div><b class="flow-rate"></b></div></div><small class="flow-reading"></small><span class="flow-end-note"></span>`;
   row.querySelector('.flow-source').textContent=source+' → '+destination;row.querySelector('.topology-path-note').textContent=sourceNote;paths.append(row);rows.set(id,row);
 }
 const scene=createTopologyScene(paths);watchMotionRegion(scene.element);let huaweiSnapshot=null;
 const connections=document.getElementById('connections');watchMotionRegion(panel);watchMotionRegion(connections);
 const reduced=typeof matchMedia==='function'?matchMedia('(prefers-reduced-motion: reduce)'):null,toggle=document.getElementById('motion-toggle');let enabled=true;
 try{enabled=localStorage.getItem('orbit-motion')!=='off';}catch{}
 function preference(){const reduce=Boolean(reduced?.matches);document.body.classList.toggle('motion-off',!enabled||reduce);toggle.disabled=reduce;toggle.setAttribute('aria-pressed',String(enabled&&!reduce));toggle.textContent=reduce?'Animações: reduzidas pelo sistema':enabled?'Animações: ativadas':'Animações: desativadas';}
 toggle.onclick=()=>{enabled=!enabled;try{localStorage.setItem('orbit-motion',enabled?'on':'off');}catch{}preference();};
 if(reduced?.addEventListener)reduced.addEventListener('change',preference);else if(reduced?.addListener)reduced.addListener(preference);preference();
 function update(){
   const snapshot=getSnapshot(),paused=isPaused(),now=getNow();document.body.classList.toggle('motion-paused',paused);document.body.classList.toggle('motion-hidden',document.hidden);
   const time=snapshot?.latest?.time,coreFresh=freshActivity(snapshot?.status,time,Math.max(15000,(snapshot?.cadence?.interfaces||2)*4000),now);
   const flowFresh=freshActivity(snapshot?.connections?.state,snapshot?.connections?.time,Math.max(15000,(snapshot?.cadence?.connections||5)*3000),now);connections.dataset.motionFresh=String(flowFresh&&!paused);
   let moving=0;const models={};
   for(const id of ['WAN1','WAN2','LAN']){
     let model;
     if(id==='LAN'){
       const iface=snapshot?.latest?.interfaces?.find(i=>i.name===snapshot?.panel?.lanInterface),options={status:snapshot?.status,time,paused,enabled:Boolean(iface?.running),maxAgeMs:Math.max(15000,(snapshot?.cadence?.interfaces||2)*4000),now};
       model={state:paused?'paused':!coreFresh?'unknown':iface?.running?'up':'down',label:paused?'Visão pausada':!coreFresh?'Sem leitura atual':iface?.running?'Link físico ativo':'Link físico desconectado',download:trafficActivity({...options,rate:iface?.txMbps}),upload:trafficActivity({...options,rate:iface?.rxMbps}),rxMbps:coreFresh?iface?.txMbps:null,txMbps:coreFresh?iface?.rxMbps:null,reason:'Tráfego agregado da interface LAN configurada. Não confirma internet por aparelho.'};
     }else model=wanActivity(snapshot,id,{paused,now});
     models[id]=model;const row=rows.get(id);row.dataset.health=model.state;row.title=model.reason;row.querySelector('.topology-path-note').textContent=(id==='LAN'?snapshot?.panel?.lanInterface:snapshot?.wan?.[id])||'Interface não configurada';row.querySelector('.flow-state').textContent=model.label;
     const lanes=row.querySelectorAll('.flow-lane');[model.download,model.upload].forEach((activity,index)=>{const lane=lanes[index];lane.querySelector('.flow-track').classList.toggle('flow-active',activity.moving);lane.querySelector('.flow-packets').style.animationDuration=activity.duration+'s';lane.querySelector('.flow-rate').textContent=paused?'Pausado':fmt(index?model.txMbps:model.rxMbps);if(activity.moving)moving++;});
     row.querySelector('.flow-reading').textContent=paused?'Visão pausada':!coreFresh?'Sem amostra recente':model.download.moving||model.upload.moving?'TRÁFEGO OBSERVADO':model.state==='up'||model.state==='degraded'?'SEM TRÁFEGO NA AMOSTRA':'FLUXO SEM CONFIRMAÇÃO';
     row.querySelector('.flow-end-note').textContent=id==='LAN'?'NAT / agregado':model.state==='down'?'Caminho indisponível':model.state==='up'||model.state==='degraded'?'Rota + sonda verificadas':'Verificação pendente';
   }
   scene.update(models,{snapshot,huawei:huaweiSnapshot,paused,now});
   document.getElementById('traffic-summary').textContent=paused?'VISÃO PAUSADA · movimentos interrompidos':!coreFresh?'SEM LEITURA RECENTE · movimentos interrompidos':moving?'TRÁFEGO ATIVO · '+moving+' direções com taxa positiva · amostra '+new Date(time).toLocaleTimeString('pt-BR'):'SEM FLUXO CONFIRMADO · amostra '+new Date(time).toLocaleTimeString('pt-BR');
   for(const id of ['wan1','wan2']){const model=wanActivity(snapshot,id==='wan1'?'WAN1':'WAN2',{paused,now}),card=document.getElementById(id+'-state').closest('.wan');card.dataset.motionHealth=model.state;card.classList.toggle('wan-traffic-active',model.download.moving||model.upload.moving);}
 }
 update();setInterval(update,1000);document.addEventListener('visibilitychange',update);
 return {update,setHuawei:value=>{huaweiSnapshot=value;update();}};
}
