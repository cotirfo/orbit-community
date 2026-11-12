// Controls only the rendered records; existing collector limits and filters remain authoritative.
export const normalizeSearch=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').trim();

export function initListControls(){
  const existingSearch={'flow-rows':'flow-search','hw-devices':'hw-search','geo-rows':'geo-search'};
  const targets=[...document.querySelectorAll('.table-scroll,.ranked,#events,#alerts,#hw-audit-rows,#geo-countries,#geo-asns,#geo-detail,#geo-huawei')];
  for(const [index,target] of targets.entries()){
    if(target.dataset.listReady)continue;target.dataset.listReady='true';
    const body=target.querySelector('tbody'),content=body||target;
    const named={'geo-countries':'Países observados','geo-asns':'Provedores observados','geo-detail':'Detalhes dos destinos','geo-huawei':'Inventário Huawei no Geo','hw-audit-rows':'Auditoria dos controles',events:'Eventos observados',alerts:'Alertas observados'};
    const headingNode=target.closest('.panel')?.querySelector('h2,h3');
    const heading=body?.id==='geo-rows'?'Destinos Geo':named[target.id]||headingNode?.dataset.telemetryName||headingNode?.textContent.trim()||'registros';
    const id=target.id||(target.id='orbit-list-'+index),native=body&&document.getElementById(existingSearch[body.id]);
    const toolbar=document.createElement('div');toolbar.className='list-toolbar';
    const input=document.createElement('input');input.type='search';input.maxLength=160;input.placeholder='Filtrar esta lista…';input.setAttribute('aria-label','Filtrar lista: '+heading);input.setAttribute('aria-controls',id);
    const count=document.createElement('span');count.className='list-count';
    const toggle=document.createElement('button');toggle.type='button';toggle.setAttribute('aria-controls',id);toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label','Expandir lista: '+heading);
    const empty=document.createElement('p');empty.className='hint list-no-results';empty.textContent='Nenhum registro corresponde ao filtro.';empty.hidden=true;
    if(!native)toolbar.append(input);toolbar.append(count,toggle);target.before(toolbar);target.after(empty);
    target.classList.add('bounded-list');target.setAttribute('tabindex','0');target.setAttribute('aria-label','Lista com rolagem: '+heading);
    let expanded=false,pending=false,scroll=0;
    const items=()=>body?[...body.rows].filter(row=>!row.querySelector('td[colspan]')):[...content.children].filter(row=>!row.matches('h2,h3,.empty')&&!row.classList.contains('list-placeholder'));
    function render(){pending=false;const rows=items(),query=normalizeSearch(input.value);let matched=0;
      for(const row of rows){const keep=!query||normalizeSearch(row.textContent).includes(query);row.hidden=!keep;if(keep)matched++;}
      target.classList.toggle('list-expanded',expanded);
      toolbar.hidden=rows.length<=8&&target.scrollHeight<=target.clientHeight+3&&!query&&!expanded;
      count.textContent=matched+' / '+rows.length+(body?.id==='geo-rows'?' nesta página':' registros');
      empty.hidden=!rows.length||matched>0;
      toggle.textContent=expanded?'Recolher lista':'Expandir lista';toggle.setAttribute('aria-expanded',String(expanded));toggle.setAttribute('aria-label',(expanded?'Recolher':'Expandir')+' lista: '+heading);
      target.classList.toggle('list-expanded',expanded);target.scrollTop=scroll;
    }
    function schedule(){if(pending)return;pending=true;requestAnimationFrame(render);}
    input.addEventListener('input',()=>{scroll=0;render();});toggle.onclick=()=>{expanded=!expanded;scroll=0;render();};
    target.addEventListener('scroll',()=>{scroll=target.scrollTop;},{passive:true});
    new MutationObserver(schedule).observe(content,{childList:true,subtree:true,characterData:true});
    document.addEventListener('orbit-display-change',()=>{input.value='';scroll=0;schedule();});render();
  }
}
