export class HttpError extends Error {constructor(status,code){super(code);this.status=status;this.code=code;}}
export const assert=(ok,status,code)=>{if(!ok)throw new HttpError(status,code);};
export const utf8=new TextEncoder();
export const randomHex=(bytes=32)=>Array.from(crypto.getRandomValues(new Uint8Array(bytes)),b=>b.toString(16).padStart(2,'0')).join('');
export const unhex=s=>{assert(typeof s==='string'&&/^(?:[0-9a-f]{2})+$/i.test(s),400,'invalid_hex');return Uint8Array.from(s.match(/../g),v=>parseInt(v,16));};
export const hex=b=>Array.from(new Uint8Array(b),v=>v.toString(16).padStart(2,'0')).join('');
export const sha256=async s=>hex(await crypto.subtle.digest('SHA-256',utf8.encode(s)));
export function canonical(value){if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';}
const keyFor=secret=>crypto.subtle.importKey('raw',utf8.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
export async function sign(payload,secret) {
  assert(typeof secret==='string'&&secret.length>=32,503,'signing_key_unconfigured');
  const body=btoa(String.fromCharCode(...utf8.encode(JSON.stringify(payload)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
  const signature=hex(await crypto.subtle.sign('HMAC',await keyFor(secret),utf8.encode(body)));
  return `${body}.${signature}`;
}
export async function unsign(token,secret,now=Date.now()) {
  assert(typeof token==='string'&&token.length<4096,400,'invalid_token');
  assert(typeof secret==='string'&&secret.length>=32,503,'signing_key_unconfigured');
  const [body,signature,...rest]=token.split('.');assert(!rest.length&&signature?.length===64,403,'invalid_token');
  let valid=false;
  try{valid=await crypto.subtle.verify('HMAC',await keyFor(secret),unhex(signature),utf8.encode(body));}catch{}
  assert(valid,403,'invalid_token');let value;
  try{value=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(body.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0))));}catch{throw new HttpError(400,'invalid_token');}
  assert(Number.isFinite(value.expiresAt)&&value.expiresAt>now,403,'expired_token');return value;
}
export async function verifyDiscordSignature(publicKey,signature,timestamp,body,now=Date.now()) {
  try{
    if(!/^\d{10,12}$/.test(timestamp||'')||Math.abs(now-Number(timestamp)*1000)>300000)return false;
    const key=await crypto.subtle.importKey('raw',unhex(publicKey),{name:'Ed25519'},false,['verify']);
    return await crypto.subtle.verify('Ed25519',key,unhex(signature),utf8.encode(timestamp+body));
  }catch{return false;}
}
export async function bodyJson(request,maxBytes=16384) {
  assert((request.headers.get('content-type')||'').split(';')[0]==='application/json',415,'json_required');
  const text=await boundedText(request,maxBytes);
  try{return JSON.parse(text);}catch{throw new HttpError(400,'invalid_json');}
}
export async function boundedText(message,maxBytes=16384) {
  if(Number(message.headers.get('content-length'))>maxBytes)throw new HttpError(413,'body_too_large');
  if(!message.body)return '';
  const reader=message.body.getReader(),parts=[];let n=0;
  while(true){const {done,value}=await reader.read();if(done)break;n+=value.byteLength;if(n>maxBytes){await reader.cancel();throw new HttpError(413,'body_too_large');}parts.push(value);}
  const bytes=new Uint8Array(n);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return new TextDecoder().decode(bytes);
}
export function safeHeaders(headers={}) {return new Headers({
  'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'Permissions-Policy':'camera=(), microphone=(), geolocation=()',...headers});}
export const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:safeHeaders(headers)});
export function cookieHeader(value,{secure=true,maxAge=604800}={}) {return `jev_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure?'; Secure':''}`;}
export function checkMutation(request,session,env) {
  assert(request.headers.get('Origin')===env.ORIGIN,403,'origin_rejected');
  assert(request.headers.get('X-CSRF-Token')===session.csrf,403,'csrf_rejected');
}
export async function initializeFromSeed(seed,matchId,config) {
  const draw=async(label,bound)=>{for(let counter=0;;counter++){
    const hash=unhex(await sha256(`gw-rng-1|${seed}|${label}|${counter}`));
    for(const b of hash)if(b<256-(256%bound))return b%bound;
  }};
  const h=await draw('human',24),j=await draw('jev',24),first=await draw('starter',2);
  const initial={human:`c${String(h+1).padStart(2,'0')}`,jev:`c${String(j+1).padStart(2,'0')}`,starter:first?'jev':'human',matchId};
  const commitment=await sha256(canonical({domain:'gw-commit-1',seed,matchId,config}));return {initial,commitment};
}
