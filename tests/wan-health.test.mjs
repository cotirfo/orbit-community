import test from 'node:test';
import os from 'node:os';
import assert from 'node:assert/strict';
import { wanHealth } from '../analysis.mjs';
const now=100000;
function fixture(){
 return {now,status:'live',latest:{time:now,interfaces:[{name:'ether1',running:true},{name:'ether5',running:true}]},
 inventory:{links:[{name:'WAN1',interface:'ether1',table:'via-wan1',probe:'1.1.1.1'},{name:'WAN2',interface:'ether5',table:'via-wan2',probe:'8.8.4.4'}]},
 details:{allRoutes:{state:'live',time:now,rows:[
 {'dst-address':'1.1.1.1/32','routing-table':'main',active:'true','immediate-gw':'198.51.100.11%ether1'},
 {'dst-address':'8.8.4.4/32','routing-table':'main',active:'true','immediate-gw':'203.0.113.11%ether5'},
 {'dst-address':'0.0.0.0/0','routing-table':'via-wan1',active:'true','immediate-gw':'198.51.100.11%ether1'},
 {'dst-address':'0.0.0.0/0','routing-table':'via-wan2',active:'true','immediate-gw':'203.0.113.11%ether5'}]},
 netwatch:{state:'live',time:now,rows:[
 {comment:'ORBIT qualidade WAN1',host:'1.1.1.1',status:'up','done-tests':'1','sent-count':'5','response-count':'5','loss-percent':'0','rtt-avg':'5ms','rtt-jitter':'1ms'},
 {comment:'ORBIT qualidade WAN2',host:'8.8.4.4',status:'up','done-tests':'1','sent-count':'5','response-count':'5','loss-percent':'0','rtt-avg':'2ms','rtt-jitter':'200us'}]}}};
}
const first=f=>wanHealth(f)[0];
test('WAN saudável exige link, sonda recente e rota pela própria operadora',()=>{const h=first(fixture());assert.equal(h.state,'up');assert.equal(h.label,'SONDA OK');assert.equal(h.failoverTo,null);});
test('link físico UP com sonda DOWN e perda total não aparece saudável',()=>{
 const f=fixture();Object.assign(f.details.netwatch.rows[0],{status:'down','response-count':'0','loss-percent':'100'});
 const h=first(f);assert.equal(h.state,'down');assert.equal(h.physicalUp,true);assert.equal(h.label,'SONDA SEM RESPOSTA');assert.equal(h.probe.rttMs,null);
});
test('failover para WAN2 não valida a WAN1 com resposta pela reserva',()=>{
 const f=fixture();f.details.allRoutes.rows[2]['immediate-gw']='203.0.113.11%ether5';f.details.allRoutes.rows[0]['immediate-gw']='203.0.113.11%ether5';
 const h=first(f);assert.equal(h.state,'down');assert.equal(h.failoverTo,'WAN2');assert.equal(h.probe.pathVerified,false);assert.equal(h.probe.rttMs,null);
});
test('cabo desconectado prevalece sobre a última sonda bem-sucedida',()=>{const f=fixture();f.latest.interfaces[0].running=false;assert.equal(first(f).label,'LINK FÍSICO DOWN');});
test('sonda antiga ou consulta com falha nunca produz estado saudável',()=>{
 for(const mutate of [f=>f.details.netwatch.time=now-35001,f=>f.details.netwatch.state='error',f=>f.details.allRoutes.time=now-45001,f=>f.details.allRoutes.state='error',f=>f.latest.time=now-20001,f=>f.status='error']){
 const f=fixture();mutate(f);assert.equal(first(f).state,'unknown');}
});
test('sem sonda, desativada, desconhecida ou sem teste completo não há confirmação',()=>{
 for(const mutate of [f=>f.details.netwatch.rows=[],f=>f.details.netwatch.rows[0].disabled='true',f=>f.details.netwatch.rows[0].status='unknown',f=>f.details.netwatch.rows[0]['done-tests']='0',f=>delete f.details.netwatch.rows[0]['loss-percent']]){const f=fixture();mutate(f);assert.equal(first(f).state,'unknown');}
});
test('perda parcial e latência elevada são degradação, não UP pleno',()=>{
 for(const [key,value] of [['loss-percent','20'],['rtt-avg','150ms'],['rtt-jitter','30ms']]){const f=fixture();f.details.netwatch.rows[0][key]=value;assert.equal(first(f).state,'degraded');}
});
test('rota ausente, desativada ou somente blackhole impede estado saudável',()=>{
 for(const mutate of [r=>r.active='false',r=>r.disabled='true',r=>{r.blackhole='';r['immediate-gw']='';}]){const f=fixture();mutate(f.details.allRoutes.rows[2]);assert.equal(first(f).state,'down');}
});
test('sonda por caminho ambíguo ou outra interface não confirma saúde',()=>{
 for(const mutate of [f=>f.details.allRoutes.rows.push({...f.details.allRoutes.rows[0]}),f=>f.details.allRoutes.rows[0]['immediate-gw']='198.51.100.11%ether10']){const f=fixture();mutate(f);assert.equal(first(f).state,'unknown');}
});
test('sonda em falha com resposta parcial usa falhou, não sem resposta',()=>{const f=fixture();Object.assign(f.details.netwatch.rows[0],{status:'down','response-count':'1','loss-percent':'80'});assert.equal(first(f).label,'SONDA FALHOU');});
test('restabelecimento volta a confirmar saúde, sem failover',()=>{const f=fixture();f.details.allRoutes.rows[2]['immediate-gw']='203.0.113.11%ether5';assert.equal(first(f).failoverTo,'WAN2');f.details.allRoutes.rows[2]['immediate-gw']='198.51.100.11%ether1';assert.equal(first(f).state,'up');assert.equal(first(f).failoverTo,null);});
