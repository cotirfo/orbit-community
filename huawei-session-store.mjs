import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// The derived SCRAM key is an authentication credential, not a telemetry field.
export function createHuaweiSessionStore({file,origin,fingerprint}){
 const directory=path.dirname(file),identity={origin,fingerprint};
 const validate=value=>value?.version===1&&value.origin===origin&&value.fingerprint===fingerprint&&Number.isInteger(value.iterations)&&value.iterations>=1&&value.iterations<=2000000&&typeof value.salt==='string'&&/^(?:[a-f0-9]{2}){1,512}$/i.test(value.salt)&&typeof value.key==='string'&&/^[a-f0-9]{64}$/i.test(value.key);
 function privateDirectory(){
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const stat=fs.lstatSync(directory);
  if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid())throw new Error('Diretório de autenticação Huawei inválido.');
  fs.chmodSync(directory,0o700);
 }
 return {
  load(){
   try{
    privateDirectory();
    const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    try{
     const stat=fs.fstatSync(fd);
     if(!stat.isFile()||stat.uid!==process.getuid()||(stat.mode&0o077)!==0||stat.size>4096)throw new Error('Permissões de autenticação Huawei inválidas.');
     const value=JSON.parse(fs.readFileSync(fd,'utf8'));
     if(!validate(value))throw new Error('Chave de autenticação Huawei inválida ou de outro roteador.');
     return {salt:value.salt.toLowerCase(),iterations:value.iterations,key:Buffer.from(value.key,'hex')};
    }finally{fs.closeSync(fd);}
   }catch(error){if(error.code==='ENOENT')return null;throw error;}
  },
  save(value){
   const record={version:1,...identity,salt:value.salt,iterations:value.iterations,key:value.key.toString('hex')};
   if(!validate(record))throw new Error('Chave de autenticação Huawei inválida.');
   privateDirectory();
   const temporary=path.join(directory,'.renewal-'+crypto.randomBytes(12).toString('hex'));
   let fd;
   try{
    fd=fs.openSync(temporary,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(record));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
    fs.renameSync(temporary,file);
   }finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}}
  },
  clear(){try{fs.unlinkSync(file);}catch(error){if(error.code!=='ENOENT')throw error;}}
 };
}
