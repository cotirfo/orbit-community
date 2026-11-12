import dns from 'node:dns/promises';
import {isIP} from 'node:net';
export function publicIPv4(value){
 if(isIP(value)!==4)return false;const [a,b,c]=value.split('.').map(Number);
 return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0||b===2))||(a===198&&(b===18||b===19||b===51&&c===100))||(a===203&&b===0&&c===113));
}
export function validateCatalog(catalog){
 if(!Array.isArray(catalog)||catalog.length<1||catalog.length>8)throw new Error('Catálogo de servidores inválido.');
 const ids=new Set();for(const server of catalog){
  if(!/^[a-z0-9-]{1,50}$/.test(server.id)||ids.has(server.id))throw new Error('Identificador de servidor inválido.');ids.add(server.id);
  const url=new URL(server.origin);if(url.protocol!=='https:'||url.port&&url.port!=='443'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||isIP(url.hostname)||!['cloudflare','librespeed'].includes(server.protocol))throw new Error('Servidor precisa ser um hostname HTTPS validado.');
  for(const field of ['pingPath','downloadPath','uploadPath']){const path=server[field];if(typeof path!=='string'||!path.startsWith('/')||path.startsWith('//')||path.includes('\\')||new URL(path,url).origin!==url.origin)throw new Error('Endpoint inválido.');}
 }return catalog;
}
export async function resolveServer(server,lookup=dns.lookup){
 const hostname=new URL(server.origin).hostname,rows=await lookup(hostname,{family:4,all:true});
 if(!rows.length||rows.some(row=>!publicIPv4(row.address)))throw new Error('DNS do servidor não retornou somente endereços IPv4 públicos.');
 return {...server,hostname,address:rows[0].address};
}
export function rankCandidates(candidates){
 return candidates.filter(c=>c.eligible&&Number.isFinite(c.latencyMs)&&Number.isFinite(c.jitterMs)).sort((a,b)=>a.latencyMs-b.latencyMs||a.jitterMs-b.jitterMs||a.id.localeCompare(b.id));
}
