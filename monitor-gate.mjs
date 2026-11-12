const token=req=>req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith('__Host-orbit_monitor='))?.slice(21)||'';
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function page(message=''){
 return '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Entrar · ORBIT</title><style>body{margin:0;background:#080f18;color:#dce8f4;font:16px system-ui;min-height:100vh;display:grid;place-items:center}main{width:min(360px,calc(100vw - 72px));padding:28px;background:#111e2c;border:1px solid #2a4258;border-radius:16px}h1{letter-spacing:5px;color:#49dcd6}label,input,button{display:block;box-sizing:border-box;width:100%}input,button{margin:12px 0;padding:14px;border-radius:8px;border:1px solid #36506a;background:#0c1520;color:#fff;font:inherit}button{background:#176c70;cursor:pointer}p{font-size:14px;color:#a9bed0;line-height:1.6}.error{color:#ffb9b9}</style><main><h1>◈ ORBIT</h1><h2>Entrar no monitor</h2><p>Acesso por HTTPS na rede local. Use a senha do administrador ORBIT já cadastrada.</p><form method="post" action="/api/monitor/login"><label>Senha do administrador<input type="password" name="password" required minlength="12" maxlength="256" autocomplete="current-password" autofocus></label><button>Entrar</button></form><p class="error" role="status">'+escape(message)+'</p><p>A coleta continua automaticamente mesmo quando você sai. A duração da sessão é definida na configuração do ORBIT.</p></main></html>';
}
export function createMonitorGate({auth,now=Date.now}){
 return async(req,res)=>{
  const origin=new URL('https://'+req.headers.host).origin,url=new URL(req.url,origin),ip=req.socket.remoteAddress.replace(/^::ffff:/,''),identity={token:token(req),ip};
  const html=(message,code=200)=>{res.writeHead(code,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"});res.end(page(message));return true;};
  if(url.pathname==='/api/monitor/login'&&req.method==='POST'){
   if(!req.socket.encrypted||req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site'||!/^application\/x-www-form-urlencoded(?:;|$)/i.test(req.headers['content-type']||''))return html('Abra o formulário pelo HTTPS do ORBIT.',403);
   let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>2048)return html('Dados excessivos.',413);}
   const form=new URLSearchParams(body);if([...form.keys()].some(k=>k!=='password')||form.getAll('password').length!==1)return html('Formulário inválido.',400);
   try{const session=await auth.login({password:form.get('password'),ip});body='';form.set('password','');res.writeHead(303,{'Location':'/','Set-Cookie':'__Host-orbit_monitor='+session.token+'; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age='+Math.floor((session.expiresAt-now())/1000)});res.end();return true;}
   catch(error){return html(error.code==='LOGIN_RATE_LIMIT'?'Muitas tentativas. Aguarde 15 minutos.':error.code==='SETUP_REQUIRED'?'Cadastre a senha do administrador na interface local do ORBIT.':'Não foi possível entrar. Confira a senha do administrador ORBIT.',error.status||401);}
  }
  const session=auth.status(identity);
  if(!session.authenticated){if(req.method==='GET'&&url.pathname==='/')return html();res.writeHead(401,{'Content-Type':'application/json'});res.end(JSON.stringify({message:'Entre no monitor ORBIT.',loginRequired:true}));return true;}
  if(url.pathname==='/api/monitor/logout'&&req.method==='POST'){
   if(req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site'){res.writeHead(403);res.end();return true;}
   auth.logout(identity);res.writeHead(303,{'Location':'/','Set-Cookie':'__Host-orbit_monitor=; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});res.end();return true;
  }
  req.monitorExpiresAt=session.expiresAt;return false;
 };
}
