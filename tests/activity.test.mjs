import test from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './helpers.mjs';
import {handle} from '../server/app.js';
import {ACTIVITY_FRAME_ANCESTORS,sha256} from '../server/security.js';

const APP='123456789012345678',ACTIVITY=`https://${APP}.discordsays.com`,JSON_HEADERS={'Content-Type':'application/json'};
async function fixture(t,{discord=true}={}){
  const ctx=await setup();t.after(()=>ctx.DB.close());
  if(discord){ctx.env.DISCORD_CLIENT_ID=APP;ctx.env.DISCORD_CLIENT_SECRET='fixture-secret';}
  const calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls.push({url:String(url),body:options?.body?String(options.body):null});
    if(String(url).endsWith('/oauth2/token'))return new Response(JSON.stringify({access_token:'fixture-access'}),{headers:JSON_HEADERS});
    if(String(url).endsWith('/users/@me'))return new Response(JSON.stringify({id:'223344556677889900',username:'player',global_name:'Player One',avatar:null}),{headers:JSON_HEADERS});
    throw new Error(`unexpected fetch ${url}`);
  });
  return {...ctx,calls};
}
const post=(env,path,{origin=ACTIVITY,body,headers={}}={})=>handle(new Request(env.ORIGIN+path,{method:'POST',headers:{...(origin?{Origin:origin}:{}),...JSON_HEADERS,...headers},body:JSON.stringify(body??{})}),env);
const get=(env,path,headers={})=>handle(new Request(env.ORIGIN+path,{headers}),env);
const login=async env=>(await post(env,'/api/activity/session',{body:{code:'sdk-code'}})).json();

test('activity config exposes only the public client id and needs Discord configured',async t=>{
  const {env}=await fixture(t),r=await get(env,'/api/activity/config');
  assert.equal(r.status,200);assert.deepEqual(await r.json(),{clientId:APP});
  const bare=await fixture(t,{discord:false});assert.equal((await get(bare.env,'/api/activity/config')).status,503);
});
test('an SDK code becomes a bearer session: exchanged without a redirect uri, token is not stored in clear',async t=>{
  const {env,store,calls}=await fixture(t),r=await post(env,'/api/activity/session',{body:{code:'sdk-code'}});
  assert.equal(r.status,200);const s=await r.json();
  assert.match(s.token,/^[a-f0-9]{64}$/);assert.match(s.csrf,/^[a-f0-9]{64}$/);assert.equal(s.accessToken,'fixture-access');assert.equal(s.user.name,'Player One');
  const exchange=new URLSearchParams(calls[0].body);assert.equal(exchange.get('grant_type'),'authorization_code');assert.equal(exchange.get('code'),'sdk-code');assert.equal(exchange.has('redirect_uri'),false);
  assert.equal(r.headers.get('set-cookie'),null,'no cookie is set inside an Activity');
  assert.equal(await store.one('SELECT 1 AS x FROM sessions WHERE token_hash=?',s.token),null,'the raw token must not be stored');
  assert.ok(await store.one('SELECT 1 AS x FROM sessions WHERE token_hash=?',await sha256(s.token)));
  assert.ok(!JSON.stringify(await store.all('SELECT * FROM sessions')).includes('fixture-access'),'the Discord access token is never stored');
});
test('the bearer session works for reads and for mutations from the activity origin',async t=>{
  const {env}=await fixture(t),s=await login(env),auth={Authorization:`Bearer ${s.token}`};
  const me=await (await get(env,'/api/me',auth)).json();assert.equal(me.user.name,'Player One');assert.equal(me.csrf,s.csrf);
  const created=await post(env,'/api/games',{headers:{...auth,'X-CSRF-Token':s.csrf},body:{requestId:crypto.randomUUID(),gameId:'guess-who',mode:'practice',difficulty:'normal'}});
  assert.equal(created.status,201);const match=await created.json();
  assert.equal((await get(env,`/api/games/${match.matchId}`,auth)).status,200);
  assert.equal((await post(env,'/api/logout',{headers:{...auth,'X-CSRF-Token':s.csrf}})).status,200);
  assert.equal((await get(env,`/api/games/${match.matchId}`,auth)).status,401,'logout removed the bearer session');
});
test('the activity origin is accepted only together with a bearer session and the right csrf',async t=>{
  const {env}=await fixture(t),s=await login(env),auth={Authorization:`Bearer ${s.token}`};
  const cookieOnly=await get(env,'/api/me'),cookie=cookieOnly.headers.get('set-cookie').split(';')[0],me=await cookieOnly.json();
  assert.equal((await post(env,'/api/logout',{headers:{cookie,'X-CSRF-Token':me.csrf}})).status,403,'a cookie session must not be usable from the discordsays origin');
  assert.equal((await post(env,'/api/logout',{origin:'https://evil.example',headers:{...auth,'X-CSRF-Token':s.csrf}})).status,403);
  assert.equal((await post(env,'/api/logout',{origin:'https://999999999999999999.discordsays.com',headers:{...auth,'X-CSRF-Token':s.csrf}})).status,403,'another application origin is not ours');
  assert.equal((await post(env,'/api/logout',{origin:null,headers:{...auth,'X-CSRF-Token':s.csrf}})).status,403);
  assert.equal((await post(env,'/api/logout',{headers:auth})).status,403,'missing csrf');
  assert.equal((await post(env,'/api/logout',{headers:{...auth,'X-CSRF-Token':'0'.repeat(64)}})).status,403,'wrong csrf');
  delete env.DISCORD_CLIENT_ID;assert.equal((await post(env,'/api/logout',{headers:{...auth,'X-CSRF-Token':s.csrf}})).status,403,'without an application id no activity origin exists');
});
test('session creation rejects foreign origins, missing codes and Discord failures',async t=>{
  const {env}=await fixture(t);
  assert.equal((await post(env,'/api/activity/session',{origin:'https://evil.example',body:{code:'c'}})).status,403);
  assert.equal((await post(env,'/api/activity/session',{origin:null,body:{code:'c'}})).status,403);
  assert.equal((await post(env,'/api/activity/session',{body:{}})).status,400);
  assert.equal((await post(env,'/api/activity/session',{body:{code:'x'.repeat(3000)}})).status,400);
  const bare=await fixture(t,{discord:false});assert.equal((await post(bare.env,'/api/activity/session',{body:{code:'c'}})).status,503);
  const failing=await fixture(t);globalThis.fetch.mock.mockImplementation(async()=>new Response('no',{status:400}));
  assert.equal((await post(failing.env,'/api/activity/session',{body:{code:'c'}})).status,502);
});
test('a blocked account cannot open an activity session',async t=>{
  const {env,store}=await fixture(t),now=Date.now();
  await store.run('INSERT INTO users(discord_id,display_name,blocked,created_at,last_seen_at) VALUES(?,?,1,?,?)','223344556677889900','x',now,now);
  assert.equal((await post(env,'/api/activity/session',{body:{code:'c'}})).status,403);
});
test('only a page loaded with frame_id may be framed, and only by Discord',async t=>{
  const {env}=await fixture(t),plain=await get(env,'/'),framed=await get(env,'/?frame_id=1&instance_id=2&platform=desktop');
  assert.equal(plain.headers.get('x-frame-options'),null);assert.match(plain.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  const csp=framed.headers.get('content-security-policy');assert.equal(framed.headers.get('x-frame-options'),null);
  assert.ok(csp.includes(ACTIVITY_FRAME_ANCESTORS));assert.ok(!csp.includes("frame-ancestors 'none'"));
  assert.ok(!/frame-ancestors[^;]*\*/.test(csp));assert.match(csp,/script-src 'self'/,'the rest of the policy is unchanged');assert.match(csp,/connect-src 'self'/);
  const api=await get(env,'/api/activity/config?frame_id=1');assert.match(api.headers.get('content-security-policy'),/frame-ancestors 'none'/,'API responses are never frameable');
});
