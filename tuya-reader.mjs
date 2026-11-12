import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {isIP} from 'node:net';
import {defaultCredentialDir} from './settings.mjs';

const defaultPythonPath=fileURLToPath(new URL(process.platform==='win32'?'./.venv-energy/Scripts/python.exe':'./.venv-energy/bin/python',import.meta.url));
const codes=new Set(['authentication','credentials','timeout','offline','invalid-data','dependency','worker']);
export const energyError=code=>Object.assign(new Error(codes.has(code)?code:'worker'),{code:codes.has(code)?code:'worker'});
// One persistent child, one outstanding request, and no shell or credentials in
// argv/environment payloads. stdout is a small, allowlisted protocol; stderr is
// intentionally discarded, including Python/library exception details.
export function createTuyaReader({address,deviceId='',protocolVersion=3.4,pythonPath=defaultPythonPath,credentialFile,timeoutMs=12000,spawnProcess=spawn}={}){
  if(isIP(address)!==4||typeof deviceId!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(deviceId)||protocolVersion!==3.4)throw energyError('credentials');
  let child=null,pending=null,buffer='',sequence=0,closed=false,reading=false,closing=Promise.resolve();
  async function terminate(code='worker'){
    const old=child;child=null;buffer='';
    if(pending){clearTimeout(pending.timer);const p=pending;pending=null;p.reject(energyError(code));}
    if(old){closing=new Promise(resolve=>{old.once('close',resolve);old.kill('SIGKILL');});await closing;}
  }
  function launch(){
    const env={PATH:process.env.PATH||'',...(process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{}),CREDENTIALS_DIRECTORY:process.env.CREDENTIALS_DIRECTORY||defaultCredentialDir,ORBIT_ENERGY_CREDENTIAL_FILE:credentialFile||''};
    const proc=spawnProcess(pythonPath,['-I','-u',fileURLToPath(new URL('./tools/energy/tuya-worker.py',import.meta.url))],{stdio:['pipe','pipe','ignore'],env,windowsHide:true,shell:false});child=proc;
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data',chunk=>{
      if(child!==proc)return;buffer+=chunk;if(buffer.length>8192){void terminate();return;}
      let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);let message;
        try{message=JSON.parse(line);}catch{void terminate();return;}
        const p=pending;if(!p||message.id!==p.id){void terminate();return;}
        clearTimeout(p.timer);pending=null;
        if(message.ok===true&&message.dps&&typeof message.dps==='object'){
          const dps={};for(const key of ['1','18','19','20'])dps[key]=message.dps[key];p.resolve({dps});
        }else p.reject(energyError(message.code));
      }
    });
    proc.stdin.on('error',()=>{if(child===proc)void terminate();});
    proc.on('error',()=>{if(child===proc)void terminate();});
    proc.on('close',()=>{if(child!==proc)return;child=null;buffer='';if(pending){clearTimeout(pending.timer);const p=pending;pending=null;p.reject(energyError('worker'));}});
  }
  return {
    async read(){
      if(closed||reading)throw energyError('worker');reading=true;
      try{await closing;if(closed)throw energyError('worker');
      if(!child)launch();const id=++sequence;
      return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>void terminate('timeout'),timeoutMs);pending={id,resolve,reject,timer};
        try{child.stdin.write(JSON.stringify({op:'status',id,deviceId,address,timeout:Math.max(.1,Math.min(5,timeoutMs/4000))})+'\n');}catch{void terminate();}
      });
      }finally{reading=false;}
    },
    async close(){closed=true;await terminate();await closing;}
  };
}
