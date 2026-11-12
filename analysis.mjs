import { isIP } from 'node:net';
import { finite, counterRate } from './telemetry.mjs';

export function endpoint(address, port) {
  const value=String(address||'');
  if(isIP(value)) return {ip:value,port:finite(port)};
  const bracket=value.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if(bracket) return {ip:bracket[1],port:finite(port??bracket[2])};
  const v4=value.match(/^(\d+\.\d+\.\d+\.\d+):(\d+)$/);
  return v4?{ip:v4[1],port:finite(port??v4[2])}:{ip:value,port:finite(port)};
}
export function durationMs(value) {
  if(value===undefined||value===null||value==='')return null;
  if(typeof value==='number'||/^\d+(?:\.\d+)?$/.test(value))return Number(value)/1000; // RouterOS raw time in microseconds
  let result=0,found=false;
  for(const m of String(value).matchAll(/([\d.]+)(ns|us|ms|s|m|h)/g)){found=true;result+=Number(m[1])*({ns:1e-6,us:.001,ms:1,s:1000,m:60000,h:3600000}[m[2]]);}
  const clock=String(value).match(/^(\d+):(\d+):(\d+(?:\.\d+)?)$/);
  if(clock)return (Number(clock[1])*3600+Number(clock[2])*60+Number(clock[3]))*1000;
  return found?result:null;
}
export function quality(rows, inventory, routes) {
  return inventory.links.map(link=>{
    const probe=rows.find(r=>r.comment==='ORBIT qualidade '+link.name || r.name==='orbit-'+link.name.toLowerCase());
    // A probe name alone does not establish its actual path.
    const enabled=Boolean(probe)&&String(probe.disabled)!=='true';
    const candidates=probe?routes.filter(r=>r['dst-address']===probe.host+'/32' && r['routing-table']==='main' && String(r.active)==='true'):[];
    const pinned=enabled && candidates.length===1 && String(candidates[0]['immediate-gw']||'').endsWith('%'+link.interface);
    return {link:link.name,host:probe?.host||link.probe,configured:Boolean(probe),enabled,pathVerified:Boolean(pinned),status:!probe?'pending':!enabled?'disabled':!pinned?'unverified':probe.status||'pending',probeStatus:probe?.status||null,
      rttMs:pinned&&finite(probe['response-count'])!==0?durationMs(probe['rtt-avg']):null,jitterMs:pinned&&finite(probe['response-count'])!==0?durationMs(probe['rtt-jitter']):null,
      lossPercent:pinned?finite(String(probe['loss-percent']??'').replace('%','')):null,
      sent:finite(probe?.['sent-count']),received:finite(probe?.['response-count']),tests:finite(probe?.['done-tests']),since:probe?.since||null};
  });
}
export function wanHealth({status,latest,details,inventory,now=Date.now(),coreMaxAgeMs=20000,routeMaxAgeMs=45000,probeMaxAgeMs=35000}) {
  const fresh=(entry,limit)=>entry?.state==='live'&&Number.isFinite(entry.time)&&now>=entry.time&&now-entry.time<=limit;
  const coreFresh=status==='live'&&Number.isFinite(latest?.time)&&now>=latest.time&&now-latest.time<=coreMaxAgeMs;
  const routesFresh=fresh(details?.allRoutes,routeMaxAgeMs),probesFresh=fresh(details?.netwatch,probeMaxAgeMs);
  const routes=routesFresh?details.allRoutes.rows||[]:[];
  const probes=quality(details?.netwatch?.rows||[],inventory,routes);
  return inventory.links.map(link=>{
    const physical=latest?.interfaces?.find(i=>i.name===link.interface),q=probes.find(p=>p.link===link.name);
    const defaults=routes.filter(r=>r['dst-address']==='0.0.0.0/0'&&r['routing-table']===link.table&&String(r.active)==='true'&&String(r.disabled)!=='true');
    const ownRoute=defaults.some(r=>String(r['immediate-gw']||'').endsWith('%'+link.interface));
    const alternatives=inventory.links.filter(l=>l.name!==link.name&&defaults.some(r=>String(r['immediate-gw']||'').endsWith('%'+l.interface)));
    const failoverTo=alternatives.length===1&&!ownRoute?alternatives[0].name:null;
    const verified=probesFresh&&routesFresh&&q.pathVerified;
    let state='unknown',label='SEM CONFIRMAÇÃO',reason='Aguardando leituras recentes da sonda e do roteamento.';
    if(!coreFresh||!physical){label='SEM LEITURA';reason='A coleta de interfaces não está atualizada.';}
    else if(!physical.running){state='down';label='LINK FÍSICO DOWN';reason=link.interface+' está sem conexão física.';}
    else if(verified&&(q.status==='down'||q.lossPercent===100)){
      state='down';label=q.received===0||q.lossPercent===100?'SONDA SEM RESPOSTA':'SONDA FALHOU';reason='Sonda '+q.host+' falhou'+(q.lossPercent!==null?' · perda '+q.lossPercent+'%':'')+'.';
    }
    else if(routesFresh&&link.table&&!ownRoute){state='down';label='WAN SEM ROTA';reason='A tabela '+link.table+' não tem rota ativa pela '+link.interface+'.';}
    else if(!routesFresh){reason='Roteamento sem leitura recente; estado da WAN não confirmado.';}
    else if(!q.configured||!q.enabled){reason=q.configured?'Sonda desativada.':'Sonda não configurada.';}
    else if(!probesFresh){reason='Sonda sem leitura recente; último resultado não confirma o estado atual.';}
    else if(!verified){reason='Caminho da sonda não confirmado pela '+link.interface+'.';}
    else if(q.status==='up'&&q.received>0&&q.tests>0&&Number.isFinite(q.lossPercent)&&Number.isFinite(q.rttMs)&&ownRoute){
      const degraded=q.lossPercent>0||q.rttMs>=150||q.jitterMs>=30;
      state=degraded?'degraded':'up';label=degraded?'SONDA DEGRADADA':'SONDA OK';
      reason=degraded?'Sonda com perda ou latência elevada.':'Sonda '+q.host+' responde pela '+link.interface+'; rota ativa.';
    }
    return {link:link.name,interface:link.interface,state,label,reason,physicalUp:coreFresh&&physical?physical.running:null,
      routeVerified:routesFresh,ownRouteActive:routesFresh?ownRoute:null,failoverTo:coreFresh?failoverTo:null,
      probe:{...q,fresh:probesFresh,pathVerified:verified,rttMs:verified?q.rttMs:null,jitterMs:verified?q.jitterMs:null,lossPercent:verified?q.lossPercent:null,time:details?.netwatch?.time||null},
      routeTime:details?.allRoutes?.time||null};
  });
}
function top(map,limit=12){return [...map.values()].sort((a,b)=>(b.rateBps??-1)-(a.rateBps??-1)||b.connections-a.connections).slice(0,limit);}
export function analyzeConnections(raw, previous, now, wanAddresses, maxGap=20) {
  const next=new Map(),rows=[],protocols=new Map(),sources=new Map(),destinations=new Map(),states=new Map(),ports=new Map();
  let observedBps=0,rateKnown=0,fasttrack=0,offloaded=0;
  for(const r of raw) {
    const source=endpoint(r['src-address'],r['src-port']),destination=endpoint(r['dst-address'],r['dst-port']),reply=endpoint(r['reply-dst-address'],r['reply-dst-port']);
    const signature=[r.family||'IPv4',r.protocol,source.ip,source.port,destination.ip,destination.port].join('|');
    const key=signature+'|'+r['.id'];
    const old=previous.get(key),orig=finite(r['orig-bytes']),repl=finite(r['repl-bytes']),elapsed=old?(now-old.time)/1000:0;
    const origBps=old?counterRate(orig,old.orig,elapsed,maxGap):null,replBps=old?counterRate(repl,old.repl,elapsed,maxGap):null;
    const rateBps=origBps!==null&&replBps!==null?origBps+replBps:null;
    if(orig!==null&&repl!==null)next.set(key,{orig,repl,time:now});
    if(rateBps!==null){observedBps+=rateBps;rateKnown++;}
    const row={id:key,routerId:r['.id'],family:r.family||'IPv4',protocol:r.protocol||'unknown',source:source.ip,sourcePort:source.port,destination:destination.ip,destinationPort:destination.port,
      mark:r['connection-mark']||'no-mark',wan:wanAddresses[reply.ip]||null,state:r['tcp-state']|| (String(r['seen-reply'])==='true'?'replied':'unreplied'),
      origBytes:orig,replBytes:repl,origBps,replBps,rateBps,timeout:r.timeout,
      fasttrack:String(r.fasttrack)==='true',offloaded:String(r['hw-offload'])==='true',srcnat:String(r.srcnat)==='true',dstnat:String(r.dstnat)==='true'};
    rows.push(row);if(row.fasttrack)fasttrack++;if(row.offloaded)offloaded++;
    for(const [map,name] of [[protocols,row.protocol],[sources,row.source],[destinations,row.destination],[states,row.state],[ports,row.protocol+':'+(row.destinationPort??'—')]]){
      const entry=map.get(name)||{name,connections:0,rateBps:null,origBytes:null,replBytes:null};entry.connections++;
      if(rateBps!==null)entry.rateBps=(entry.rateBps??0)+rateBps;
      if(orig!==null)entry.origBytes=(entry.origBytes??0)+orig;if(repl!==null)entry.replBytes=(entry.replBytes??0)+repl;map.set(name,entry);
    }
  }
  rows.sort((a,b)=>(b.rateBps??-1)-(a.rateBps??-1)||(b.origBytes??0)+(b.replBytes??0)-(a.origBytes??0)-(a.replBytes??0));
  return {next,view:{time:now,count:raw.length,rateKnown,observedBps:rateKnown?observedBps:null,fasttrack,offloaded,
    protocols:top(protocols),sources:top(sources),destinations:top(destinations),states:top(states),ports:top(ports),rows:rows.slice(0,1000),displayLimited:rows.length>1000}};
}
export function aggregateHistory(history,minutes=60,maxPoints=1200) {
  const filtered=history.filter(s=>s.time>Date.now()-minutes*60000);
  if(filtered.length<=maxPoints)return filtered;
  const step=Math.ceil(filtered.length/maxPoints),result=[];
  for(let index=0;index<filtered.length;index+=step){
    const group=filtered.slice(index,index+step),last=group.at(-1);
    const average=values=>{const present=values.filter(Number.isFinite);return present.length?present.reduce((a,b)=>a+b,0)/present.length:null;};
    result.push({...last,cpu:average(group.map(s=>s.cpu)),memoryPercent:average(group.map(s=>s.memoryPercent)),interfaces:last.interfaces.map(i=>({...i,
      ...Object.fromEntries(['rxMbps','txMbps','rxPps','txPps','dropPps'].map(key=>[key,average(group.map(s=>s.interfaces.find(r=>r.name===i.name)?.[key]))])),
      rxPeakMbps:Math.max(...group.map(s=>s.interfaces.find(r=>r.name===i.name)?.rxMbps).filter(Number.isFinite),0)}))});
  }
  return result;
}
