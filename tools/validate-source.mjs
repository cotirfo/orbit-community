import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function walk(folder){return fs.readdirSync(folder,{withFileTypes:true}).flatMap(d=>['.git','node_modules','data','work'].includes(d.name)?[]:d.isDirectory()?walk(path.join(folder,d.name)):[path.join(folder,d.name)]);}
let failures=0,checked=0;
for(const file of walk(root)){
 if(/\.(?:mjs|cjs|js)$/.test(file)&&!file.endsWith(path.join('public','infrastructure.js'))){const r=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});checked++;if(r.status!==0){console.error(path.relative(root,file)+': syntax check failed');failures++;}}
 if(file.endsWith('.json')&&!['config.json','inventory.json'].includes(path.basename(file))){try{JSON.parse(fs.readFileSync(file,'utf8'));checked++;}catch{console.error(path.relative(root,file)+': invalid JSON');failures++;}}
}
console.log(JSON.stringify({checked,failures}));process.exitCode=failures?1:0;
