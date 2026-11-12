import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import os from 'node:os';
import { BlockList,isIP } from 'node:net';
import { deviceOrigin } from './settings.mjs';
import { promisify } from 'node:util';
import { createPinnedHuaweiAgent } from './huawei-tls.mjs';
const pbkdf2=promisify(crypto.pbkdf2);
const privateIPv4=new BlockList();
for(const [network,bits] of [['10.0.0.0',8],['172.16.0.0',12],['192.168.0.0',16],['169.254.0.0',16],['127.0.0.0',8]])privateIPv4.addSubnet(network,bits);
const READ_PATHS=new Set(['/html/index.html','/api/system/deviceinfo','/api/system/HostInfo','/api/ntwk/wan?type=active','/api/ntwk/wandiagnose','/api/ntwk/wandetect','/api/ntwk/wlanfilterenhance','/api/ntwk/getmacaddress','/api/system/heartbeat','/api/ntwk/sntp']);
const WRITE_PATHS=new Set(['/api/system/user_login_nonce','/api/system/user_login_proof','/api/app/qosclass_host','/api/ntwk/wlanfilterenhance','/api/system/changedevicename']);
const canonicalMac=value=>String(value||'').toUpperCase();
export const isMac=value=>/^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(canonicalMac(value));
const numeric=value=>value===null||value===undefined||value===''?null:Number.isFinite(Number(value))?Number(value):null;
const bool=value=>value===true||value===1||value==='1'||value==='true';
const reportedRate=value=>numeric(value)!==null&&numeric(value)>=0?Math.floor(Number(value))*8:null;
const safeText=(value,max=128)=>String(value??'').replace(/[\u0000-\u001f]/g,' ').slice(0,max);
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function challengeParameters(firstNonce,response){
 const iterations=Number(response.iterations),salt=String(response.salt||''),finalNonce=String(response.servernonce||'');
 if(!Number.isInteger(iterations)||iterations<1||iterations>2000000||!/^[a-f0-9]{2,1024}$/i.test(salt)||salt.length%2||!finalNonce.startsWith(firstNonce)||finalNonce.length>1024)throw new Error('Desafio de autenticação Huawei inválido.');
 return {iterations,salt:salt.toLowerCase(),finalNonce};
}
function proofFromKey(salted,firstNonce,response){
 const {finalNonce}=challengeParameters(firstNonce,response);
 // Huawei SCRAMJS reverses HMAC message/key relative to RFC SCRAM.
 const hmac=(key,message)=>crypto.createHmac('sha256',key).update(message).digest();
 const client=hmac('Client Key',salted),server=hmac('Server Key',salted),stored=crypto.createHash('sha256').update(client).digest();
 const message=firstNonce+','+finalNonce+','+finalNonce,signature=hmac(message,stored);
 const proof=Buffer.from(client.map((byte,index)=>byte^signature[index]));client.fill(0);stored.fill(0);
 return {clientproof:proof.toString('hex'),finalnonce:finalNonce,expectedServerProof:hmac(message,server).toString('hex'),serverKey:server};
}
export async function huaweiProof(password,firstNonce,response){
 const {iterations,salt}=challengeParameters(firstNonce,response);
 const salted=await pbkdf2(password,Buffer.from(salt,'hex'),iterations,32,'sha256');
 try{return proofFromKey(salted,firstNonce,response);}finally{salted.fill(0);}
}
export function normalizeHuawei({hosts,deviceInfo,wan,diagnostics,filters,myMac,clock,collectorAddresses=[],collectorMacs=[],protectedMacs=[]},time=Date.now()){
 const rows=Array.isArray(hosts)?hosts:[],filter=Array.isArray(filters)?filters[0]:null;
 const black=new Set((filter?.BMACAddresses||[]).map(r=>canonicalMac(r.MACAddress)));
 const white=new Set((filter?.WMACAddresses||[]).map(r=>canonicalMac(r.MACAddress)));
 const filterEnabled=bool(filter?.MACAddressControlEnabled),allowList=bool(filter?.MacFilterPolicy);
 const devices=rows.filter(h=>isMac(h.MACAddress)).map(h=>{
   const mac=canonicalMac(h.MACAddress),online=bool(h.Active46??h.Active),wifi=/SSID/.test(h.Layer2Interface||''),mesh=bool(h.IsSlave),self=mac===canonicalMac(myMac?.macaddress)||collectorAddresses.includes(h.IPAddress)||collectorMacs.some(value=>canonicalMac(value)===mac);
   const blocked=filterEnabled&&(allowList?!white.has(mac):black.has(mac)),administratorProtected=protectedMacs.some(value=>canonicalMac(value)===mac);
   return {id:safeText(h.ID,128),mac,name:safeText(h.ActualName||h.HostName||mac,64),ip:safeText(h.IPAddress,45),online,
     connection:mesh?'Link+':bool(h.IsGuest)?'Convidado':wifi?(h.Frequency==='5GHz'?'Wi-Fi 5 GHz':h.Frequency==='2.4GHz'?'Wi-Fi 2,4 GHz':'Wi-Fi'):/LAN/.test(h.Layer2Interface||'')?'Cabo':'Não identificado',
     wifi,mesh,self,administratorProtected,blocked,filterEnabled,allowList,uploadKbps:online?reportedRate(h.UpRate):null,downloadKbps:online?reportedRate(h.DownRate):null,
     connectedSince:safeText(String(h.AccessRecord||'').split('#')[0],32),limitEnabled:bool(h.DeviceDownRateEnable),uploadLimitKbps:numeric(h.DeviceMaxUpLoadRate),downloadLimitKbps:numeric(h.DeviceMaxDownLoadRate),
     canBlock:wifi&&!mesh&&!self&&!administratorProtected&&filterEnabled&&!allowList,canLimit:!mesh&&!self&&!administratorProtected,canRename:!mesh};
 });
 const metadata={model:safeText(deviceInfo?.DeviceName||'HUAWEI WiFi AX3',64),firmware:safeText(deviceInfo?.SoftwareVersion,64),hardware:safeText(deviceInfo?.HardwareVersion,64),uptimeSeconds:numeric(deviceInfo?.UpTime),wanIp:safeText(diagnostics?.ManWanIP||diagnostics?.ExternalIPAddress||'',45),connectionUptimeSeconds:numeric(diagnostics?.Uptime),wanUploadKbps:numeric(wan?.UpBandwidth)===null?null:Math.max(0,Number(wan.UpBandwidth)*8),wanDownloadKbps:numeric(wan?.DownBandwidth)===null?null:Math.max(0,Number(wan.DownBandwidth)*8),clock:safeText(clock?.CurrentLocalTime,32)};
 return {state:'live',time,metadata,online:devices.filter(d=>d.online).length,offline:devices.filter(d=>!d.online).length,devices,
   coverage:'Taxas reportadas pelo Huawei, seguindo a conversão do firmware. Não identificam conteúdos de HTTPS/VPN nem a WAN do MikroTik por aparelho.'};
}
export function createHuaweiClient({requestImpl,now=Date.now,origin,sourceIp,certificateFingerprint,protectedMacs=[],sessionStore=null,timeoutMs=8000}={}){
 if(!Array.isArray(protectedMacs)||protectedMacs.some(mac=>!isMac(mac)))throw new Error('MAC de administrador protegido inválido.');
 let url;
 try{url=deviceOrigin(origin,['http:','https:'],'huawei.origin');}catch{throw new Error('Endereço de administração Huawei não permitido. Configure uma origem HTTP ou HTTPS sem caminho ou credenciais.');}
 if(sourceIp!==undefined&&isIP(sourceIp)!==4)throw new Error('Origem IPv4 do coletor Huawei inválida.');
 const secure=url.protocol==='https:',requestTransport=requestImpl||(secure?https.request:http.request);
 if(!secure&&(isIP(url.hostname)!==4||!privateIPv4.check(url.hostname)))throw new Error('HTTP para Huawei exige um endereço IPv4 privado. Use HTTPS com pin SHA-256 para um hostname.');
 if(secure&&!sourceIp)throw new Error('Configure a origem Ethernet para a administração HTTPS Huawei.');
 if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>60000)throw new Error('Timeout Huawei inválido.');
 origin=url.origin;
 let cookie=new Map(),csrf=null,connected=false,raw=null,queue=Promise.resolve(),renewal=null,renewedAt=null,renewals=0,retryAt=0,failures=0,view={state:'pending',time:null,metadata:null,devices:[],error:'Conecte o Huawei no painel administrativo deste PC.'};
 const agent=secure?createPinnedHuaweiAgent({fingerprint:certificateFingerprint,now,timeoutMs}):new http.Agent({keepAlive:true,maxSockets:1});
 let savedRenewal=false,storageError='';
 if(sessionStore){try{renewal=sessionStore.load();savedRenewal=Boolean(renewal);}catch{storageError='Não foi possível carregar a autenticação salva do Huawei. Conecte novamente.';view.error=storageError;}}
 async function request(path,{data,html=false}={}){
   if(!(data===undefined?READ_PATHS:WRITE_PATHS).has(path))throw new Error('Endpoint Huawei não permitido.');
   const body=data===undefined?null:JSON.stringify(data.action&&Array.isArray(data.data)?{...data,csrf}:{data,csrf});
   return new Promise((resolvePromise,rejectPromise)=>{
     let settled=false,req;
     const deadline=setTimeout(()=>{const error=new Error('Tempo limite na conexão com Huawei.');reject(error);req?.destroy();},timeoutMs);
     const resolve=value=>{if(!settled){settled=true;clearTimeout(deadline);resolvePromise(value);}};
     const reject=error=>{if(!settled){settled=true;clearTimeout(deadline);rejectPromise(error);}};
     try{req=requestTransport(new URL(path,origin),{agent,...(sourceIp?{localAddress:sourceIp}:{}),method:body?'POST':'GET',timeout:timeoutMs,headers:{_ResponseFormat:'JSON',Referer:origin+'/html/index.html',Cookie:[...cookie].map(([k,v])=>k+'='+v).join('; '),...(body?{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body)}:{})}},res=>{
       for(const line of res.headers['set-cookie']||[]){const pair=line.split(';')[0],i=pair.indexOf('=');if(i>0){const key=pair.slice(0,i),value=pair.slice(i+1);if(!value||/max-age\s*=\s*0(?:;|$)/i.test(line))cookie.delete(key);else cookie.set(key,value);}}
       const chunks=[];let length=0;res.on('data',chunk=>{length+=chunk.length;if(length>2e6)req.destroy(new Error('Resposta Huawei acima do limite.'));else chunks.push(chunk);});res.on('error',reject);res.on('aborted',()=>reject(new Error('Huawei interrompeu a resposta.')));
       res.on('end',()=>{
         if(res.statusCode!==200){const err=new Error(res.statusCode===404?'Sessão do Huawei expirada. Conecte novamente no PC.':'Huawei HTTP '+res.statusCode);err.status=res.statusCode;reject(err);return;}
         const text=Buffer.concat(chunks).toString('utf8');if(html){resolve(text);return;}
         let value;try{value=JSON.parse(text);}catch{reject(new Error('Huawei retornou resposta inválida.'));return;}
         if([401,403,404].includes(Number(value?.ERRORSTATUS))){reject(Object.assign(new Error('Sessão do Huawei expirada.'),{status:Number(value.ERRORSTATUS)}));return;}
         if(value?.csrf_param&&value?.csrf_token)csrf={csrf_param:value.csrf_param,csrf_token:value.csrf_token};
         resolve(value);
       });
     });req.on('timeout',()=>req.destroy(new Error('Tempo limite na conexão com Huawei.')));req.on('error',reject);req.end(body);}catch(error){reject(error);}
   });
 }
 const serialized=fn=>{const job=queue.then(fn);queue=job.catch(()=>{});return job;};
 const expired=error=>[401,403,404].includes(error.status);
 function forgetRenewal({clearSaved=false}={}){renewal?.key.fill(0);renewal=null;if(clearSaved&&sessionStore){try{sessionStore.clear();savedRenewal=false;}catch{storageError='Não foi possível remover a autenticação Huawei inválida.';}}}
 function failed(error){
   if(expired(error)||error.authentication){connected=false;cookie.clear();csrf=null;}
   if(error.authentication)forgetRenewal({clearSaved:true});
   retryAt=now()+Math.min(300000,30000*2**Math.min(failures++,4));
   view={...view,state:!connected&&!renewal?'auth-required':'error',error:error.authentication?'Huawei exige nova autenticação. Conecte novamente no PC.':error.message};
 }
 async function authenticate(password){
   cookie.clear();csrf=null;connected=false;
   let candidate=null,proof=null;
   try{
     const html=await request('/html/index.html',{html:true});
     const meta=name=>(html.match(/<meta\b[^>]*>/gi)||[]).find(tag=>new RegExp('name=["\']'+name+'["\']','i').test(tag))?.match(/content=["']([^"']+)["']/i)?.[1];
     csrf={csrf_param:meta('csrf_param'),csrf_token:meta('csrf_token')};if(!csrf.csrf_param||!csrf.csrf_token||!html.match(/g_userScram\s*=\s*1/))throw Object.assign(new Error('Método de login deste firmware não suportado.'),{authentication:true});
     const firstNonce=crypto.randomBytes(32).toString('hex'),challenge=await request('/api/system/user_login_nonce',{data:{username:'admin',firstnonce:firstNonce}});
     if(challenge.err!==0)throw new Error('Huawei indisponível para renovar a sessão. Nova tentativa após o intervalo de reconexão.');
     let parameters;try{parameters=challengeParameters(firstNonce,challenge);}catch(error){error.authentication=true;throw error;}
     if(password!==undefined){candidate={...parameters,key:await pbkdf2(password,Buffer.from(parameters.salt,'hex'),parameters.iterations,32,'sha256')};password='';}
     else if(renewal&&renewal.salt===parameters.salt&&renewal.iterations===parameters.iterations)candidate=renewal;
     else throw Object.assign(new Error('Desafio Huawei mudou. Informe a senha novamente no PC.'),{authentication:true});
     proof=proofFromKey(candidate.key,firstNonce,challenge);
     const result=await request('/api/system/user_login_proof',{data:{clientproof:proof.clientproof,finalnonce:proof.finalnonce}});
     if(result.err!==0||!equalHex(result.serversignature,proof.expectedServerProof))throw Object.assign(new Error('Login Huawei recusado ou assinatura inválida.'),{authentication:true});
     const rsaProof=crypto.createHmac('sha256',proof.serverKey).update(Buffer.from(String(result.rsan||''),'hex')).digest('hex');
     if(!equalHex(result.rsapubkeysignature,rsaProof))throw Object.assign(new Error('Assinatura da chave do Huawei inválida.'),{authentication:true});
     if(candidate!==renewal){forgetRenewal();renewal=candidate;}candidate=null;
     if(sessionStore){try{sessionStore.save(renewal);savedRenewal=true;storageError='';}catch{savedRenewal=false;storageError='Coleta ativa, mas não foi possível salvar a chave de renovação no host coletor.';}}
     connected=true;retryAt=0;failures=0;renewedAt=now();if(password===undefined)renewals++;
   }catch(error){if(candidate&&candidate!==renewal)candidate.key.fill(0);failed(error);throw error;}
   finally{password='';proof?.serverKey.fill(0);}
 }
 async function poll(){
   if(now()<retryAt)return view;
   if(!connected){if(!renewal)return view;if(now()<retryAt)return view;await authenticate();}
   for(let attempt=0;attempt<2;attempt++){
   try{
     const next={};
     for(const [key,path] of [['hosts','/api/system/HostInfo'],['deviceInfo','/api/system/deviceinfo'],['wan','/api/ntwk/wan?type=active'],['diagnostics','/api/ntwk/wandiagnose'],['filters','/api/ntwk/wlanfilterenhance'],['myMac','/api/ntwk/getmacaddress'],['clock','/api/ntwk/sntp']])next[key]=await request(path);
     if(!Array.isArray(next.hosts))throw new Error('Lista Huawei de dispositivos inesperada.');
     const localInterfaces=Object.values(os.networkInterfaces()).flat().filter(r=>r&&!r.internal);
     raw=next;retryAt=0;failures=0;view=normalizeHuawei({...next,collectorAddresses:localInterfaces.map(r=>r.address),collectorMacs:localInterfaces.map(r=>r.mac),protectedMacs},now());return view;
   }catch(error){
     if(expired(error)&&renewal&&attempt===0){await authenticate();continue;}
     // A second expired read can be a router/session interruption. It does not
     // establish that the cryptographically verified renewal key is invalid.
     failed(error);throw error;
   }
   }
 }
 function device(mac){const normalized=view.devices.find(d=>d.mac===canonicalMac(mac));if(!normalized)throw new Error('Dispositivo não encontrado. Atualize a lista.');const source=raw.hosts.find(h=>canonicalMac(h.MACAddress)===normalized.mac);return {normalized,source};}
 function buildAction(input,{protectedMac}={}){
   if(!raw||view.state!=='live'||now()-view.time>30000)throw new Error('Aguarde uma leitura Huawei atualizada.');
   if(!input||!isMac(input.mac)||!['rename','limit','access'].includes(input.kind))throw new Error('Ação ou dispositivo inválido.');
   if(protectedMac!==undefined&&!isMac(protectedMac))throw new Error('Identificação do administrador inválida.');
   const {normalized:d,source:h}=device(input.mac);let path,payload,summary,before;
   if(protectedMac&&d.mac===canonicalMac(protectedMac)&&['limit','access'].includes(input.kind))throw new Error('Este aparelho administra o ORBIT e está protegido contra bloqueio ou limite.');
   if(input.kind==='rename'){
     if(!d.canRename||typeof input.name!=='string'||input.name.trim().length<1||input.name.trim().length>64||/[\u0000-\u001f]/.test(input.name))throw new Error('Nome inválido ou dispositivo sem suporte para renomear.');
     path='/api/system/changedevicename';payload={action:'update',data:[{ActualName:input.name.trim(),ID:h.ID}]};summary='Renomear '+d.name+' para '+input.name.trim();before={name:d.name};
   }else if(input.kind==='limit'){
     if(!d.canLimit)throw new Error('O coletor, administradores e dispositivos Link+ estão protegidos contra limitação.');
     if(typeof input.enabled!=='boolean'||![input.uploadKbps,input.downloadKbps].every(n=>Number.isInteger(n)&&(n===0||n>=100&&n<=1000000)))throw new Error('Limites devem ser inteiros de 100 a 1000000 Kbps, ou 0 para ilimitado.');
     path='/api/app/qosclass_host';payload={...h,DeviceDownRateEnable:input.enabled,DeviceMaxUpLoadRate:input.uploadKbps,DeviceMaxDownLoadRate:input.downloadKbps};summary=(input.enabled?'Aplicar limite':'Remover limite')+' em '+d.name+' · upload '+input.uploadKbps+' / download '+input.downloadKbps+' Kbps';before={enabled:d.limitEnabled,uploadKbps:d.uploadLimitKbps,downloadKbps:d.downloadLimitKbps};
   }else{
     if(!d.canBlock||typeof input.blocked!=='boolean')throw new Error('Bloqueio disponível somente para clientes Wi-Fi em modo de lista de bloqueio. O coletor/Link+ estão protegidos.');
     if(!Array.isArray(raw.filters)||raw.filters.length!==2||raw.filters.some(r=>!bool(r.MACAddressControlEnabled)||bool(r.MacFilterPolicy)))throw new Error('Configuração das listas Wi-Fi não permite esta ação.');
     path='/api/ntwk/wlanfilterenhance';payload={};
     raw.filters.forEach((r,index)=>{const updated=structuredClone(r),item={HostName:d.name,MACAddress:d.mac};
       for(const key of ['BMACAddresses','WMACAddresses']){if(!Array.isArray(updated[key]))throw new Error('Lista de MAC Huawei inesperada.');updated[key]=updated[key].filter(v=>canonicalMac(v.MACAddress)!==d.mac);}
       updated[input.blocked?'BMACAddresses':'WMACAddresses'].push(item);
       if(updated.BMACAddresses.length>(numeric(raw.deviceInfo.MacFilterCapacity)||32)||updated.WMACAddresses.length>(numeric(raw.deviceInfo.MacFilterCapacity)||32))throw new Error('Capacidade de filtro Huawei excedida.');
       const out={};for(const [key,value] of Object.entries(updated))out[/Addresses$/.test(key)?key.replace(/Addresses$/,'Filters').replace('MAC','Mac'):key]=value;
       payload[index===0?'config2g':'config5g']=out;
     });summary=(input.blocked?'Bloquear':'Liberar')+' acesso Wi-Fi de '+d.name+' nas duas bandas';before={blocked:d.blocked};
   }
   // Fingerprint only action-sensitive state; changing transfer rates do not invalidate review.
   return {kind:input.kind,mac:d.mac,name:d.name,summary,before,fingerprint:hash({id:h.ID,mac:d.mac,before,filters:input.kind==='access'?raw.filters:null}),path,payload};
 }
 return {
   snapshot:()=>({...view,managementOrigin:origin,connected,canReconnect:Boolean(renewal),automaticRenewal:Boolean(renewal),savedRenewal,storageError,renewedAt,renewals,nextRetryAt:retryAt||null}),
   connect(password){return serialized(async()=>{
     if(typeof password!=='string'||!password||password.length>512)throw new Error('Informe a senha de administração do Huawei.');
     forgetRenewal({clearSaved:true});await authenticate(password);password='';return poll();
   });},
   reconnect(){return serialized(async()=>{if(!renewal)throw new Error('Conecte o Huawei novamente na administração local do PC.');if(now()<retryAt)throw new Error('Aguarde a próxima tentativa de reconexão.');await authenticate();return poll();});},
   poll:()=>serialized(poll),
   heartbeat:()=>serialized(async()=>{if(!connected||now()<retryAt)return;try{await request('/api/system/heartbeat');}catch(error){if(expired(error)&&renewal){await authenticate();await poll();}else{failed(error);throw error;}}}),
   plan:(input,context)=>buildAction(input,context),
   execute(input,fingerprint,context){return serialized(async()=>{
     await poll();const action=buildAction(input,context);if(action.fingerprint!==fingerprint)throw new Error('Estado do dispositivo mudou. Revise a ação novamente.');
     let response;try{response=await request(action.path,{data:action.payload});}catch(error){failed(error);throw new Error('Comando enviado, mas sem confirmação. Atualize e confira antes de repetir. '+error.message);}if(response.errcode!==0)throw new Error('Huawei recusou a alteração'+(Number.isInteger(response.errcode)?' (código '+response.errcode+')':'')+'.');
     let d,verified=false;
     for(let attempt=0;attempt<6;attempt++){
       if(attempt)await new Promise(resolve=>setTimeout(resolve,4000));
       await poll();d=device(input.mac).normalized;
       verified=input.kind==='rename'?d.name===input.name.trim():input.kind==='access'?d.blocked===input.blocked:d.limitEnabled===input.enabled&&(!input.enabled||d.uploadLimitKbps===input.uploadKbps&&d.downloadLimitKbps===input.downloadKbps);
       if(verified)break;
     }
     if(!verified)throw new Error('Comando enviado, mas o estado ainda não confirmou a alteração. Atualize e confira antes de repetir.');
     return {verified:true,summary:action.summary,device:d};
   });},
   async close(){await queue;forgetRenewal();cookie.clear();csrf=null;connected=false;raw=null;agent.destroy();}
 };
}
function equalHex(a,b){if(typeof a!=='string'||!/^[a-f0-9]{64}$/i.test(a)||typeof b!=='string'||!/^[a-f0-9]{64}$/i.test(b))return false;return crypto.timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));}
