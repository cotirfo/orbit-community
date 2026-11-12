import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createControlAuth } from './control-auth.mjs';
import { createHuaweiClient,isMac } from './huawei.mjs';
import { createHuaweiSessionStore } from './huawei-session-store.mjs';
import { loadSettings,localHostHeader } from './settings.mjs';
import { sendPanelAsset } from './panel-assets.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const local=ip=>ip==='127.0.0.1'||ip==='::1';
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
const failure=(message,status=400)=>Object.assign(new Error(message),{status});
const clean=value=>String(value||'').replace(/[\u0000-\u001f]/g,' ').slice(0,256);
const cookieToken=req=>req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith('orbit_admin='))?.slice(12)||'';
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
async function input(req){let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>4096)throw failure('Solicitação acima do limite.',413);}try{const value=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value))throw 0;return value;}catch{throw failure('JSON inválido.');}}
function keys(value,allowed){if(Object.keys(value).some(k=>!allowed.includes(k)))throw failure('Campo não permitido.');}
export async function createController({directory=root,dataDir=path.join(directory,'data'),port=8790,upstreamPort=18887,huawei=null,huaweiError='',intervalSeconds=10,heartbeatSeconds=5,now=Date.now,relayKey=null,auth=null,proxiedAdminSources=[]}={}){
 await fs.mkdir(dataDir,{recursive:true,mode:0o700});
 if(!relayKey){const keyFile=path.join(dataDir,'control-relay.key');try{relayKey=await fs.readFile(keyFile,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;relayKey=crypto.randomBytes(32).toString('hex');await fs.writeFile(keyFile,relayKey,{mode:0o600,flag:'wx'});}}
 auth=auth||await createControlAuth({root:directory,dataDir,now,remoteAllowed:true});
 const plans=new Map(),history=[];let busy=false,polling=false,lastAction=0,auditTail=[];
 const auditPath=path.join(dataDir,'control-audit.jsonl');
 try{auditTail=(await fs.readFile(auditPath,'utf8')).trim().split('\n').filter(Boolean).slice(-200).map(line=>JSON.parse(line));}catch(error){if(error.code!=='ENOENT')throw error;}
 async function audit(entry){auditTail.push({time:now(),...entry});auditTail=auditTail.slice(-200);await fs.writeFile(auditPath,auditTail.map(v=>JSON.stringify(v)).join('\n')+'\n',{mode:0o600});}
 const staleMs=Math.max(30000,intervalSeconds*3000);
 const huaweiSnapshot=()=>huawei?.snapshot()??{state:huaweiError?'error':'disabled',devices:[],error:huaweiError||'Integração Huawei desabilitada.'};
 async function collect(){const snap=huaweiSnapshot();if(polling||busy||(!snap.connected&&!snap.canReconnect))return;polling=true;try{const s=await huawei.poll();if(s.state==='live'&&s.time!==history.at(-1)?.time){history.push({time:s.time,uploadKbps:s.metadata?.wanUploadKbps,downloadKbps:s.metadata?.wanDownloadKbps,online:s.online});if(history.length>360)history.shift();}}catch{}finally{polling=false;}}
 function session(req){const socketIp=req.socket.remoteAddress?.replace(/^::ffff:/,'')||'',relayed=equal(req.headers['x-orbit-relay'],relayKey);if(!local(socketIp))throw failure('Controlador local.',403);if(req.headers['x-orbit-client']&&!relayed)throw failure('Relay inválido.',403);return {ip:relayed?req.headers['x-orbit-client']:socketIp,relayed,token:cookieToken(req),csrf:req.headers['x-orbit-csrf']};}
 function localOnly(s){if(s.relayed||!local(s.ip))throw failure('Abra a administração local do ORBIT para esta operação.',403);}
 function protectAdministrator(s,identity,action){
   if(!['limit','access'].includes(action.kind))return;
   if(proxiedAdminSources.includes(s.ip)&&!identity.protectedMac)throw failure('Gere um novo código no PC selecionando o aparelho que administrará o ORBIT.',409);
   const target=huaweiSnapshot().devices.find(d=>d.mac===String(action.mac).toUpperCase());
   if(target?.ip===s.ip||identity.protectedMac&&target?.mac===identity.protectedMac)throw failure('Este aparelho administra o ORBIT e está protegido contra bloqueio ou limite.',409);
 }
 function response(res,value,status=200){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));}
 function setSession(res,s){res.setHeader('Set-Cookie','orbit_admin='+s.token+'; HttpOnly; SameSite=Strict; Path=/api; Max-Age='+Math.max(0,Math.floor((s.expiresAt-now())/1000)));return {authenticated:true,csrf:s.csrf,expiresAt:s.expiresAt};}
 const server=http.createServer(async(req,res)=>{
   res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'none'");
   let s;
   try{
     const host=req.headers.host||'';if(!localHostHeader(host.toLowerCase(),port))throw failure('Host inválido.',403);
     s=session(req);const url=new URL(req.url,'http://'+host),p=url.pathname;
     if(req.headers['sec-fetch-site']==='cross-site')throw failure('Origem inválida.',403);
     if(req.method==='GET'&&p==='/api/huawei/status'){const snap=huaweiSnapshot(),identity=auth.status(s),unidentified=identity.authenticated&&proxiedAdminSources.includes(s.ip)&&!identity.protectedMac;response(res,{...snap,devices:snap.devices.map(d=>identity.protectedMac===d.mac?{...d,administratorProtected:true,canBlock:false,canLimit:false}:unidentified?{...d,canBlock:false,canLimit:false}:d),state:snap.state==='live'&&snap.time&&now()-snap.time>staleMs?'stale':snap.state,lastSuccessAt:snap.time||null,ageSeconds:snap.time?Math.max(0,(now()-snap.time)/1000):null,history,cadenceSeconds:intervalSeconds,controlBusy:busy});return;}
     if(req.method==='GET'&&p==='/api/control/status'){response(res,{...auth.status(s),local:!s.relayed&&local(s.ip),pairingRequiresDevice:Boolean(huawei)&&proxiedAdminSources.length>0});return;}
     if(req.method==='GET'&&p==='/api/control/audit'){auth.authorize(s);response(res,{entries:auditTail.slice(-50).reverse()});return;}
     if(req.method==='POST'&&(p.startsWith('/api/control/')||p==='/api/huawei/connect'||p==='/api/huawei/reconnect')){
       if(req.headers.origin!==new URL('http://'+host).origin||!String(req.headers['content-type']||'').startsWith('application/json'))throw failure('Abra o formulário no próprio ORBIT.',403);
       const v=await input(req);
       if(p==='/api/control/setup'||p==='/api/control/login'){localOnly(s);keys(v,['password']);const result=await auth[p.endsWith('setup')?'setup':'login']({password:v.password,ip:s.ip});response(res,setSession(res,result));return;}
       if(p==='/api/control/pair'){keys(v,['code']);response(res,setSession(res,auth.pair({code:v.code,ip:s.ip})));return;}
       const identity=auth.authorize({...s,write:true});
       if(p==='/api/control/pairing'){
         localOnly(s);keys(v,['protectedMac']);
         if(v.protectedMac!==undefined||(huawei&&proxiedAdminSources.length)){
           const snap=huaweiSnapshot(),mac=String(v.protectedMac||'').toUpperCase(),device=snap.devices.find(d=>d.mac===mac);
           if(!isMac(mac)||snap.state!=='live'||!snap.time||now()-snap.time>staleMs||!device?.online||device.mesh||device.self)throw failure('Selecione um aparelho online para proteger durante a administração pelo celular.',409);
           response(res,auth.issuePairing({...s,protectedMac:mac}));return;
         }
         response(res,auth.issuePairing(s));return;
       }
       if(p==='/api/control/logout'){keys(v,[]);auth.logout(s);res.setHeader('Set-Cookie','orbit_admin=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0');response(res,{loggedOut:true});return;}
       if(!huawei&&['/api/huawei/connect','/api/huawei/reconnect','/api/control/plan','/api/control/commit'].includes(p))throw failure(huaweiSnapshot().error,503);
       if(p==='/api/huawei/connect'){localOnly(s);keys(v,['password']);if(busy)throw failure('Aguarde a operação atual.',409);busy=true;try{await huawei.connect(v.password);response(res,{connected:true,message:'Huawei conectado. Telemetria a cada '+intervalSeconds+' segundos.'});}finally{busy=false;}return;}
       if(p==='/api/huawei/reconnect'){keys(v,[]);if(busy)throw failure('Aguarde a operação atual.',409);busy=true;try{await huawei.reconnect();response(res,{connected:true,message:'Sessão Huawei renovada. Coleta retomada.'});}finally{busy=false;}return;}
       if(p==='/api/control/plan'){
         keys(v,['kind','mac','name','enabled','uploadKbps','downloadKbps','blocked']);
         if(busy)throw failure('Aguarde a operação atual.',409);
         const d=huaweiSnapshot().devices.find(d=>d.mac===String(v.mac).toUpperCase());
         protectAdministrator(s,identity,v);
         const plan=huawei.plan(v,{protectedMac:identity.protectedMac}),id=crypto.randomBytes(24).toString('hex'),expiresAt=now()+60000;
         for(const [k,r]of plans)if(r.expiresAt<now())plans.delete(k);
         if(plans.size>=50)throw failure('Muitas revisões pendentes. Aguarde um minuto.',429);
         plans.set(id,{...plan,input:v,owner:digest(s.token),ip:s.ip,expiresAt});
         response(res,{id,expiresAt,summary:plan.summary,before:plan.before,target:{name:plan.name,mac:plan.mac,ip:d?.ip},note:'A alteração será enviada uma vez e o estado será lido novamente para confirmar.'});return;
       }
       if(p==='/api/control/commit'){
         keys(v,['id','confirm']);const plan=plans.get(v.id);
         if(!plan||plan.expiresAt<now()||plan.owner!==digest(s.token)||plan.ip!==s.ip||v.confirm!==true)throw failure('Revisão expirada ou inválida. Prepare a ação novamente.',409);
         if(busy||now()-lastAction<2000)throw failure('Aguarde a operação anterior.',409);
         plans.delete(v.id);busy=true;lastAction=now();let result;
         try{protectAdministrator(s,identity,plan.input);result=await huawei.execute(plan.input,plan.fingerprint,{protectedMac:identity.protectedMac});await audit({action:plan.kind,target:plan.mac,name:plan.name,summary:plan.summary,before:plan.before,result:'verified',administratorIp:s.ip});response(res,result);}
         catch(error){await audit({action:plan.kind,target:plan.mac,name:plan.name,summary:plan.summary,result:'error',message:clean(error.message),administratorIp:s.ip});throw error;}
         finally{busy=false;}return;
       }
       throw failure('Operação não disponível.',404);
     }
     if(req.method==='GET'&&await sendPanelAsset(res,p,directory,'control'))return;
     if(req.method==='GET'&&['/api/status','/api/history','/api/stream','/metrics'].includes(p)){
       const up=http.get({hostname:'127.0.0.1',port:upstreamPort,path:p+url.search,headers:{Host:'127.0.0.1:'+upstreamPort},timeout:p.endsWith('stream')?0:10000},r=>{res.writeHead(r.statusCode,{'Content-Type':r.headers['content-type']||'application/json'});r.pipe(res);});up.on('timeout',()=>up.destroy());up.on('error',()=>{if(!res.headersSent)response(res,{message:'Coletor MikroTik indisponível.'},503);else res.destroy();});res.on('close',()=>up.destroy());return;
     }
     throw failure('Não encontrado.',404);
   }catch(error){if(!res.headersSent)response(res,{message:clean(error.message)},error.status||error.statusCode||400);else res.destroy();}
 });
 const timer=huawei?setInterval(collect,intervalSeconds*1000):null,heartbeat=huawei?setInterval(()=>{if(!busy&&!polling)huawei.heartbeat().catch(()=>{});},heartbeatSeconds*1000):null;timer?.unref();heartbeat?.unref();
 return {server,relayKey,async start(){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});return server.address();},async close(){clearInterval(timer);clearInterval(heartbeat);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await huawei?.close();}};
}
export async function startConfiguredController({root,dataDir,config}=loadSettings(),{force=false}={}){
 const setup=config.huawei;
 if(!force&&!setup.enabled&&!(config.lan.enabled&&config.monitorHttps.enabled))return null;
 let huawei=null,huaweiError='';
 if(setup.enabled){
   try{
     const sessionStore=setup.persistSession&&typeof process.getuid==='function'?createHuaweiSessionStore({file:path.join(dataDir,'huawei-auth','renewal.json'),origin:new URL(setup.origin).origin,fingerprint:setup.certificateFingerprint||''}):null;
     huawei=createHuaweiClient({...setup,sessionStore});
   }catch{huaweiError='Huawei indisponível. Confira o endereço, a interface de origem e o certificado configurado.';console.error(huaweiError);}
 }
 const controller=await createController({directory:root,dataDir,port:config.lan.controlPort,upstreamPort:config.port,huawei,huaweiError,intervalSeconds:setup.intervalSeconds,heartbeatSeconds:setup.heartbeatSeconds,proxiedAdminSources:config.lan.adminNatSources});
 try{await controller.start();}
 catch(error){await controller.close();throw error;}
 console.log('ORBIT • Administração em http://127.0.0.1:'+config.lan.controlPort+'/#huawei');
 return {...controller,huaweiEnabled:setup.enabled};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const controller=await startConfiguredController(undefined,{force:true});for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void controller.close());}
 catch{console.error('Administração local indisponível. Confira a configuração e a porta de controle.');process.exitCode=1;}
}
