import {lineChart,colors} from './charts.js';
import {emptyScenario,estimateAutonomy,UPS,SIMPLE_DEFAULTS,PROTECTED_EQUIPMENT} from './energy-model.mjs';

const names={conservative:'Conservador',nominal:'Nominal',optimistic:'Otimista'};
const fmt=(v,d=2)=>Number.isFinite(v)?v.toLocaleString('pt-BR',{maximumFractionDigits:d}):'—';
const stamp=t=>t?new Date(t).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'Sem leitura';
const duration=result=>result?.state==='ready'?Math.floor(result.minutes/60)+'h '+result.minutes%60+'min':result?.state==='overload'?'Sobrecarga estimada':result?.state==='zero-load'?'Carga zero':'Configuração incompleta';
export function initEnergyPanel({now=Date.now,isPaused=()=>false}={}){
  const section=document.createElement('section');section.id='energy';
  section.innerHTML=`<div class="section-title"><div><p class="eyebrow">TUYA LOCAL / NOBREAK</p><h2>Energia &amp; Nobreak</h2></div><span class="detail-time" id="energy-state" role="status">Aguardando configuração</span></div>
    <p class="hint">Medição real na entrada AC do nobreak. Inclui perdas e possível carregamento. Autonomia é uma simulação, sem medição de bateria.</p>
    <p class="hint" id="energy-equipment"></p>
    <div class="energy-cards" id="energy-cards"></div><p class="hint" id="energy-summary"></p>
    <div class="chart-grid"><article class="panel"><h3>Potência em tempo real</h3><canvas id="energy-live" aria-label="Potência de entrada nos últimos 30 minutos"></canvas></article>
    <article class="panel"><div class="panel-heading"><h3>Histórico de potência</h3><label>Período <select id="energy-range"><option value="1440">24 horas</option><option value="10080">7 dias</option><option value="43200">30 dias</option></select></label></div><canvas id="energy-history" aria-label="Histórico de potência de entrada"></canvas></article>
    <article class="panel"><h3>Consumo acumulado de hoje</h3><canvas id="energy-day" aria-label="Consumo acumulado de hoje"></canvas></article>
    <article class="panel"><h3>Consumo por mês</h3><canvas id="energy-month" aria-label="Consumo por mês"></canvas></article>
    <article class="panel"><h3>Consumo diário</h3><canvas id="energy-daily" aria-label="Consumo por dia"></canvas></article>
    <article class="panel"><h3>Evolução da potência média</h3><canvas id="energy-average" aria-label="Potência média dos intervalos medidos de cada dia"></canvas></article></div>
    <article class="panel energy-simulator"><div class="panel-heading"><h3>Simulador de autonomia</h3><span class="hint" id="energy-hardware"></span></div>
    <p class="hint">Estimativa automática pelo consumo e pelo banco configurado, supondo as baterias inicialmente carregadas. Não é contador regressivo nem porcentagem real de bateria. Valores editados ficam somente neste navegador.</p>
    <div class="energy-inputs"><label>Fonte da carga<select id="energy-source"><option value="latest">Última entrada AC medida</option><option value="average">Média da entrada AC</option><option value="manual">Potência de saída independente</option></select></label>
    <label>Modelo de cálculo<select id="energy-mode"><option value="simplified">Estimativa simples (padrão)</option><option value="advanced">Simulação elétrica avançada</option></select></label>
    <label>Período da média<select id="energy-average-range"><option value="60">Última hora</option><option value="1440">Últimas 24 horas</option><option value="10080">Últimos 7 dias</option></select></label>
    <label>Potência de saída (W)<input id="energy-manual" type="number" min="0" step="0.1"></label></div>
    <p class="hint" id="energy-simple-basis"></p>
    <details id="energy-simple-settings"><summary>Premissas da estimativa simples</summary><p class="hint">Os fatores de 50%, 70% e 85% são hipóteses globais de aproveitamento, não especificações do fabricante nem porcentagem de bateria. Englobam perdas e capacidade utilizável uma única vez. Sem medição de saúde ou carga real.</p><div class="energy-inputs" id="energy-simple-factors"></div></details>
    <div id="energy-advanced" hidden><details><summary>Calibração da entrada AC → carga de saída</summary><p class="hint">Usada somente no modelo avançado. Identifique o carregamento e as perdas com medição independente.</p><div class="energy-inputs" id="energy-calibration"></div></details>
    <details><summary>Condição das baterias e eficiência por cenário</summary><div class="energy-inputs"><label>Cenário em edição<select id="energy-scenario"><option value="nominal">Nominal</option><option value="conservative">Conservador</option><option value="optimistic">Otimista</option></select></label></div>
    <div id="energy-factors"></div></details></div><button type="button" id="energy-reset">Restaurar parâmetros do servidor</button>
    <p id="energy-load-note" class="hint"></p><div class="energy-results" id="energy-results" aria-live="polite"></div>
    <details><summary>Parâmetros e cálculo desta simulação</summary><pre id="energy-calculation"></pre></details></article>
    <details class="panel"><summary>Histórico de comunicação</summary><ul id="energy-events"></ul><p class="hint">Indisponibilidade do dispositivo Tuya não confirma falta de energia. Ela está antes do nobreak e também pode perder comunicação por falha de rede.</p></details>`;
  document.getElementById('diagnostics').before(section);const link=document.createElement('a');link.href='#energy';link.innerHTML='12 <span>Energia &amp; Nobreak</span>';document.querySelector('aside nav').append(link);
  const get=id=>section.querySelector('#energy-'+id),cards=[];
  for(const title of ['Potência atual','Tensão da rede','Corrente','Consumo de hoje','Consumo no mês','Estado da tomada','Última atualização','Autonomia estimada']){
    const card=document.createElement('article');card.className='panel';const p=document.createElement('p'),value=document.createElement('strong'),note=document.createElement('p');p.textContent=title;note.className='hint';value.textContent='—';card.append(p,value,note);get('cards').append(card);cards.push({value,note});
  }
  let snapshot=null,model=null,serverModel=null,chartSource=null;
  const storageKey='orbit.energy.simulator.v1';let saved;
  try{saved=JSON.parse(localStorage.getItem(storageKey));}catch{}
  function remember(){try{localStorage.setItem(storageKey,JSON.stringify({model,source:get('source').value,manual:get('manual').value,range:get('average-range').value}));}catch{}}
  function field(parent,title,value,change,{min=0,max,step='any',type='number'}={}){
    const label=document.createElement('label');label.textContent=title;const input=document.createElement('input');input.type=type;input.value=value??'';
    if(type==='number'){input.min=String(min);if(max!==undefined)input.max=String(max);input.step=step;}else input.maxLength=500;
    input.oninput=()=>{change(type==='number'?(input.value.trim()===''?null:Number(input.value)):input.value);remember();simulate();};label.append(input);parent.append(label);return input;
  }
  function calibrationForm(){const parent=get('calibration');parent.replaceChildren();const c=model.calibration;
    for(const [key,label,max]of [['inputToOutputEfficiency','Eficiência AC de entrada → saída (0–1)',1],['chargingWatts','Potência de carregamento na entrada (W)'],['idleInputWatts','Consumo próprio na entrada (W)']])field(parent,label,c[key],v=>c[key]=v,{max});
    field(parent,'Base da calibração / condição de carregamento',c.basis,v=>c.basis=v,{type:'text'});
  }
  function simplifiedForm(){const parent=get('simple-factors');parent.replaceChildren();model.simplified={...SIMPLE_DEFAULTS,...model.simplified};
    for(const [key,label]of [['conservativeFraction','Aproveitamento conservador (%)'],['nominalFraction','Aproveitamento nominal (%)'],['optimisticFraction','Aproveitamento otimista (%)']])field(parent,label,model.simplified[key]*100,v=>model.simplified[key]=v===null?null:v/100,{max:100});
  }
  function scenarioForm(){const parent=get('factors');parent.replaceChildren();const key=get('scenario').value,s=model.scenarios[key]||emptyScenario(model.hardware);model.scenarios[key]=s;
    const basis=document.createElement('div');basis.className='energy-inputs';parent.append(basis);field(basis,'Origem e condições dos parâmetros (obrigatório)',s.basis,v=>s.basis=v,{type:'text'});
    const grid=document.createElement('div');grid.className='energy-batteries';parent.append(grid);
    model.hardware.batteryCapacitiesAh.forEach((ah,i)=>{const group=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent='Bateria '+(i+1)+' · '+model.hardware.volts+' V / '+ah+' Ah';group.append(legend);grid.append(group);const b=s.batteries[i];
      for(const [k,label,max,min]of [['health','Saúde / capacidade relativa (0–1)',1,0],['usableDischarge','Descarga utilizável (0–1)',1,0],['stateOfCharge','Carga inicial assumida (0–1)',1,0],['temperatureFactor','Fator de temperatura (0–1)',1,0],['peukertExponent','Expoente de Peukert (1–2)',2,1],['referenceHours','Regime nominal de descarga (horas)',undefined,.01]])field(group,label,b[k],v=>b[k]=v,{max,min});
    });
    const losses=document.createElement('div');losses.className='energy-inputs';parent.append(losses);const label=document.createElement('label');label.textContent='Convenção das perdas';const select=document.createElement('select');select.innerHTML='<option value="inclusive">Eficiência global (inclui consumo próprio)</option><option value="separateIdle">Eficiência de conversão + consumo DC separado</option>';select.value=s.lossAccounting;label.append(select);losses.append(label);select.onchange=()=>{s.lossAccounting=select.value;if(select.value==='inclusive')s.idleWatts=0;remember();scenarioForm();simulate();};
    const idle=field(losses,'Consumo próprio DC separado (W)',s.idleWatts,v=>s.idleWatts=v);idle.disabled=s.lossAccounting==='inclusive';
    const hint=document.createElement('p');hint.className='hint';hint.textContent='Curva: use pelo menos dois pontos que cubram a carga. Use os dados do equipamento para estimar a eficiência. Não há extrapolação.';parent.append(hint);
    const curve=document.createElement('div');curve.className='energy-curve';parent.append(curve);
    s.efficiencyCurve.forEach((point,i)=>{const row=document.createElement('div');row.className='energy-inputs';curve.append(row);field(row,'Carga de saída (W)',point.watts,v=>point.watts=v,{max:model.hardware.watts});field(row,'Eficiência (0–1)',point.efficiency,v=>point.efficiency=v,{max:1});const remove=document.createElement('button');remove.type='button';remove.textContent='Remover ponto';remove.onclick=()=>{s.efficiencyCurve.splice(i,1);remember();scenarioForm();simulate();};row.append(remove);});
    const add=document.createElement('button');add.type='button';add.textContent='Adicionar ponto de eficiência';add.disabled=s.efficiencyCurve.length>=32;add.onclick=()=>{s.efficiencyCurve.push({watts:null,efficiency:null});remember();scenarioForm();};parent.append(add);
  }
  function current(){return snapshot?.fresh&&snapshot.lastValid&&now()-snapshot.lastValid.time>=-2000&&now()-snapshot.lastValid.time<=snapshot.staleSeconds*1000;}
  function average(minutes){
    // Daily buckets carry measured duration and trapezoidal energy. For short
    // windows, the backend publishes exact recent interval integrals below.
    return snapshot?.consumption?.averages?.[minutes]||null;
  }
  function simulate(){
    if(!model)return;const source=get('source').value;get('manual').disabled=source!=='manual';get('average-range').disabled=source!=='average';
    model.estimateMode=get('mode').value==='advanced'?'advanced':'simplified';const simple=model.estimateMode==='simplified';get('advanced').hidden=simple;get('simple-settings').hidden=!simple;get('simple-basis').hidden=!simple;
    let watts,loadNote,historical=false;
    if(source==='manual'){watts=get('manual').value.trim()===''?undefined:Number(get('manual').value);loadNote='Consumo personalizado informado pelo usuário; não é leitura da dispositivo Tuya.';}
    else{const avg=source==='average'?average(get('average-range').value):null;watts=source==='average'?avg?.watts:snapshot?.lastValid?.watts;historical=!current();
      loadNote=(source==='average'?'Média de entrada AC: '+fmt(watts)+' W · cobertura medida '+fmt(avg?.seconds/60,1)+' min. ':'Entrada AC: '+fmt(watts)+' W. ')+(historical?'Base histórica; não representa a carga atual.':'Medição atualizada.');}
    const estimate=estimateAutonomy(watts,model,{powerSource:source==='manual'?'manual-output':'input-ac'}),results=estimate.scenarios;
    loadNote+=' '+(estimate.load.basis||estimate.load.reason||'');
    get('simple-basis').textContent='Banco de '+model.hardware.volts+' V / '+model.hardware.nominalWh+' Wh nominais. Estimativa nominal: '+model.hardware.nominalWh+' Wh × '+fmt((model.simplified?.nominalFraction??.7)*100,0)+'% de aproveitamento global / consumo em W. Baterias inicialmente carregadas por hipótese. Entrada AC é aproximação da carga; o carregamento e as perdas não são separados.';
    get('load-note').textContent=loadNote;
    get('results').replaceChildren();
    for(const [key,result]of Object.entries(results)){const card=document.createElement('div'),h=document.createElement('h4'),value=document.createElement('strong'),note=document.createElement('p');h.textContent=names[key];value.textContent=duration(result);note.className='hint';note.textContent=result.state==='ready'?(historical?'Estimativa histórica. ':'Estimativa. ')+result.basis:result.reason;card.append(h,value,note);get('results').append(card);}
    get('calculation').textContent=JSON.stringify({equipamento:model.hardware,equipamentosProtegidos:serverModel?.protectedEquipment||PROTECTED_EQUIPMENT,modelo:estimate.mode,fonte:source,baseHistorica:historical,consumoReferenciaW:watts??null,origemCarga:estimate.load.source,convencao:simple?'Capacidade nominal em Wh × fator global assumido / consumo W. O fator engloba capacidade utilizável e perdas uma única vez. Não há SOC medido.':'Pdc = Psaída / eficiência + consumo DC separado. Wh úteis / Pdc. Fatores de saúde, temperatura, carga assumida, descarga e corrente aplicados uma vez.',cenarios:results},null,2);
    const nominal=snapshot?.estimate?.scenarios?.nominal;cards[7].value.textContent=duration(nominal);cards[7].note.textContent=(snapshot?.estimate?.historical||!current()?'Estimativa histórica · ':'Estimativa · ')+(snapshot?.estimate?.mode==='simplified'?fmt((nominal?.usableFraction??.7)*100,0)+'% de aproveitamento global assumido':'Parâmetros do servidor');
  }
  function charts(){const c=snapshot?.consumption;if(!c)return;const h=c.history||[],today=new Date(now()).toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'}),calendarTime=d=>Date.parse(d+'T00:00:00-03:00');
    const plot=(id,rows,getValue,minutes,unit,pointsOnly=false)=>lineChart(get(id),rows,[{name:unit==='W'?'Potência na entrada':'Energia medida',get:getValue,color:colors[0]}],{minutes,unit,pointsOnly,now:now(),timeZone:'America/Sao_Paulo',pointNote:()=>id==='live'||id==='history'?'Média das leituras neste minuto; períodos sem dados ficam ausentes':'Energia integrada apenas nos intervalos medidos'});
    // Minute aggregates are intentionally points: gaps are never drawn as a continuous measurement.
    plot('live',h,p=>p.watts,30,'W',true);plot('history',h,p=>p.watts,Number(get('range').value),'W',true);
    plot('day',h.filter(p=>new Date(p.time).toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'})===today),p=>p.dayWh/1000,1440,'kWh',true);
    const daily=c.daily.map(d=>({...d,time:calendarTime(d.date)}));plot('daily',daily,p=>p.kwh,Math.max(7,c.retentionDays)*1440,'kWh',true);plot('average',daily,p=>p.averageWatts,Math.max(7,c.retentionDays)*1440,'W',true);
    plot('month',c.monthly.map(m=>({...m,time:calendarTime(m.month+'-01')})),p=>p.kwh,366*1440,'kWh',true);
  }
  function render(value){snapshot=value||snapshot;if(!snapshot)return;const s=snapshot,live=current(),last=s.lastValid;
    if(s.enabled===false){get('state').textContent='Integração desativada';cards.forEach(c=>{c.value.textContent='—';c.note.textContent='Integração desativada';});section.querySelectorAll('input,select,button').forEach(n=>n.disabled=true);return;}
    if(!model){if(!s.model)return;serverModel={...s.model,hardware:{...UPS,...s.model.hardware}};model=structuredClone(serverModel);
      if(saved?.model?.scenarios&&saved.model.calibration){try{const candidate=saved.model;if(typeof candidate.calibration.basis!=='string')throw 0;for(const name of Object.keys(names)){const scenario=candidate.scenarios[name];if(!scenario||typeof scenario.basis!=='string'||!Array.isArray(scenario.batteries)||scenario.batteries.length!==serverModel.hardware.batteryCapacitiesAh.length||scenario.batteries.some((b,i)=>!b||b.ah!==serverModel.hardware.batteryCapacitiesAh[i])||!Array.isArray(scenario.efficiencyCurve)||scenario.efficiencyCurve.length>32||scenario.efficiencyCurve.some(p=>!p||typeof p!=='object'))throw 0;}model={...serverModel,...candidate,hardware:serverModel.hardware,simplified:{...SIMPLE_DEFAULTS,...candidate.simplified}};}catch{}}
      if(saved?.source&&['latest','average','manual'].includes(saved.source))get('source').value=saved.source;if(saved?.manual!==undefined)get('manual').value=saved.manual;if(saved?.range)get('average-range').value=saved.range;get('mode').value=model.estimateMode==='advanced'?'advanced':'simplified';simplifiedForm();calibrationForm();scenarioForm();
    }
    const hardware=model.hardware;get('hardware').textContent=hardware.model+' · '+hardware.volts+' V · '+hardware.batteryCapacitiesAh.join(' + ')+' Ah · '+hardware.nominalWh+' Wh · '+hardware.watts+' W / '+hardware.va+' VA';
    get('equipment').textContent='Equipamentos protegidos: '+(s.model?.protectedEquipment||PROTECTED_EQUIPMENT).join(' · ')+'. O consumo é total; não há medição individual por equipamento.';
    const labels={disabled:'Integração desativada',pending:'Aguardando primeira leitura',online:'Medição atualizada',stale:'Medição desatualizada',unavailable:'Telemetria indisponível',error:'Configuração indisponível'};
    get('state').textContent=labels[s.state==='online'&&!live?'stale':s.state]||'Sem leitura';const readings=[live?fmt(last?.watts,1)+' W':'—',live?fmt(last?.volts,1)+' V':'—',live?fmt(last?.amps,3)+' A':'—',fmt(s.consumption?.todayWh/1000,4)+' kWh',fmt(s.consumption?.monthWh/1000,4)+' kWh',live?(last?.relay?'Relé ligado':'Relé desligado'):'Sem leitura atual',stamp(last?.time)];
    readings.forEach((v,i)=>{cards[i].value.textContent=v;cards[i].note.textContent=i<3?'Medição de entrada AC':i===5?'Somente leitura':i===6?'America/Sao_Paulo':'Somente intervalos medidos';});
    get('summary').textContent=(s.error?s.error+' ':'')+(s.consumption?.storageWarning?s.consumption.storageWarning+' ':'')+'Último consumo conhecido: '+fmt(last?.watts,1)+' W em '+stamp(last?.time)+'. Semana (seg–hoje): '+fmt(s.consumption?.weekWh/1000,4)+' kWh. Total desde '+stamp(s.consumption?.startedAt)+': '+fmt(s.consumption?.totalKwh,4)+' kWh. Lacunas não são contabilizadas.';
    get('events').replaceChildren();for(const event of s.events||[]){const li=document.createElement('li');li.textContent=stamp(event.time)+' · '+event.message;get('events').append(li);}
    simulate();if(chartSource!==s.consumption){chartSource=s.consumption;charts();}
  }
  for(const id of ['source','average-range','mode'])get(id).onchange=()=>{model.estimateMode=get('mode').value;remember();simulate();};get('manual').oninput=()=>{remember();simulate();};get('scenario').onchange=scenarioForm;get('range').onchange=charts;
  get('reset').onclick=()=>{model=structuredClone(serverModel);get('mode').value=model.estimateMode==='advanced'?'advanced':'simplified';remember();simplifiedForm();calibrationForm();scenarioForm();simulate();};
  window.addEventListener('resize',charts);setInterval(()=>{if(!isPaused())render();},5000);
  return {render};
}
