export function currentSection(sections,position,{threshold=20,atEnd=false}={}){
 const sorted=sections.filter(s=>Number.isFinite(s.top)).slice().sort((a,b)=>a.top-b.top);
 if(!sorted.length)return null;if(atEnd)return sorted[sorted.length-1].id;
 let current=sorted[0].id;for(const section of sorted){if(section.top<=position+threshold)current=section.id;else break;}return current;
}
export function initNavigation(){
 const sidebar=document.querySelector('aside'),nav=sidebar.querySelector('nav'),main=document.querySelector('main');sidebar.id='orbit-sidebar';nav.setAttribute('aria-label','Seções do ORBIT');
 const bar=document.createElement('div');bar.className='mobile-nav';bar.innerHTML='<a class="mobile-brand" href="#overview" aria-label="ORBIT início">◈ <b>ORBIT</b></a><div class="mobile-location"><small>VOCÊ ESTÁ EM</small><span id="mobile-current">Visão geral</span></div><button id="mobile-menu" type="button" aria-controls="orbit-sidebar" aria-expanded="false" aria-label="Abrir menu">☰ Menu</button>';
 document.body.insertBefore(bar,sidebar);const shade=document.createElement('button');shade.type='button';shade.className='nav-backdrop';shade.setAttribute('aria-label','Fechar menu');shade.tabIndex=-1;document.body.insertBefore(shade,main);
 const toggle=document.getElementById('mobile-menu'),current=document.getElementById('mobile-current'),media=matchMedia('(max-width: 900px)');let opened=false,selected='',frame=null,interacted=false;
 const links=[...nav.querySelectorAll('a[href^="#"]')],sections=links.map(link=>({id:link.hash.slice(1),node:document.getElementById(link.hash.slice(1)),link,name:link.querySelector('span')?.textContent.trim()||link.textContent.trim().replace(/^\d+\s*/, '')})).filter(s=>s.node);
 function activate(id){const section=sections.find(s=>s.id===id);if(!section)return;selected=id;for(const entry of sections){const active=entry.id===id;entry.link.classList.toggle('active',active);if(active)entry.link.setAttribute('aria-current','location');else entry.link.removeAttribute('aria-current');}current.textContent=section.name;bar.setAttribute('aria-label','Seção atual: '+section.name);}
 function menu(open,{focus=true}={}){opened=Boolean(open)&&media.matches;document.body.classList.toggle('nav-open',opened);toggle.setAttribute('aria-expanded',String(opened));toggle.setAttribute('aria-label',opened?'Fechar menu':'Abrir menu');toggle.textContent=opened?'× Fechar':'☰ Menu';if(media.matches)sidebar.setAttribute('aria-hidden',String(!opened));else sidebar.removeAttribute('aria-hidden');if(focus){if(opened)(sections.find(s=>s.id===selected)?.link||links[0]).focus();else toggle.focus();}}
 function measure(){frame=null;const position=window.pageYOffset||document.documentElement.scrollTop||0,visible=sections.filter(s=>s.node.getClientRects().length&&getComputedStyle(s.node).visibility!=='hidden');activate(currentSection(visible.map(s=>({id:s.id,top:s.node.getBoundingClientRect().top+position})),position,{threshold:media.matches?90:28,atEnd:position>0&&position+window.innerHeight>=document.documentElement.scrollHeight-3}));}
 function schedule(){if(frame===null)frame=requestAnimationFrame(measure);}
 function go(link){const id=link.hash.slice(1),section=sections.find(s=>s.id===id);if(!section)return;interacted=true;activate(id);menu(false,{focus:false});
   // Detail sections are intentionally collapsed in objective mode. Reveal them before scrolling.
   if(!section.node.getClientRects().length){const mode=document.getElementById('view-mode');if(mode&&mode.value!=='detailed'){mode.value='detailed';mode.dispatchEvent(new Event('change',{bubbles:true}));}}
   if(location.hash!==link.hash)history.pushState(null,'',link.hash);
   requestAnimationFrame(()=>{const position=section.node.getBoundingClientRect().top+(window.pageYOffset||0)-(media.matches?82:18),root=document.documentElement,previousBehavior=root.style.scrollBehavior;root.style.scrollBehavior='auto';void root.offsetHeight;window.scrollTo(0,Math.max(0,position));requestAnimationFrame(()=>{root.style.scrollBehavior=previousBehavior;schedule();});});
 }
 nav.addEventListener('click',event=>{const link=event.target.closest('a[href^="#"]');if(!link||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;interacted=true;event.preventDefault();go(link);});
 toggle.onclick=()=>menu(!opened);shade.onclick=()=>menu(false);
 bar.querySelector('a').onclick=event=>{interacted=true;event.preventDefault();go(links.find(a=>a.hash==='#overview'));};
 for(const type of ['wheel','touchstart','keydown'])window.addEventListener(type,()=>{interacted=true;},{passive:true});
 document.addEventListener('keydown',event=>{if(!opened)return;if(event.key==='Escape'){event.preventDefault();menu(false);return;}if(event.key==='Tab'){const nodes=[...sidebar.querySelectorAll('a,button')].filter(n=>!n.disabled&&n.getClientRects().length);const first=nodes[0],last=nodes[nodes.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}});
 function breakpoint(){menu(false,{focus:false});schedule();}if(media.addEventListener)media.addEventListener('change',breakpoint);else media.addListener(breakpoint);
 window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule);window.addEventListener('hashchange',schedule);window.addEventListener('popstate',()=>{const link=links.find(a=>a.hash===location.hash);if(link)go(link);else schedule();});
 document.addEventListener('orbit-display-change',schedule);
 const observer=typeof ResizeObserver==='function'?new ResizeObserver(schedule):null;if(observer)observer.observe(main);
 breakpoint();activate(sections.some(s=>s.id===location.hash.slice(1))?location.hash.slice(1):'overview');
 // Sections are inserted dynamically and telemetry changes their heights on load.
 let aligned=false;const initialHash=location.hash;const settle=setInterval(()=>{if(!interacted&&!aligned&&initialHash===location.hash&&initialHash&&sections.some(s=>s.id===initialHash.slice(1))&&document.querySelector('#status')?.textContent.includes('COLETA ATIVA')){go(links.find(a=>a.hash===initialHash));aligned=true;}else schedule();},1000);
 setTimeout(()=>{clearInterval(settle);schedule();},5000);
 return {update:schedule};
}
