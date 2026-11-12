import test from 'node:test';
import os from 'node:os';
import assert from 'node:assert/strict';
import { endpoint,durationMs,analyzeConnections,quality } from '../analysis.mjs';
test('endpoints IPv4, IPv6 e portas não confundem endereço com porta',()=>{
  assert.deepEqual(endpoint('10.231.2.45:5000'),{ip:'10.231.2.45',port:5000});
  assert.deepEqual(endpoint('[2001:db8::1]:443'),{ip:'2001:db8::1',port:443});
  assert.deepEqual(endpoint('2001:db8::1234'),{ip:'2001:db8::1234',port:null});
  assert.deepEqual(endpoint('2001:db8::1234','53'),{ip:'2001:db8::1234',port:53});
});
test('taxa só usa conexões comparáveis, sem transformar primeiro snapshot em zero',()=>{
  const row={'.id':'*1',protocol:'tcp','src-address':'10.231.2.45:1200','dst-address':'1.1.1.1:443','reply-dst-address':'192.168.15.7:5000','orig-bytes':'100','repl-bytes':'1000'};
  const first=analyzeConnections([row],new Map(),10000,{'192.168.15.7':'WAN1'});
  assert.equal(first.view.observedBps,null);assert.equal(first.view.rows[0].wan,'WAN1');
  const second=analyzeConnections([{...row,'orig-bytes':'300','repl-bytes':'1400'}],first.next,15000,{});
  assert.equal(second.view.observedBps,120);assert.equal(second.view.sources[0].rateBps,120);
  const reset=analyzeConnections([{...row,'orig-bytes':'1','repl-bytes':'1'}],second.next,20000,{});
  assert.equal(reset.view.observedBps,null);
  const reused=analyzeConnections([{...row,'dst-address':'8.8.8.8:443'}],second.next,20000,{});
  assert.equal(reused.view.observedBps,null);
});
test('unidades Netwatch e atribuição à WAN exigem a rota correta',()=>{
  assert.equal(durationMs('9ms739us'),9.739);assert.equal(durationMs('249us'),.249);assert.equal(durationMs('00:00:00.012'),12);assert.equal(durationMs('9739'),9.739);
  const inventory={links:[{name:'WAN1',probe:'1.1.1.1',interface:'ether1'}]},probes=[{comment:'ORBIT qualidade WAN1',host:'1.1.1.1','rtt-avg':'9ms739us','loss-percent':'0%'}];
  assert.equal(quality(probes,inventory,[])[0].pathVerified,false);
  const routes=[{'dst-address':'1.1.1.1/32','routing-table':'main',active:'true','immediate-gw':'198.51.100.11%ether1'}];
  assert.equal(quality(probes,inventory,routes)[0].pathVerified,true);
  const lost=quality([{...probes[0],'response-count':'0','rtt-avg':'0us','rtt-jitter':'0us','loss-percent':'100%'}],inventory,routes)[0];
  assert.equal(lost.rttMs,null);assert.equal(lost.jitterMs,null);assert.equal(lost.lossPercent,100);
});
test('failover não atribui à WAN1 resultados obtidos sem sua rota ativa',()=>{
  const inventory={links:[{name:'WAN1',probe:'1.1.1.1',interface:'ether1'}]};
  const probe={comment:'ORBIT qualidade WAN1',host:'1.1.1.1',status:'up','response-count':'5','rtt-avg':'12ms','rtt-jitter':'1ms','loss-percent':'0%'};
  const route={'dst-address':'1.1.1.1/32','routing-table':'main',active:'true','immediate-gw':'198.51.100.11%ether1'};
  for(const routes of [[],[{...route,active:'false'}],[{...route,'immediate-gw':'203.0.113.11%ether5'}],[{...route,'immediate-gw':'198.51.100.11%ether10'}]]){
    const q=quality([probe],inventory,routes)[0];
    assert.equal(q.status,'unverified');assert.equal(q.probeStatus,'up');assert.equal(q.rttMs,null);assert.equal(q.lossPercent,null);
  }
  assert.equal(quality([probe],inventory,[route])[0].rttMs,12);
  assert.equal(quality([{...probe,disabled:'true'}],inventory,[route])[0].status,'disabled');
});
