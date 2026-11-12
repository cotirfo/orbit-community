import { BlockList, isIP } from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';

const special = new BlockList();
for (const [ip, bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]]) special.addSubnet(ip,bits,'ipv4');
// AS112 and AMT are special-purpose infrastructure, unsuitable for location claims.
for (const ip of ['192.31.196.0','192.52.193.0','192.175.48.0']) special.addSubnet(ip,24,'ipv4');
for (const [ip,bits] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]]) special.addSubnet(ip,bits,'ipv6');
special.addSubnet('2620:4f:8000::',48,'ipv6');
const global6 = new BlockList(); global6.addSubnet('2000::',3,'ipv6');
export function publicIP(value) {
  const family=isIP(value);
  if(family===4) return !special.check(value,'ipv4');
  return family===6 && !value.includes('%') && global6.check(value,'ipv6') && !special.check(value,'ipv6');
}
const canonical = ip => isIP(ip)===6 ? new URL('http://['+ip+']/').hostname.slice(1,-1) : ip;
const bounded=(value,fallback,min,max)=>Number.isFinite(Number(value))?Math.max(min,Math.min(max,Math.floor(Number(value)))):fallback;
const clean=value=>typeof value==='string'?value.replace(/[\u0000-\u001f]/g,' ').slice(0,180):null;
const name=value=>clean(value?.names?.['pt-BR']||value?.names?.en);
const coordinate=(value,limit)=>Number.isFinite(value)&&Math.abs(value)<=limit?value:null;

// No network code: databases are installed separately by the operator.
export function createLocalGeoProvider({root,config={},openDatabase}={}) {
  let loaded;
  async function load(){
    let open=openDatabase;
    const result={};
    for(const [kind,filename,type] of [['city',config.cityDatabase||'data/geoip/GeoLite2-City.mmdb','City'],['asn',config.asnDatabase||'data/geoip/GeoLite2-ASN.mmdb','ASN']]){
      try{
        const file=path.resolve(root,filename),stat=await fs.stat(file);
        const limit=kind==='city'?128*1024*1024:32*1024*1024;
        if(!stat.isFile()||stat.size>limit)throw new Error('database size');
        open??=(await import('maxmind')).open;
        const reader=await open(file,{cache:{max:512},watchForUpdates:false});
        if(!String(reader.metadata?.databaseType||'').endsWith('-'+type))throw new Error('database type');
        const build=reader.metadata?.buildEpoch;
        result[kind]={reader,state:'ready',updatedAt:build instanceof Date?build.getTime():stat.mtimeMs,bytes:stat.size};
      }catch(error){result[kind]={reader:null,state:error.code==='ENOENT'?'pending':'error',updatedAt:null,bytes:0};}
    }
    return result;
  }
  const ready=()=>loaded||(loaded=load().catch(()=>({city:{state:'error'},asn:{state:'error'}})));
  return {
    async status(){const db=await ready();return Object.fromEntries(Object.entries(db).map(([k,{state,updatedAt,bytes}])=>[k,{state,updatedAt,bytes}]));},
    async lookup(ip){
      const db=await ready();let city=null,asn=null,failed=false;
      for(const kind of ['city','asn']){try{const record=db[kind].reader?.get(ip);if(kind==='city')city=record;else asn=record;}catch{failed=true;}}
      const lat=coordinate(city?.location?.latitude,90),lon=coordinate(city?.location?.longitude,180);
      return {state:failed?'error':city||asn?'available':db.city.state==='pending'||db.asn.state==='pending'?'pending':db.city.state==='error'||db.asn.state==='error'?'error':'unavailable',
        countryCode:clean(city?.country?.iso_code),country:name(city?.country),region:name(city?.subdivisions?.[0]),city:name(city?.city),
        latitude:lat!==null&&lon!==null?lat:null,longitude:lat!==null&&lon!==null?lon:null,
        accuracyRadiusKm:Number.isFinite(city?.location?.accuracy_radius)?city.location.accuracy_radius:null,
        asn:Number.isSafeInteger(asn?.autonomous_system_number)&&asn.autonomous_system_number>0?asn.autonomous_system_number:null,
        organization:clean(asn?.autonomous_system_organization),approximate:Boolean(city)};
    }
  };
}

export function createGeoConnections({root,config={},provider=createLocalGeoProvider({root,config}),now=Date.now}={}) {
  const maxCacheEntries=bounded(config.maxCacheEntries,2048,1,20000),cacheTtlMs=bounded(config.cacheTtlSeconds,86400,1,604800)*1000;
  const maxHistoryEntries=bounded(config.maxHistoryEntries,2000,1,10000),retentionMs=bounded(config.retentionMinutes,60,0,10080)*60000;
  const huaweiSource=config.huaweiNatAddress;
  const cache=new Map(),history=new Map();let current=[],lastTime=null,lastInputTime=null,database={city:{state:'pending'},asn:{state:'pending'}},coverage={},evicted=0;
  function prune(){const cutoff=now()-retentionMs;for(const [key,row] of history)if(row.lastSeen<cutoff||retentionMs===0)history.delete(key);for(const [key,entry] of cache)if(entry.expires<=now())cache.delete(key);}
  async function lookup(ip){
    let entry=cache.get(ip);
    if(entry?.expires<=now()){cache.delete(ip);entry=null;}
    if(entry){cache.delete(ip);cache.set(ip,entry);return entry.promise;}
    const promise=Promise.resolve().then(()=>provider.lookup(ip)).catch(()=>({state:'error'}));
    cache.set(ip,{promise,expires:now()+cacheTtlMs});
    while(cache.size>maxCacheEntries)cache.delete(cache.keys().next().value);
    return promise;
  }
  function origin(ip,details){
    if(ip===huaweiSource)return {ip,label:'Huawei AX3 — dispositivos internos agregados',aggregated:true};
    const fresh=entry=>entry?.state==='live'&&Number.isFinite(entry.time)&&now()-entry.time>=0&&now()-entry.time<=120000;
    const lease=fresh(details.leases)?details.leases.rows?.find(r=>(r['active-address']||r.address)===ip&&r.status==='bound'):null;
    const arp=fresh(details.arp)?details.arp.rows?.find(r=>r.address===ip):null;
    return {ip,label:clean(lease?.['host-name']||arp?.['host-name'])||ip,mac:clean(lease?.['active-mac-address']||lease?.['mac-address']||arp?.['mac-address']),aggregated:false};
  }
  function snapshot(state='pending'){
    prune();return {state:config.enabled===false?'disabled':state,mapOrigin:config.mapOrigin??null,time:lastTime,databases:database,rows:current,history:[...history.values()],coverage,
      limits:{maxCacheEntries,cacheTtlSeconds:cacheTtlMs/1000,maxHistoryEntries,retentionMinutes:retentionMs/60000},historyEvictions:evicted};
  }
  return {
    async observe(connections,details={}){
      if(config.enabled===false||connections.state!=='live')return snapshot(connections.state);
      if(connections.time===lastInputTime)return snapshot('live');
      const groups=new Map(),rows=(connections.rows||[]).slice(0,1000);let excluded=0;
      // Only destinations from the already exposed collector rows are processed.
      for(const row of rows){
        if(!publicIP(row.destination)){excluded++;continue;}
        const ip=canonical(row.destination),source=origin(row.source,details),wan=['WAN1','WAN2'].includes(row.wan)?row.wan:null;
        const key=JSON.stringify([source.ip,ip,row.destinationPort,row.protocol,wan]);
        const group=groups.get(key)||{key,ip,port:row.destinationPort??null,protocol:clean(row.protocol),source,wan,connections:0};
        group.connections++;groups.set(key,group);
      }
      const results=new Map(),ips=[...new Set([...groups.values()].map(r=>r.ip))];
      for(let i=0;i<ips.length;i+=32){await Promise.all(ips.slice(i,i+32).map(async ip=>results.set(ip,await lookup(ip))));await new Promise(resolve=>setImmediate(resolve));}
      try{database=await provider.status();}catch{database={city:{state:'error'},asn:{state:'error'}};}
      current=[...groups.values()].map(row=>({...row,geo:results.get(row.ip)||{state:'unavailable'}}));
      prune();
      if(retentionMs>0)for(const row of current){
        const old=history.get(row.key);history.delete(row.key);
        history.set(row.key,{...row,firstSeen:old?.firstSeen??connections.time,lastSeen:connections.time,samplesSeen:(old?.samplesSeen||0)+1,peakConnections:Math.max(old?.peakConnections||0,row.connections)});
        while(history.size>maxHistoryEntries){history.delete(history.keys().next().value);evicted++;}
      }
      lastTime=connections.time;lastInputTime=connections.time;
      coverage={observedRows:rows.length,totalConnections:connections.count??null,publicConnections:current.reduce((n,r)=>n+r.connections,0),excludedConnections:excluded,
        partial:Boolean(connections.displayLimited||connections.count>rows.length),ipv6State:details.ipv6Connections?.state||'pending',fasttrack:connections.fasttrack||0,offloaded:connections.offloaded||0};
      return snapshot('live');
    },
    snapshot,
    diagnostics(){prune();return {cacheEntries:cache.size,historyEntries:history.size};}
  };
}
