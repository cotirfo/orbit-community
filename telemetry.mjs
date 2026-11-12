export function finite(value) {
  if(value===undefined||value===null||value==='') return null;
  const n=Number(value);return Number.isFinite(n)?n:null;
}
export function counterRate(current,previous,seconds,maxGap) {
  if(!Number.isFinite(current)||!Number.isFinite(previous)||seconds<=0||seconds>maxGap||current<previous) return null;
  return (current-previous)/seconds;
}
export function percentUsed(free,total) {
  const f=finite(free),t=finite(total);return f!==null&&t!==null&&t>0?100*(1-f/t):null;
}
export function uptimeSeconds(value) {
  const s=String(value||'');let total=0;
  for(const m of s.matchAll(/(\d+)(w|d|h|m|s)/g)) total+=Number(m[1])*({w:604800,d:86400,h:3600,m:60,s:1}[m[2]]);
  const clock=s.match(/(?:^|\s)(\d+):(\d+):(\d+)$/);
  if(clock) total+=Number(clock[1])*3600+Number(clock[2])*60+Number(clock[3]);
  return total;
}
