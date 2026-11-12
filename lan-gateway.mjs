import http from 'node:http';
import https from 'node:https';
import { createControlAuth } from './control-auth.mjs';
import { createMonitorGate } from './monitor-gate.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';
import { loadSettings } from './settings.mjs';
import { panelAssetPaths } from './panel-assets.mjs';
import { createSpeedTestService } from './speedtest.mjs';
import { createWanMeasurement, inspectWanSetup } from './wan-speed.mjs';
import { validateCatalog } from './server-selection.mjs';
import { createOoklaMeasurement,inspectOoklaSetup,validateOoklaCatalog } from './ookla.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const safePaths=new Set([...panelAssetPaths,'/api/status','/api/history','/api/stream','/metrics']);
const asV4=value=>String(value||'').replace(/^::ffff:/,'');
const ipNumber=value=>value.split('.').reduce((n,part)=>(n*256+Number(part))>>>0,0);
export function allowedAddress(address,subnets){
  const ip=asV4(address);if(isIP(ip)!==4)return false;
  return subnets.some(cidr=>{const [network,prefix]=cidr.split('/'),bits=Number(prefix);if(isIP(network)!==4||!Number.isInteger(bits)||bits<0||bits>32)return false;const mask=bits===0?0:(0xffffffff<<(32-bits))>>>0;return (ipNumber(ip)&mask)===(ipNumber(network)&mask);});
}
export function createLanGateway({listenAddress,port,additionalPorts=[],upstreamPort=8787,allowedSubnets,hostAliases=[],maxClients=32,speedTest=null,controlPort=8790,controlRelayKey='',tlsOptions=null,monitorGate=null,caCertificate=null}){
  if(isIP(listenAddress)!==4||!Array.isArray(allowedSubnets)||!allowedSubnets.length)throw new Error('Configure o IP IPv4 e as redes permitidas para o ORBIT LAN.');
  const ports=[...new Set([port,...additionalPorts])];
  const hosts=new Set([listenAddress,...hostAliases].flatMap(host=>ports.flatMap(p=>p===(tlsOptions&&p===port?443:80)?[host.toLowerCase(),host.toLowerCase()+':'+p]:[host.toLowerCase()+':'+p])));
  const clients=new Set();let streamRequest=null,retry=null,cache=null,buffer='',stopping=false;
  const agent=new http.Agent({keepAlive:true,maxSockets:8});
  const headers=res=>{res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'");};
  function broadcast(frame){for(const res of clients){if(res.writableLength>2e6){res.destroy();clients.delete(res);}else res.write(frame);}}
  function disconnected(){
    streamRequest=null;buffer='';
    if(stopping)return;
    const sample={status:'error',error:'O coletor deste PC está desconectado. Inicie o ORBIT no PC e autentique no painel local (porta '+upstreamPort+').',credentialsReady:cache?.credentialsReady||false,lastSuccess:cache?.lastSuccess||null};
    cache={...cache,...sample};broadcast('event: sample\ndata: '+JSON.stringify(sample)+'\n\n');
    clearTimeout(retry);retry=setTimeout(connectStream,2000);retry.unref();
  }
  function connectStream(){
    if(stopping||streamRequest)return;
    const request=http.get({hostname:'127.0.0.1',port:upstreamPort,path:'/api/stream',headers:{Host:'127.0.0.1:'+upstreamPort,Accept:'text/event-stream'},timeout:40000},upstream=>{
      if(upstream.statusCode!==200){upstream.resume();request.destroy(new Error('Streaming local indisponível.'));return;}
      upstream.setEncoding('utf8');
      upstream.on('data',chunk=>{
        buffer+=chunk;if(buffer.length>10e6){request.destroy(new Error('Frame excessivo.'));return;}
        let index;
        while((index=buffer.indexOf('\n\n'))!==-1){
          const frame=buffer.slice(0,index);buffer=buffer.slice(index+2);
          const event=frame.match(/^event: (.+)$/m)?.[1],payload=frame.match(/^data: (.+)$/m)?.[1];
          if(payload){try{const value=JSON.parse(payload);if(event==='snapshot')cache=value;else if(event==='connections')cache={...cache,connections:value};else cache={...cache,...value};}catch{request.destroy(new Error('Streaming local inválido.'));return;}}
          broadcast(frame+'\n\n');
        }
      });
      upstream.on('end',()=>request.destroy());upstream.on('error',()=>request.destroy());
    });
    streamRequest=request;request.once('close',disconnected);request.on('error',()=>{});request.on('timeout',()=>request.destroy());
  }
  const handleRequest=async(req,res)=>{
    headers(res);
    if(!allowedAddress(req.socket.remoteAddress,allowedSubnets)||!hosts.has((req.headers.host||'').toLowerCase())){res.writeHead(403);res.end('Acesso permitido somente pelas redes locais configuradas.');return;}
    let url;try{url=new URL(req.url,'http://'+listenAddress);}catch{res.writeHead(400);res.end();return;}
    const scheme=req.socket.encrypted?'https://':'http://';
    if(caCertificate&&req.method==='GET'&&url.pathname==='/orbit-ca.crt'){res.writeHead(200,{'Content-Type':'application/x-x509-ca-cert','Content-Disposition':'attachment; filename="ORBIT-CA.crt"'});res.end(caCertificate);return;}
    if(tlsOptions&&!req.socket.encrypted){if(req.method!=='GET'){res.writeHead(403);res.end('Use HTTPS.');return;}const hostname=new URL('http://'+req.headers.host).hostname;res.writeHead(308,{Location:'https://'+hostname+(port===443?'':':'+port)+url.pathname+url.search});res.end();return;}
    if(monitorGate){try{if(await monitorGate(req,res))return;}catch{res.writeHead(503);res.end('Autenticação do monitor indisponível.');return;}}
    // Credential enrolment is available only behind the authenticated HTTPS
    // monitor. The router account stays confined to the collector process.
    if(monitorGate&&req.socket.encrypted&&url.pathname==='/api/connect'){
      if(req.method!=='POST'||req.headers.origin!==new URL(scheme+req.headers.host).origin||req.headers['sec-fetch-site']==='cross-site'||!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')){res.writeHead(403);res.end();return;}
      let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>4096){res.writeHead(413);res.end();return;}}
      const request=http.request({hostname:'127.0.0.1',port:upstreamPort,path:'/api/connect',method:'POST',timeout:15000,headers:{Host:'127.0.0.1:'+upstreamPort,Origin:'http://127.0.0.1:'+upstreamPort,'Content-Type':'application/json'}},upstream=>{res.writeHead(upstream.statusCode,{'Content-Type':'application/json'});upstream.pipe(res);});request.on('timeout',()=>request.destroy());request.on('error',()=>{if(!res.headersSent){res.writeHead(503);res.end(JSON.stringify({message:'Coletor indisponível.'}));}else res.destroy();});request.end(body);body='';return;
    }
    const controlReads=['/api/huawei/status','/api/control/status','/api/control/audit'],controlWrites=['/api/control/pair','/api/control/logout','/api/control/plan','/api/control/commit','/api/huawei/reconnect'];
    if(controlReads.includes(url.pathname)||controlWrites.includes(url.pathname)){
      const write=controlWrites.includes(url.pathname);
      if(!req.socket.encrypted||!monitorGate||!controlRelayKey||req.method!==(write?'POST':'GET')||req.headers['sec-fetch-site']==='cross-site'||write&&(req.headers.origin!==new URL(scheme+req.headers.host).origin||!String(req.headers['content-type']||'').startsWith('application/json'))){res.writeHead(403);res.end('Acesso administrativo indisponível ou origem inválida.');return;}
      let length=0;
      const request=http.request({hostname:'127.0.0.1',port:controlPort,path:url.pathname,agent,method:req.method,timeout:45000,headers:{Host:'127.0.0.1:'+controlPort,'X-ORBIT-Relay':controlRelayKey,'X-ORBIT-Client':asV4(req.socket.remoteAddress),Cookie:req.headers.cookie||'','X-ORBIT-CSRF':req.headers['x-orbit-csrf']||'',...(write?{Origin:new URL('http://127.0.0.1:'+controlPort).origin,'Content-Type':'application/json'}:{})}},upstream=>{res.statusCode=upstream.statusCode||502;res.setHeader('Content-Type','application/json; charset=utf-8');if(upstream.headers['set-cookie'])res.setHeader('Set-Cookie',upstream.headers['set-cookie'].map(cookie=>req.socket.encrypted?cookie+'; Secure':cookie));upstream.pipe(res);});
      req.on('data',chunk=>{length+=chunk.length;if(length>4096){request.destroy();if(!res.headersSent){res.writeHead(413);res.end();}}else request.write(chunk);});req.on('end',()=>request.end());
      request.on('timeout',()=>request.destroy());request.on('error',()=>{if(!res.headersSent){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({message:'O serviço de controle do PC não respondeu.'}));}else res.destroy();});res.on('close',()=>request.destroy());return;
    }
    if(speedTest&&url.pathname==='/api/speedtest'){
      if(req.method!=='GET'||req.headers['sec-fetch-site']==='cross-site'){res.writeHead(403);res.end();return;}
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(speedTest.snapshot()));return;
    }
    if(speedTest&&['/api/speedtest/start','/api/speedtest/cancel','/api/speedtest/server','/api/speedtest/engine'].includes(url.pathname)){
      const expectedOrigin=new URL(scheme+req.headers.host).origin;
      if(req.method!=='POST'||req.headers.origin!==expectedOrigin||!String(req.headers['content-type']||'').startsWith('application/json')||req.headers['sec-fetch-site']==='cross-site'){res.writeHead(403);res.end('Inicie o teste pelo próprio painel ORBIT.');return;}
      let body='';req.on('data',chunk=>{body+=chunk;if(Buffer.byteLength(body)>256){res.writeHead(413);res.end();req.destroy();}});
      req.on('end',()=>{if(res.writableEnded)return;let input;const serverChoice=url.pathname.endsWith('/server'),engineChoice=url.pathname.endsWith('/engine');try{input=JSON.parse(body);if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>engineChoice?k!=='engineId':k!=='link'&&!(serverChoice&&k==='serverId'))||(input.link!==undefined&&!['all','WAN1','WAN2'].includes(input.link))||(engineChoice&&!['http','ookla'].includes(input.engineId))||(serverChoice&&(!['WAN1','WAN2'].includes(input.link)||typeof input.serverId!=='string'||!/^[a-z0-9-]{1,50}$/.test(input.serverId)))){res.writeHead(400);res.end();return;}}catch{res.writeHead(400);res.end();return;}
        const result=engineChoice?speedTest.setEngine(input.engineId):serverChoice?speedTest.setServer(input.link,input.serverId):url.pathname.endsWith('/start')?speedTest.start('manual',input.link||'all'):{accepted:speedTest.cancel(),message:'Solicitação de cancelamento enviada.'};
        res.writeHead(result.accepted?202:409,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(result));
      });return;
    }
    if(req.method!=='GET'){res.writeHead(405,{'Allow':'GET'});res.end('Este acesso permite somente visualizar o painel.');return;}
    if(!safePaths.has(url.pathname)){res.writeHead(404);res.end();return;}
    if(url.pathname.startsWith('/api/')&&req.headers['sec-fetch-site']==='cross-site'){res.writeHead(403);res.end();return;}
    if(url.pathname==='/api/stream'){
      if(clients.size>=maxClients){res.writeHead(429);res.end('Limite de visualizadores atingido.');return;}
      res.writeHead(200,{'Content-Type':'text/event-stream','Connection':'keep-alive','X-Accel-Buffering':'no'});res.write('retry: 2000\n\n');clients.add(res);
      if(cache)res.write('event: snapshot\ndata: '+JSON.stringify(cache)+'\n\n');
      const expiry=req.monitorExpiresAt?setTimeout(()=>res.end(),Math.max(1,req.monitorExpiresAt-Date.now())):null;expiry?.unref();req.on('close',()=>{clearTimeout(expiry);clients.delete(res);});return;
    }
    const request=http.get({hostname:'127.0.0.1',port:upstreamPort,path:url.pathname+url.search,agent,headers:{Host:'127.0.0.1:'+upstreamPort},timeout:10000},upstream=>{
      res.statusCode=upstream.statusCode||502;res.setHeader('Content-Type',upstream.headers['content-type']||'text/plain; charset=utf-8');
      if(url.pathname==='/'){
        let html='';upstream.setEncoding('utf8');upstream.on('data',chunk=>{html+=chunk;if(html.length>1e6)request.destroy();});
        upstream.on('end',()=>res.end(html.replace('name="orbit-role" content="monitor"','name="orbit-role" content="lan"').replace('</header>',monitorGate?'<form method="post" action="/api/monitor/logout"><button>Sair do monitor</button></form></header>':'</header>')));
      }else upstream.pipe(res);
      upstream.on('error',()=>res.destroy());
    });
    request.on('timeout',()=>request.destroy(new Error('Tempo limite do coletor.')));
    request.on('error',()=>{if(!res.headersSent){res.writeHead(503,{'Content-Type':'text/plain; charset=utf-8'});res.end('O coletor local não respondeu. Inicie o ORBIT neste PC.');}else res.destroy();});
    res.on('close',()=>request.destroy());
  };
  const server=tlsOptions?https.createServer(tlsOptions,handleRequest):http.createServer(handleRequest),compatibilityServers=ports.slice(1).map(p=>({port:p,server:http.createServer(handleRequest)}));
  const heartbeat=setInterval(()=>broadcast(': heartbeat\n\n'),15000);heartbeat.unref();
  return {server,snapshot:()=>cache,
    async start(){
      const listen=(target,p)=>new Promise((resolve,reject)=>{target.once('error',reject);target.listen(p,listenAddress,()=>{target.removeListener('error',reject);resolve();});});
      await listen(server,port);
      for(const item of compatibilityServers){try{await listen(item.server,item.port);}catch(error){if(error.code!=='EADDRINUSE'){await this.close();throw error;}console.log('ORBIT LAN: porta complementar '+item.port+' ocupada. A porta principal continua ativa.');}}
      connectStream();return server.address();
    },
    async close(){stopping=true;clearTimeout(retry);clearInterval(heartbeat);streamRequest?.destroy();agent.destroy();for(const client of clients)client.end();clients.clear();await speedTest?.close();await Promise.all([server,...compatibilityServers.map(item=>item.server)].map(target=>new Promise(resolve=>{target.closeIdleConnections();target.close(resolve);})));}
  };
}
export async function startConfiguredLanGateway({root,config,dataDir}=loadSettings(),{controlRelayKey}={}){
  if(!config.lan.enabled)return null;
  const port=config.lan.port,tls=config.monitorHttps;
  let protection={};
  if(tls.enabled){
    try{
      protection={
        tlsOptions:{key:fs.readFileSync(tls.keyFile),cert:fs.readFileSync(tls.certFile),minVersion:'TLSv1.2'},
        caCertificate:tls.caFile?fs.readFileSync(tls.caFile):null,
        monitorGate:createMonitorGate({auth:await createControlAuth({root,dataDir,remoteAllowed:true,allowPasswordLogin:true,sessionTtlMs:tls.sessionSeconds*1000})})
      };
    }catch{throw new Error('Gateway HTTPS indisponível. Confira os certificados, a chave TLS e o armazenamento da autenticação.');}
  }
  if(controlRelayKey===undefined)try{controlRelayKey=fs.readFileSync(path.join(dataDir,'control-relay.key'),'utf8');}catch{controlRelayKey='';}
  let gateway,speedTest=null;
  const speed=config.speedTest,profiles=speed.profiles,getRouterSnapshot=()=>gateway?.snapshot();
  if(speed.enabled)try{
    const catalog=validateCatalog(JSON.parse(fs.readFileSync(speed.catalogFile,'utf8')));
    const engines=[{id:'http',name:'ORBIT / HTTP',catalog,profileStatus:p=>inspectWanSetup(getRouterSnapshot(),p),runMeasurement:createWanMeasurement({profiles,getRouterSnapshot,catalog})}];
    if(speed.ookla.enabled&&profiles.length)try{
      const native= speed.ookla, nativeCatalog=validateOoklaCatalog(JSON.parse(fs.readFileSync(native.catalogFile,'utf8')));
      engines.push({id:'ookla',name:'Speedtest by Ookla / oficial',catalog:nativeCatalog,timeoutSeconds:180,
        profileStatus:p=>fs.existsSync(native.binaryPath)?inspectOoklaSetup(getRouterSnapshot(),p,nativeCatalog):{configured:false,ready:false,reason:'Cliente oficial Ookla indisponível no host coletor.'},
        runMeasurement:createOoklaMeasurement({profiles,catalog:nativeCatalog,binary:native.binaryPath,sourceIp:native.sourceIp||config.lan.listenAddress,getRouterSnapshot})});
    }catch{console.error('Ookla indisponível. Confira o catálogo e os perfis WAN.');}
    speedTest=createSpeedTestService({root,dataDir,catalog,profiles,cooldownSeconds:speed.cooldownSeconds,automaticIntervalSeconds:speed.automaticIntervalSeconds,retentionDays:speed.retentionDays,...(profiles.length?{engines}:{})});
  }catch{console.error('Medição de velocidade indisponível. Confira o catálogo e os perfis configurados.');}
  try{
    gateway=createLanGateway({...config.lan,...protection,port,upstreamPort:config.port,speedTest,controlRelayKey});
    await gateway.start();
  }catch(error){
    if(gateway)await gateway.close();else await speedTest?.close();
    throw new Error(error.code==='EADDRINUSE'?'Gateway LAN indisponível. Porta em uso.':'Gateway LAN indisponível. Confira o endereço, as portas e os certificados configurados.');
  }
  const host=config.lan.hostAliases[0]||(config.lan.listenAddress==='0.0.0.0'?null:config.lan.listenAddress);
  const url=host?new URL((tls.enabled?'https://':'http://')+host+':'+port+'/').href:null;
  console.log('ORBIT • Gateway de rede '+(url?'em '+url:'ativo na porta '+port));
  return {...gateway,url,speedTestEnabled:Boolean(speedTest)};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const gateway=await startConfiguredLanGateway();if(gateway)for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void gateway.close());}
  catch(error){console.error(error.message);process.exitCode=1;}
}
