import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {createLanGateway} from '../lan-gateway.mjs';
import {createMonitorGate} from '../monitor-gate.mjs';

test('existing monitor authentication protects energy API and SSE; relay caches independent energy events',async t=>{
  let upstreamStream;
  const upstream=http.createServer((req,res)=>{
    if(req.url==='/api/stream'){upstreamStream=res;res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('event: snapshot\ndata: {"status":"pending","energy":{"state":"pending"}}\n\n');return;}
    res.setHeader('Content-Type','application/json');res.end('{"energy":{"enabled":true,"state":"online","lastValid":{"watts":46.3}}}');
  });upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  const monitorGate=createMonitorGate({auth:{status:({token})=>({authenticated:token==='fixture',expiresAt:Date.now()+60000})}});
  const gateway=createLanGateway({listenAddress:'127.0.0.1',port:0,upstreamPort:upstream.address().port,allowedSubnets:['127.0.0.1/32'],monitorGate});const address=await gateway.start();
  t.after(async()=>{await gateway.close();upstreamStream?.end();upstream.closeAllConnections();await new Promise(resolve=>upstream.close(resolve));});
  function request(route,authenticated){return http.get({hostname:'127.0.0.1',port:address.port,path:route,headers:{Host:'127.0.0.1:0',...(authenticated?{Cookie:'__Host-orbit_monitor=fixture'}:{})}});}
  for(const route of ['/api/status','/api/stream']){const req=request(route,false);const [res]=await once(req,'response');assert.equal(res.statusCode,401);res.resume();await once(res,'end');}
  const req=request('/api/status',true),[res]=await once(req,'response');assert.equal(res.statusCode,200);let body='';for await(const chunk of res)body+=chunk;assert.equal(JSON.parse(body).energy.lastValid.watts,46.3);
  for(let i=0;i<100&&!upstreamStream;i++)await new Promise(resolve=>setTimeout(resolve,5));assert.ok(upstreamStream);
  const live=request('/api/stream',true),[stream]=await once(live,'response');stream.setEncoding('utf8');
  const received=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Energy SSE missing')),2000);stream.on('data',chunk=>{if(chunk.includes('event: energy\n')){clearTimeout(timer);resolve(chunk);}});});
  upstreamStream.write('event: energy\ndata: {"energy":{"state":"online","lastValid":{"watts":46.3}}}\n\n');
  assert.ok((await received).includes('46.3'));assert.equal(gateway.snapshot().status,'pending');assert.equal(gateway.snapshot().energy.state,'online');live.destroy();stream.destroy();
  const next=request('/api/stream',true),[nextStream]=await once(next,'response');nextStream.setEncoding('utf8');let snapshot='';for await(const chunk of nextStream){snapshot+=chunk;if(snapshot.includes('46.3'))break;}assert.ok(snapshot.includes('46.3'));next.destroy();nextStream.destroy();
});
