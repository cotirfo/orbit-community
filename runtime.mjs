import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deviceOrigin,loadSettings,localHostHeader } from './settings.mjs';
import { sendPanelAsset } from './panel-assets.mjs';
import { X509Certificate } from 'node:crypto';
import { createCollector } from './collector.mjs';
import { createCollectorSecret } from './collector-secret.mjs';
import { createHostMetrics } from './host-metrics.mjs';
import { createEnergyCollector } from './energy-collector.mjs';
export async function startRuntime({root,config,inventory,dataDir}=loadSettings()){
const hostMetrics=createHostMetrics();
const panel={localPort:config.port,controlPort:config.lan.controlPort,controlEnabled:false,huaweiEnabled:false,lanUrl:null,speedTestEnabled:false,lanInterface:config.lanInterface??null,routerReady:false};
let ca,routerOrigin,routerError='';
if(config.routerOS.enabled){
  try{
    routerOrigin=deviceOrigin(config.routerUrl,['https:'],'routerUrl');
    const fingerprint=config.caFingerprint?.replace(/:/g,'').toLowerCase();
    if(!/^[a-f0-9]{64}$/.test(fingerprint??''))throw new Error('Configure a CA e o SHA-256 do RouterOS.');
    ca=fs.readFileSync(config.caFile);const cert=new X509Certificate(ca);
    if(!cert.ca||cert.fingerprint256.replace(/:/g,'').toLowerCase()!==fingerprint||Date.now()<Date.parse(cert.validFrom)||Date.now()>Date.parse(cert.validTo))throw new Error('CA inválida.');
    panel.routerReady=true;
  }catch{routerError='RouterOS indisponível. Confira a URL HTTPS, o arquivo da CA, sua validade e o SHA-256 configurado.';}
}
const secretStore=panel.routerReady&&config.persistCollector&&typeof process.getuid==='function'?createCollectorSecret({directory:path.join(dataDir,'collector-auth'),keyFile:config.routerOS.credentialKeyFile,identity:config.routerUrl+'|'+config.caFingerprint,user:config.routerOS.user}):null;
let credentials=process.env.MIKROTIK_PASSWORD&&(!process.env.MIKROTIK_USER||process.env.MIKROTIK_USER===config.routerOS.user)?{user:config.routerOS.user,password:process.env.MIKROTIK_PASSWORD}:null;
let credentialStored=false,credentialStorageError=panel.routerReady&&config.persistCollector&&!secretStore?'O armazenamento criptografado do coletor exige permissões POSIX. A sessão pode ser mantida em memória.':'';
if(!credentials)try{const saved=secretStore?.load();if(saved){credentials=saved;credentialStored=true;}}catch{credentialStorageError='Credencial salva indisponível. Cadastre a conta de leitura novamente no formulário local.';}
let energy;
const decorate=value=>({...value,panel,host:hostMetrics.snapshot(),energy:energy?.snapshot(),collectorAuthentication:{stored:credentialStored,storageError:credentialStorageError}});
const agent=panel.routerReady?new https.Agent({keepAlive:true,maxSockets:1,timeout:config.routerOS.timeoutMs}):null;
let chain=Promise.resolve(),queued=0,connecting=false,collector;
const clients=new Set(),stats=new Map();
function performance(){return {queue:queued,streams:clients.size,endpoints:[...stats.values()].map(r=>({...r,averageMs:r.times.length?r.times.reduce((a,b)=>a+b,0)/r.times.length:null,p95Ms:r.times.length?[...r.times].sort((a,b)=>a-b)[Math.ceil(r.times.length*.95)-1]:null,times:undefined}))};}
function emit(event,value){const text='event: '+event+'\ndata: '+JSON.stringify(['sample','snapshot'].includes(event)?decorate(value):value)+'\n\n';for(const res of clients){if(res.writableLength>2e6){res.destroy();clients.delete(res);continue;}res.write(text);}}
const hostTimer=setInterval(()=>emit('sample',{}),5000);hostTimer.unref();
function request(route,body,login){
  if(queued>8)return Promise.reject(new Error('Fila REST ocupada. Aguarde a próxima rodada.'));
  queued++;
  const job=chain.then(()=>new Promise((resolve,reject)=>{
    const {user,password}=login||credentials||{};
    if(!user||!password){reject(new Error('Autenticação necessária.'));return;}
    const url=new URL('/rest/'+route,routerOrigin);
    const payload=body===undefined?undefined:JSON.stringify(body),started=Date.now();
    let completed=false;
    const finish=(err,value)=>{
      if(completed)return;completed=true;
      const elapsed=Date.now()-started,entry=stats.get(route)||{route,success:0,failures:0,times:[]};
      entry.times.push(elapsed);if(entry.times.length>60)entry.times.shift();entry.lastMs=elapsed;entry.time=Date.now();entry.error=err?.message||'';entry[err?'failures':'success']++;stats.set(route,entry);
      if(err?.status===401&&!login){credentials=null;if(credentialStored)try{secretStore?.clear();}catch{}credentialStored=false;collector?.authenticationFailed('O MikroTik recusou a credencial. Confira a conta de leitura no painel local.');}
      err?reject(err):resolve(value);
    };
    const req=https.request(url,{agent,ca,auth:user+':'+password,method:payload?'POST':'GET',timeout:config.routerOS.timeoutMs,
      headers:payload?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}:{}},res=>{
      const chunks=[];let length=0;
      res.on('data',chunk=>{length+=chunk.length;if(length>8e6)req.destroy(new Error('Resposta REST acima de 8 MB; cobertura não disponível nesta rodada.'));else chunks.push(chunk);});
      res.on('error',err=>finish(err));
      res.on('end',()=>{
        if(res.statusCode!==200){const err=new Error('RouterOS HTTP '+res.statusCode+'.');err.status=res.statusCode;finish(err);return;}
        let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{finish(new Error('Resposta JSON inválida do RouterOS.'));return;}
        finish(null,value);
      });
    });
    req.on('timeout',()=>req.destroy(new Error('Tempo limite na consulta REST.')));
    req.on('error',error=>{const err=new Error(error.message==='Tempo limite na consulta REST.'?error.message:error.code==='ECONNREFUSED'?'Conexão HTTPS recusada pelo RouterOS.':'Falha de comunicação HTTPS com o RouterOS.');err.code=error.code;finish(err);});req.end(payload);
  }));
  chain=job.catch(()=>{});return job.finally(()=>{queued--;});
}
const collectorOptions={root,dataDir,config,inventory,request,emit,performance,isAuthorized:()=>Boolean(credentials),enabled:panel.routerReady,unavailableReason:routerError};
try{collector=createCollector(collectorOptions);}
catch{panel.routerReady=false;collector=createCollector({...collectorOptions,enabled:false,unavailableReason:'Armazenamento do coletor indisponível. Confira o diretório de dados e suas permissões.'});}
energy=await createEnergyCollector({root,dataDir,config:config.energy,retentionDays:config.retentionDays,emit});
energy.start();
function json(res,code,value){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));}
let failedLogins=[];
async function connect(req,res,host){
  if(!panel.routerReady)return json(res,503,{message:collector.snapshot().error});
  if(req.headers.origin!==new URL('http://'+host).origin||(req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin'))return json(res,403,{message:'Origem não permitida. Abra o painel local.'});
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return json(res,415,{message:'Envie JSON.'});
  if(connecting||credentials)return json(res,409,{message:'Já existe uma sessão conectada.'});
  failedLogins=failedLogins.filter(t=>t>Date.now()-60000);if(failedLogins.length>=3)return json(res,429,{message:'Três tentativas recusadas. Aguarde um minuto e confira a conta antes de repetir.'});
  connecting=true;
  try{
    let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>4096)return json(res,413,{message:'Dados excessivos.'});}
    let input;try{input=JSON.parse(body);}catch{return json(res,400,{message:'Dados inválidos.'});}body='';
    if(input?.user!==config.routerOS.user||typeof input.password!=='string'||!input.password||input.password.length>512)return json(res,400,{message:'Informe a conta de leitura configurada e a senha definida no MikroTik.'});
    await request('system/resource',undefined,input);
    if(secretStore){try{secretStore.save(input);credentialStored=true;credentialStorageError='';}catch{input.password='';return json(res,503,{message:'Login validado, mas não foi possível salvar a credencial com segurança. Verifique a chave do serviço no Debian.'});}}
    credentials={user:input.user,password:input.password};input.password='';failedLogins=[];
    collector.stop();collector.start();json(res,200,{message:credentialStored?'Coleta ativa. Reconexão automática salva com criptografia no Debian.':'Conectado. Streaming de telemetria iniciado.'});
  }catch(e){if(e.status===401)failedLogins.push(Date.now());json(res,502,{message:e.status===401?'Login recusado pelo MikroTik. Confira senha, conta habilitada, endereço permitido e grupo read,api,rest-api.':e.code==='ECONNREFUSED'?'A conexão foi recusada. Confira a porta HTTPS configurada no MikroTik.':'Não foi possível validar a conta de leitura no RouterOS.'});}
  finally{connecting=false;}
}
const server=http.createServer((req,res)=>{
  const host=req.headers.host||'';if(!localHostHeader(host.toLowerCase(),config.port)){res.writeHead(403);res.end();return;}
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'");
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/connect'&&req.method==='POST'){void connect(req,res,host);return;}
  if(url.pathname==='/api/reload'&&req.method==='POST'){
    if(req.headers.origin!==new URL('http://'+host).origin)return json(res,403,{message:'Origem não permitida.'});
    if(!panel.routerReady)return json(res,503,{message:'Coletor RouterOS indisponível.'});
    void(async()=>{try{collector.stop();await chain;const updated=await import('./collector.mjs?version='+Date.now());collector=updated.createCollector(collectorOptions);if(credentials)collector.start();emit('snapshot',{...collector.snapshot(),history:undefined});json(res,200,{message:'Coletor atualizado; sessão mantida em memória.'});}catch(e){json(res,500,{message:'Não foi possível recarregar o coletor.'});}})();return;
  }
  if(req.method!=='GET'){res.writeHead(405);res.end();return;}
  const minutes=Math.max(1,Math.min(1440,Number(url.searchParams.get('minutes'))||60));
  if(url.pathname==='/api/status')return json(res,200,decorate(collector.snapshot(minutes)));
  if(url.pathname==='/api/history')return json(res,200,{history:collector.history(minutes)});
  if(url.pathname==='/api/stream'){
    if(clients.size>=8)return json(res,429,{message:'Limite de abas em streaming atingido.'});
    res.writeHead(200,{'Content-Type':'text/event-stream','Connection':'keep-alive','X-Accel-Buffering':'no'});res.write('retry: 2000\n\n');clients.add(res);
    res.write('event: snapshot\ndata: '+JSON.stringify(decorate({...collector.snapshot(),history:undefined}))+'\n\n');
    const heartbeat=setInterval(()=>res.write(': heartbeat\n\n'),15000);heartbeat.unref();req.on('close',()=>{clearInterval(heartbeat);clients.delete(res);});return;
  }
  if(url.pathname==='/metrics'){
    const s=collector.snapshot(1),lines=['# TYPE mikrotik_collector_up gauge','mikrotik_collector_up '+(s.status==='live'?1:0)];
    if(s.status==='live'&&s.latest){for(const [name,value]of [['cpu_percent',s.latest.cpu],['memory_percent',s.latest.memoryPercent],['temperature_celsius',s.latest.temperature]])if(value!==null&&value!==undefined)lines.push('mikrotik_'+name+' '+value);
      for(const i of s.latest.interfaces){const label='{interface='+JSON.stringify(i.name)+'}';for(const [name,value]of [['receive_bytes_total',i.rxBytes],['transmit_bytes_total',i.txBytes],['rx_packets_per_second',i.rxPps],['tx_packets_per_second',i.txPps],['tx_queue_drops_per_second',i.dropPps]])if(value!==null&&value!==undefined)lines.push('mikrotik_interface_'+name+label+' '+value);}}
    if(s.connections.state==='live')lines.push('mikrotik_connections '+s.connections.count);res.writeHead(200,{'Content-Type':'text/plain; version=0.0.4'});res.end(lines.join('\n')+'\n');return;
  }
  void sendPanelAsset(res,url.pathname,root).then(found=>{if(!found){res.writeHead(404);res.end();}});
});
let closed=false;
async function close(){
  if(closed)return;closed=true;clearInterval(hostTimer);collector.stop();agent?.destroy();
  for(const res of clients)res.end();
  const stopped=new Promise(resolve=>server.close(resolve));server.closeAllConnections();
  await Promise.all([energy.stop(),stopped]);
}
try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.port,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
}catch(error){await close();throw new Error('Não foi possível abrir a porta local do painel ('+(error.code||'erro de rede')+').');}
if(panel.routerReady&&credentials)collector.start();
console.log('ORBIT • Painel local em http://127.0.0.1:'+config.port+'/');
if(routerError)console.error(routerError);
return {panel,close};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const app=await startRuntime();for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void app.close());}
  catch(error){console.error(error.message);process.exitCode=1;}
}
