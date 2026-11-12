import test from 'node:test';
import os from 'node:os';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createCollector } from '../collector.mjs';
test('collector produces comparable rates and stops polling after authentication loss',async()=>{
  const fixtureRoot=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-collector-fixture-'));
  const previousUser=process.env.MIKROTIK_USER,previousPassword=process.env.MIKROTIK_PASSWORD;
  process.env.MIKROTIK_USER='fixture';process.env.MIKROTIK_PASSWORD='fixture-only';
  let calls=0,counters=0;const emitted=[];
  const request=async route=>{
    calls++;
    if(route==='system/resource')return {'cpu-load':'3','free-memory':'80','total-memory':'100','free-hdd-space':'90','total-hdd-space':'100',uptime:'1h','board-name':'TEST FIXTURE',version:'TEST'};
    if(route==='interface/print'){counters++;return [{name:'ether1',type:'ether',running:'true','rx-byte':String(counters*200),'tx-byte':String(counters*100),'rx-packet':String(counters*2),'tx-packet':String(counters*1),'tx-queue-drop':'0'}];}
    if(route.includes('connection/tracking'))return {'total-entries':'0'};
    return [];
  };
  const collector=createCollector({root:fixtureRoot,config:{intervalSeconds:2,connectionSeconds:5,detailsSeconds:20,retentionDays:1,wan:{WAN1:'ether1',WAN2:'ether5'}},inventory:{links:[]},request,performance:()=>({endpoints:[]}),emit:(event,value)=>emitted.push({event,value})});
  try{
    collector.start();await new Promise(resolve=>setTimeout(resolve,2250));
    const samples=emitted.filter(e=>e.event==='sample'&&e.value.status==='live');assert.ok(samples.length>=2);
    assert.equal(samples[0].value.latest.interfaces[0].rxMbps,null);
    assert.ok(samples[1].value.latest.interfaces[0].rxMbps>0);assert.ok(samples[1].value.latest.interfaces[0].rxPps>0);
    const geoEvent=emitted.find(e=>e.event==='geo');assert.ok(geoEvent);assert.equal(geoEvent.value.geoConnections.state,'live');assert.deepEqual(geoEvent.value.geoConnections.rows,[]);
    assert.equal(collector.snapshot().geoConnections.state,'live');
    delete process.env.MIKROTIK_USER;delete process.env.MIKROTIK_PASSWORD;
    collector.authenticationFailed('TEST AUTH LOSS');const stoppedCalls=calls;await new Promise(resolve=>setTimeout(resolve,2200));
    assert.equal(calls,stoppedCalls);assert.equal(collector.snapshot().status,'auth-error');assert.equal(collector.snapshot().credentialsReady,false);
  }finally{
    collector.stop();if(previousUser===undefined)delete process.env.MIKROTIK_USER;else process.env.MIKROTIK_USER=previousUser;
    if(previousPassword===undefined)delete process.env.MIKROTIK_PASSWORD;else process.env.MIKROTIK_PASSWORD=previousPassword;
  }
});
