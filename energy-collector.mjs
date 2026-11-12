import path from 'node:path';
import {createEnergyMetrics,decodeDps} from './energy-metrics.mjs';
import {createTuyaReader} from './tuya-reader.mjs';
import {emptyScenario,estimateAutonomy,configuredUPS,SIMPLE_DEFAULTS,PROTECTED_EQUIPMENT} from './public/energy-model.mjs';

const messages={authentication:'Autenticação Tuya recusada; confira a credencial no Debian.',credentials:'Credencial privada ou endereço da dispositivo Tuya não configurado.',timeout:'Tempo limite na consulta local.',offline:'dispositivo Tuya indisponível; verifique a conectividade local.',dependency:'Ambiente TinyTuya 1.20.0 indisponível.',worker:'Processo de leitura indisponível.', 'invalid-data':'Telemetria Tuya inválida.', 'energy-storage':'Persistência de energia indisponível; integração interrompida neste intervalo.'};
const bounded=(value,fallback,min,max)=>Number.isFinite(value)?Math.max(min,Math.min(max,value)):fallback;
// Only electrical parameters can cross SSE. Never spread integration config.
export function publicEnergyModel(config={}){
  const pick=(v,keys)=>Object.fromEntries(keys.map(k=>[k,typeof v?.[k]==='number'&&Number.isFinite(v[k])?v[k]:null]));
  const text=v=>typeof v==='string'?v.slice(0,500):'';
  const hardware=configuredUPS(config.hardware);
  const protectedEquipment=Array.isArray(config.protectedEquipment)?config.protectedEquipment.slice(0,32).map(text).filter(Boolean):[...PROTECTED_EQUIPMENT];
  const scenarios={};
  for(const name of ['conservative','nominal','optimistic']){const s=config.scenarios?.[name]||emptyScenario(hardware);scenarios[name]={basis:text(s.basis),batteries:hardware.batteryCapacitiesAh.map((ah,i)=>({ah,...pick(s.batteries?.[i],['health','usableDischarge','stateOfCharge','temperatureFactor','peukertExponent','referenceHours'])})),efficiencyCurve:Array.isArray(s.efficiencyCurve)?s.efficiencyCurve.slice(0,32).map(p=>pick(p,['watts','efficiency'])):[],lossAccounting:s.lossAccounting==='separateIdle'?'separateIdle':'inclusive',idleWatts:typeof s.idleWatts==='number'?s.idleWatts:0};}
  const simplified=Object.fromEntries(Object.entries(SIMPLE_DEFAULTS).map(([key,value])=>[key,typeof config.simplified?.[key]==='number'&&Number.isFinite(config.simplified[key])?config.simplified[key]:value]));
  return {hardware,protectedEquipment,estimateMode:config.estimateMode==='advanced'?'advanced':'simplified',simplified,calibration:{...pick(config.calibration,['inputToOutputEfficiency','chargingWatts','idleInputWatts']),basis:text(config.calibration?.basis)},scenarios};
}
export async function createEnergyCollector({root,dataDir,config={},retentionDays=7,emit=()=>{},now=Date.now,readerFactory=createTuyaReader,metricsFactory=createEnergyMetrics}={}){
  if(config.enabled!==true)return {start(){},async stop(){},async poll(){},snapshot:()=>({enabled:false,state:'disabled'})};
  const intervalMs=bounded(config.intervalSeconds,10,2,300)*1000,staleMs=bounded(config.staleSeconds,Math.max(30,intervalMs/1000*3),intervalMs/1000,900)*1000;
  const maxGapMs=bounded(config.maxGapSeconds,intervalMs/1000*3,intervalMs/1000,900)*1000,retries=Math.floor(bounded(config.retries,1,0,2));
  let model;
  try{model=publicEnergyModel(config);}
  catch{return {start(){},async stop(){},async poll(){},snapshot:()=>({enabled:true,state:'error',error:'Confira os parâmetros elétricos do nobreak.',model:publicEnergyModel()})};}
  let metrics,reader,state='pending',error='',lastSuccess=null,timer=null,running=false,busy=false,work=null,generation=0;
  const events=[];
  try{metrics=await metricsFactory({directory:path.join(dataDir??path.join(root,'data'),'energy'),retentionDays,maxGapMs,now});}
  catch{state='error';error=messages['energy-storage'];}
  if(metrics)try{reader=readerFactory({address:config.address,deviceId:config.deviceId,protocolVersion:config.protocolVersion,pythonPath:config.pythonPath,credentialFile:config.credentialFile,timeoutMs:bounded(config.timeoutSeconds,12,1,30)*1000});}catch(e){state='error';error=messages[e.code]||messages.worker;}
  function snapshot(){
    const consumption=metrics?.snapshot(),lastValid=consumption?.lastValid||null,fresh=state==='online'&&lastSuccess!==null&&now()-lastSuccess<=staleMs&&now()>=lastSuccess;
    const estimate=estimateAutonomy(lastValid?.watts,model);
    return {enabled:true,state:state==='online'&&!fresh?'stale':state,error,fresh,lastSuccess,lastValid,staleSeconds:staleMs/1000,consumption,model,events:events.slice(),estimate:{...estimate,historical:!fresh,basedAt:lastValid?.time||null}};
  }
  function status(next,code=''){
    if(next!==state){events.push({time:now(),state:next,message:next==='online'?'Telemetria dispositivo Tuya disponível.':messages[code]||'Telemetria dispositivo Tuya indisponível.'});if(events.length>30)events.shift();}
    state=next;error=messages[code]||'';
  }
  async function collect(gen){
    try{
      if(!reader||!metrics)return;
      let value;
      for(let attempt=0;;attempt++)try{value=await reader.read();break;}catch(e){if(gen!==generation)return;if(attempt>=retries||['authentication','credentials','dependency'].includes(e.code))throw e;}
      if(gen!==generation)return;
      const sample=decodeDps(value,now());await metrics.accept(sample);if(gen!==generation)return;lastSuccess=sample.time;status('online');
    }catch(e){if(gen!==generation)return;await metrics?.gap().catch(()=>{});status('unavailable',e.message==='energy-storage'?'energy-storage':messages[e.code||e.message]?e.code||e.message:'worker');}
    finally{busy=false;work=null;if(gen===generation){emit('energy',{energy:snapshot()});if(running){timer=setTimeout(()=>void poll(),intervalMs);timer.unref();}}}
  }
  function poll(){if(busy)return work;busy=true;work=collect(generation);return work;}
  return {
    snapshot,poll,
    start(){if(running)return;running=true;generation++;void poll();},
    async stop(){running=false;generation++;clearTimeout(timer);await reader?.close();await work;await metrics?.gap().catch(()=>{});await metrics?.close();},
  };
}
