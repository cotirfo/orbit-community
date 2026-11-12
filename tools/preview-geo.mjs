// Isolated UI fixture. Never imports runtime/server or accesses configured devices.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createGeoConnections} from '../geo-connections.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pending=process.argv.includes('--pending'),stale=process.argv.includes('--stale');
const sampleRows=[{source:'10.231.2.45',destination:'8.8.8.8',destinationPort:443,protocol:'tcp',wan:'WAN1'},
  {source:'10.231.2.45',destination:'8.8.8.8',destinationPort:443,protocol:'tcp',wan:'WAN1'},
  {source:'192.168.88.20',destination:'1.1.1.1',destinationPort:53,protocol:'udp',wan:'WAN2'},
  {source:'192.168.88.20',destination:'2001:4860:4860::8888',destinationPort:443,protocol:'tcp',wan:null},
  {source:'10.231.2.45',destination:'9.9.9.9',destinationPort:443,protocol:'tcp',wan:'WAN1'}];
if(process.argv.includes('--dense'))for(let i=1;i<=120;i++)sampleRows.push({source:i%2?'10.231.2.45':'192.168.88.20',destination:'45.1.0.'+i,destinationPort:i%3?443:53,protocol:i%3?'tcp':'udp',wan:i%2?'WAN1':'WAN2'});
const provider={status:async()=>({city:{state:pending?'pending':'ready'},asn:{state:pending?'pending':'ready'}}),lookup:async ip=>pending?{state:'pending'}:ip==='9.9.9.9'?{state:'unavailable'}:{state:'available',country:ip==='1.1.1.1'?'País sintético B':'País sintético A',countryCode:ip==='1.1.1.1'?'GB':'BR',city:'Fixture sem localização real',region:'Região sintética',latitude:ip==='1.1.1.1'?50:-10,longitude:ip==='1.1.1.1'?0:-40,asn:ip==='1.1.1.1'?64501:64500,organization:'Provedor de teste',approximate:true}};
const geo=createGeoConnections({root,config:{huaweiNatAddress:"10.231.2.45"},provider});
const originalLookup=provider.lookup;provider.lookup=async ip=>{if(!ip.startsWith('45.1.0.'))return originalLookup(ip);if(pending)return {state:'pending'};const index=Number(ip.split('.').at(-1));return {state:'available',country:'País sintético '+index%12,countryCode:'X'+index%12,city:'Fixture de teste',region:'Região sintética',latitude:index%3===0?40:index%3===1?-20:50,longitude:index%3===0?-95:index%3===1?-40:8,asn:64500+index%20,organization:'Provedor sintético '+index%20,accuracyRadiusKm:20,approximate:true};};
const clients=new Set();let snapshot;
async function update(){
  const time=Date.now()-(stale?120000:0),connections={state:'live',time,count:sampleRows.length,rows:sampleRows.map((r,i)=>({...r,id:String(i),state:'established',protocol:r.protocol})),protocols:[],sources:[],destinations:[]};
  const details={ipv6Connections:{state:'live',count:1,time}};
  snapshot={status:'live',error:'PREVIEW SINTÉTICO — nenhuma conexão com roteadores; localizações de fixture.',credentialsReady:true,lastSuccess:time,cadence:{interfaces:2,connections:5,details:30},latest:{time,cpu:1,memoryPercent:10,interfaces:[],model:'FIXTURE',architecture:'TEST'},wan:{WAN1:'ether1',WAN2:'ether5'},inventory:{links:[]},details,connections,geoConnections:await geo.observe(connections,details),history:[],flowHistory:[]};
  for(const res of clients)res.write('event: snapshot\ndata: '+JSON.stringify(snapshot)+'\n\n');
}
await update();const timer=setInterval(update,5000);timer.unref();
const files={'/':'index.html','/style.css':'style.css','/infrastructure.js':'infrastructure.js'};
const server=http.createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/api/status'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(snapshot));return;}
  if(pathname==='/api/stream'){res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('event: snapshot\ndata: '+JSON.stringify(snapshot)+'\n\n');clients.add(res);req.on('close',()=>clients.delete(res));return;}
  if(pathname==='/api/huawei/status'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({state:'live',time:Date.now(),devices:[{ip:'192.168.3.10',name:'Cliente sintético Huawei',online:true}],metadata:{},history:[]}));return;}
  if(pathname==='/api/control/status'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({authenticated:false,configured:true}));return;}
  if(pathname.startsWith('/api/')){res.writeHead(404,{'Content-Type':'application/json'});res.end('{}');return;}
  const file=files[pathname];if(!file){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript');fs.createReadStream(path.join(root,'public',file)).pipe(res);
});
server.listen(18990,'127.0.0.1',()=>console.log('Synthetic Geo preview: http://127.0.0.1:18990/#geo-connections'));
process.once('SIGINT',()=>{clearInterval(timer);for(const client of clients)client.end();server.close();});
