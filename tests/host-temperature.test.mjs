import test from 'node:test';
import os from 'node:os';
import assert from 'node:assert/strict';
import {readCpuTemperatures} from '../host-metrics.mjs';
const io=(dirs,files)=>({async readdir(path){if(!dirs[path])throw new Error('missing');return dirs[path];},async readFile(path){if(!(path in files))throw new Error('missing');return files[path];}});
test('host coletor coretemp temp2/temp3 sensors work with renumbered hwmon and exclude GPU/disk temperatures',async()=>{
 const values=await readCpuTemperatures({io:io({'/sys/class/hwmon':['hwmon7','hwmon8'],'/sys/class/hwmon/hwmon7':['temp2_input','temp3_input','temp2_crit'],'/sys/class/hwmon/hwmon8':['temp1_input']},{'/sys/class/hwmon/hwmon7/name':'coretemp\n','/sys/class/hwmon/hwmon7/temp2_input':'42000\n','/sys/class/hwmon/hwmon7/temp3_input':'43000\n','/sys/class/hwmon/hwmon7/temp2_crit':'100000','/sys/class/hwmon/hwmon8/name':'nvme','/sys/class/hwmon/hwmon8/temp1_input':'95000'})});assert.deepEqual(values,[42,43]);assert.equal(Math.max(...values),43);
});
test('Missing hwmon falls back only to a CPU thermal zone',async()=>{
 const values=await readCpuTemperatures({io:io({'/sys/class/thermal':['thermal_zone0','thermal_zone1']},{'/sys/class/thermal/thermal_zone0/type':'x86_pkg_temp','/sys/class/thermal/thermal_zone0/temp':'47000','/sys/class/thermal/thermal_zone1/type':'gpu','/sys/class/thermal/thermal_zone1/temp':'85000'})});assert.deepEqual(values,[47]);
});
test('Unavailable or invalid sensors stay missing rather than becoming a false zero',async()=>{
 const values=await readCpuTemperatures({io:io({'/sys/class/hwmon':['hwmon0'],'/sys/class/hwmon/hwmon0':['temp1_input','temp2_input','temp3_input','temp4_input']},{'/sys/class/hwmon/hwmon0/name':'coretemp','/sys/class/hwmon/hwmon0/temp1_input':'','/sys/class/hwmon/hwmon0/temp2_input':'N/A','/sys/class/hwmon/hwmon0/temp3_input':'-1000','/sys/class/hwmon/hwmon0/temp4_input':'999999'})});assert.deepEqual(values,[]);
});
