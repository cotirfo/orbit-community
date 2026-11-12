// Shared, pure simulation. Advanced factors remain unset; the simplified mode
// uses explicit global assumptions, independently of manufacturer curves.
const defaultBatteryCapacities=Object.freeze([10,30]);
export const UPS=Object.freeze({model:'Nobreak de exemplo',volts:12,watts:500,va:1000,nominalWh:480,batteryCapacitiesAh:defaultBatteryCapacities});
export function configuredUPS(input={}){
  const {model=UPS.model,volts=UPS.volts,watts=UPS.watts,va=UPS.va,batteryCapacitiesAh=defaultBatteryCapacities}=input;
  if(typeof model!=='string'||!model.trim()||model.length>100||![volts,watts,va].every(v=>finite(v)&&v>0)||
    !Array.isArray(batteryCapacitiesAh)||batteryCapacitiesAh.length<1||batteryCapacitiesAh.length>8||batteryCapacitiesAh.some(v=>!finite(v)||v<=0))throw new Error('Parâmetros elétricos do nobreak inválidos.');
  const nominalWh=volts*batteryCapacitiesAh.reduce((sum,ah)=>sum+ah,0);
  if(!finite(nominalWh))throw new Error('Capacidade nominal do nobreak inválida.');
  return {model,volts,watts,va,nominalWh,batteryCapacitiesAh:[...batteryCapacitiesAh]};
}
export const PROTECTED_EQUIPMENT=Object.freeze(['Roteador','Equipamento de rede']);
// Simulation assumptions, not manufacturer specifications or measured battery health.
// One aggregate factor accounts for usable capacity and losses, without multiplying
// inverter/health/discharge factors again in the simplified model.
export const SIMPLE_DEFAULTS=Object.freeze({conservativeFraction:.5,nominalFraction:.7,optimisticFraction:.85});
export function simplifiedRuntime(watts,usableFraction=SIMPLE_DEFAULTS.nominalFraction,hardware=UPS){
  if(!finite(watts)||watts<0)return {state:'incomplete',reason:'Aguardando consumo válido para estimar a autonomia.'};
  if(watts===0)return {state:'zero-load',reason:'Consumo zero: autonomia não calculada.'};
  if(watts>hardware.watts)return {state:'overload',reason:'Referência acima de '+hardware.watts+' W: possível sobrecarga estimada; a entrada também inclui perdas e carregamento.'};
  if(!fraction(usableFraction))return {state:'incomplete',reason:'O aproveitamento global deve estar entre 0% e 100%.'};
  const availableWh=hardware.nominalWh*usableFraction,hours=availableWh/watts,theoreticalHours=hardware.nominalWh/watts;
  if(!Number.isFinite(hours)||!Number.isFinite(theoreticalHours))return {state:'incomplete',reason:'Consumo fora da resolução numérica do modelo.'};
  return {state:'ready',hours,minutes:Math.floor(hours*60),referenceWatts:watts,nominalWh:hardware.nominalWh,availableWh,usableFraction,theoreticalHours,batteries:hardware.batteryCapacitiesAh.map(ah=>({ah,nominalWh:hardware.volts*ah,availableWh:hardware.volts*ah*usableFraction})),basis:'Baterias inicialmente carregadas por hipótese; aproveitamento global assumido de '+Math.round(usableFraction*100)+'%. Não mede carga ou saúde das baterias.',assumptions:{initialCharge:'assumed-full',usableFraction,formula:'Capacidade nominal em Wh × aproveitamento global / consumo W',lossAccounting:'single-global-factor',manufacturerCurve:false}};
}
export function simplifiedScenarios(watts,options={},hardware=UPS){
  const results={};
  for(const [name,key]of [['conservative','conservativeFraction'],['nominal','nominalFraction'],['optimistic','optimisticFraction']])results[name]=simplifiedRuntime(watts,options[key]??SIMPLE_DEFAULTS[key],hardware);
  const nominal=results.nominal;
  for(const name of ['conservative','optimistic'])if(nominal.state==='ready'&&results[name].state==='ready'&&(name==='conservative'?results[name].hours>nominal.hours:results[name].hours<nominal.hours))results[name]={state:'incomplete',reason:'Revise a ordem dos fatores dos cenários.'};
  return results;
}
export function estimateAutonomy(watts,model={}, {powerSource='input-ac'}={}){
  if(model.estimateMode==='advanced'){
    const load=powerSource==='manual-output'?{state:'ready',watts,source:'manual-output'}:outputLoad(watts,model.calibration);
    return {mode:'advanced',load,scenarios:runtimeScenarios(load.watts,model.scenarios,model.hardware)};
  }
  const load=finite(watts)&&watts>=0?{state:'ready',watts,source:powerSource==='manual-output'?'manual-output':'input-proxy',basis:powerSource==='manual-output'?'Consumo personalizado informado pelo usuário.':'Entrada AC usada como aproximação da carga; inclui perdas e possível carregamento, sem conversão automática para saída.'}:{state:'incomplete',reason:'Sem consumo válido.'};
  return {mode:'simplified',load,scenarios:simplifiedScenarios(watts,model.simplified,model.hardware)};
}
export function emptyScenario(hardware=UPS){
  const battery=ah=>({ah,health:null,usableDischarge:null,stateOfCharge:null,temperatureFactor:null,peukertExponent:null,referenceHours:null});
  return {basis:'',batteries:hardware.batteryCapacitiesAh.map(battery),efficiencyCurve:[],lossAccounting:'inclusive',idleWatts:0};
}
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const fraction=v=>finite(v)&&v>=0&&v<=1;
export function outputLoad(inputWatts,calibration){
  const c=calibration||{};
  if(!finite(inputWatts)||inputWatts<0)return {state:'incomplete',reason:'Potência de entrada ausente.'};
  if(!fraction(c.inputToOutputEfficiency)||c.inputToOutputEfficiency===0||!finite(c.chargingWatts)||c.chargingWatts<0||!finite(c.idleInputWatts)||c.idleInputWatts<0||typeof c.basis!=='string'||!c.basis.trim())
    return {state:'incomplete',reason:'Calibre eficiência AC, consumo próprio e carregamento, ou informe uma potência de saída independente.'};
  const watts=(inputWatts-c.chargingWatts-c.idleInputWatts)*c.inputToOutputEfficiency;
  return watts<0?{state:'incomplete',reason:'A calibração excede a potência de entrada.'}:{state:'ready',watts,basis:c.basis,source:'calibrated-input'};
}
export function simulateRuntime(watts,scenario,hardware=UPS){
  if(!finite(watts)||watts<0)return {state:'incomplete',reason:'Informe a potência de saída.'};
  if(watts===0)return {state:'zero-load',reason:'Carga zero: autonomia não calculada.'};
  if(watts>hardware.watts)return {state:'overload',reason:'Sobrecarga estimada: carga acima de '+hardware.watts+' W.'};
  const s=scenario;
  if(typeof s?.basis!=='string'||!s.basis.trim()||!Array.isArray(s.batteries)||s.batteries.length!==hardware.batteryCapacitiesAh.length)return {state:'incomplete',reason:'Premissas e condições das baterias configuradas são obrigatórias.'};
  for(const [i,b] of s.batteries.entries())if(!b||b.ah!==hardware.batteryCapacitiesAh[i]||![b.health,b.usableDischarge,b.stateOfCharge,b.temperatureFactor].every(fraction)||!finite(b.peukertExponent)||b.peukertExponent<1||b.peukertExponent>2||!finite(b.referenceHours)||b.referenceHours<=0)
    return {state:'incomplete',reason:'Configure saúde, descarga utilizável, carga assumida, temperatura e descarga de referência de cada bateria.'};
  const curve=s.efficiencyCurve;
  if(!Array.isArray(curve)||curve.length<2||curve.some((p,i)=>!p||!finite(p.watts)||p.watts<0||p.watts>hardware.watts||!fraction(p.efficiency)||p.efficiency===0||(i>0&&p.watts<=curve[i-1].watts))||watts<curve[0].watts||watts>curve[curve.length-1].watts)
    return {state:'incomplete',reason:'Curva de eficiência ausente ou não cobre esta carga. Não há extrapolação.'};
  if(!['inclusive','separateIdle'].includes(s.lossAccounting)||!finite(s.idleWatts)||s.idleWatts<0||(s.lossAccounting==='inclusive'&&s.idleWatts!==0))
    return {state:'incomplete',reason:'Perdas inconsistentes: eficiência global já inclui consumo próprio.'};
  const upper=curve.findIndex(p=>p.watts>=watts),lo=curve[Math.max(0,upper-1)],hi=curve[upper];
  const efficiency=hi.watts===lo.watts?hi.efficiency:lo.efficiency+(hi.efficiency-lo.efficiency)*(watts-lo.watts)/(hi.watts-lo.watts);
  // The curve is either global (inclusive) or conversion-only plus measured DC idle.
  const dcWatts=watts/efficiency+s.idleWatts,current=dcWatts/hardware.volts;
  const conditionedAh=s.batteries.map(b=>b.ah*b.health*b.temperatureFactor),sum=conditionedAh.reduce((a,b)=>a+b,0);
  const batteries=s.batteries.map((b,i)=>{
    const amps=sum>0?current*conditionedAh[i]/sum:0,referenceAmps=b.ah/b.referenceHours;
    const dischargeFactor=amps>0?Math.min(1,Math.pow(referenceAmps/amps,b.peukertExponent-1)):1;
    const usableWh=hardware.volts*conditionedAh[i]*b.usableDischarge*b.stateOfCharge*dischargeFactor;
    return {ah:b.ah,nominalWh:hardware.volts*b.ah,amps,dischargeFactor,usableWh};
  });
  const availableDcWh=batteries.reduce((sum,b)=>sum+b.usableWh,0),hours=availableDcWh/dcWatts;
  if(!Number.isFinite(hours))return {state:'incomplete',reason:'Carga fora da resolução numérica do modelo.'};
  return {state:'ready',hours,minutes:Math.floor(hours*60),outputWatts:watts,dcWatts,efficiency,availableDcWh,batteries,basis:s.basis,assumptions:s};
}
export function runtimeScenarios(watts,scenarios={},hardware=UPS){
  const results={};
  for(const name of ['conservative','nominal','optimistic'])results[name]=simulateRuntime(watts,scenarios[name],hardware);
  const n=results.nominal;
  for(const name of ['conservative','optimistic'])if(n.state==='ready'&&results[name].state==='ready'&&(name==='conservative'?results[name].hours>n.hours:results[name].hours<n.hours))results[name]={state:'incomplete',reason:'Os parâmetros contradizem a ordem dos cenários. Revise as premissas.'};
  return results;
}
