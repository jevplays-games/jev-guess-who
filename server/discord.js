import {assert,randomHex,sha256,sign,unsign,cookieHeader,verifyDiscordSignature,boundedText,json} from './security.js';
const SNOWFLAKE=/^\d{16,22}$/;
export async function readSession(store,request,env,{create=false}={}) {
  const token=request.headers.get('cookie')?.match(/(?:^|;\s*)jev_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  let session=token?await store.one('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?',await sha256(token),Date.now()):null;
  let setCookie=null;
  if(!session&&create){
    const value=randomHex(),hash=await sha256(value),now=Date.now();
    session={token_hash:hash,user_id:null,csrf:randomHex(),context_json:null,created_at:now,expires_at:now+7*86400000};
    await store.run('INSERT INTO sessions(token_hash,user_id,csrf,created_at,expires_at) VALUES(?,NULL,?,?,?)',hash,session.csrf,now,session.expires_at);
    setCookie=cookieHeader(value,{secure:env.LOCAL_DEVELOPMENT!=='true'});
  }
  assert(session,401,'session_required');
  session.context=session.context_json?JSON.parse(session.context_json):null;
  session.user=session.user_id?await store.one('SELECT discord_id,display_name,avatar_hash,blocked FROM users WHERE discord_id=?',session.user_id):null;
  assert(!session.user?.blocked,403,'account_blocked');
  session.actorKey=await sha256(`${env.RATE_LIMIT_HASH_KEY}|${session.user_id||session.token_hash}`);
  return {session,setCookie};
}
export async function beginOAuth(store,session,env) {
  assert(env.DISCORD_CLIENT_ID&&env.DISCORD_CLIENT_SECRET,503,'discord_not_configured');
  const token=randomHex(),expiresAt=Date.now()+600000;
  await store.run('INSERT INTO grants(token_hash,kind,session_hash,payload_json,expires_at) VALUES(?,?,?,?,?)',await sha256(token),'oauth',session.token_hash,'{}',expiresAt);
  await store.telemetry('oauth_started',{actorKey:session.actorKey});
  const target=new URL('https://discord.com/oauth2/authorize');
  for(const [k,v] of Object.entries({client_id:env.DISCORD_CLIENT_ID,redirect_uri:env.ORIGIN+'/api/auth/discord/callback',response_type:'code',scope:'identify',state:token}))target.searchParams.set(k,v);
  return target.toString();
}
export async function completeOAuth(store,session,params,env,{fetchImpl=fetch}={}) {
  const state=params.get('state'),code=params.get('code');assert(state&&code&&state.length===64&&code.length<2048,400,'oauth_parameters');
  const hash=await sha256(state),now=Date.now();
  const consumed=await store.run(`UPDATE grants SET consumed_at=? WHERE token_hash=? AND kind='oauth' AND session_hash=? AND expires_at>? AND consumed_at IS NULL`,now,hash,session.token_hash,now);
  assert(consumed.meta.changes===1,403,'oauth_state_rejected');
  const response=await fetchImpl('https://discord.com/api/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.DISCORD_CLIENT_ID,client_secret:env.DISCORD_CLIENT_SECRET,grant_type:'authorization_code',code,redirect_uri:env.ORIGIN+'/api/auth/discord/callback'}),signal:AbortSignal.timeout(8000)});
  assert(response.ok,502,'discord_token_exchange_failed');
  const token=await response.json();assert(typeof token.access_token==='string',502,'discord_token_missing');
  const who=await fetchImpl('https://discord.com/api/v10/users/@me',{headers:{Authorization:`Bearer ${token.access_token}`},signal:AbortSignal.timeout(8000)});
  assert(who.ok,502,'discord_identity_failed');const user=await who.json();assert(SNOWFLAKE.test(user.id),502,'discord_identity_invalid');
  const name=String(user.global_name||user.username||'Discord player').slice(0,80);
  const oldUser=await store.one('SELECT blocked FROM users WHERE discord_id=?',user.id);assert(!oldUser?.blocked,403,'account_blocked');
  const value=randomHex(),newHash=await sha256(value),csrf=randomHex();
  const statements=[
    store.statement(`INSERT INTO users(discord_id,display_name,avatar_hash,created_at,last_seen_at) VALUES(?,?,?,?,?) ON CONFLICT(discord_id) DO UPDATE SET display_name=excluded.display_name,avatar_hash=excluded.avatar_hash,last_seen_at=excluded.last_seen_at`,user.id,name,user.avatar??null,now,now),
    store.statement('INSERT INTO sessions(token_hash,user_id,csrf,created_at,expires_at) VALUES(?,?,?,?,?)',newHash,user.id,csrf,now,now+604800000),
    store.statement('DELETE FROM sessions WHERE token_hash=?',session.token_hash)
  ];
  // Preserve access to this browser's guest practice, but never retroactively award results.
  if(!session.user_id)statements.push(store.statement('UPDATE matches SET owner_session_hash=? WHERE owner_session_hash=? AND user_id IS NULL',newHash,session.token_hash));
  await store.batch(statements);
  await store.telemetry('discord_login',{actorKey:await sha256(`${env.RATE_LIMIT_HASH_KEY}|${user.id}`)});
  return cookieHeader(value,{secure:env.LOCAL_DEVELOPMENT!=='true'});
}
export async function interaction(store,request,env) {
  assert(env.DISCORD_PUBLIC_KEY&&env.DISCORD_CLIENT_ID&&env.LAUNCH_SIGNING_KEY,503,'discord_not_configured');
  const body=await boundedText(request,65536);
  const valid=await verifyDiscordSignature(env.DISCORD_PUBLIC_KEY,request.headers.get('X-Signature-Ed25519'),request.headers.get('X-Signature-Timestamp'),body);
  if(!valid){await store.telemetry('context_rejected',{details:{reason:'discord_signature'}});assert(false,401,'invalid_discord_signature');}
  let input;try{input=JSON.parse(body);}catch{assert(false,400,'invalid_json');}
  if(input.type===1)return json({type:1});
  assert(input.application_id===env.DISCORD_CLIENT_ID&&input.type===2&&input.data?.name==='play-jev',400,'unsupported_interaction');
  const guildId=input.guild_id,channelId=input.channel_id,subject=input.member?.user?.id;
  assert(SNOWFLAKE.test(guildId)&&SNOWFLAKE.test(channelId)&&SNOWFLAKE.test(subject),403,'guild_context_required');
  assert(input.authorizing_integration_owners?.['0']===guildId,403,'guild_installation_required');
  assert(!input.data.options?.some(o=>o.name!=='game'||o.value!=='guess-who'),400,'unknown_game');
  const existing=await store.one('SELECT payload_json,expires_at FROM grants WHERE source_id=? AND kind=\'launch\'',input.id);
  let token;
  if(existing&&existing.expires_at>Date.now())token=await sign(JSON.parse(existing.payload_json),env.LAUNCH_SIGNING_KEY);
  else {
    const now=Date.now(),payload={version:1,kind:'launch',subject,guildId,channelId,gameId:'guess-who',interactionId:input.id,issuedAt:now,expiresAt:now+300000,nonce:randomHex(16)};
    token=await sign(payload,env.LAUNCH_SIGNING_KEY);
    await store.run('INSERT INTO grants(token_hash,kind,source_id,payload_json,expires_at) VALUES(?,?,?,?,?)',await sha256(token),'launch',input.id,JSON.stringify(payload),payload.expiresAt);
  }
  // Fragment token avoids normal URL query logging; it is stripped immediately by the client.
  const url=`${env.ORIGIN}/#launch=${encodeURIComponent(token)}`;
  return json({type:4,data:{content:'Play Guess Who against JEV. Sign in with the Discord account that invoked this command.',flags:64,components:[{type:1,components:[{type:2,style:5,label:'Play Guess Who',url}]}]}});
}
export async function redeemContext(store,session,token,env) {
  assert(session.user_id,401,'discord_required');const payload=await unsign(token,env.LAUNCH_SIGNING_KEY);
  assert(payload.kind==='launch'&&payload.version===1&&payload.subject===session.user_id&&payload.gameId==='guess-who',403,'launch_subject_rejected');
  assert(SNOWFLAKE.test(payload.guildId)&&SNOWFLAKE.test(payload.channelId)&&payload.expiresAt-payload.issuedAt<=300000,403,'invalid_launch_context');
  const hash=await sha256(token),now=Date.now(),consumeMarker=randomHex(16);
  const grant=await store.one("SELECT * FROM grants WHERE token_hash=? AND kind='launch'",hash);
  assert(grant&&grant.expires_at>now&&!grant.consumed_at,403,'launch_already_used');
  const results=await store.batch([
    store.statement("UPDATE grants SET consumed_at=?,session_hash=? WHERE token_hash=? AND consumed_at IS NULL AND expires_at>?",now,consumeMarker,hash,now),
    store.statement(`UPDATE sessions SET context_json=? WHERE token_hash=? AND EXISTS(SELECT 1 FROM grants WHERE token_hash=? AND session_hash=?)`,JSON.stringify(payload),session.token_hash,hash,consumeMarker)
  ]);
  assert(results[0].meta.changes===1,403,'launch_already_used');
  await store.telemetry('context_redeemed',{actorKey:session.actorKey});return payload;
}
