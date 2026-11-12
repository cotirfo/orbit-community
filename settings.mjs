import fs from 'node:fs';
import path from 'node:path';
import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';

export const projectRoot=path.dirname(fileURLToPath(import.meta.url));
export const defaultCredentialDir='/run/credentials/orbit-community.service';
const wanSlots=['WAN1','WAN2'];
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const invalid=field=>new Error('Configuração inválida em '+field+'.');
const object=(value,field)=>{
  if(value===undefined)return {};
  if(!record(value))throw invalid(field);
  return value;
};
const list=(value,field)=>{
  if(value===undefined)return [];
  if(!Array.isArray(value))throw invalid(field);
  return value;
};
const integer=(value,field,fallback,min,max)=>{
  if(value===undefined)return fallback;
  if(!Number.isInteger(value)||value<min||value>max)throw invalid(field);
  return value;
};
const flag=(value,field,fallback=false)=>{
  if(value===undefined)return fallback;
  if(typeof value!=='boolean')throw invalid(field);
  return value;
};
const location=(base,value,field,fallback)=>{
  if(value===undefined)return fallback;
  if(typeof value!=='string'||!value.trim()||value.includes('\0'))throw invalid(field);
  return path.resolve(base,value);
};
function json(filename,field,optional){
  let input;
  try{input=fs.readFileSync(filename,'utf8');}
  catch(error){
    if(optional&&error.code==='ENOENT')return {};
    throw new Error('Não foi possível ler '+field+'.');
  }
  try{return object(JSON.parse(input.replace(/^\uFEFF/,'')),field);}
  catch{throw invalid(field+' (JSON)');}
}
export function validRouterUser(value){
  return typeof value==='string'&&value.length>0&&value.length<=128&&!/[:\s\x00-\x1f\x7f]/.test(value);
}
export function deviceOrigin(value,protocols,field){
  let url;
  try{url=new URL(value);}
  catch{throw invalid(field);}
  if(!protocols.includes(url.protocol)||!url.hostname||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw invalid(field);
  return url;
}
export function localHostHeader(host,port){
  return ['127.0.0.1','localhost'].some(name=>host===name+':'+port||(port===80&&host===name));
}

export function loadSettings({root=projectRoot,cwd=process.cwd(),env=process.env}={}){
  const configFile=location(cwd,env.ORBIT_CONFIG,'ORBIT_CONFIG',path.join(root,'config.json'));
  const configDirectory=path.dirname(configFile);
  const raw=json(configFile,'configuração',env.ORBIT_CONFIG===undefined);
  const inventoryFile=location(cwd,env.ORBIT_INVENTORY,'ORBIT_INVENTORY')??
    location(configDirectory,raw.inventoryFile,'inventoryFile',path.join(configDirectory,'inventory.json'));
  const originalInventory=json(inventoryFile,'inventário',env.ORBIT_INVENTORY===undefined&&raw.inventoryFile===undefined);
  const dataDir=location(cwd,env.ORBIT_DATA_DIR,'ORBIT_DATA_DIR')??
    location(configDirectory,raw.dataDir,'dataDir',path.join(root,'data'));

  const inventoryLinks=list(originalInventory.links,'inventário.links');
  const wan={...object(raw.wan,'wan')};
  const uniqueLinks=new Set();
  for(const row of inventoryLinks){
    if(!record(row)||!wanSlots.includes(row.name)||uniqueLinks.has(row.name)||typeof row.interface!=='string'||!row.interface.trim())throw invalid('inventário.links (slots WAN1 e WAN2)');
    if(wan[row.name]!==undefined&&wan[row.name]!==row.interface)throw invalid('wan e inventário.links.interface (interfaces divergentes)');
    uniqueLinks.add(row.name);
    wan[row.name]=row.interface;
  }
  if(Object.entries(wan).some(([name,iface])=>!wanSlots.includes(name)||typeof iface!=='string'||!iface.trim()))throw invalid('wan (slots WAN1 e WAN2)');
  const inventory={
    ...originalInventory,
    router:object(originalInventory.router,'inventário.router'),
    links:Object.entries(wan).map(([name,iface])=>inventoryLinks.find(link=>link.name===name)??{name,interface:iface}),
    devices:list(originalInventory.devices,'inventário.devices')
  };

  const router=object(raw.routerOS,'routerOS'),lan=object(raw.lan,'lan'),monitor=object(raw.monitorHttps,'monitorHttps');
  const huawei=object(raw.huawei,'huawei'),energy=object(raw.energy,'energy'),geo=object(raw.geoConnections,'geoConnections');
  const speed=object(raw.speedTest,'speedTest'),ookla=object(speed.ookla,'speedTest.ookla');
  const speedEnabled=flag(speed.enabled,'speedTest.enabled');
  const speedProfiles=(speedEnabled?list(speed.profiles,'speedTest.profiles'):[]).map(p=>{
    if(!record(p)||!wanSlots.includes(p.name)||typeof p.interface!=='string'||!p.interface.trim())throw invalid('speedTest.profiles');
    const {name,interface:iface,table,probe,gateway,routerSource,localPort,localPorts,serverList,serverHosts}=p;
    if(wan[name]&&wan[name]!==iface)throw invalid('speedTest.profiles.interface (interface divergente da WAN)');
    return {name,interface:iface,table,probe,gateway,routerSource,localPort,localPorts,serverList,serverHosts};
  });
  if(new Set(speedProfiles.map(p=>p.name)).size!==speedProfiles.length)throw invalid('speedTest.profiles (WAN duplicada)');
  const cross=object(raw.crossQuality,'crossQuality');
  const routerEnabled=flag(router.enabled,'routerOS.enabled',Boolean(raw.routerUrl));
  const huaweiEnabled=flag(huawei.enabled,'huawei.enabled',Boolean(huawei.origin));
  const monitorEnabled=flag(monitor.enabled,'monitorHttps.enabled');
  const port=integer(raw.port,'port',8787,1,65535);
  const controlPort=integer(lan.controlPort,'lan.controlPort',18879,1,65535);
  const routerUser=router.user??env.MIKROTIK_USER??'orbit-monitor';
  if(!validRouterUser(routerUser))throw invalid('routerOS.user ou MIKROTIK_USER');

  const mapOrigin=geo.mapOrigin;
  if(mapOrigin!==undefined&&(!record(mapOrigin)||typeof mapOrigin.label!=='string'||!mapOrigin.label.trim()||mapOrigin.label.length>100||
    !Number.isFinite(mapOrigin.latitude)||Math.abs(mapOrigin.latitude)>90||!Number.isFinite(mapOrigin.longitude)||Math.abs(mapOrigin.longitude)>180))throw invalid('geoConnections.mapOrigin');
  const crossLinks=list(cross.links,'crossQuality.links');
  if(crossLinks.length&&(crossLinks.length!==2||new Set(crossLinks.map(link=>link?.name)).size!==2||
    crossLinks.some(link=>!record(link)||!wan[link.name]||isIP(link.source)!==4||isIP(link.gateway)!==4||typeof link.table!=='string'||!link.table.trim()||
      (link.interface!==undefined&&link.interface!==wan[link.name]))))throw invalid('crossQuality.links');

  const config={
    ...raw, port, wan,
    intervalSeconds:integer(raw.intervalSeconds,'intervalSeconds',2,2,86400),
    connectionSeconds:integer(raw.connectionSeconds,'connectionSeconds',5,5,86400),
    detailsSeconds:integer(raw.detailsSeconds,'detailsSeconds',30,20,86400),
    retentionDays:integer(raw.retentionDays,'retentionDays',7,1,30),
    monitoredInterfaces:list(raw.monitoredInterfaces,'monitoredInterfaces'),
    lanInterface:raw.lanInterface,
    caFile:location(configDirectory,raw.caFile,'caFile'),
    routerOS:{
      enabled:routerEnabled,user:routerUser,
      timeoutMs:integer(router.timeoutMs,'routerOS.timeoutMs',5000,100,60000),
      credentialKeyFile:location(cwd,env.ORBIT_COLLECTOR_KEY_FILE,'ORBIT_COLLECTOR_KEY_FILE')??
        location(configDirectory,router.credentialKeyFile,'routerOS.credentialKeyFile',path.join(env.CREDENTIALS_DIRECTORY||defaultCredentialDir,'collector-key'))
    },
    persistCollector:flag(raw.persistCollector,'persistCollector'),
    huawei:{
      ...huawei, enabled:huaweiEnabled,
      persistSession:flag(huawei.persistSession,'huawei.persistSession',true),
      timeoutMs:integer(huawei.timeoutMs,'huawei.timeoutMs',8000,100,60000),
      intervalSeconds:integer(huawei.intervalSeconds,'huawei.intervalSeconds',10,2,300),
      heartbeatSeconds:integer(huawei.heartbeatSeconds,'huawei.heartbeatSeconds',5,2,60)
    },
    lan:{
      ...lan, enabled:flag(lan.enabled,'lan.enabled'), controlPort,
      port:integer(lan.port,'lan.port',monitorEnabled?443:port,1,65535),
      additionalPorts:list(lan.additionalPorts,'lan.additionalPorts').map(value=>integer(value,'lan.additionalPorts',undefined,1,65535)),
      allowedSubnets:list(lan.allowedSubnets,'lan.allowedSubnets'),
      hostAliases:list(lan.hostAliases,'lan.hostAliases'),
      adminNatSources:list(lan.adminNatSources,'lan.adminNatSources'),
      maxClients:integer(lan.maxClients,'lan.maxClients',32,1,200)
    },
    monitorHttps:{
      enabled:monitorEnabled,
      keyFile:location(configDirectory,monitor.keyFile,'monitorHttps.keyFile',path.join(configDirectory,'certs','monitor.key')),
      certFile:location(configDirectory,monitor.certFile,'monitorHttps.certFile',path.join(configDirectory,'certs','monitor.crt')),
      caFile:monitor.caFile===null?null:location(configDirectory,monitor.caFile,'monitorHttps.caFile',null),
      sessionSeconds:integer(monitor.sessionSeconds,'monitorHttps.sessionSeconds',43200,60,604800)
    },
    speedTest:{
      ...speed, enabled:speedEnabled,
      profiles:speedProfiles,
      cooldownSeconds:integer(speed.cooldownSeconds,'speedTest.cooldownSeconds',300,0,86400),
      automaticIntervalSeconds:integer(speed.automaticIntervalSeconds,'speedTest.automaticIntervalSeconds',0,0,604800),
      retentionDays:integer(speed.retentionDays,'speedTest.retentionDays',30,1,365),
      catalogFile:location(configDirectory,speed.catalogFile,'speedTest.catalogFile',path.join(root,'speed-servers.json')),
      ookla:{...ookla,enabled:flag(ookla.enabled,'speedTest.ookla.enabled'),
        binaryPath:location(configDirectory,ookla.binaryPath,'speedTest.ookla.binaryPath',path.join(root,'bin',process.platform==='win32'?'speedtest.exe':'speedtest')),
        catalogFile:location(configDirectory,ookla.catalogFile,'speedTest.ookla.catalogFile',path.join(root,'ookla-servers.json'))}
    },
    geoConnections:{
      ...geo,enabled:flag(geo.enabled,'geoConnections.enabled',raw.geoConnections!==undefined),
      cityDatabase:location(configDirectory,geo.cityDatabase,'geoConnections.cityDatabase',path.join(dataDir,'geoip','GeoLite2-City.mmdb')),
      asnDatabase:location(configDirectory,geo.asnDatabase,'geoConnections.asnDatabase',path.join(dataDir,'geoip','GeoLite2-ASN.mmdb')),
      mapOrigin:mapOrigin&&{label:mapOrigin.label,latitude:mapOrigin.latitude,longitude:mapOrigin.longitude}
    },
    crossQuality:{intervalSeconds:integer(cross.intervalSeconds,'crossQuality.intervalSeconds',10,2,300),links:crossLinks.map(link=>({...link,interface:wan[link.name]}))},
    energy:{
      ...energy,enabled:flag(energy.enabled,'energy.enabled'),
      pythonPath:location(configDirectory,energy.pythonPath,'energy.pythonPath',path.join(root,'.venv-energy',process.platform==='win32'?'Scripts/python.exe':'bin/python')),
      credentialFile:location(cwd,env.ORBIT_ENERGY_CREDENTIAL_FILE,'ORBIT_ENERGY_CREDENTIAL_FILE')??location(configDirectory,energy.credentialFile,'energy.credentialFile')
    }
  };
  if(config.monitoredInterfaces.some(name=>typeof name!=='string'||!name.trim()))throw invalid('monitoredInterfaces');
  if(config.lanInterface!==undefined&&(typeof config.lanInterface!=='string'||!config.lanInterface.trim()))throw invalid('lanInterface');
  if(config.lan.enabled){
    if(isIP(config.lan.listenAddress)!==4)throw invalid('lan.listenAddress (IPv4)');
    if(!config.lan.allowedSubnets.length||config.lan.allowedSubnets.some(cidr=>{
      const [host,bits,...rest]=typeof cidr==='string'?cidr.split('/'):[];
      return isIP(host||'')!==4||!/^(?:[0-9]|[12][0-9]|3[0-2])$/.test(bits??'')||rest.length;
    }))throw invalid('lan.allowedSubnets (IPv4/CIDR)');
    if(config.lan.hostAliases.some(host=>typeof host!=='string'||!/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/i.test(host)))throw invalid('lan.hostAliases');
    if(config.lan.adminNatSources.some(host=>isIP(host)!==4))throw invalid('lan.adminNatSources');
  }
  return {root,config,inventory,dataDir};
}
