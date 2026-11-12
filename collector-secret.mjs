import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {defaultCredentialDir} from './settings.mjs';

// Only the dedicated read account is retained. The key is supplied through
// systemd's credential directory, outside application backups and telemetry.
export function createCollectorSecret({directory,keyFile,identity,user='orbit-monitor'}){
 const file=path.join(directory,'mikrotik.enc'),aad=Buffer.from(identity);
 function prepare(){fs.mkdirSync(directory,{recursive:true,mode:0o700});const s=fs.lstatSync(directory);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o077))throw new Error('Diretório privado do coletor inválido.');}
 function read(file,max=4096,credential=false){const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const s=fs.fstatSync(fd);
  // systemd exposes LoadCredential through a protected mount using root:root
  // 0440. This exception is for the key in that directory, never the saved blob.
  const systemdKey=credential&&s.uid===0&&s.gid===0&&(s.mode&0o777)===0o440&&path.resolve(path.dirname(file))===path.resolve(process.env.CREDENTIALS_DIRECTORY||defaultCredentialDir);
  if(!s.isFile()||((s.mode&0o077)!==0&&!systemdKey)||s.size>max||![0,process.getuid()].includes(s.uid))throw new Error('Arquivo privado do coletor inválido.');return fs.readFileSync(fd);}finally{fs.closeSync(fd);}}
 function key(){const k=read(keyFile,32,true);if(k.length!==32)throw new Error('Chave privada do coletor inválida.');return k;}
 const valid=v=>v?.user===user&&typeof v.password==='string'&&v.password.length>0&&v.password.length<=512;
 return {
  load(){prepare();let record;try{record=JSON.parse(read(file));}catch(e){if(e.code==='ENOENT')return null;throw new Error('Credencial salva indisponível; cadastre novamente pelo formulário local.');}try{if(record.version!==1)throw 0;const iv=Buffer.from(record.iv,'base64'),tag=Buffer.from(record.tag,'base64');if(iv.length!==12||tag.length!==16)throw 0;const decipher=crypto.createDecipheriv('aes-256-gcm',key(),iv,{authTagLength:16});decipher.setAAD(aad);decipher.setAuthTag(tag);const plain=Buffer.concat([decipher.update(Buffer.from(record.data,'base64')),decipher.final()]);try{const v=JSON.parse(plain);if(!valid(v))throw 0;return v;}finally{plain.fill(0);}}catch{throw new Error('Credencial salva inválida ou de outro roteador; cadastre novamente.');}},
  save(v){if(!valid(v))throw new Error('Credencial do coletor inválida.');prepare();const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key(),iv);cipher.setAAD(aad);const plain=Buffer.from(JSON.stringify({user:v.user,password:v.password}));let data;try{data=Buffer.concat([cipher.update(plain),cipher.final()]);}finally{plain.fill(0);}const record={version:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')},tmp=path.join(directory,'.save-'+crypto.randomBytes(12).toString('hex'));let fd;try{fd=fs.openSync(tmp,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(record));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(tmp,file);}finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(tmp);}catch(e){if(e.code!=='ENOENT')throw e;}}},
  clear(){try{fs.unlinkSync(file);}catch(e){if(e.code!=='ENOENT')throw e;}}
 };
}
