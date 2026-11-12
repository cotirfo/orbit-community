import land from './world-land.json';
import {displayText} from './display-sanitize.js';
import {normalizeSearch} from './list-controls.js';
import {filterGeoRows,summarizeGeo,hasCoordinates,project,routeStyle,routePath,networkMapOrigin} from './geo-model.mjs';

const ns='http://www.w3.org/2000/svg';
const svgNode=(tag,attributes={})=>{const n=document.createElementNS(ns,tag);for(const [key,value] of Object.entries(attributes))n.setAttribute(key,value);return n;};
const node=(tag,value,className)=>{const n=document.createElement(tag);if(value!==undefined)n.textContent=displayText(value);if(className)n.className=className;return n;};
const time=value=>value?new Date(value).toLocaleString('pt-BR'):'—';
const stateLabel={ready:'instalada',pending:'configuração pendente',error:'falha na base',available:'aproximada',unavailable:'indisponível'};

export function initGeoConnections({getSnapshot,now=Date.now,isPaused=()=>false,addHelp=()=>{}}){
  const panel=node('section',undefined,'panel');panel.id='geo-connections';
  panel.innerHTML='<div class="panel-heading"><div><p class="eyebrow">DESTINOS / GEOIP LOCAL</p><h2>Geo Connections</h2></div><b id="geo-state" class="tag">AGUARDANDO COLETA</b></div><p id="geo-status" class="hint" role="status"></p><div id="geo-kpis" class="geo-kpis"></div><div class="geo-filters"><label>Visão<select id="geo-mode"><option value="current">Snapshot atual</option><option value="history">Histórico de destinos</option></select></label><label>Origem<select id="geo-source"></select></label><label>País<select id="geo-country"></select></label><label>Provedor / ASN<select id="geo-provider"></select></label><label>Protocolo<select id="geo-protocol"></select></label><label>WAN<select id="geo-wan"></select></label><button id="geo-clear">Limpar filtros</button></div><p id="geo-coverage" class="hint"></p><div class="geo-map-toolbar"><span>Mapa mundial · projeção equiretangular</span><div><button id="geo-zoom-in" aria-label="Ampliar mapa">+</button><button id="geo-zoom-out" aria-label="Reduzir mapa">−</button><button id="geo-reset">Recentrar</button></div></div><div id="geo-map-container" class="geo-map-container"></div><p id="geo-map-message" class="hint"></p><p class="hint">Arraste para mover e use + / − para ampliar. Selecione um ponto ou um destino na tabela. Localização aproximada de infraestrutura: CDN, VPN, proxies e anycast podem representar outro local; não indica a localização de pessoas.</p><p class="hint">Cartografia: Natural Earth (domínio público). This product includes GeoLite Data created by MaxMind, available from https://www.maxmind.com.</p><div class="geo-rank-grid"><div><h3>Países observados</h3><div id="geo-countries"></div></div><div><h3>Provedores observados</h3><div id="geo-asns"></div></div></div><div class="table-scroll"><table><thead><tr><th>IP remoto / detalhe</th><th>País / região / cidade aproximados</th><th>ASN / organização</th><th id="geo-count-heading">Conexões no snapshot</th><th>Protocolos / portas</th><th>WAN observada</th></tr></thead><tbody id="geo-rows"></tbody></table></div><div class="geo-pagination"><button id="geo-prev">Anterior</button><span id="geo-page"></span><button id="geo-next">Próxima</button></div><div id="geo-detail" class="geo-detail" aria-live="polite"></div><details><summary>Inventário Huawei e limite de atribuição</summary><p class="hint">Conexões do Huawei AX3 são agregadas por NAT. Os aparelhos abaixo pertencem ao inventário existente e não recebem destinos individuais sem correlação NAT.</p><p id="geo-huawei" class="hint"></p></details>';
  document.getElementById('connections').after(panel);
  const link=node('a');link.href='#geo-connections';link.append(document.createTextNode('11 '),node('span','Geo Connections'));document.querySelector('aside nav').append(link);
  const el=id=>document.getElementById('geo-'+id),text=(id,value)=>{el(id).textContent=displayText(value);};
  addHelp(panel.querySelector('h2'),'Geo Connections');
  const intro=node('p','Veja para onde as conexões públicas da rede apontam. Passe o cursor, use Tab ou toque nos pontos para ver localização aproximada, provedores e conexões. Use o botão “i” para entender a cobertura e os limites.','hint geo-intro');panel.querySelector('.panel-heading').after(intro);
  const searchLabel=node('label','Buscar destino'),search=node('input');search.id='geo-search';search.type='search';search.maxLength=160;search.placeholder='IP, cidade, país, provedor ou porta';searchLabel.append(search);el('clear').before(searchLabel);
  const inventory=node('div');inventory.id='geo-huawei';el('huawei').replaceWith(inventory);
  const svg=svgNode('svg',{viewBox:'0 0 720 360',role:'group','aria-label':'Destinos geográficos aproximados das conexões observadas',tabindex:'0'});
  const grid=svgNode('g',{'class':'geo-graticule'});
  for(let lon=-150;lon<=150;lon+=30)grid.append(svgNode('path',{d:'M'+project(lon,90).join(' ')+'V360'}));
  for(let lat=-60;lat<=60;lat+=30)grid.append(svgNode('path',{d:'M0 '+project(0,lat)[1]+'H720'}));
  const outlines=svgNode('g',{'class':'geo-land'});
  for(const feature of land.features){const polygons=feature.geometry.type==='Polygon'?[feature.geometry.coordinates]:feature.geometry.coordinates;
    for(const polygon of polygons){const d=polygon.map(ring=>ring.map((p,i)=>(i?'L':'M')+project(p[0],p[1]).map(v=>v.toFixed(2)).join(' ')).join('')+'Z').join('');outlines.append(svgNode('path',{d,'fill-rule':'evenodd'}));}}
  const routes=svgNode('g',{'class':'geo-routes','aria-hidden':'true'}),points=svgNode('g',{'class':'geo-points'});
  const origin=svgNode('g',{'class':'geo-origin','aria-label':'Origem ilustrativa das linhas'});
  origin.append(svgNode('path',{d:'M3 3 L23 23','class':'geo-origin-leader'}),svgNode('rect',{x:16,y:20,width:112,height:33,rx:6,'class':'geo-origin-plate'}),svgNode('circle',{r:9,'class':'geo-origin-ring'}),svgNode('circle',{r:3,'class':'geo-origin-core'}));
  const originName=svgNode('text',{x:25,y:33,'class':'geo-origin-name'});originName.textContent=networkMapOrigin.label;const originNote=svgNode('text',{x:25,y:44,'class':'geo-origin-note'});originNote.textContent='PONTO ILUSTRATIVO';origin.append(originName,originNote);
  svg.append(grid,outlines,routes,points,origin);el('map-container').append(svg);
  el('map-container').classList.add('geo-neon-map');
  el('map-container').insertAdjacentHTML('afterbegin','<div class="geo-map-hud"><span><i></i> CONNECTION MATRIX</span><span id="geo-motion-label">AGUARDANDO LEITURA</span></div>');
  el('map-container').insertAdjacentHTML('beforeend','<div class="geo-map-legend"><span>ORIGEM <b>→</b> DESTINO</span><span>Cor por fluxo · pulsos indicam direção</span></div>');
  let view={x:0,y:0,w:720,h:360},page=0,selected=null,lastHuawei=null,visible=[],lastGeo=null,mapGroups=new Map();const markers=new Map(),routeEntries=new Map();
  const mapOrigin=()=>lastGeo?.mapOrigin||networkMapOrigin;
  const originPoint=()=>project(mapOrigin().longitude,mapOrigin().latitude);
  function positionRoutes(){const start=originPoint(),scale=view.w/720;origin.setAttribute('transform','translate('+start.join(' ')+') scale('+scale+')');for(const entry of routeEntries.values())for(const path of entry.paths)path.setAttribute('d',routePath(start,entry.end,entry.lane*scale));}
  function setView(){view.x=Math.max(0,Math.min(720-view.w,view.x));view.y=Math.max(0,Math.min(360-view.h,view.y));svg.setAttribute('viewBox',[view.x,view.y,view.w,view.h].join(' '));for(const entry of markers.values())entry.circle.setAttribute('r',entry.radius*view.w/720);positionRoutes();}
  function zoom(factor){hidePopup();const width=Math.max(90,Math.min(720,view.w*factor));view.x+=(view.w-width)/2;view.y+=(view.h-width/2)/2;view.w=width;view.h=width/2;setView();}
  el('zoom-in').onclick=()=>zoom(.65);el('zoom-out').onclick=()=>zoom(1/.65);el('reset').onclick=()=>{view={x:0,y:0,w:720,h:360};setView();};
  let drag=null;
  svg.addEventListener('pointerdown',event=>{if(event.button!==0||event.target.closest('.geo-marker,.geo-origin'))return;hidePopup();drag={x:event.clientX,y:event.clientY,vx:view.x,vy:view.y};svg.setPointerCapture?.(event.pointerId);});
  svg.addEventListener('pointermove',event=>{if(!drag)return;const scale=1/(svg.getScreenCTM()?.a||1),dx=(event.clientX-drag.x)*scale,dy=(event.clientY-drag.y)*scale;view.x=drag.vx-dx;view.y=drag.vy-dy;setView();});
  for(const type of ['pointerup','pointercancel'])svg.addEventListener(type,()=>{drag=null;});
  svg.addEventListener('keydown',event=>{if(event.target!==svg)return;const steps={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};if(steps[event.key]){event.preventDefault();view.x+=steps[event.key][0]*view.w/10;view.y+=steps[event.key][1]*view.h/10;setView();}else if(event.key==='+'||event.key==='=')zoom(.65);else if(event.key==='-')zoom(1/.65);});
  const popup=node('div',undefined,'geo-point-popup');popup.id='geo-point-popup';popup.hidden=true;popup.setAttribute('role','dialog');popup.setAttribute('aria-label','Resumo do ponto no mapa');
  const popupClose=node('button','×','geo-popup-close');popupClose.type='button';popupClose.setAttribute('aria-label','Fechar resumo do ponto');
  const popupBody=node('div'),popupMore=node('button','Ver todos os detalhes','geo-popup-more');popupMore.type='button';popup.append(popupClose,popupBody,popupMore);el('map-container').append(popup);
  let popupKey=null,popupAnchor=null,popupPinned=false,popupTimer=null;
  function hidePopup(){clearTimeout(popupTimer);popup.hidden=true;popupAnchor?.setAttribute('aria-expanded','false');popupKey=null;popupAnchor=null;popupPinned=false;}
  function deferHide(){clearTimeout(popupTimer);popupTimer=setTimeout(()=>{if(!popupPinned&&!popup.contains(document.activeElement)&&document.activeElement!==popupAnchor)hidePopup();},180);}
  function shortList(values,limit=3){const list=[...new Set(values.filter(Boolean))];return list.slice(0,limit).join(' · ')+(list.length>limit?' · +'+(list.length-limit)+' outros':'');}
  function openPopup(key,anchor){
    const isOrigin=key==='origin',group=mapGroups.get(key);if(!isOrigin&&!group){hidePopup();return;}
    const rows=isOrigin?visible:visible.filter(r=>hasCoordinates(r.geo)&&r.geo.latitude===group.lat&&r.geo.longitude===group.lon),summary=summarizeGeo(rows);
    clearTimeout(popupTimer);if(popupAnchor&&popupAnchor!==anchor){popupAnchor.setAttribute('aria-expanded','false');popupPinned=false;}popupKey=key;popupAnchor=anchor;anchor.setAttribute('aria-expanded','true');
    popupBody.replaceChildren();popupBody.append(node('p',isOrigin?'ORIGEM ILUSTRATIVA':'DESTINO OBSERVADO','geo-popup-eyebrow'));
    popupBody.append(node('h3',isOrigin?mapOrigin().label:shortList(summary.destinations.map(d=>[...new Set([d.geo.city,d.geo.region,d.geo.country||d.geo.countryCode].filter(Boolean))].join(' / ')),2)||'Localização aproximada'));
    const stats=node('div',undefined,'geo-popup-stats');for(const [number,label] of [[summary.connections,el('mode').value==='history'?'nas últimas observações':'conexões no snapshot'],[summary.destinations.length,'destinos']]){const card=node('div');card.append(node('strong',number),node('small',label));stats.append(card);}popupBody.append(stats);
    const facts=node('dl'),fact=(label,value)=>facts.append(node('dt',label),node('dd',value||'Não informado'));
    if(isOrigin)fact('Referência',lastGeo?.mapOrigin?'Referência aproximada configurada pelo operador.':'Ponto ilustrativo usado para desenhar as linhas.');
    else{
      fact('ASN / provedor',shortList(summary.asns.map(a=>a.label)));
      fact('Destinos',shortList(summary.destinations.map(d=>d.ip)));
      fact('Coordenadas',group.lat+', '+group.lon);
      const radii=rows.map(r=>r.geo?.accuracyRadiusKm).filter(v=>Number.isFinite(v)&&v>=0);if(radii.length){const min=Math.min(...radii),max=Math.max(...radii);fact('Raio informado',min===max?min+' km':min+'–'+max+' km (conforme o destino)');}
    }
    fact('WAN observada',shortList(rows.map(r=>r.wan||'Não identificada')));
    fact('Protocolos / portas',shortList(rows.map(r=>(r.protocol||'—')+'/'+(r.port??'—')),6));
    fact('Origens observadas',shortList(rows.map(r=>r.source.label===r.source.ip?r.source.ip:r.source.label+' · '+r.source.ip)));
    popupBody.append(facts,node('p',(el('mode').value==='history'?'Histórico · última observação: ':'Snapshot: ')+time(el('mode').value==='history'?Math.max(0,...rows.map(r=>r.lastSeen||0)):lastGeo?.time),'hint'));
    popupBody.append(node('p',isOrigin?'Os destinos são aproximados por GeoIP. Clientes do Huawei permanecem agregados por NAT.':'GeoIP descreve infraestrutura aproximada. CDN, VPN e anycast podem apontar para outro local.','hint'));
    popupMore.hidden=isOrigin;popup.hidden=false;popup.style.maxHeight=Math.max(120,el('map-container').clientHeight-24)+'px';
    const map=el('map-container').getBoundingClientRect(),point=anchor.getBoundingClientRect();popup.style.left=Math.max(12,Math.min(map.width-popup.offsetWidth-12,point.right-map.left+14))+'px';popup.style.top=Math.max(12,Math.min(map.height-popup.offsetHeight-12,point.top-map.top-30))+'px';
  }
  popupClose.onclick=hidePopup;popup.addEventListener('pointerenter',()=>clearTimeout(popupTimer));popup.addEventListener('pointerleave',deferHide);popup.addEventListener('focusout',deferHide);popup.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();const anchor=popupAnchor;hidePopup();anchor?.focus();hidePopup();}});
  popupMore.onclick=()=>{const group=mapGroups.get(popupKey);if(!group)return;selected={lat:group.lat,lon:group.lon};hidePopup();showDetail();el('detail').scrollIntoView({block:'nearest'});};
  origin.setAttribute('tabindex','0');origin.setAttribute('role','button');origin.setAttribute('aria-controls',popup.id);origin.setAttribute('aria-expanded','false');origin.addEventListener('pointerenter',()=>openPopup('origin',origin));origin.addEventListener('pointerleave',deferHide);origin.addEventListener('focus',()=>openPopup('origin',origin));origin.addEventListener('blur',deferHide);origin.addEventListener('click',()=>{openPopup('origin',origin);popupPinned=true;});origin.addEventListener('keydown',event=>{if(event.key==='Escape')hidePopup();else if(event.key==='Enter'||event.key===' '){event.preventDefault();openPopup('origin',origin);popupPinned=true;}});
  document.addEventListener('pointerdown',event=>{if(!popup.hidden&&!popup.contains(event.target)&&!event.target.closest('.geo-marker,.geo-origin'))hidePopup();});window.addEventListener('resize',hidePopup);
  function options(id,values,label){const select=el(id),old=select.value,items=[['',label],...values];const signature=JSON.stringify(items.map(([key,label])=>[key,displayText(label)]));if(select.dataset.options===signature)return;select.dataset.options=signature;select.replaceChildren();for(const [value,label] of items){const option=node('option',label);option.value=value;select.append(option);}select.value=items.some(v=>v[0]===old)?old:'';}
  function rank(id,items){const target=el(id);target.replaceChildren();for(const item of items){const line=node('div',undefined,'geo-rank');line.append(node('span',item.label),node('strong',item.connections));target.append(line);}if(!items.length)target.append(node('p','Sem dados para este filtro','hint list-placeholder'));}
  function showDetail(){const target=el('detail');target.replaceChildren();if(!selected){target.append(node('p','Selecione um destino para ver origens, WAN, portas e coordenadas.','hint'));return;}
    const rows=visible.filter(r=>selected.ip?r.ip===selected.ip:hasCoordinates(r.geo)&&r.geo.latitude===selected.lat&&r.geo.longitude===selected.lon);
    target.append(node('h3','Detalhe do destino observado'));if(!rows.length){target.append(node('p','Destino ausente nesta visão ou nos filtros atuais.','hint'));return;}
    const isHistory=el('mode').value==='history';for(const dest of summarizeGeo(rows).destinations){const geo=dest.geo,record=node('article',undefined,'geo-destination');record.append(node('h4',dest.ip));record.append(node('p',[geo.country,geo.region,geo.city].filter(Boolean).join(' / ')||'Localização indisponível'));
      record.append(node('p',hasCoordinates(geo)?'Coordenadas aproximadas: '+geo.latitude+', '+geo.longitude+(geo.accuracyRadiusKm!==null&&geo.accuracyRadiusKm!==undefined?' · raio informado: '+geo.accuracyRadiusKm+' km':' · raio não informado'):'Coordenadas indisponíveis'));
      record.append(node('p',geo.asn?'AS'+geo.asn+' · '+(geo.organization||'Organização indisponível'):'ASN indisponível'));
      for(const row of dest.rows){record.append(node('p',row.source.label+' · '+row.source.ip+(row.source.mac?' · '+row.source.mac:'')+' → '+row.ip+' · '+row.protocol+'/'+(row.port??'—')+' · WAN '+(row.wan||'não identificada')+' · '+row.connections+(isHistory?' conexões na última observação desta combinação':' conexões no snapshot')));
        if(isHistory)record.append(node('p','Primeiro registro: '+time(row.firstSeen)+' · último: '+time(row.lastSeen)+' · '+row.samplesSeen+' snapshots · pico observado: '+row.peakConnections,'hint'));}
      if(geo.state!=='available')record.append(node('p','GeoIP: '+(stateLabel[geo.state]||'indisponível'),'hint'));target.append(record);
    }
  }
  function renderMap(destinations){mapGroups=new Map();for(const dest of destinations){if(!hasCoordinates(dest.geo))continue;const key=dest.geo.latitude+','+dest.geo.longitude,group=mapGroups.get(key)||{lat:dest.geo.latitude,lon:dest.geo.longitude,connections:0,ips:[]};group.connections+=dest.connections;group.ips.push(dest.ip);mapGroups.set(key,group);}
    for(const [key,entry] of markers)if(!mapGroups.has(key)){entry.circle.remove();markers.delete(key);}
    for(const [key,group] of mapGroups){let entry=markers.get(key);if(!entry){const [cx,cy]=project(group.lon,group.lat),circle=svgNode('circle',{cx,cy,tabindex:'0',role:'button','class':'geo-marker'}),title=svgNode('title');circle.append(title);entry={circle,title};markers.set(key,entry);points.append(circle);
        circle.setAttribute('aria-controls','geo-point-popup');circle.setAttribute('aria-expanded','false');
        circle.addEventListener('pointerenter',()=>openPopup(key,circle));circle.addEventListener('pointerleave',deferHide);circle.addEventListener('focus',()=>openPopup(key,circle));circle.addEventListener('blur',deferHide);
        circle.addEventListener('click',()=>{openPopup(key,circle);popupPinned=true;});circle.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openPopup(key,circle);popupPinned=true;}else if(event.key==='Escape')hidePopup();});}
      entry.radius=Math.min(5,1.8+Math.log2(1+group.connections)*.5);entry.circle.setAttribute('r',entry.radius*view.w/720);const label=group.ips.length+' destinos · '+group.connections+' conexões · '+group.lat+', '+group.lon;entry.circle.setAttribute('aria-label',label);entry.title.textContent=label;
    }
    const mapped=visible.filter(row=>hasCoordinates(row.geo)),shown=[];let total=0;
    for(const row of mapped){total+=row.connections;for(let i=0;i<row.connections&&shown.length<700;i++)shown.push({key:row.key+'#'+i,geo:row.geo});}
    const keys=new Set(shown.map(row=>row.key));
    for(const [key,entry] of routeEntries)if(!keys.has(key)){entry.group.remove();routeEntries.delete(key);}
    for(const row of shown){let entry=routeEntries.get(row.key);if(!entry){const style=routeStyle(row.key),group=svgNode('g',{'class':'geo-route'}),paths=['glow','line','pulse'].map(type=>svgNode('path',{'class':'geo-route-'+type,pathLength:100,stroke:style.color}));for(const path of paths)group.append(path);paths[2].style.animationDuration=style.duration+'s';paths[2].style.animationDelay=style.delay+'s';entry={group,paths,lane:style.lane};routeEntries.set(row.key,entry);routes.append(group);}entry.end=project(row.geo.longitude,row.geo.latitude);}
    origin.style.display=shown.length?'':'none';positionRoutes();
    if(popupKey&&!popup.hidden){const anchor=popupKey==='origin'?origin:markers.get(popupKey)?.circle;if(anchor)openPopup(popupKey,anchor);else hidePopup();}
    return {shown:shown.length,total};
  }
  function update(){const snapshot=getSnapshot(),geo=snapshot?.geoConnections;lastGeo=geo;
    if(!geo){text('status','Aguardando o primeiro snapshot de conexões.');return;}
    if(geo.state==='disabled'){text('status','Geolocalização desabilitada.');return;}
    originName.textContent=mapOrigin().label;originNote.textContent=geo.mapOrigin?'ORIGEM APROXIMADA':'PONTO ILUSTRATIVO';origin.setAttribute('aria-label',mapOrigin().label);origin.setAttribute('transform','translate('+originPoint().join(' ')+')');
    const history=el('mode').value==='history',rows=history?geo.history||[]:geo.rows||[],all=summarizeGeo(rows);
    options('source',[...new Map(rows.map(r=>[r.source.ip,r.source.label+' · '+r.source.ip])).entries()],'Todas as origens');options('country',all.countries.map(r=>[r.key,r.label]),'Todos os países');options('provider',all.asns.map(r=>[r.key,r.label]),'Todos os provedores');
    options('protocol',[...new Set(rows.map(r=>r.protocol))].sort().map(v=>[v,v]),'Todos os protocolos');options('wan',[['WAN1','WAN1'],['WAN2','WAN2'],['unknown','Não identificada']],'Todas as WANs');
    const query=normalizeSearch(search.value);
    visible=filterGeoRows(rows,Object.fromEntries(['source','country','provider','protocol','wan'].map(key=>[key,el(key).value]))).filter(r=>!query||normalizeSearch(displayText([r.ip,r.source.label,r.source.ip,r.geo?.country,r.geo?.countryCode,r.geo?.region,r.geo?.city,r.geo?.organization,r.geo?.asn,r.protocol,r.port,r.wan].filter(v=>v!==null&&v!==undefined).join(' '))).includes(query));const summary=summarizeGeo(visible);
    const kpis=el('kpis');kpis.replaceChildren();for(const [value,label] of [[summary.connections,history?'Conexões nas últimas observações¹':'Conexões públicas no filtro'],[summary.destinations.length,'Destinos'],[summary.countryCount,'Países conhecidos'],[summary.asnCount,'ASNs conhecidos']]){const card=node('div');card.append(node('strong',value),node('small',label));kpis.append(card);}
    rank('countries',summary.countries);rank('asns',summary.asns);const routeCount=renderMap(summary.destinations);
    text('map-message',summary.located?routeCount.shown+' trajetos'+(routeCount.total>routeCount.shown?' de '+routeCount.total+' (limite visual de 700; use os filtros)':'')+' · '+summary.located+' / '+summary.connections+' conexões com coordenadas. Uma linha por conexão '+(history?'na última observação de cada combinação':'no snapshot')+'. Origem: '+mapOrigin().label+'. Pulsos indicam direção, não velocidade ou pacotes medidos.':'Nenhuma coordenada disponível nesta visão. IPs e filtros continuam disponíveis; nenhum ponto foi estimado.');
    const db=geo.databases||{},dbLabel=entry=>(stateLabel[entry?.state]||'pendente')+(entry?.updatedAt?' (base de '+time(entry.updatedAt)+(now()-entry.updatedAt>30*86400000?' · desatualizada':'')+')':'');text('status','City: '+dbLabel(db.city)+' · ASN: '+dbLabel(db.asn)+' · última leitura: '+time(geo.time)+'. '+(history?'¹ Histórico de combinações origem/destino/porta/protocolo/WAN; valores são do último snapshot de cada combinação, não conexões únicas nem simultâneas.':''));
    const c=geo.coverage||{};text('coverage',(c.partial?'COBERTURA PARCIAL · ':'')+(c.observedRows??0)+' / '+(c.totalConnections??'—')+' registros expostos pelo coletor · '+(c.publicConnections??0)+' para destinos públicos · '+(c.excludedConnections??0)+' destinos especiais ignorados · IPv6: '+(c.ipv6State||'pendente')+'. Conexões curtas entre snapshots podem faltar.'+(c.fasttrack||c.offloaded?' FastTrack/offload pode limitar bytes observados.':'')+' Histórico volátil: '+(geo.limits?.retentionMinutes??0)+' min / '+(geo.limits?.maxHistoryEntries??0)+' combinações; '+(geo.historyEvictions||0)+' descartadas por limite.');
    text('count-heading',history?'Conexões nas últimas observações¹':'Conexões no snapshot');
    const pages=Math.max(1,Math.ceil(summary.destinations.length/100));page=Math.min(page,pages-1);el('rows').replaceChildren();
    for(const dest of summary.destinations.slice(page*100,(page+1)*100)){const tr=node('tr'),button=node('button',dest.ip);button.onclick=()=>{selected={ip:dest.ip};showDetail();el('detail').scrollIntoView({block:'nearest'});};const first=node('td');first.append(button);tr.append(first);
      const rows=dest.rows;for(const value of [[dest.geo.country,dest.geo.region,dest.geo.city].filter(Boolean).join(' / ')||'Indisponível',dest.geo.asn?'AS'+dest.geo.asn+' · '+(dest.geo.organization||'—'):'Indisponível',dest.connections,[...new Set(rows.map(r=>r.protocol+'/'+(r.port??'—')))].join(', '),[...new Set(rows.map(r=>r.wan||'Não identificada'))].join(', ')])tr.append(node('td',value));el('rows').append(tr);}
    if(!summary.destinations.length){const tr=node('tr'),cell=node('td','Nenhum destino público nesta visão.');cell.colSpan=6;tr.append(cell);el('rows').append(tr);}text('page',(page+1)+' / '+pages+' · '+summary.destinations.length+' destinos');el('prev').disabled=page===0;el('next').disabled=page>=pages-1;showDetail();freshness();
  }
  let mapInView=true,motionEnabled=true;
  function freshness(){const snapshot=getSnapshot(),stale=!lastGeo?.time||now()-lastGeo.time>Math.max(30000,(snapshot?.cadence?.connections||5)*4000)||lastGeo.state!=='live'||snapshot?.status!=='live'||snapshot?.connections?.state!=='live',history=el('mode').value==='history',paused=isPaused();text('state',paused?'VISÃO PAUSADA':stale?'LEITURA INDISPONÍVEL / ANTIGA':'DESTINOS OBSERVADOS');el('state').className='tag '+(stale?'warn':'up');const animate=motionEnabled&&!paused&&!stale&&!history&&!document.hidden&&mapInView;el('map-container').classList.toggle('geo-map-live',animate);text('motion-label',history?'HISTÓRICO · ESTÁTICO':paused?'VISÃO PAUSADA':stale?'SEM LEITURA RECENTE':motionEnabled?'FLUXOS OBSERVADOS · AO VIVO':'ANIMAÇÃO PAUSADA');}
  const motion=node('button','Pausar animação');motion.id='geo-motion';motion.setAttribute('aria-pressed','false');el('reset').before(motion);motion.onclick=()=>{motionEnabled=!motionEnabled;motion.textContent=motionEnabled?'Pausar animação':'Animar trajetos';motion.setAttribute('aria-pressed',String(!motionEnabled));freshness();};
  document.addEventListener('visibilitychange',freshness);
  if(typeof IntersectionObserver!=='undefined'){const observer=new IntersectionObserver(entries=>{mapInView=entries[0].isIntersecting;freshness();});observer.observe(el('map-container'));}
  for(const id of ['mode','source','country','provider','protocol','wan'])el(id).onchange=()=>{page=0;selected=null;update();};
  search.addEventListener('input',()=>{page=0;selected=null;hidePopup();update();});
  el('clear').onclick=()=>{for(const id of ['source','country','provider','protocol','wan'])el(id).value='';search.value='';page=0;selected=null;hidePopup();update();};el('prev').onclick=()=>{page--;update();};el('next').onclick=()=>{page++;update();};
  function huawei(value){lastHuawei=value;const fresh=value?.state==='live'&&now()-(value.time||0)<=30000,target=el('huawei');target.replaceChildren();target.append(node('p',!value?'Inventário disponível na seção Huawei / controle, quando conectado.':fresh?'Inventário atual:':'Inventário indisponível ou antigo:','hint list-placeholder'));for(const d of value?.devices||[])target.append(node('p',(d.name||'Sem nome')+' · '+d.ip+(d.online?' (ativo)':' (inativo)'),'hint'));}
  document.addEventListener('orbit-display-change',()=>{search.value='';hidePopup();update();huawei(lastHuawei);});setInterval(()=>{freshness();if(lastHuawei)huawei(lastHuawei);},5000);
  update();huawei(null);return {update,setHuawei:huawei};
}
