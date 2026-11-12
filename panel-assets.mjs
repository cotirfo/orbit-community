import fs from 'node:fs/promises';
import path from 'node:path';

const assets=new Map([
  ['/','index.html'],['/app.js','app.js'],['/charts.js','charts.js'],
  ['/style.css','style.css'],['/infrastructure.js','infrastructure.js']
]);
const types={'.html':'text/html','.css':'text/css','.js':'text/javascript'};
export const panelAssetPaths=[...assets.keys()];

export async function sendPanelAsset(res,pathname,root,role='monitor'){
  const asset=assets.get(pathname);
  if(!asset)return false;
  try{
    let content=await fs.readFile(path.join(root,'public',asset));
    if(pathname==='/')content=content.toString('utf8').replace('name="orbit-role" content="monitor"','name="orbit-role" content="'+role+'"');
    res.writeHead(200,{'Content-Type':types[path.extname(asset)]+'; charset=utf-8'});
    res.end(content);
  }catch(error){
    res.writeHead(error.code==='ENOENT'?404:500,{'Content-Type':'text/plain; charset=utf-8'});
    res.end(error.code==='ENOENT'?'Asset do painel indisponível. Execute npm run build.':'Não foi possível ler o asset do painel.');
  }
  return true;
}
