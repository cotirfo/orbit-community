export function createActivityClock({wallNow=()=>Date.now(),monotonicNow=()=>typeof performance!=='undefined'&&typeof performance.now==='function'?performance.now():Date.now()}={}){
 let anchor=null;
 return {
   synchronize(serverDate){
     const time=typeof serverDate==='string'?Date.parse(serverDate):NaN,received=monotonicNow();
     if(!Number.isFinite(time)||!Number.isFinite(received))return false;
     // HTTP Date has one-second precision. Use its upper bound so calibration
     // cannot make an expired observation appear newer than it really is.
     anchor={time:time+1000,received};return true;
   },
   now(){
     const elapsed=anchor?monotonicNow()-anchor.received:NaN;
     return Number.isFinite(elapsed)&&elapsed>=0?anchor.time+elapsed:wallNow();
   }
 };
}
export function freshActivity(status,time,maxAgeMs,now=Date.now()){
 // Samples use the collector clock; a small offset from the viewer's clock
 // must not make every new sample disappear until the viewer catches up.
 const age=now-time;
 return status==='live'&&Number.isFinite(time)&&age>=-2000&&age<=maxAgeMs;
}
export function trafficActivity({status,time,rate,enabled=true,paused=false,maxAgeMs=15000,now=Date.now()}){
 if(paused)return {state:'paused',moving:false,duration:4,label:'Visão pausada'};
 if(!freshActivity(status,time,maxAgeMs,now))return {state:'unknown',moving:false,duration:4,label:'Sem leitura atual'};
 if(!enabled)return {state:'down',moving:false,duration:4,label:'Inativo'};
 if(!Number.isFinite(rate)||rate<0)return {state:'unknown',moving:false,duration:4,label:'Taxa indisponível'};
 if(rate===0)return {state:'idle',moving:false,duration:4,label:'Sem tráfego na amostra'};
 // Visual intensity only: never interpreted as individual packets or link capacity.
 return {state:'active',moving:true,duration:Math.max(.75,3.8-Math.log10(1+rate)*.9),label:'Tráfego observado'};
}
export function wanActivity(snapshot,name,{paused=false,now=Date.now()}={}){
 const iface=snapshot?.latest?.interfaces?.find(i=>i.name===snapshot?.wan?.[name]),health=snapshot?.wanHealth?.find(h=>h.link===name);
 const coreFresh=freshActivity(snapshot?.status,snapshot?.latest?.time,Math.max(15000,(snapshot?.cadence?.interfaces||2)*4000),now);
 let state='unknown',label='Sem confirmação atual';
 if(paused){state='paused';label='Visão pausada';}
 else if(coreFresh&&iface?.running===false){state='down';label='Link físico desconectado';}
 else if(coreFresh&&health&&freshActivity('live',health.routeTime,45000,now)){
   const probeFresh=health.probe?.fresh&&freshActivity('live',health.probe.time,35000,now);
   if(health.failoverTo||health.routeVerified&&!health.ownRouteActive){state='down';label=health.failoverTo?'Failover para '+health.failoverTo:'Sem rota pela operadora';}
   else if(probeFresh&&health.probe.pathVerified&&health.routeVerified&&health.ownRouteActive&&['up','degraded','down'].includes(health.state)){state=health.state;label=health.label;}
 }
 const options={status:coreFresh?'live':'error',time:snapshot?.latest?.time,enabled:Boolean(iface?.running)&&['up','degraded'].includes(state),paused,maxAgeMs:Math.max(15000,(snapshot?.cadence?.interfaces||2)*4000),now};
 return {state,label,interface:iface?.name||snapshot?.wan?.[name]||'—',download:trafficActivity({...options,rate:iface?.rxMbps}),upload:trafficActivity({...options,rate:iface?.txMbps}),rxMbps:coreFresh?iface?.rxMbps:null,txMbps:coreFresh?iface?.txMbps:null,reason:health?.reason||'Aguardando interface, sonda e rota recentes.'};
}
