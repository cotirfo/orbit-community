import test from 'node:test';
import os from 'node:os';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHuaweiSessionStore} from '../huawei-session-store.mjs';
const supported=process.platform==='linux';
function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-huawei-auth-test-')),file=path.join(root,'private','renewal.json'),options={file,origin:'https://192.0.2.2',fingerprint:'a'.repeat(64)},store=createHuaweiSessionStore(options),value={salt:'abcd',iterations:100,key:Buffer.alloc(32,7)};return {root,file,options,store,value,close:()=>fs.rmSync(root,{recursive:true,force:true})};}
test('private store persists only derived key and locks directory/file permissions',{skip:!supported},()=>{const f=fixture();try{assert.equal(f.store.load(),null);f.store.save(f.value);assert.deepEqual(f.store.load(),f.value);assert.equal(fs.statSync(path.dirname(f.file)).mode&0o777,0o700);assert.equal(fs.statSync(f.file).mode&0o777,0o600);assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(f.file))).sort(),['fingerprint','iterations','key','origin','salt','version']);f.store.clear();assert.equal(f.store.load(),null);}finally{f.close();}});
test('store rejects symlinks and permissive files',{skip:!supported},()=>{const f=fixture();try{f.store.save(f.value);fs.chmodSync(f.file,0o644);assert.throws(()=>f.store.load(),/Permissões/);fs.chmodSync(f.file,0o600);fs.renameSync(f.file,f.file+'.real');fs.symlinkSync(f.file+'.real',f.file);assert.throws(()=>f.store.load());}finally{f.close();}});
test('store binds credentials to router identity and rejects corrupted data',{skip:!supported},()=>{const f=fixture();try{f.store.save(f.value);assert.throws(()=>createHuaweiSessionStore({...f.options,origin:'http://192.0.2.47'}).load(),/outro roteador/);assert.throws(()=>createHuaweiSessionStore({...f.options,fingerprint:'b'.repeat(64)}).load(),/outro roteador/);fs.writeFileSync(f.file,'{}');assert.throws(()=>f.store.load(),/inválida/);assert.throws(()=>f.store.save({...f.value,key:Buffer.alloc(31)}),/inválida/);}finally{f.close();}});
