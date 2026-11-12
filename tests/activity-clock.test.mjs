import test from 'node:test';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createActivityClock,freshActivity,trafficActivity,wanActivity} from '../public/activity-model.mjs';

const now=1000000;
function sample(time=now){return {status:'live',cadence:{interfaces:2},wan:{WAN1:'ether1'},latest:{time,interfaces:[{name:'ether1',running:true,rxMbps:50,txMbps:10}]},wanHealth:[{link:'WAN1',state:'up',label:'SONDA OK',routeTime:time,routeVerified:true,ownRouteActive:true,probe:{time,fresh:true,pathVerified:true}}]};}

test('Small viewer/collector clock offsets do not hide a new sample',()=>{
 for(const offset of [0,79,733,1300,2000]){
  assert.equal(freshActivity('live',now+offset,15000,now),true);
  assert.equal(trafficActivity({status:'live',time:now+offset,rate:10,now}).moving,true);
  assert.equal(wanActivity(sample(now+offset),'WAN1',{now}).state,'up');
 }
});
test('A 1.3-second clock offset stays stable between two-second sample arrivals',()=>{
 for(let tick=0;tick<30;tick++){
  const viewerTime=now+tick*1000,collectorTime=now+Math.floor(tick/2)*2000+1300;
  const model=wanActivity(sample(collectorTime),'WAN1',{now:viewerTime});
  assert.equal(model.state,'up');assert.equal(model.rxMbps,50);assert.equal(model.download.moving,true);
 }
});
test('Large future offsets, expired timestamps and missing timestamps remain invalid',()=>{
 for(const time of [now+2001,now+60000,now-15001,null,undefined,NaN])assert.equal(freshActivity('live',time,15000,now),false);
 assert.equal(freshActivity('error',now+1000,15000,now),false);
});
test('Clock tolerance cannot hide a WAN failure, failover or missing path proof',()=>{
 for(const modify of [s=>s.status='error',s=>s.latest.interfaces[0].running=false,s=>s.wanHealth[0].failoverTo='WAN2',s=>s.wanHealth[0].state='down',s=>s.wanHealth[0].routeVerified=false,s=>s.wanHealth[0].probe.pathVerified=false]){
  const state=sample(now+1300);modify(state);assert.equal(wanActivity(state,'WAN1',{now}).download.moving,false);
 }
});
test('Expired core, route and probe observations still stop motion',()=>{
 for(const modify of [s=>s.latest.time=now-15001,s=>s.wanHealth[0].routeTime=now-45001,s=>s.wanHealth[0].probe.time=now-35001,s=>s.wanHealth[0].probe.fresh=false]){
  const state=sample(now+1300);modify(state);assert.equal(wanActivity(state,'WAN1',{now}).download.moving,false);
 }
});
test('Huawei keeps its separate age limit, and zero traffic and pause stop motion',()=>{
 assert.equal(freshActivity('live',now-30000,30000,now),true);
 assert.equal(freshActivity('live',now-30001,30000,now),false);
 assert.equal(trafficActivity({status:'live',time:now+1300,rate:0,now}).moving,false);
 assert.equal(wanActivity(sample(now+1300),'WAN1',{now,paused:true}).download.moving,false);
});

test('HTTP collector time fixes recurring flow loss with the observed 2.885-second viewer skew',()=>{
 let elapsed=0;const clock=createActivityClock({wallNow:()=>now+elapsed-2885,monotonicNow:()=>elapsed});
 assert.equal(wanActivity(sample(now),'WAN1',{now:clock.now()}).state,'unknown');
 assert.equal(clock.synchronize(new Date(now).toUTCString()),true);
 for(elapsed=0;elapsed<60000;elapsed+=250){
  const source=sample(now+Math.floor(elapsed/2000)*2000),qualityTime=now+Math.floor(elapsed/10000)*10000;
  source.wanHealth[0].routeTime=qualityTime;source.wanHealth[0].probe.time=qualityTime;
  const model=wanActivity(source,'WAN1',{now:clock.now()});assert.equal(model.state,'up');assert.equal(model.download.moving,true);
 }
});

test('Collector-aligned clock handles viewers minutes ahead or behind without changing freshness budgets',()=>{
 for(const skew of [-300000,300000]){
  let elapsed=0;const clock=createActivityClock({wallNow:()=>now+skew+elapsed,monotonicNow:()=>elapsed});
  clock.synchronize(new Date(now).toUTCString());
  assert.equal(wanActivity(sample(now),'WAN1',{now:clock.now()}).download.moving,true);
  elapsed=15001;assert.equal(wanActivity(sample(now),'WAN1',{now:clock.now()}).download.moving,false);
 }
});

test('Viewer wall-clock corrections cannot revive expired telemetry after synchronization',()=>{
 let elapsed=0,wall=now;const clock=createActivityClock({wallNow:()=>wall,monotonicNow:()=>elapsed});clock.synchronize(new Date(now).toUTCString());
 const anchor=clock.now();elapsed=5000;wall-=3600000;assert.equal(clock.now(),anchor+5000);
 wall+=7200000;assert.equal(clock.now(),anchor+5000);
 elapsed=31001;assert.equal(freshActivity('live',now,30000,clock.now()),false);
 clock.synchronize(new Date(now+31000).toUTCString());assert.equal(freshActivity('live',now,30000,clock.now()),false);
});

test('Fresh HTTP responses do not make old observations or failed WANs look live',()=>{
 const clock=createActivityClock({wallNow:()=>now-300000,monotonicNow:()=>0});clock.synchronize(new Date(now).toUTCString());
 assert.equal(wanActivity(sample(now-15001),'WAN1',{now:clock.now()}).download.moving,false);
 for(const modify of [s=>s.status='error',s=>s.latest.interfaces[0].running=false,s=>s.wanHealth[0].state='down',s=>s.wanHealth[0].failoverTo='WAN2',s=>s.wanHealth[0].probe.pathVerified=false]){
  const source=sample(now);modify(source);assert.equal(wanActivity(source,'WAN1',{now:clock.now()}).download.moving,false);
 }
 assert.equal(wanActivity(sample(now),'WAN1',{now:clock.now(),paused:true}).download.moving,false);
});

test('Missing or invalid Date headers preserve the current clock instead of refreshing sample age',()=>{
 let elapsed=0;const clock=createActivityClock({wallNow:()=>now-300000,monotonicNow:()=>elapsed});
 assert.equal(clock.now(),now-300000);assert.equal(clock.synchronize(null),false);
 clock.synchronize(new Date(now).toUTCString());const anchor=clock.now();elapsed=20000;
 for(const invalid of [null,undefined,'invalid date',0])assert.equal(clock.synchronize(invalid),false);
 assert.equal(clock.now(),anchor+20000);assert.equal(wanActivity(sample(now),'WAN1',{now:clock.now()}).download.moving,false);
});
