// Discord Activity support. Discord loads the game in an iframe on <application id>.discordsays.com, where a
// SameSite cookie is not sent, so the game signs the player in through the Embedded App SDK and then keeps a
// bearer session token in memory. Nothing here changes the normal browser sign-in and no game state is exposed.
import {assert,randomHex,sha256,json,bodyJson,activityOrigin} from './security.js';
import {discordIdentity,upsertUser} from './discord.js';

export function activityConfig(env) {
  assert(env.DISCORD_CLIENT_ID&&env.DISCORD_CLIENT_SECRET,503,'discord_not_configured');
  return json({clientId:env.DISCORD_CLIENT_ID});
}
export async function createActivitySession(store,request,env,{fetchImpl=fetch}={}) {
  assert(env.DISCORD_CLIENT_ID&&env.DISCORD_CLIENT_SECRET,503,'discord_not_configured');
  const origin=request.headers.get('Origin');
  assert(origin&&(origin===activityOrigin(env)||origin===env.ORIGIN),403,'origin_rejected');
  const {code}=await bodyJson(request);
  assert(typeof code==='string'&&code.length>0&&code.length<2048,400,'invalid_code');
  // An SDK authorization code is exchanged without a redirect URI.
  const {user,name,accessToken}=await discordIdentity(env,code,null,fetchImpl);
  const blocked=await store.one('SELECT blocked FROM users WHERE discord_id=?',user.id);assert(!blocked?.blocked,403,'account_blocked');
  const raw=randomHex(),csrf=randomHex(),now=Date.now();
  await store.batch([
    upsertUser(store,user,name,now),
    store.statement('INSERT INTO sessions(token_hash,user_id,csrf,created_at,expires_at) VALUES(?,?,?,?,?)',await sha256(raw),user.id,csrf,now,now+86400000)
  ]);
  await store.telemetry('discord_login',{actorKey:await sha256(`${env.RATE_LIMIT_HASH_KEY}|${user.id}`),details:{source:'activity'}});
  // The Discord access token is returned once so the SDK can authenticate; it is never stored or logged.
  return json({token:raw,csrf,accessToken,user:{id:user.id,name}});
}
