import {displayText} from './display-sanitize.js';
const palette=['#44d6d0','#a293ff','#52a7ff','#ffc36a','#9fea80'];
const interactions=new WeakMap();
let tooltipCounter=0;
let activeInspection=null;
export function nearestSample(samples,time){
  if(!samples.length)return null;
  let low=0,high=samples.length-1;
  while(low<high){const mid=Math.floor((low+high)/2);if(samples[mid].time<time)low=mid+1;else high=mid;}
  const after=samples[low],before=samples[Math.max(0,low-1)];
  return Math.abs(before.time-time)<=Math.abs(after.time-time)?before:after;
}
export function pointValues(sample,series,unit){return series.map((line,index)=>({name:line.name||'Série '+(index+1),value:line.get(sample),unit:line.unit??unit,color:line.color||palette[index],dash:Boolean(line.dash)}));}
function inspection(canvas){
  if(interactions.has(canvas))return interactions.get(canvas);
  const tooltip=document.createElement('div');tooltip.className='chart-tooltip';tooltip.id='chart-point-'+(++tooltipCounter);tooltip.hidden=true;tooltip.setAttribute('role','tooltip');document.body.append(tooltip);
  const state={tooltip,paint:null,time:null,locked:false,position:null};interactions.set(canvas,state);
  canvas.tabIndex=0;canvas.setAttribute('aria-describedby',tooltip.id);canvas.classList.add('inspectable-chart');
  state.hide=()=>{state.time=null;state.locked=false;tooltip.hidden=true;state.restore?.();};
  const locate=event=>{const box=canvas.getBoundingClientRect();state.position={x:event.clientX,y:event.clientY};state.pick?.((event.clientX-box.left)/box.width*state.width,(event.clientY-box.top)/box.height*state.height);};
  const pointerEvents=typeof window.PointerEvent==='function';
  canvas.addEventListener(pointerEvents?'pointermove':'mousemove',event=>{if(!state.locked)locate(event);});
  canvas.addEventListener(pointerEvents?'pointerleave':'mouseleave',()=>{if(!state.locked)state.hide();});
  if(!pointerEvents)canvas.addEventListener('touchstart',event=>{if(event.touches.length){locate(event.touches[0]);state.locked=true;state.paint?.();}},{passive:true});
  canvas.addEventListener('pointerdown',event=>{if(event.pointerType==='touch'){locate(event);state.locked=true;state.paint?.();}});
  canvas.addEventListener('pointercancel',state.hide);
  canvas.addEventListener('click',event=>{if(event.pointerType==='touch')return;state.locked=false;locate(event);state.locked=state.time!==null;state.paint?.();});
  canvas.addEventListener('focus',()=>{if(state.time===null)state.select?.('End');});
  canvas.addEventListener('blur',state.hide);
  canvas.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();state.hide();}else if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();state.locked=true;state.select?.(event.key);}});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')state.hide();});
  window.addEventListener('scroll',()=>{if(!state.locked)state.hide();else state.paint?.();},{passive:true});
  return state;
}
function showPoint(state,title,rows,note,anchor){
  if(activeInspection&&activeInspection!==state)activeInspection.hide();activeInspection=state;
  const tip=state.tooltip;tip.replaceChildren();const heading=document.createElement('strong');heading.textContent=displayText(title);tip.append(heading);
  const close=document.createElement('button');close.className='point-close';close.textContent='×';close.setAttribute('aria-label','Fechar detalhe do ponto');close.onpointerdown=event=>event.preventDefault();close.onclick=state.hide;tip.append(close);
  for(const row of rows){const line=document.createElement('div');line.className='point-row';const swatch=document.createElement('i');swatch.style.background=row.color;swatch.className=row.dash?'point-dash':'';const label=document.createElement('span');label.textContent=displayText(row.name);const value=document.createElement('b');value.textContent=Number.isFinite(row.value)?row.value.toLocaleString('pt-BR',{maximumFractionDigits:3})+(row.unit?' '+row.unit:''):'Sem leitura';line.append(swatch,label,value);tip.append(line);}
  const hint=document.createElement('small');hint.textContent=displayText(note)+(state.locked?' · Fixado; Esc para fechar':' · Clique ou toque para fixar');tip.append(hint);tip.hidden=false;
  const w=tip.offsetWidth,h=tip.offsetHeight,point=state.position||anchor;
  const viewportWidth=Math.min(innerWidth,document.documentElement.clientWidth||innerWidth);
  tip.style.left=Math.max(8,Math.min(viewportWidth-w-8,point.x+16))+'px';tip.style.top=Math.max(8,Math.min(innerHeight-h-8,point.y+16))+'px';
}
documentSafeDismiss();
function documentSafeDismiss(){if(typeof document==='undefined')return;document.addEventListener(typeof window.PointerEvent==='function'?'pointerdown':'mousedown',event=>{if(activeInspection&&!event.target.closest('canvas,.chart-tooltip'))activeInspection.hide();});}
function inspectLine(canvas,c,samples,series,unit,geometry){
  const state=inspection(canvas),{w,h,L,R,T,B,start,end,max,dpr,pointsOnly,pointNote,timeZone}=geometry;
  const base=c.getImageData(0,0,canvas.width,canvas.height);state.width=w;state.height=h;state.restore=()=>c.putImageData(base,0,0);
  const heading=canvas.closest('article')?.querySelector('h2,h3,p');
  canvas.setAttribute('aria-label',(canvas.dataset.telemetryName||heading?.dataset.telemetryName||heading?.textContent||'Gráfico')+'. Passe o cursor ou toque para inspecionar. Pelo teclado, use as setas para percorrer amostras e Esc para fechar.');
  state.paint=()=>{
    state.restore();if(state.time===null)return;const sample=nearestSample(samples,state.time);if(!sample){state.tooltip.hidden=true;return;}
    state.time=sample.time;const x=L+(sample.time-start)/(end-start)*(R-L),box=canvas.getBoundingClientRect();
    c.save();c.setTransform(dpr,0,0,dpr,0,0);c.strokeStyle='#b8d0e9';c.lineWidth=1;c.setLineDash([3,3]);c.beginPath();c.moveTo(x,T);c.lineTo(x,B);c.stroke();c.setLineDash([]);
    for(const row of pointValues(sample,series,unit)){if(!Number.isFinite(row.value))continue;const y=B-Math.min(max,row.value)/max*(B-T);c.beginPath();c.fillStyle=row.color;c.strokeStyle='#101b2a';c.lineWidth=2;c.arc(x,y,3.5,0,Math.PI*2);c.fill();c.stroke();}c.restore();
    showPoint(state,new Date(sample.time).toLocaleString('pt-BR',timeZone?{timeZone}:undefined),pointValues(sample,series,unit),pointNote?pointNote(sample):pointsOnly?'Teste concluído no PC; sem interpolação entre medições':'Amostra mais próxima; média quando agregada',{x:box.left+x/w*box.width,y:box.top+T/h*box.height});
  };
  state.pick=(x,y)=>{if(x<L||x>R||y<T||y>B){if(!state.locked)state.hide();return;}const sample=nearestSample(samples,start+(x-L)/(R-L)*(end-start));state.time=sample?.time??null;state.paint();};
  state.select=key=>{if(!samples.length)return;const current=nearestSample(samples,state.time??end),index=samples.indexOf(current),next=key==='Home'?0:key==='End'?samples.length-1:Math.max(0,Math.min(samples.length-1,index+(key==='ArrowLeft'?-1:1)));state.position=null;state.time=samples[next].time;state.paint();};
  state.paint();
}
export function lineChart(canvas,history,series,{minutes=15,unit='',ceiling=null,pointsOnly=false,pointNote=null,timeZone,now=Date.now()}={}){
  const box=canvas.getBoundingClientRect(),dpr=devicePixelRatio||1,w=Math.max(260,box.width),h=box.height||200;
  canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);const c=canvas.getContext('2d');c.scale(dpr,dpr);
  const compact=h<80,L=compact?2:49,R=w-(compact?2:12),T=compact?3:17,B=h-(compact?3:27),end=now,start=end-minutes*60000;
  const samples=history.filter(s=>s.time>=start&&s.time<=end),values=samples.flatMap(s=>series.map(line=>line.get(s))).filter(Number.isFinite);
  const max=ceiling??Math.max(1,...values)*1.12;
  c.font='10px Consolas, monospace';c.fillStyle='#778da6';c.strokeStyle='#26384b';c.lineWidth=.6;
  if(!compact){for(let j=0;j<5;j++){const y=T+(B-T)*j/4;c.beginPath();c.moveTo(L,y);c.lineTo(R,y);c.stroke();const number=max*(1-j/4);c.fillText(number>=1000?(number/1000).toFixed(1)+'k':number.toLocaleString('pt-BR',{maximumFractionDigits:1}),2,y+3);}c.fillText(unit,2,h-4);for(let j=0;j<4;j++){const time=start+(end-start)*j/3,x=L+(R-L)*j/3,date=new Date(time),label=minutes>1440?date.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',...(timeZone?{timeZone}:{})}):date.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',...(timeZone?{timeZone}:{})});c.fillText(label,Math.min(x,R-33),h-5);}}
  if(!values.length){if(!compact){c.fillStyle='#99adc3';c.textAlign='center';c.fillText('Aguardando amostras válidas',w/2,h/2);}}
  series.forEach((line,index)=>{
    const color=line.color||palette[index];c.beginPath();c.strokeStyle=color;c.lineWidth=1.65;c.setLineDash(line.dash?[4,3]:[]);let previous=null;
    for(const sample of samples){const value=line.get(sample);if(!Number.isFinite(value)){previous=null;continue;}const x=L+(sample.time-start)/(end-start)*(R-L),y=B-Math.min(max,value)/max*(B-T);
      if(!pointsOnly&&previous&&sample.time-previous.time<Math.max(20000,minutes*60000/700*3))c.lineTo(x,y);else c.moveTo(x,y);previous=sample;
    }c.stroke();c.setLineDash([]);
    if(pointsOnly){c.fillStyle=color;for(const sample of samples){const value=line.get(sample);if(!Number.isFinite(value))continue;const x=L+(sample.time-start)/(end-start)*(R-L),y=B-Math.min(max,value)/max*(B-T);c.beginPath();c.arc(x,y,3.5,0,Math.PI*2);c.fill();}}
  });
  inspectLine(canvas,c,samples,series,unit,{w,h,L,R,T,B,start,end,max,dpr,pointsOnly,pointNote,timeZone});
}
export function donut(canvas,entries){
 const box=canvas.getBoundingClientRect(),dpr=devicePixelRatio||1,w=box.width,h=box.height;canvas.width=w*dpr;canvas.height=h*dpr;
 const c=canvas.getContext('2d');c.scale(dpr,dpr);const total=entries.reduce((n,e)=>n+e.connections,0),radius=Math.min(w,h)*.34,cx=w*.5,cy=h*.5;
 c.lineWidth=14;c.strokeStyle='#26384b';c.beginPath();c.arc(cx,cy,radius,0,Math.PI*2);c.stroke();let angle=-Math.PI/2;
 if(total)entries.forEach((entry,index)=>{const next=angle+entry.connections/total*Math.PI*2;c.strokeStyle=palette[index%palette.length];c.beginPath();c.arc(cx,cy,radius,angle,next);c.stroke();angle=next;});
 c.textAlign='center';c.fillStyle='#dce9f8';c.font='24px Consolas, monospace';c.fillText(total||'—',cx,cy+5);c.font='10px Consolas, monospace';c.fillStyle='#8298b1';c.fillText('CONEXÕES',cx,cy+25);
 const state=inspection(canvas);state.width=w;state.height=h;canvas.setAttribute('aria-label','Mix de protocolos. Passe o cursor ou toque em um segmento. Use as setas pelo teclado.');
 state.paint=()=>{if(state.time===null||!entries[state.time]){state.tooltip.hidden=true;return;}const entry=entries[state.time],box=canvas.getBoundingClientRect();showPoint(state,entry.name.toUpperCase(),[{name:'Conexões',value:entry.connections,unit:'conex.',color:palette[state.time%palette.length]},{name:'Participação',value:total?entry.connections/total*100:null,unit:'%',color:palette[state.time%palette.length]}],'Snapshot atual da tabela',{x:box.left+cx,y:box.top+cy});};
 state.pick=(x,y)=>{const distance=Math.hypot(x-cx,y-cy);if(!total||Math.abs(distance-radius)>15){state.hide();return;}let angle=(Math.atan2(y-cy,x-cx)+Math.PI/2+Math.PI*2)%(Math.PI*2),sum=0;state.time=entries.findIndex(e=>{sum+=e.connections/total*Math.PI*2;return angle<=sum;});state.paint();};
 state.select=key=>{if(!entries.length)return;state.position=null;state.time=key==='Home'?0:key==='End'?entries.length-1:Math.max(0,Math.min(entries.length-1,(state.time??0)+(key==='ArrowLeft'?-1:1)));state.paint();};state.paint();
}
export const colors=palette;
