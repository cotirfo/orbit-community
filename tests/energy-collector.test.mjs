import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createEnergyCollector,publicEnergyModel} from '../energy-collector.mjs';
const dps={dps:{'1':true,'18':557,'19':463,'20':1165}};
async function fixture(t,{read=async()=>dps,...config}={}){let now=Date.now();const root=await fs.mkdtemp(path.join(os.tmpdir(),'orbit-energy-collector-')),events=[];const collector=await createEnergyCollector({root,config:{enabled:true,retries:0,...config},now:()=>now,emit:(kind,data)=>events.push({kind,data}),readerFactory:()=>({read,close:async()=>{}})});t.after(async()=>{await collector.stop();await fs.rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:25});});return {collector,events,advance:ms=>now+=ms};}
test('disabled energy touches neither persistence nor workers and exposes no config',async()=>{const collector=await createEnergyCollector({config:{enabled:false,localKey:'synthetic-private'},readerFactory:()=>{throw 0;},metricsFactory:()=>{throw 0;}});collector.start();await collector.poll();await collector.stop();assert.deepEqual(collector.snapshot(),{enabled:false,state:'disabled'});});
test('collector runs independently of MikroTik auth and emits sanitized energy SSE',async t=>{const {collector,events,advance}=await fixture(t);await collector.poll();let s=collector.snapshot();assert.equal(s.state,'online');assert.equal(s.lastValid.watts,46.3);assert.equal(s.estimate.mode,'simplified');assert.equal(s.estimate.scenarios.nominal.state,'ready');assert.equal(s.estimate.load.source,'input-proxy');assert.deepEqual(s.model.protectedEquipment,['Roteador','Equipamento de rede']);assert.equal(events[0].kind,'energy');advance(10000);await collector.poll();assert.ok(collector.snapshot().consumption.totalWh>0);});
test('expired telemetry remains historical and cannot claim a new current prediction',async t=>{const {collector,advance}=await fixture(t);await collector.poll();advance(31000);const s=collector.snapshot();assert.equal(s.state,'stale');assert.equal(s.fresh,false);assert.equal(s.estimate.historical,true);assert.equal(s.estimate.basedAt,s.lastValid.time);});
test('offline, authentication and worker errors are redacted; recovery resets integration',async t=>{
  let failure;const {collector,advance,events}=await fixture(t,{read:async()=>{if(failure)throw Object.assign(new Error('synthetic-secret-never-log'),{code:failure});return dps;}});
  await collector.poll();advance(10000);await collector.poll();const wh=collector.snapshot().consumption.totalWh;
  for(const code of ['offline','authentication','worker','timeout']){failure=code;advance(10000);await collector.poll();const s=collector.snapshot();assert.equal(s.state,'unavailable');assert.equal(s.lastValid.watts,46.3);assert.equal(s.estimate.historical,true);assert.ok(!JSON.stringify(s).includes('synthetic-secret'));}
  failure=null;advance(10000);await collector.poll();assert.equal(collector.snapshot().state,'online');assert.equal(collector.snapshot().consumption.totalWh,wh);assert.ok(events.at(-1).data.energy.events.some(e=>e.state==='online'));
});
test('retry count is bounded and auth errors are not retried',async t=>{let calls=0,code='timeout';const {collector}=await fixture(t,{retries:1,read:async()=>{calls++;throw Object.assign(new Error('private'),{code});}});await collector.poll();assert.equal(calls,2);code='authentication';await collector.poll();assert.equal(calls,3);});
test('concurrent polls share one read and stop discards in-flight data',async t=>{
  let release,calls=0;const {collector}=await fixture(t,{read:()=>{calls++;return new Promise(resolve=>release=resolve);}});const a=collector.poll(),b=collector.poll();assert.equal(calls,1);assert.equal(a,b);const stop=collector.stop();release(dps);await stop;assert.equal(collector.snapshot().lastSuccess,null);
});
test('invalid telemetry is a gap; confidential integration fields are absent from public model',async t=>{
  const {collector}=await fixture(t,{read:async()=>({dps:{...dps.dps,'19':-1}})});await collector.poll();assert.equal(collector.snapshot().state,'unavailable');assert.equal(collector.snapshot().lastValid,null);
  const model=publicEnergyModel({deviceId:'SYNTHETIC_ID',localKey:'SYNTHETIC_KEY',pythonPath:'private-path',scenarios:{nominal:{basis:'fixture',localKey:'SYNTHETIC_KEY'}}});const text=JSON.stringify(model);for(const secret of ['SYNTHETIC_KEY','SYNTHETIC_ID','private-path','localKey','deviceId'])assert.ok(!text.includes(secret));
});
