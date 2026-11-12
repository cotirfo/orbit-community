import test from 'node:test';
import assert from 'node:assert/strict';
import {UPS,emptyScenario,simulateRuntime,outputLoad,runtimeScenarios,simplifiedRuntime,simplifiedScenarios,estimateAutonomy} from '../public/energy-model.mjs';
// Synthetic parameters for arithmetic tests only. These are not manufacturer curves.
const configured=()=>({...emptyScenario(),basis:'SYNTHETIC TEST ONLY',batteries:[10,30].map(ah=>({ah,health:1,usableDischarge:1,stateOfCharge:1,temperatureFactor:1,peukertExponent:1,referenceHours:20})),efficiencyCurve:[{watts:0,efficiency:.8},{watts:500,efficiency:.8}]});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
test('hardware capacities are 120 + 360 = 480 Wh, with 500 W active rating',()=>{assert.equal(UPS.nominalWh,480);assert.equal(UPS.watts,500);const r=simulateRuntime(100,configured());near(r.availableDcWh,480);near(r.hours,480*.8/100);assert.deepEqual(r.batteries.map(b=>b.nominalWh),[120,360]);});
test('individual battery health, discharge, SOC and temperature are applied once',()=>{
  const s=configured();s.batteries[0].health=.5;s.batteries[1].health=.8;s.batteries[1].usableDischarge=.7;s.batteries[1].stateOfCharge=.6;s.batteries[1].temperatureFactor=.9;
  const r=simulateRuntime(100,s);near(r.batteries[0].usableWh,60);near(r.batteries[1].usableWh,360*.8*.7*.6*.9);near(r.hours,r.availableDcWh/125);
});
test('efficiency interpolates by load and never extrapolates or doubles idle loss',()=>{
  const s=configured();s.efficiencyCurve=[{watts:50,efficiency:.7},{watts:250,efficiency:.9}];near(simulateRuntime(150,s).efficiency,.8);assert.equal(simulateRuntime(10,s).state,'incomplete');
  s.idleWatts=10;assert.equal(simulateRuntime(150,s).state,'incomplete');s.lossAccounting='separateIdle';near(simulateRuntime(150,s).dcWatts,150/.8+10);
});
test('Peukert reduction is individual, bounded, and disappears at exponent 1',()=>{
  const s=configured();s.batteries[0].peukertExponent=1.2;s.batteries[1].peukertExponent=1.1;const r=simulateRuntime(400,s);assert.ok(r.batteries.every(b=>b.dischargeFactor<1));assert.ok(r.availableDcWh<480);const low=simulateRuntime(1,s);near(low.availableDcWh,480);
});
test('missing factors, zero load, overload and fully degraded bank are explicit',()=>{
  assert.equal(simulateRuntime(100,emptyScenario()).state,'incomplete');assert.equal(simulateRuntime(0,configured()).state,'zero-load');assert.equal(simulateRuntime(501,configured()).state,'overload');
  const s=configured();for(const b of s.batteries)b.health=0;const r=simulateRuntime(100,s);assert.equal(r.hours,0);assert.equal(Number.isFinite(r.hours),true);
  s.batteries[0].health=2;assert.equal(simulateRuntime(100,s).state,'incomplete');assert.equal(simulateRuntime(NaN,s).state,'incomplete');
  assert.equal(simulateRuntime(100,{...configured(),basis:42}).state,'incomplete');assert.equal(simulateRuntime(100,{...configured(),batteries:[null,null]}).state,'incomplete');assert.equal(simulateRuntime(100,{...configured(),efficiencyCurve:[null,null]}).state,'incomplete');
});
test('input watts require known charging and AC calibration; manual output is independent',()=>{
  assert.equal(outputLoad(100,{}).state,'incomplete');const c={inputToOutputEfficiency:.9,chargingWatts:20,idleInputWatts:10,basis:'Independent measurement'};
  near(outputLoad(100,c).watts,63);assert.equal(outputLoad(100,{...c,chargingWatts:null}).state,'incomplete');assert.equal(outputLoad(10,c).state,'incomplete');assert.notEqual(simulateRuntime(100,configured()).hours,simulateRuntime(outputLoad(100,c).watts,configured()).hours);
});
test('scenarios require their own documented parameters and consistent ordering',()=>{
  const nominal=configured(),conservative=configured(),optimistic=configured();conservative.batteries[0].health=.5;optimistic.efficiencyCurve.forEach(p=>p.efficiency=.9);
  const r=runtimeScenarios(100,{nominal,conservative,optimistic});assert.ok(r.conservative.hours<r.nominal.hours&&r.nominal.hours<r.optimistic.hours);
  assert.equal(runtimeScenarios(100,{nominal}).optimistic.state,'incomplete');assert.equal(runtimeScenarios(100,{nominal,optimistic:conservative}).optimistic.state,'incomplete');
});
test('simplified autonomy uses 12 V × (10 + 30 Ah), with one explicit aggregate assumption',()=>{
  const r=simplifiedRuntime(60);near(r.nominalWh,480);near(r.availableWh,336);near(r.hours,336/60);assert.equal(r.minutes,336);assert.deepEqual(r.batteries.map(b=>b.ah),[10,30]);near(r.batteries.reduce((s,b)=>s+b.availableWh,0),336);assert.equal(r.assumptions.lossAccounting,'single-global-factor');assert.equal(r.assumptions.manufacturerCurve,false);
});
test('simplified estimate needs no calibration or individual battery factors and never claims input is measured output',()=>{
  const r=estimateAutonomy(60);assert.equal(r.mode,'simplified');assert.equal(r.load.source,'input-proxy');assert.equal(r.scenarios.nominal.state,'ready');assert.equal(r.scenarios.nominal.outputWatts,undefined);
  const advanced=estimateAutonomy(60,{estimateMode:'advanced'});assert.equal(advanced.load.state,'incomplete');const manual=estimateAutonomy(60,{}, {powerSource:'manual-output'});assert.equal(manual.load.source,'manual-output');
});
test('simplified scenarios show assumptions, decrease with load and handle invalid, zero and overload',()=>{
  const r=simplifiedScenarios(60);assert.ok(r.conservative.hours<r.nominal.hours&&r.nominal.hours<r.optimistic.hours);assert.ok(r.nominal.basis.includes('70%'));near(simplifiedRuntime(120).hours,r.nominal.hours/2);
  for(const invalid of [undefined,null,NaN,Infinity,-1])assert.equal(simplifiedRuntime(invalid).state,'incomplete');assert.equal(simplifiedRuntime(0).state,'zero-load');assert.equal(simplifiedRuntime(501).state,'overload');assert.equal(simplifiedRuntime(100,2).state,'incomplete');assert.equal(simplifiedRuntime(100,0).hours,0);
  assert.equal(simplifiedScenarios(100,{conservativeFraction:.8,nominalFraction:.7}).conservative.state,'incomplete');
});
