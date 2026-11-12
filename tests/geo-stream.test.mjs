import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {createLanGateway} from '../lan-gateway.mjs';
import {createMonitorGate} from '../monitor-gate.mjs';

test('existing LAN authentication protects Geo snapshots and SSE, relays geo events and caches them for new viewers',async t=>{
  const geo={state:'live',time:1000,rows:[{ip:'8.8.8.8',source:{ip:'10.231.2.45',label:'Huawei AX3 — dispositivos internos agregados'}}],history:[]};
  const upstreamClients=new Set();const upstream=http.createServer((req,res)=>{
    if(req.url==='/api/stream'){res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('event: snapshot\ndata: '+JSON.stringify({geoConnections:{...geo,rows:[]}})+'\n\n');upstreamClients.add(res);req.on('close',()=>upstreamClients.delete(res));return;}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({geoConnections:geo}));
  });upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  const gate=createMonitorGate({auth:{status:({token})=>({authenticated:token==='synthetic-token',expiresAt:Date.now()+60000})}});
  const gateway=createLanGateway({listenAddress:'127.0.0.1',port:0,upstreamPort:upstream.address().port,allowedSubnets:['127.0.0.1/32'],monitorGate:gate});
  const address=await gateway.start();
  t.after(async()=>{await gateway.close();for(const client of upstreamClients)client.end();await new Promise(resolve=>upstream.close(resolve));});
  const get=(route,authenticated=false,site)=>new Promise((resolve,reject)=>{
    http.get({hostname:'127.0.0.1',port:address.port,path:route,headers:{Host:'127.0.0.1:0',...(authenticated?{Cookie:'__Host-orbit_monitor=synthetic-token'}:{}),...(site?{'sec-fetch-site':site}:{})}},res=>{let body='';res.setEncoding('utf8');res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,body,csp:res.headers['content-security-policy']}));}).on('error',reject);
  });
  for(const route of ['/api/status','/api/stream']){const result=await get(route);assert.equal(result.status,401);assert.ok(!result.body.includes('8.8.8.8'));}
  const status=await get('/api/status',true);assert.equal(status.status,200);assert.equal(JSON.parse(status.body).geoConnections.rows[0].ip,'8.8.8.8');assert.ok(status.csp.includes("connect-src 'self'"));
  assert.equal((await get('/api/status',true,'cross-site')).status,403);
  // Wait only for the synthetic upstream stream to connect.
  for(let i=0;i<100&&!upstreamClients.size;i++)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(upstreamClients.size,1);
  const stream=http.get({hostname:'127.0.0.1',port:address.port,path:'/api/stream',headers:{Host:'127.0.0.1:0',Cookie:'__Host-orbit_monitor=synthetic-token'}});
  const [response]=await once(stream,'response');assert.equal(response.statusCode,200);response.setEncoding('utf8');
  const received=new Promise((resolve,reject)=>{let buffer='';const timer=setTimeout(()=>reject(new Error('Missing Geo SSE event')),2000);response.on('data',chunk=>{buffer+=chunk;if(buffer.includes('event: geo\n')&&buffer.includes('8.8.8.8')){clearTimeout(timer);resolve(buffer);}});});
  for(const client of upstreamClients)client.write('event: geo\ndata: '+JSON.stringify({geoConnections:geo})+'\n\n');
  await received;stream.destroy();response.destroy();
  assert.equal(gateway.snapshot().geoConnections.rows[0].ip,'8.8.8.8');
  // A new stream gets the updated Geo payload in the cached snapshot.
  const second=http.get({hostname:'127.0.0.1',port:address.port,path:'/api/stream',headers:{Host:'127.0.0.1:0',Cookie:'__Host-orbit_monitor=synthetic-token'}});
  const [secondResponse]=await once(second,'response');secondResponse.setEncoding('utf8');
  const [chunk]=await once(secondResponse,'data');let snapshot=chunk;if(!snapshot.includes('8.8.8.8')){const [more]=await once(secondResponse,'data');snapshot+=more;}assert.ok(snapshot.includes('8.8.8.8'));second.destroy();secondResponse.destroy();
});
