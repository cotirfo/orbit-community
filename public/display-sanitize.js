const ipv4Pattern = /\b(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?\b/g;
const macPattern = /\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/gi;
const ipv6TokenPattern = /(?<![\w])[0-9a-f:]{2,39}(?![\w])/gi;

function isIpv6(value) {
 if (!value.includes(':') || (!value.includes('::') && (value.match(/:/g)||[]).length < 3)) return false;
 try { return new URL('http://['+value+']/').hostname.length > 2; } catch { return false; }
}

export function identifiersHidden() {
 try { return localStorage.getItem('orbit-display-hide-identifiers') === 'true'; }
 catch { return false; }
}

export function displayText(value) {
 if (value === null || value === undefined) return '—';
 let result=String(value).replace(/\b(?:null|undefined|nan|infinity)\b/gi,'—').replace(/[ \t]{2,}/g,' ').trim();
 if (!identifiersHidden()) return result;
 result=result.replace(macPattern,'••:••:••:••:••:••');
 result=result.replace(ipv4Pattern,match=>{
   const address=match.split('/')[0],parts=address.split('.').map(Number);
   return parts.every(part=>part>=0&&part<=255)?'•••.•••.•••.•••'+(match.includes('/')?'/••':''):match;
 });
 return result.replace(ipv6TokenPattern,match=>isIpv6(match)?'••••:••••:••••:••••':match);
}

export function sanitizeExport(value) {
 if (!identifiersHidden()) return value;
 if (Array.isArray(value)) return value.map(sanitizeExport);
 if (value&&typeof value==='object') return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,sanitizeExport(item)]));
 return typeof value==='string'?displayText(value):value;
}
