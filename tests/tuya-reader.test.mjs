import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {createTuyaReader} from '../tuya-reader.mjs';
const readerFor=options=>createTuyaReader({address:'192.0.2.46',deviceId:'SYNTHETIC_DEVICE_ID',...options});
function fakeSpawn(onRequest){const invocations=[];const spawnProcess=(file,args,options)=>{const child=new EventEmitter();child.stdout=new PassThrough();child.kill=()=>{queueMicrotask(()=>child.emit('close',null,'SIGKILL'));return true;};child.stdin=new Writable({write(chunk,encoding,done){onRequest(JSON.parse(String(chunk)),child);done();}});invocations.push({file,args,options,child});return child;};return {invocations,spawnProcess};}
test('persistent child only receives status, reuses process, and filters unknown response keys',async()=>{
  const fake=fakeSpawn((req,c)=>{assert.equal(req.op,'status');assert.equal(req.deviceId,'SYNTHETIC_DEVICE_ID');queueMicrotask(()=>c.stdout.write(JSON.stringify({id:req.id,ok:true,dps:{'1':true,'18':557,'19':463,'20':1165,'22':999,localKey:'SYNTHETIC_KEY'}})+'\n'));});const reader=readerFor({spawnProcess:fake.spawnProcess});
  try{const a=await reader.read();await reader.read();assert.equal(fake.invocations.length,1);assert.equal(a.dps['22'],undefined);assert.ok(!JSON.stringify(a).includes('SYNTHETIC_KEY'));assert.ok(!JSON.stringify(fake.invocations[0].args).includes('SYNTHETIC_DEVICE_ID'));assert.ok(!JSON.stringify(fake.invocations[0].options.env).includes('SYNTHETIC_DEVICE_ID'));assert.equal(fake.invocations[0].options.shell,false);assert.equal(fake.invocations[0].options.stdio[2],'ignore');assert.deepEqual(fake.invocations[0].args.slice(0,2),['-I','-u']);}finally{await reader.close();}
});
test('parent hard timeout kills a hung child and the next read starts a new worker',async()=>{
  let hung=true;const fake=fakeSpawn((req,c)=>{if(!hung)queueMicrotask(()=>c.stdout.write(JSON.stringify({id:req.id,ok:true,dps:{}})+'\n'));});const reader=readerFor({spawnProcess:fake.spawnProcess,timeoutMs:20});
  try{await assert.rejects(reader.read(),e=>e.code==='timeout');hung=false;await reader.read();assert.equal(fake.invocations.length,2);}finally{await reader.close();}
});
test('auth failures are allowlisted and Python messages, malformed frames and exits never leak',async()=>{
  for(const mode of ['auth','raw','exit','oversize','wrong-id']){const fake=fakeSpawn((req,c)=>queueMicrotask(()=>{
    if(mode==='exit'){c.emit('close',1);return;}if(mode==='raw'){c.stdout.write('Traceback SYNTHETIC_KEY\n');return;}if(mode==='oversize'){c.stdout.write('SYNTHETIC_KEY'.repeat(1000));return;}
    c.stdout.write(JSON.stringify({id:mode==='wrong-id'?req.id+1:req.id,ok:false,code:'authentication',message:'SYNTHETIC_KEY'})+'\n');
  }));const reader=readerFor({spawnProcess:fake.spawnProcess});try{await assert.rejects(reader.read(),e=>e.code===(mode==='auth'?'authentication':'worker')&&!e.message.includes('SYNTHETIC_KEY'));}finally{await reader.close();}}
});
test('concurrent reader calls reject; close terminates pending request and prevents restart',async()=>{const fake=fakeSpawn(()=>{}),reader=readerFor({spawnProcess:fake.spawnProcess});const first=reader.read();await assert.rejects(reader.read());const rejected=assert.rejects(first);await reader.close();await rejected;await assert.rejects(reader.read());assert.equal(fake.invocations.length,1);});

test('reader requires the device address before starting a worker',()=>{
  assert.throws(()=>createTuyaReader({deviceId:'SYNTHETIC_DEVICE_ID',spawnProcess:()=>assert.fail('worker started')}),{code:'credentials'});
});
