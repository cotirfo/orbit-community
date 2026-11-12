// Local review fixture only. Never imports runtime/server, config.json, credentials,
// RouterOS, Huawei transports or the Tuya reader. All values are synthetic.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {publicEnergyModel} from '../energy-collector.mjs';
import {emptyScenario,estimateAutonomy} from '../public/energy-model.mjs';
import {dayKey} from '../energy-metrics.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const configured=process.argv.includes('--configured'),stale=process.argv.includes('--stale'),disabled=process.argv.includes('--disabled');
const scenario=factor=>({...emptyScenario(),basis:'FIXTURE SINTÉTICA para validação visual; não usar como especificação',batteries:[10,30].map(ah=>({ah,health:factor,usableDischarge:.8,stateOfCharge:1,temperatureFactor:1,peukertExponent:1.1,referenceHours:20})),efficiencyCurve:[{watts:0,efficiency:.7},{watts:250,efficiency:.86},{watts:500,efficiency:.82}]});
const model=publicEnergyModel(configured?{calibration:{inputToOutputEfficiency:.9,chargingWatts:0,idleInputWatts:5,basis:'FIXTURE SINTÉTICA'},scenarios:{conservative:scenario(.6),nominal:scenario(.8),optimistic:scenario(1)}}:{});
const clients=new Set();let snapshot;
function update(){const time=Date.now()-(stale?120000:0),lastValid={time,watts:46.3,amps:.557,volts:116.5,relay:true},today=dayKey(Date.now());
  const history=Array.from({length:121},(_,i)=>({time:time-(120-i)*60000,watts:40+6*Math.sin(i/6),dayWh:i*40/60,connected:true}));
  const daily=Array.from({length:7},(_,i)=>{const date=new Date(Date.now()-(6-i)*86400000);return {date:dayKey(date),wh:800+i*10,kwh:.8+i*.01,averageWatts:40+i,observedSeconds:72000};});
  const consumption={timezone:'America/Sao_Paulo',startedAt:time-6*86400000,lastValid,totalWh:6000,totalKwh:6,todayWh:daily.at(-1).wh,monthWh:6000,weekWh:3500,history,daily,monthly:[{month:today.slice(0,7),wh:6000,kwh:6}],retentionDays:7,averages:Object.fromEntries([60,1440,10080].map(m=>[m,{watts:42,seconds:m*60}]))};
  const energy=disabled?{enabled:false,state:'disabled'}:{enabled:true,state:stale?'unavailable':'online',fresh:!stale,lastSuccess:time,lastValid,staleSeconds:30,consumption,model,estimate:{...estimateAutonomy(lastValid.watts,model),historical:stale,basedAt:time},events:[{time,state:stale?'unavailable':'online',message:'Fixture sintética; nenhum dispositivo conectado.'}]};
  snapshot={status:'pending',error:'PRÉVIA SINTÉTICA — nenhum dispositivo conectado.',credentialsReady:false,latest:null,details:{},inventory:{links:[]},wan:{WAN1:'ether1',WAN2:'ether5'},connections:{state:'pending',rows:[]},history:[],flowHistory:[],energy};
  for(const client of clients)client.write('event: snapshot\ndata: '+JSON.stringify(snapshot)+'\n\n');
}
update();const timer=setInterval(update,10000);timer.unref();
const server=http.createServer((req,res)=>{const route=new URL(req.url,'http://localhost').pathname;res.setHeader('Cache-Control','no-store');
  if(route==='/api/status'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(snapshot));return;}
  if(route==='/api/stream'){res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('event: snapshot\ndata: '+JSON.stringify(snapshot)+'\n\n');clients.add(res);req.on('close',()=>clients.delete(res));return;}
  if(route==='/api/huawei/status'||route==='/api/control/status'){res.setHeader('Content-Type','application/json');res.end('{"state":"pending","authenticated":false,"configured":true}');return;}
  const file={'/':'index.html','/style.css':'style.css','/infrastructure.js':'infrastructure.js'}[route];if(!file){res.writeHead(404);res.end('{}');return;}
  res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':'text/javascript');
  if(file==='index.html'){res.end(fs.readFileSync(path.join(root,'public',file),'utf8').replace('<body>','<body><div style="position:fixed;top:0;left:0;right:0;text-align:center;z-index:99;background:#664711;color:white;padding:5px;pointer-events:none">PRÉVIA SINTÉTICA · SEM DISPOSITIVOS</div>'));return;}
  fs.createReadStream(path.join(root,'public',file)).pipe(res);
});
server.listen(18991,'127.0.0.1',()=>console.log('Synthetic energy preview: http://127.0.0.1:18991/#energy'));
process.once('SIGINT',()=>{clearInterval(timer);for(const client of clients)client.end();server.close();});
