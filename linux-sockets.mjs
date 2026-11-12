import fs from 'node:fs/promises';
export function parseProcTcp(text,inodes,ipv6=false){
 const address=hex=>{if(!ipv6)return hex.match(/../g).reverse().map(b=>parseInt(b,16)).join('.');const bytes=hex.match(/.{8}/g).flatMap(w=>w.match(/../g).reverse());if(bytes.slice(0,10).every(b=>b==='00')&&bytes[10]==='FF'&&bytes[11]==='FF')return '::ffff:'+bytes.slice(12).map(b=>parseInt(b,16)).join('.');return bytes.join('').match(/.{4}/g).join(':').toLowerCase();};
 return text.trim().split('\n').slice(1).flatMap(line=>{const fields=line.trim().split(/\s+/);if(fields.length<10||!inodes.has(fields[9]))return [];const endpoint=value=>{const [ip,port]=value.split(':');if(!new RegExp(ipv6?'^[0-9A-F]{32}$':'^[0-9A-F]{8}$','i').test(ip)||!/^[0-9a-f]{4}$/i.test(port))throw new Error('Endpoint TCP Linux invalido.');return {address:address(ip.toUpperCase()),port:parseInt(port,16)};};const local=endpoint(fields[1]),remote=endpoint(fields[2]);return [{LocalAddress:local.address,LocalPort:local.port,RemoteAddress:remote.address,RemotePort:remote.port}];});
}
export async function processSocketsLinux(pid){
 if(!Number.isInteger(pid)||pid<=0)throw new Error('PID invalido.');
 const prefix='/proc/'+pid;
 try{
  const descriptors=await fs.readdir(prefix+'/fd'),inodes=new Set();
  await Promise.all(descriptors.map(async fd=>{try{const link=await fs.readlink(prefix+'/fd/'+fd),match=link.match(/^socket:\[(\d+)\]$/);if(match)inodes.add(match[1]);}catch(error){if(error.code!=='ENOENT')throw error;}}));
  if(!inodes.size)return [];
  const rows=[];for(const [file,ipv6]of [['tcp',false],['tcp6',true]]){try{rows.push(...parseProcTcp(await fs.readFile(prefix+'/net/'+file,'utf8'),inodes,ipv6));}catch(error){if(error.code!=='ENOENT')throw error;}}
  return rows;
 }catch(error){if(error.code==='ENOENT'||error.code==='ESRCH')return [];throw error;}
}
