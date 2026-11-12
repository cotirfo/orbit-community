import test from 'node:test';
import os from 'node:os';
import assert from 'node:assert/strict';
import {nearestSample,pointValues} from '../public/charts.js';
test('Inspection selects an actual sample with correct time at boundaries and between observations',()=>{
 const samples=[{time:1000,value:1},{time:2000,value:null},{time:5000,value:3}];
 assert.equal(nearestSample([],1000),null);
 assert.equal(nearestSample(samples,0),samples[0]);
 assert.equal(nearestSample(samples,10000),samples[2]);
 assert.equal(nearestSample(samples,3600),samples[2]);
 assert.equal(nearestSample(samples,2500),samples[1]);
});
test('Point detail preserves missing readings, distinguishes upload and download, and retains units',()=>{
 const series=[{name:'WAN1 RX',get:s=>s.rx,color:'cyan'},{name:'WAN1 TX',get:s=>s.tx,color:'cyan',dash:true},{name:'Loss',get:s=>s.loss,unit:'%'}];
 const values=pointValues({rx:0,tx:.002,loss:null},series,'Mbps');
 assert.equal(values[0].value,0);assert.equal(values[1].value,.002);assert.equal(values[1].dash,true);assert.equal(values[1].unit,'Mbps');assert.equal(values[2].value,null);assert.equal(values[2].unit,'%');
});
