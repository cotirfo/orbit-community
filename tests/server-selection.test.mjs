import test from 'node:test';
import os from 'node:os';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {publicIPv4,validateCatalog,resolveServer,rankCandidates} from '../server-selection.mjs';
import {createSpeedTestService} from '../speedtest.mjs';
const catalog=JSON.parse(fs.readFileSync(new URL('../speed-servers.json',import.meta.url)));
test('Catalog and DNS require HTTPS endpoints and exclusively public IPv4 addresses',async()=>{
 assert.equal(validateCatalog(catalog).length,3);assert.equal(publicIPv4('172.233.0.26'),true);
 for(const ip of ['127.0.0.1','192.0.2.48','100.64.0.1','169.254.1.2','::1','203.0.113.1'])assert.equal(publicIPv4(ip),false);
 const unsafe=structuredClone(catalog);unsafe[0].downloadPath='//internal.example/';assert.throws(()=>validateCatalog(unsafe),/Endpoint/);
 await assert.rejects(resolveServer(catalog[0],async()=>[{address:'127.0.0.1'}]),/públicos/);
 await assert.rejects(resolveServer(catalog[0],async()=>[{address:'172.233.0.26'},{address:'192.0.2.48'}]),/públicos/);
 const resolved=await resolveServer(catalog[0],async()=>[{address:'172.233.0.26'}]);assert.equal(resolved.hostname,'medicao-1.example');
});
test('Ranking excludes unavailable and incomplete measurements; jitter breaks a latency tie',()=>{
 const ranked=rankCandidates([{id:'failed',eligible:false,latencyMs:0,jitterMs:0},{id:'missing',eligible:true,latencyMs:null,jitterMs:0},{id:'cloud',eligible:true,latencyMs:60,jitterMs:5},{id:'regional',eligible:true,latencyMs:5,jitterMs:1},{id:'unstable',eligible:true,latencyMs:5,jitterMs:3}]);
 assert.deepEqual(ranked.map(r=>r.id),['regional','unstable','cloud']);
});
test('Per-WAN manual server preferences persist and reach manual/automatic measurement',async()=>{
 const base=os.tmpdir(),root=fs.mkdtempSync(path.join(base,'servers-fixture-'));const profiles=[{name:'WAN1'},{name:'WAN2'}],calls=[];
 const options={root,profiles,catalog,profileStatus:()=>({configured:true,ready:true}),runMeasurement:async options=>{calls.push({link:options.link,serverSelection:options.serverSelection});return {link:options.link,pathVerified:true,downloadMbps:100,uploadMbps:50,latencyMs:5,jitterMs:1};}};
 const service=createSpeedTestService(options);
 try{
  assert.equal(service.setServer('WAN1','medicao-1').accepted,true);assert.equal(service.setServer('WAN2','https://internal').accepted,false);
  const restored=createSpeedTestService(options);assert.equal(restored.snapshot().serverSelections.WAN1,'medicao-1');await restored.close();
  service.start('automatic');assert.equal(service.setServer('WAN1','cloudflare').accepted,false);await service.wait();assert.deepEqual(calls,[{link:'WAN1',serverSelection:'medicao-1'},{link:'WAN2',serverSelection:'auto'}]);
 }finally{await service.close();const target=fs.realpathSync(root);if(!target.startsWith(base+path.sep)||!path.basename(target).startsWith('servers-fixture-'))throw new Error('Unsafe cleanup');fs.rmSync(target,{recursive:true,force:true});}
});
