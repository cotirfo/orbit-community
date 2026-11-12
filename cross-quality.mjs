// Shared calculation and RouterOS configuration contract; no browser or Node APIs.
export const CROSS_TARGETS=[
 {id:'cloudflare',name:'Cloudflare',host:'1.1.1.1'},
 {id:'google',name:'Google',host:'8.8.8.8'},
 {id:'quad9',name:'Quad9',host:'9.9.9.9'}
];
export const CROSS_LINKS=[
 {name:'WAN1',interface:'ether1',gateway:'198.51.100.11',source:'198.51.100.12',table:'orbit-rtt-wan1'},
 {name:'WAN2',interface:'ether5',gateway:'203.0.113.11',source:'203.0.113.12',table:'orbit-rtt-wan2'}
];
const disabled=row=>!row||['true','yes'].includes(String(row.disabled))||['true','yes'].includes(String(row.invalid));
const active=row=>['true','yes'].includes(String(row?.active));
const number=value=>value===undefined||value===null||value===''?null:Number.isFinite(Number(value))?Number(value):null;
const fresh=(entry,now,age)=>entry?.state==='live'&&Number.isFinite(entry.time)&&now>=entry.time&&now-entry.time<=age;
function duration(value){
 if(value===undefined||value===null||value==='')return null;
 if(typeof value==='number'||/^\d+(?:\.\d+)?$/.test(value))return Number(value)/1000;
 const text=String(value),clock=text.match(/^(\d+):(\d+):(\d+(?:\.\d+)?)$/);
 if(clock)return (Number(clock[1])*3600+Number(clock[2])*60+Number(clock[3]))*1000;
 let result=0,found=false;for(const m of text.matchAll(/([\d.]+)(ns|us|ms|s|m|h)/g)){found=true;result+=Number(m[1])*({ns:1e-6,us:.001,ms:1,s:1000,m:60000,h:3600000}[m[2]]);}return found?result:null;
}
const sourceMatches=(value,ip)=>value===ip||value===ip+'/32';
const differentSource=(row,ip)=>row['src-address']&&/^(?:\d{1,3}\.){3}\d{1,3}(?:\/32)?$/.test(row['src-address'])&&!sourceMatches(row['src-address'],ip);
export function crossedQuality(details,now=Date.now(),configuredLinks=CROSS_LINKS){
 const configured=(details.netwatch?.rows||[]).some(r=>String(r.comment||'').startsWith('ORBIT RTT '));
 const configFresh=['pcc','nat','addresses','addressLists'].every(key=>fresh(details[key],now,90000));
 const routeFresh=fresh(details.allRoutes,now,45000),probeFresh=fresh(details.netwatch,now,35000);
 const routes=details.allRoutes?.rows||[],mangle=details.pcc?.rows||[],nat=details.nat?.rows||[],addresses=details.addresses?.rows||[];
 const targets=(details.addressLists?.rows||[]).filter(r=>r.list==='orbit-rtt-targets'&&!disabled(r));
 const samples=configuredLinks.flatMap(link=>{
   const marker=mangle.filter(r=>r.comment==='ORBIT RTT '+link.name+' output');
   const mark=marker[0],markIndex=mangle.indexOf(mark);
   const earlierRouting=mangle.slice(0,Math.max(0,markIndex)).some(r=>!disabled(r)&&r.chain==='output'&&['mark-routing','jump','accept'].includes(r.action)&&!differentSource(r,link.source)&&(!r.protocol||r.protocol==='icmp'));
   const markerGood=marker.length===1&&!disabled(mark)&&mark.chain==='output'&&mark.protocol==='icmp'&&sourceMatches(mark['src-address'],link.source)&&mark['dst-address-list']==='orbit-rtt-targets'&&mark.action==='mark-routing'&&mark['new-routing-mark']===link.table&&String(mark.passthrough)==='false'&&!earlierRouting;
   const defaults=routes.filter(r=>r['routing-table']===link.table&&r['dst-address']==='0.0.0.0/0'&&!disabled(r));
   const blocks=defaults.filter(r=>Object.hasOwn(r,'blackhole')&&String(r.blackhole)!=='false'&&Number(r.distance)===254);
   const activeDefaults=defaults.filter(active),ownRoute=activeDefaults.length===1&&String(activeDefaults[0]['immediate-gw'])===link.gateway+'%'+link.interface&&[link.gateway,link.gateway+'%'+link.interface,link.gateway+'@main'].includes(activeDefaults[0].gateway);
   const sourceGood=addresses.filter(r=>!disabled(r)&&r.interface==='lo'&&r.address===link.source+'/32').length===1;
   const natRows=nat.filter(r=>r.comment==='ORBIT RTT '+link.name+' NAT'),n=natRows[0];
   const natIndex=nat.indexOf(n),earlierNat=nat.slice(0,Math.max(0,natIndex)).some(r=>!disabled(r)&&r.chain==='srcnat'&&!differentSource(r,link.source)&&(!r['out-interface']||r['out-interface']===link.interface)&&(!r.protocol||r.protocol==='icmp'));
   const natGood=natRows.length===1&&!disabled(n)&&n.chain==='srcnat'&&sourceMatches(n['src-address'],link.source)&&n['dst-address-list']==='orbit-rtt-targets'&&n.protocol==='icmp'&&n['out-interface']===link.interface&&n.action==='masquerade'&&!earlierNat;
   return CROSS_TARGETS.map(target=>{
     const probes=(details.netwatch?.rows||[]).filter(r=>r.comment==='ORBIT RTT '+link.name+' '+target.name),probe=probes[0];
     const probeGood=probes.length===1&&!disabled(probe)&&probe.type==='icmp'&&probe.host===target.host&&probe['src-address']===link.source&&['up-script','down-script','test-script'].every(k=>!probe[k]);
     const targetGood=targets.filter(r=>r.address===target.host).length===1;
     const pathVerified=configFresh&&routeFresh&&markerGood&&natGood&&sourceGood&&ownRoute&&blocks.length===1&&targetGood&&probeGood;
     const sent=number(probe?.['sent-count']),received=number(probe?.['response-count']),tests=number(probe?.['done-tests']);
     const loss=number(String(probe?.['loss-percent']??'').replace('%',''));
     const completed=probeFresh&&probeGood&&tests>0&&sent>0&&received>=0&&received<=sent&&loss!==null&&loss>=0&&loss<=100&&['up','down'].includes(probe.status);
     const verified=pathVerified&&completed;
     const rtt=verified&&received>0?duration(probe['rtt-avg']):null;
     return {link:link.name,target:target.id,targetName:target.name,host:target.host,source:link.source,table:link.table,configured:probes.length>0,
       state:!verified?'unverified':received===0?'down':loss>0||rtt>=150?'degraded':probe.status==='up'?'up':'degraded',
       probeStatus:probe?.status||'pending',pathVerified,verified,fresh:probeFresh,tests,sent:verified?sent:null,received:verified?received:null,
       lossPercent:verified?loss:null,rttMs:rtt,jitterMs:verified&&received>0?duration(probe['rtt-jitter']):null,time:details.netwatch?.time||null,
       reason:verified?'Caminho '+link.interface+' confirmado':!probeGood?'Sonda ausente, duplicada, desativada ou diferente do esperado':!configFresh||!routeFresh||!probeFresh?'Leitura de configuração, rota ou sonda pendente/antiga':!markerGood?'Regra de saída não confirmada':!natGood?'NAT da sonda não confirmado':!sourceGood?'Origem da sonda não confirmada':!ownRoute||blocks.length!==1?'Rota exclusiva/bloqueio da WAN não confirmado':!targetGood?'Destino não autorizado':'Aguardando primeiro teste completo'};
   });
 });
 // A fair mean uses only the same targets with verified replies on BOTH links.
 const common=CROSS_TARGETS.filter(t=>configuredLinks.every(l=>samples.some(s=>s.link===l.name&&s.target===t.id&&s.verified&&Number.isFinite(s.rttMs)))).map(t=>t.id);
 const mean=values=>values.length?values.reduce((n,v)=>n+v,0)/values.length:null;
 const links=configuredLinks.map(link=>{
   const own=samples.filter(s=>s.link===link.name),valid=own.filter(s=>s.verified),received=valid.reduce((n,s)=>n+s.received,0),sent=valid.reduce((n,s)=>n+s.sent,0);
   return {link:link.name,meanRttMs:mean(own.filter(s=>common.includes(s.target)).map(s=>s.rttMs)),
     comparableTargets:common.length,expectedTargets:CROSS_TARGETS.length,verifiedTargets:valid.length,
     respondingTargets:valid.filter(s=>s.received>0).length,failedTargets:valid.filter(s=>s.received===0).length,
     lossPercent:sent?100*(sent-received)/sent:null,lossComplete:valid.length===CROSS_TARGETS.length,
     samples:own,state:!valid.length?'pending':valid.some(s=>s.received===0)||valid.length<CROSS_TARGETS.length||common.length<CROSS_TARGETS.length?'partial':valid.some(s=>s.state!=='up')?'degraded':'up'};
 });
 return {configured,time:details.netwatch?.time||null,commonTargets:common,complete:common.length===CROSS_TARGETS.length,
   method:'Média aritmética dos mesmos destinos com resposta validada nas duas WANs; perda calculada por pacotes enviados',samples,links};
}
