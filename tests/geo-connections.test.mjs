import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {publicIP,createGeoConnections,createLocalGeoProvider} from '../geo-connections.mjs';
import {analyzeConnections} from '../analysis.mjs';
import {filterGeoRows,summarizeGeo,hasCoordinates,project} from '../public/geo-model.mjs';

const record={state:'available',countryCode:'BR',country:'Brasil',region:'Região sintética',city:'Cidade de teste',latitude:-10,longitude:-40,asn:64500,organization:'Provedor sintético',approximate:true};
const row=(destination='8.8.8.8',extra={})=>({source:'10.231.2.45',destination,destinationPort:443,protocol:'tcp',wan:'WAN1',...extra});
const connection=(rows,time=1000,extra={})=>({state:'live',time,rows,count:rows.length,...extra});
const fakeProvider=lookup=>({lookup:lookup||(()=>record),status:async()=>({city:{state:'ready'},asn:{state:'ready'}})});

test('Geo IP excludes special-use IPv4 and IPv6, including mapped, translated, scoped and documentation addresses',()=>{
  for(const ip of ['8.8.8.8','1.1.1.1','2001:4860:4860::8888','2606:4700:4700::1111'])assert.equal(publicIP(ip),true,ip);
  for(const ip of ['192.31.196.1','192.52.193.1','192.175.48.1','2620:4f:8000::1'])assert.equal(publicIP(ip),false,ip);
  for(const ip of ['','garbage','300.1.2.3','0.0.0.0','10.1.2.3','100.64.0.1','127.0.0.1','169.254.1.1','172.31.255.255','192.0.0.9','192.0.2.1','192.88.99.1','192.0.2.47','198.18.1.1','198.51.100.1','203.0.113.1','224.0.0.1','255.255.255.255','::','::1','fe80::1','fe80::1%eth0','fc00::1','ff02::1','::ffff:8.8.8.8','64:ff9b::808:808','2001::1','2001:db8::1','2002:0808:0808::1','3fff::1'])assert.equal(publicIP(ip),false,ip);
});

test('missing databases return pending data without fabricating location; malformed databases fail independently',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'orbit-geo-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const provider=createLocalGeoProvider({root});
  assert.equal((await provider.status()).city.state,'pending');
  const result=await provider.lookup('8.8.8.8');assert.equal(result.state,'pending');for(const key of ['city','country','asn','latitude','longitude'])assert.equal(result[key],null);
  await fs.mkdir(path.join(root,'data/geoip'),{recursive:true});await fs.writeFile(path.join(root,'data/geoip/GeoLite2-City.mmdb'),'invalid fixture');
  const corrupt=createLocalGeoProvider({root});assert.equal((await corrupt.status()).city.state,'error');assert.equal((await corrupt.status()).asn.state,'pending');
  assert.equal((await corrupt.lookup('8.8.8.8')).country,null);
});

test('local MMDB adapter normalizes City and ASN independently and retains absent values, zero coordinates and metadata',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'orbit-geo-adapter-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.writeFile(path.join(root,'city.mmdb'),'fixture');await fs.writeFile(path.join(root,'asn.mmdb'),'fixture');let fail=false,invalid=false;const queries=[];
  const provider=createLocalGeoProvider({root,config:{cityDatabase:'city.mmdb',asnDatabase:'asn.mmdb'},openDatabase:async(file,options)=>{
    assert.equal(options.watchForUpdates,false);assert.equal(options.cache.max,512);const city=file.endsWith('city.mmdb');
    return {metadata:{databaseType:city?'GeoLite2-City':'GeoLite2-ASN',buildEpoch:new Date(1000)},get:ip=>{queries.push(ip);if(fail&&city)throw new Error('fixture failure');return city?{country:{iso_code:'BR',names:{'pt-BR':'Brasil'}},city:{names:{en:'Fixture'}},location:{latitude:invalid?100:0,longitude:0,accuracy_radius:50}}:{autonomous_system_number:64500,autonomous_system_organization:'Synthetic ASN'};}};
  }});
  const result=await provider.lookup('2001:4860:4860::8888');assert.equal(result.latitude,0);assert.equal(result.longitude,0);assert.equal(result.country,'Brasil');assert.equal(result.region,null);assert.equal(result.asn,64500);assert.equal(result.accuracyRadiusKm,50);assert.equal((await provider.status()).city.updatedAt,1000);assert.equal(queries.length,2);
  invalid=true;assert.equal((await provider.lookup('8.8.8.8')).longitude,null);
  fail=true;const failed=await provider.lookup('8.8.8.8');assert.equal(failed.state,'error');assert.equal(failed.country,null);assert.equal(failed.asn,64500);
});

test('deduplication canonicalizes IPv6, caches lookup failures, expires and bounds LRU memory',async()=>{
  let clock=1000,calls=0;
  const geo=createGeoConnections({now:()=>clock,config:{maxCacheEntries:2,cacheTtlSeconds:2},provider:fakeProvider(async ip=>{calls++;if(ip==='1.1.1.1')throw new Error('synthetic');return record;})});
  let result=await geo.observe(connection([row('2001:4860:4860::8888'),row('2001:4860:4860:0:0:0:0:8888'),row('1.1.1.1')]));
  assert.equal(calls,2);assert.equal(result.rows.length,2);assert.equal(result.rows[0].connections,2);assert.equal(result.rows[1].geo.state,'error');
  await geo.observe(connection([row('1.1.1.1')],1001));assert.equal(calls,2);
  clock=4000;await geo.observe(connection([row('1.1.1.1')],4000));assert.equal(calls,3);
  await geo.observe(connection([row('8.8.8.8'),row('9.9.9.9'),row('1.0.0.1')],4001));assert.ok(geo.diagnostics().cacheEntries<=2);
});

test('history has bounded cardinality, configurable expiry and explicit snapshot counts instead of invented unique sessions',async()=>{
  let clock=1000;const geo=createGeoConnections({now:()=>clock,provider:fakeProvider(),config:{maxHistoryEntries:2,retentionMinutes:1}});
  let result=await geo.observe(connection([row(),row(),row('1.1.1.1')],clock));assert.equal(result.history[0].connections,2);
  clock++;result=await geo.observe(connection([row()],clock));const repeated=result.history.find(r=>r.ip==='8.8.8.8');assert.equal(repeated.connections,1);assert.equal(repeated.peakConnections,2);assert.equal(repeated.samplesSeen,2);
  await geo.observe(connection([row()],clock));assert.equal(geo.snapshot().history.find(r=>r.ip==='8.8.8.8').samplesSeen,2);
  clock++;result=await geo.observe(connection([row('9.9.9.9')],clock));assert.equal(result.history.length,2);assert.equal(result.historyEvictions,1);
  clock+=60001;assert.equal(geo.snapshot().history.length,0);assert.equal(geo.diagnostics().cacheEntries,3);
  const disabled=createGeoConnections({now:()=>clock,config:{retentionMinutes:0},provider:fakeProvider()});await disabled.observe(connection([row()],clock));assert.equal(disabled.snapshot().history.length,0);
});

test('origin and WAN reuse observed NAT evidence and never map Huawei internal clients to aggregate flows',async()=>{
  const raw=[{'.id':'*1',protocol:'tcp','src-address':'10.231.2.45:12345','dst-address':'8.8.8.8:443','reply-dst-address':'11.1.1.1:12345',srcnat:'true'},
    {'.id':'*2',protocol:'udp','src-address':'192.168.88.20:4000','dst-address':'[2001:4860:4860::8888]:53','reply-dst-address':'[2001:4860::10]:4000',family:'IPv6'},
    {'.id':'*3',protocol:'tcp','src-address':'192.168.88.21','dst-address':'1.1.1.1','connection-mark':'WAN1_conn'}];
  const analyzed=analyzeConnections(raw,new Map(),1000,{'11.1.1.1':'WAN2','2001:4860::10':'WAN1'}).view;
  const geo=createGeoConnections({now:()=>1000,config:{huaweiNatAddress:"10.231.2.45"},provider:fakeProvider()});
  const result=await geo.observe({...analyzed,state:'live'},{leases:{state:'live',time:1000,rows:[{address:'192.168.88.20','host-name':'Workstation',status:'bound'},{address:'192.168.3.10','host-name':'Huawei client',status:'bound'}]},ipv6Connections:{state:'live'}});
  const aggregate=result.rows.find(r=>r.source.ip==='10.231.2.45');assert.equal(aggregate.source.label,'Huawei AX3 — dispositivos internos agregados');assert.equal(aggregate.source.aggregated,true);assert.equal(aggregate.wan,'WAN2');assert.equal(result.rows.find(r=>r.source.ip==='192.168.88.20').source.label,'Workstation');assert.equal(result.rows.find(r=>r.source.ip==='192.168.88.21').wan,null);assert.ok(!JSON.stringify(result).includes('192.168.3.10'));
});

test('Geo preserves the collector row limit and reports special destinations, missing IPv6 and partial coverage',async()=>{
  let calls=0;const geo=createGeoConnections({now:()=>1000,provider:fakeProvider(()=>{calls++;return record;})});
  const result=await geo.observe(connection([...Array.from({length:1000},()=>row()),row('1.1.1.1')],1000,{count:1200,displayLimited:true}));assert.equal(result.coverage.observedRows,1000);assert.equal(result.coverage.publicConnections,1000);assert.equal(result.coverage.partial,true);assert.equal(result.coverage.ipv6State,'pending');assert.equal(calls,1);
  const special=await geo.observe(connection([row('192.168.3.10'),row('::1')],1001));assert.equal(special.rows.length,0);assert.equal(special.coverage.excludedConnections,2);assert.equal(calls,1);
  const failed=await geo.observe({state:'error'});assert.equal(failed.state,'error');assert.equal(failed.time,1001);
});

test('dashboard country/ASN rankings, source/WAN/protocol filters and map use only known coordinates',async()=>{
  const geo=createGeoConnections({now:()=>1000,provider:fakeProvider(ip=>ip==='1.1.1.1'?{state:'unavailable'}:record)});
  const result=await geo.observe(connection([row(),row(),row('1.1.1.1',{protocol:'udp',wan:'WAN2',source:'192.168.88.20'})]));
  const all=summarizeGeo(result.rows);assert.equal(all.connections,3);assert.equal(all.located,2);assert.equal(all.countryCount,1);assert.equal(all.asnCount,1);assert.equal(all.countries[0].connections,2);assert.equal(all.asns[0].connections,2);
  const rows=filterGeoRows(result.rows,{source:'10.231.2.45',country:'BR',provider:'64500',protocol:'tcp',wan:'WAN1'});assert.equal(rows.length,1);assert.equal(rows[0].connections,2);assert.equal(filterGeoRows(result.rows,{country:'unknown'}).length,1);assert.equal(hasCoordinates({latitude:null,longitude:null}),false);assert.equal(hasCoordinates({latitude:0,longitude:0}),true);assert.deepEqual(project(0,0),[360,180]);
});
