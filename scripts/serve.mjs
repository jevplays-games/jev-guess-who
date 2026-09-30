import http from 'node:http';
import path from 'node:path';
import {readFile,mkdir,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Readable} from 'node:stream';
import {randomBytes} from 'node:crypto';
import {handle,maintenance} from '../server/app.js';
import {openDatabase} from './sqlite-adapter.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const port=Number(process.env.PORT)||8787,origin=process.env.ORIGIN||`http://localhost:${port}`,loopbackNames=['localhost','127.0.0.1','[::1]','::1'];
// GoDaddy may override NODE_ENV, so an HTTPS non-loopback ORIGIN also means production.
const originUrl=new URL(origin),production=process.env.NODE_ENV==='production'||(originUrl.protocol==='https:'&&!loopbackNames.includes(originUrl.hostname)),host=process.env.HOST||(production?'0.0.0.0':'127.0.0.1'),trustProxy=process.env.TRUST_PROXY==='1';
if(!['127.0.0.1','localhost','::1'].includes(host)&&!origin.startsWith('https://'))throw Error('Non-loopback hosting requires an HTTPS ORIGIN and reverse proxy.');
const local=new URL(origin).protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname);
const database=path.resolve(root,process.env.DB_PATH||'data/guess-who.sqlite');await mkdir(path.dirname(database),{recursive:true});
const DB=openDatabase(database);DB.exec(await readFile(path.join(root,'migrations/001.sql'),'utf8'));
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2'};
if(production&&!(process.env.LAUNCH_SIGNING_KEY&&process.env.RATE_LIMIT_HASH_KEY))console.warn('LAUNCH_SIGNING_KEY/RATE_LIMIT_HASH_KEY missing: using ephemeral random keys (Discord launch links and sessions-hash values will not survive restarts).');
const env={...process.env,DB,ORIGIN:origin,LOCAL_DEVELOPMENT:local?'true':'false',
  LAUNCH_SIGNING_KEY:process.env.LAUNCH_SIGNING_KEY||randomBytes(32).toString('hex'),
  RATE_LIMIT_HASH_KEY:process.env.RATE_LIMIT_HASH_KEY||randomBytes(32).toString('hex'),
  ASSETS:{async fetch(request){
    let relative=decodeURIComponent(new URL(request.url).pathname);if(relative==='/')relative='/index.html';
    const filename=path.resolve(root,'public','.'+relative),base=path.join(root,'public')+path.sep;
    if(!filename.startsWith(base))return new Response('Not found',{status:404});
    try{if(!(await stat(filename)).isFile())throw Error();const bytes=await readFile(filename);return new Response(bytes,{headers:{'Content-Type':types[path.extname(filename)]||'application/octet-stream'}});}catch{return new Response('Not found',{status:404});}
  }}
};
const server=http.createServer(async(req,res)=>{
  try{
    const headers=new Headers();for(const [name,value] of Object.entries(req.headers))if(value&&!['cf-connecting-ip','x-forwarded-for','x-forwarded-host'].includes(name))headers.set(name,Array.isArray(value)?value.join(','):value);
    // TRUST_PROXY=1 (only behind a proxy that overwrites these) uses the proxy-appended client IP and forwarded Host.
    if(trustProxy){const hops=String(req.headers['x-forwarded-for']||'').split(',').map(v=>v.trim()).filter(Boolean);if(hops.length)headers.set('cf-connecting-ip',hops[hops.length-1]);}
    const publicHost=(trustProxy&&req.headers['x-forwarded-host']?String(req.headers['x-forwarded-host']).split(',')[0].trim():req.headers.host);
    // Preserve incoming Host for origin validation. Never trust an external forwarding header.
    const request=new Request(`${new URL(origin).protocol}//${publicHost}${req.url}`,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{})});
    const response=await handle(request,env);res.writeHead(response.status,Object.fromEntries(response.headers));
    if(req.method==='HEAD')res.end();else res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.writeHead(500,{'Content-Type':'application/json'});res.end('{"error":"server_error"}');}
});
server.listen(port,host,()=>console.log(`Guess Who: ${origin}\nOpponent: ${env.TYPESAFE_API_KEY?'JEV configured (not yet connection-tested)':'local heuristic / explicitly labeled fallback only'}\nDatabase: ${database}`));
const timer=setInterval(()=>maintenance(env).catch(()=>console.error('Maintenance failed')),3600000);timer.unref();
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{clearInterval(timer);server.close(()=>{DB.close();process.exit(0);});});
