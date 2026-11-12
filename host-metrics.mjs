import os from 'node:os';
import fs from 'node:fs/promises';

export function cpuPercent(before,after){if(!before||!after)return null;const total=after.total-before.total,idle=after.idle-before.idle;return total>0?Math.max(0,Math.min(100,100*(1-idle/total))):null;}
const cpu=()=>os.cpus().reduce((s,c)=>{s.idle+=c.times.idle;s.total+=Object.values(c.times).reduce((a,b)=>a+b,0);return s;},{idle:0,total:0});
export async function readCpuTemperatures({io=fs,hwmonRoot='/sys/class/hwmon',thermalRoot='/sys/class/thermal'}={}){
 const temperatures=[],read=file=>io.readFile(file,'utf8').catch(()=>''),list=dir=>io.readdir(dir).catch(()=>[]);
 const add=raw=>{const text=String(raw).trim();if(!/^-?\d+$/.test(text))return;const value=Number(text)/1000;if(Number.isFinite(value)&&value>=0&&value<150)temperatures.push(value);};
 for(const name of await list(hwmonRoot)){
  if(!/^hwmon\d+$/.test(name))continue;const directory=hwmonRoot+'/'+name,driver=(await read(directory+'/name')).trim();
  if(!/^(coretemp|k10temp|zenpower|cpu_thermal)$/.test(driver))continue;
  for(const file of await list(directory))if(/^temp\d+_input$/.test(file))add(await read(directory+'/'+file));
 }
 if(!temperatures.length)for(const name of await list(thermalRoot)){
  if(!/^thermal_zone\d+$/.test(name))continue;const directory=thermalRoot+'/'+name,type=(await read(directory+'/type')).trim();
  if(/cpu|coretemp|x86_pkg_temp/i.test(type))add(await read(directory+'/temp'));
 }
 return temperatures;
}
export function createHostMetrics(){
 let priorCpu=null,priorNet=null,snapshot={state:'pending'},busy=false;
 async function sample(){if(busy)return;busy=true;try{
  const time=Date.now(),nextCpu=cpu(),memoryText=await fs.readFile('/proc/meminfo','utf8'),mem={};for(const line of memoryText.split('\n')){const m=line.match(/^(\w+):\s+(\d+)/);if(m)mem[m[1]]=Number(m[2])*1024;}
  const disk=await fs.statfs('/opt/orbit'),netText=await fs.readFile('/proc/net/dev','utf8'),interfaces=[];
  for(const line of netText.split('\n').slice(2)){const [name,values]=line.split(':');if(!values||name.trim()==='lo')continue;const v=values.trim().split(/\s+/).map(Number),old=priorNet?.interfaces.find(i=>i.name===name.trim()),elapsed=priorNet?(time-priorNet.time)/1000:0;const rate=(n,o)=>elapsed>0&&elapsed<=30&&n>=o?(n-o)*8/elapsed/1e6:null;interfaces.push({name:name.trim(),rxBytes:v[0],txBytes:v[8],rxMbps:old?rate(v[0],old.rxBytes):null,txMbps:old?rate(v[8],old.txBytes):null,rxErrors:v[2],txErrors:v[10]});}
  const temperatures=await readCpuTemperatures();
  snapshot={state:'live',time,os:'Debian / Linux '+os.release(),architecture:os.arch(),cpuModel:os.cpus()[0]?.model||'CPU',cores:os.cpus().length,cpuPercent:cpuPercent(priorCpu,nextCpu),load:os.loadavg(),uptimeSeconds:os.uptime(),memory:{total:mem.MemTotal,available:mem.MemAvailable,used:mem.MemTotal-mem.MemAvailable,percent:100*(1-mem.MemAvailable/mem.MemTotal),swapTotal:mem.SwapTotal,swapUsed:mem.SwapTotal-mem.SwapFree},disk:{total:disk.blocks*disk.bsize,available:disk.bavail*disk.bsize,used:(disk.blocks-disk.bfree)*disk.bsize,percent:100*(1-disk.bfree/disk.blocks)},temperature:temperatures.length?Math.max(...temperatures):null,process:{rss:process.memoryUsage().rss,uptimeSeconds:process.uptime()},interfaces};priorCpu=nextCpu;priorNet={time,interfaces};
 }catch{snapshot={...snapshot,state:'error',error:'Não foi possível ler as métricas locais.'};}finally{busy=false;}}
 const ready=sample();const timer=setInterval(sample,5000);timer.unref();return {snapshot:()=>snapshot,close:()=>clearInterval(timer),sample,ready};
}
