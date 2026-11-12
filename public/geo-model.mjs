export function hasCoordinates(geo){return Number.isFinite(geo?.latitude)&&Math.abs(geo.latitude)<=90&&Number.isFinite(geo?.longitude)&&Math.abs(geo.longitude)<=180;}
export function project(longitude,latitude){return [(longitude+180)*2,(90-latitude)*2];}
// Illustrative anchor for drawing routes when the installation location is unspecified.
export const networkMapOrigin={label:'Origem ilustrativa',latitude:0,longitude:0};
// Stable identity keeps a route's color and animation phase through SSE updates.
export function routeStyle(key){let hash=2166136261;for(const char of String(key))hash=Math.imul(hash^char.charCodeAt(0),16777619)>>>0;return {color:['#22f5ee','#ff4dc4','#a4ff48','#ffbd42','#a88bff','#4bafff','#ff6b7d','#51ffb0'][hash%8],lane:(hash%17)-8,duration:3+(hash%24)/10,delay:-(hash%60)/10};}
export function routePath(start,end,lane=0){
  const [x,y]=start,[tx,ty]=end,dx=tx-x,dy=ty-y,distance=Math.hypot(dx,dy);
  const bend=Math.min(85,distance*.22)+lane*2;
  const lift=Math.abs(dx)>20?-1:1;
  const cx=(x+tx)/2+(distance?(-dy/distance)*bend*lift:8),cy=(y+ty)/2+(distance?(dx/distance)*bend*lift:-8);
  return 'M'+x.toFixed(2)+' '+y.toFixed(2)+' Q'+cx.toFixed(2)+' '+cy.toFixed(2)+' '+tx.toFixed(2)+' '+ty.toFixed(2);
}
export function filterGeoRows(rows,filters={}){
  return rows.filter(row=>(!filters.source||row.source.ip===filters.source)&&(!filters.country||(row.geo?.countryCode||'unknown')===filters.country)&&
    (!filters.provider||(String(row.geo?.asn||'unknown')===filters.provider))&&(!filters.protocol||row.protocol===filters.protocol)&&(!filters.wan||(row.wan||'unknown')===filters.wan));
}
export function summarizeGeo(rows){
  const destinations=new Map(),countries=new Map(),asns=new Map();let connections=0,located=0;
  for(const row of rows){
    const count=row.connections||0,geo=row.geo||{};connections+=count;if(hasCoordinates(geo))located+=count;
    const dest=destinations.get(row.ip)||{ip:row.ip,geo,connections:0,rows:[]};dest.connections+=count;dest.rows.push(row);destinations.set(row.ip,dest);
    for(const [map,key,label] of [[countries,geo.countryCode||'unknown',geo.country||geo.countryCode||'País indisponível'],[asns,String(geo.asn||'unknown'),geo.asn?'AS'+geo.asn+' · '+(geo.organization||'Organização indisponível'):'ASN indisponível']]){
      const item=map.get(key)||{key,label,connections:0};item.connections+=count;map.set(key,item);
    }
  }
  const ranked=map=>[...map.values()].sort((a,b)=>b.connections-a.connections||String(a.key).localeCompare(String(b.key)));
  return {connections,located,destinations:ranked(new Map([...destinations].map(([k,v])=>[k,{...v,key:k}]))),countries:ranked(countries),asns:ranked(asns),countryCount:[...countries.keys()].filter(k=>k!=='unknown').length,asnCount:[...asns.keys()].filter(k=>k!=='unknown').length};
}
