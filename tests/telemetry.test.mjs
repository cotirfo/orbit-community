import test from 'node:test';
import os from 'node:os';
import assert from 'node:assert/strict';
import { finite,counterRate,percentUsed,uptimeSeconds } from '../telemetry.mjs';
test('resets e lacunas não viram taxas artificiais',()=>{
 assert.equal(counterRate(2000,1000,10,45),100);
 assert.equal(counterRate(10,2000,10,45),null);
 assert.equal(counterRate(2000,1000,60,45),null);
 assert.equal(counterRate(null,1000,10,45),null);
 assert.equal(counterRate(2000,1000,0,45),null);
});
test('métricas ausentes não viram zero',()=>{
 assert.equal(finite(undefined),null);assert.equal(finite(''),null);assert.equal(finite('0'),0);
 assert.equal(percentUsed(undefined,512),null);assert.equal(percentUsed(100,0),null);
 assert.equal(percentUsed('256','512'),50);
});
test('uptime textual e relógio permitem detectar reinício',()=>{
 assert.equal(uptimeSeconds('16h59m47s'),61187);
 assert.equal(uptimeSeconds('1d 01:02:03'),90123);
 assert.equal(uptimeSeconds('1w2d3h4m5s'),788645);
});
