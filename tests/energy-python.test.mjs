import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const python=process.env.ORBIT_TEST_PYTHON||'python3';
const available=spawnSync(python,['--version'],{windowsHide:true,encoding:'utf8'});
test('Python worker contract, read-only requests, dependency errors and redaction',{skip:available.status!==0?'Set ORBIT_TEST_PYTHON to a Python 3 executable to run worker tests':false},()=>{
  const result=spawnSync(python,['-B',fileURLToPath(new URL('./tuya_worker_test.py',import.meta.url))],{windowsHide:true,encoding:'utf8',timeout:15000});
  assert.equal(result.status,0,result.stderr||result.stdout);
});
