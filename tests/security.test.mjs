import test from 'node:test';
import assert from 'node:assert/strict';
import {sign,unsign,verifyDiscordSignature,hex,sha256,randomHex,checkMutation,boundedText} from '../server/security.js';
import {setup,userSession} from './helpers.mjs';
import {beginOAuth,completeOAuth,redeemContext,interaction} from '../server/discord.js';

test('signed launch token rejects tampering and expiry',async()=>{
  const secret='x'.repeat(64),token=await sign({expiresAt:Date.now()+1000,kind:'test'},secret);
  assert.equal((await unsign(token,secret)).kind,'test');
  await assert.rejects(()=>unsign(token.slice(0,-1)+(token.endsWith('0')?'1':'0'),secret),/invalid_token/);
  await assert.rejects(()=>unsign(token,secret,Date.now()+2000),/expired_token/);
});
test('Discord Ed25519 validates timestamp plus exact body and rejects stale timestamps',async()=>{
  const pair=await crypto.subtle.generateKey({name:'Ed25519'},true,['sign','verify']),publicKey=hex(await crypto.subtle.exportKey('raw',pair.publicKey));
  const body=JSON.stringify({type:1}),timestamp=String(Math.floor(Date.now()/1000));
  const signature=hex(await crypto.subtle.sign('Ed25519',pair.privateKey,new TextEncoder().encode(timestamp+body)));
  assert.equal(await verifyDiscordSignature(publicKey,signature,timestamp,body),true);
  assert.equal(await verifyDiscordSignature(publicKey,signature,timestamp,body+' '),false);
  assert.equal(await verifyDiscordSignature(publicKey,signature,timestamp,body,Date.now()+600000),false);
});
test('origin and CSRF checks are both mandatory',()=>{
  const session={csrf:'a'},env={ORIGIN:'https://game.example'};
  assert.throws(()=>checkMutation(new Request(env.ORIGIN,{headers:{Origin:'https://evil.example','X-CSRF-Token':'a'}}),session,env),/origin_rejected/);
  assert.throws(()=>checkMutation(new Request(env.ORIGIN,{headers:{Origin:env.ORIGIN,'X-CSRF-Token':'wrong'}}),session,env),/csrf_rejected/);
});
test('streamed request body limits apply without Content-Length',async()=>{
  await assert.rejects(()=>boundedText(new Request('https://example.test',{method:'POST',body:'x'.repeat(30)}),20),/body_too_large/);
});
test('OAuth rejects missing, expired, foreign-session and already consumed state',async()=>{
  const {DB,store,session,env}=await setup();env.DISCORD_CLIENT_ID='123456789012345678';env.DISCORD_CLIENT_SECRET='test';
  try {
    const url=new URL(await beginOAuth(store,session,env)),state=url.searchParams.get('state');
    assert.equal(url.searchParams.get('scope'),'identify');
    await assert.rejects(()=>completeOAuth(store,{...session,token_hash:'other'},new URLSearchParams({state,code:'x'}),env),/oauth_state_rejected/);
    await store.run('UPDATE grants SET expires_at=0');
    await assert.rejects(()=>completeOAuth(store,session,new URLSearchParams({state,code:'x'}),env),/oauth_state_rejected/);
  }finally{DB.close();}
});
test('mocked Discord OAuth rotates the session without storing provider tokens',async()=>{
  const {DB,store,session,env}=await setup();env.DISCORD_CLIENT_ID='123456789012345678';env.DISCORD_CLIENT_SECRET='test';
  try {
    const start=new URL(await beginOAuth(store,session,env)),params=new URLSearchParams({state:start.searchParams.get('state'),code:'x'});
    const cookie=await completeOAuth(store,session,params,env,{fetchImpl:async url=>url.endsWith('/token')?Response.json({access_token:'DO_NOT_STORE',refresh_token:'DO_NOT_STORE_EITHER'}):Response.json({id:'123456789012345679',username:'Player',global_name:'A <script> name'})});
    assert.ok(cookie.includes('HttpOnly'));assert.equal(await store.one('SELECT token_hash FROM sessions WHERE token_hash=?',session.token_hash),null);
    assert.equal((await store.one('SELECT COUNT(*) AS n FROM sessions')).n,1);
    const users=await store.all('SELECT * FROM users');assert.equal(users[0].display_name,'A <script> name');
    assert.equal(JSON.stringify(await store.all('SELECT * FROM sessions')).includes('DO_NOT_STORE'),false);
    await assert.rejects(()=>completeOAuth(store,session,params,env),/oauth_state_rejected/);
  }finally{DB.close();}
});
test('launch redemption requires matching identity and consumes exactly once',async()=>{
  const {DB,store,session,env}=await setup();await userSession(store,session);
  try {
    const now=Date.now(),payload={kind:'launch',version:1,subject:session.user_id,guildId:'223456789012345678',channelId:'323456789012345678',gameId:'guess-who',issuedAt:now,expiresAt:now+300000,nonce:randomHex(),interactionId:'423456789012345678'};
    const token=await sign(payload,env.LAUNCH_SIGNING_KEY);
    await store.run('INSERT INTO grants(token_hash,kind,payload_json,expires_at) VALUES(?,?,?,?)',await sha256(token),'launch',JSON.stringify(payload),payload.expiresAt);
    await assert.rejects(()=>redeemContext(store,{...session,user_id:'523456789012345678'},token,env),/launch_subject_rejected/);
    const results=await Promise.allSettled([redeemContext(store,session,token,env),redeemContext(store,session,token,env)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    const row=await store.one('SELECT context_json FROM sessions WHERE token_hash=?',session.token_hash);assert.equal(JSON.parse(row.context_json).guildId,payload.guildId);
  }finally{DB.close();}
});
test('unsigned interaction cannot forge channel context',async()=>{
  const {DB,store,env}=await setup();Object.assign(env,{DISCORD_PUBLIC_KEY:'00'.repeat(32),DISCORD_CLIENT_ID:'123456789012345678'});
  try{await assert.rejects(()=>interaction(store,new Request(env.ORIGIN+'/api/discord/interactions',{method:'POST',body:'{"type":2}'}),env),/invalid_discord_signature/);}finally{DB.close();}
});
