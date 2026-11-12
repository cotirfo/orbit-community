import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createEnergyMetrics,decodeDps,dayKey} from '../energy-metrics.mjs';

const sample=(time,watts=100)=>({time,watts,volts:116.5,amps:.557,relay:true});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
async function fixture(t,options={}){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'orbit-energy-'));t.after(()=>fs.rm(directory,{recursive:true,force:true,maxRetries:3,retryDelay:25}));return {directory,metrics:await createEnergyMetrics({directory,...options})};}
test('DPS maps only relay, A, W, V; unknown registers are never interpreted',()=>{
  const result=decodeDps({'1':true,'18':557,'19':463,'20':1165,'22':15848,'25':5501},1000);
  assert.deepEqual(result,{time:1000,relay:true,amps:.557,watts:46.3,volts:116.5});assert.equal(decodeDps({'1':false,'18':0,'19':0,'20':0},1000).relay,false);
});
test('invalid, missing, negative, string and nonfinite DPS cannot become measurements',()=>{
  const base={'1':true,'18':1,'19':1,'20':1};
  for(const key of ['18','19','20'])for(const value of [null,undefined,'42',NaN,Infinity,-1,true])assert.throws(()=>decodeDps({...base,[key]:value},1000));
  for(const value of [0,1,'true',null])assert.throws(()=>decodeDps({...base,'1':value},1000));assert.throws(()=>decodeDps(base,0));
});
test('trapezoid uses actual irregular timestamps and W → Wh → kWh',async t=>{
  let now=Date.parse('2026-10-29T12:00:00Z');const {metrics}=await fixture(t,{now:()=>now,maxGapMs:120000});
  await metrics.accept(sample(now,100));now+=13000;await metrics.accept(sample(now,200));now+=47000;await metrics.accept(sample(now,300));
  const expected=(150*13+250*47)/3600,s=metrics.snapshot();near(s.totalWh,expected);near(s.totalKwh,expected/1000);near(s.todayWh,expected);near(s.observedSeconds,60);near(s.averages[60].watts,expected*60);
});
test('explicit failure and excessive interval do not invent energy or bridge gaps',async t=>{
  let now=Date.now();const {metrics}=await fixture(t,{now:()=>now});await metrics.accept(sample(now));now+=10000;await metrics.accept(sample(now));const wh=metrics.snapshot().totalWh;
  await metrics.gap();now+=10000;await metrics.accept(sample(now));near(metrics.snapshot().totalWh,wh);
  now+=31000;await metrics.accept(sample(now));near(metrics.snapshot().totalWh,wh);now+=10000;await metrics.accept(sample(now));near(metrics.snapshot().totalWh,wh*2);
});
test('atomic checkpoint survives restart without duplicating or counting downtime',async t=>{
  let now=Date.now();const {metrics,directory}=await fixture(t,{now:()=>now});await metrics.accept(sample(now));now+=10000;await metrics.accept(sample(now));const wh=metrics.snapshot().totalWh;
  const restored=await createEnergyMetrics({directory,now:()=>now});assert.equal(restored.snapshot().lastValid.time,now);near(restored.snapshot().totalWh,wh);
  now+=10000;await restored.accept(sample(now));near(restored.snapshot().totalWh,wh);now+=10000;await restored.accept(sample(now));near(restored.snapshot().totalWh,wh*2);
  await restored.accept(sample(now));await restored.accept(sample(now-5000));near(restored.snapshot().totalWh,wh*2);
});
test('midnight and month boundary use São Paulo and split a changing power exactly',async t=>{
  let now=Date.parse('2026-11-01T02:59:50Z');const {metrics}=await fixture(t,{now:()=>now});await metrics.accept(sample(now,100));now+=20000;await metrics.accept(sample(now,300));
  const s=metrics.snapshot();assert.equal(dayKey(now),'2026-11-01');near(s.daily.find(d=>d.date==='2026-10-31').wh,150*10/3600);near(s.todayWh,250*10/3600);near(s.monthWh,s.todayWh);near(s.totalWh,4000/3600);
  assert.equal(s.monthly.length,2);near(s.history.at(-1).dayWh,s.todayWh);
});
test('week starts Monday and average clips intervals at the selected boundary',async t=>{
  let now=Date.parse('2026-10-26T03:00:10Z');const {metrics}=await fixture(t,{now:()=>now,maxGapMs:120000});await metrics.accept(sample(now-20000,100));await metrics.accept(sample(now,100));near(metrics.snapshot().weekWh,100*10/3600);
  now+=3600000-5000;near(metrics.snapshot().averages[60].seconds,5);near(metrics.snapshot().averages[60].watts,100);now+=10000;assert.equal(metrics.snapshot().averages[60].watts,null);
});
test('unreadable/corrupt state fails closed and is preserved for recovery',async t=>{
  const {directory}=await fixture(t);await fs.writeFile(path.join(directory,'state.json'),'{corrupt');await assert.rejects(createEnergyMetrics({directory}),/energy-storage/);assert.equal(await fs.readFile(path.join(directory,'state.json'),'utf8'),'{corrupt');
});
test('failed durable append cannot advance totals; recovery drops the uncertain baseline',async t=>{
  let now=Date.now(),fail=false;const io={...fs,open:async(...args)=>{if(fail&&args[1]==='a+')throw new Error('synthetic disk failure');return fs.open(...args);}};
  const {metrics,directory}=await fixture(t,{now:()=>now,io});await metrics.accept(sample(now));fail=true;now+=10000;await assert.rejects(metrics.accept(sample(now)),/energy-storage/);near(metrics.snapshot().totalWh,0);
  const restored=await createEnergyMetrics({directory,now:()=>now});near(restored.snapshot().totalWh,0);fail=false;now+=10000;await metrics.accept(sample(now));near(metrics.snapshot().totalWh,0);
  const recovered=await createEnergyMetrics({directory,now:()=>now});near(recovered.snapshot().totalWh,0);
});
test('checkpoint failure retains journal; replay is idempotent after checkpoint succeeds but truncation fails',async t=>{
  let now=Date.now(),failRename=true,failTruncate=false;const io={...fs,rename:async(...args)=>{if(failRename)throw new Error('fixture');return fs.rename(...args);},truncate:async(...args)=>{if(failTruncate)throw new Error('fixture');return fs.truncate(...args);}};
  const {directory,metrics}=await fixture(t,{now:()=>now,io});await metrics.accept(sample(now));now+=10000;await metrics.accept(sample(now));const wh=metrics.snapshot().totalWh;await metrics.close();
  let restored=await createEnergyMetrics({directory,now:()=>now});near(restored.snapshot().totalWh,wh);failRename=false;failTruncate=true;await metrics.close();
  restored=await createEnergyMetrics({directory,now:()=>now});near(restored.snapshot().totalWh,wh);assert.ok((await fs.readFile(path.join(directory,'journal.jsonl'),'utf8')).length>0);
});
test('a partial journal tail is discarded, while malformed committed records fail closed',async t=>{
  let now=Date.now();const {directory,metrics}=await fixture(t,{now:()=>now});await metrics.accept(sample(now));await fs.appendFile(path.join(directory,'journal.jsonl'),'{partial');
  const restored=await createEnergyMetrics({directory,now:()=>now});assert.equal(restored.snapshot().lastValid.time,now);assert.ok(restored.snapshot().storageWarning);await fs.appendFile(path.join(directory,'journal.jsonl'),'{corrupt}\n');await assert.rejects(createEnergyMetrics({directory}),/energy-storage/);
});
test('raw retention is bounded without losing cumulative energy',async t=>{
  let now=Date.now();const {metrics}=await fixture(t,{now:()=>now,retentionDays:1});await metrics.accept(sample(now));now+=10000;await metrics.accept(sample(now));const total=metrics.snapshot().totalWh;
  now+=2*86400000;await metrics.accept(sample(now));assert.equal(metrics.snapshot().history.length,1);near(metrics.snapshot().totalWh,total);assert.equal(metrics.snapshot().todayWh,0);
});
