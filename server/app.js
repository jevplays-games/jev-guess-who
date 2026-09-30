import {Store} from './store.js';
import {HttpError,assert,json,bodyJson,safeHeaders,checkMutation,cookieHeader,sha256,ACTIVITY_FRAME_ANCESTORS} from './security.js';
import {readSession,beginOAuth,completeOAuth,interaction,redeemContext} from './discord.js';
import {activityConfig,createActivitySession} from './activity.js';
import {createMatch,ownedMatch,snapshot,humanAction,advance,personalAnalytics,leaderboard,verifyMatch} from './matches.js';
export async function handle(request,env) {
  const url=new URL(request.url),path=url.pathname;
  const store=new Store(env.DB);
  try {
    // Platform health checks arrive with the platform's own Host; only GET /api/health (static, no data) is exempt.
    if(path==='/api/health'&&request.method==='GET')return json({ok:true,game:'guess-who',version:'1.0.0'});
    assert(env.ORIGIN&&url.origin===env.ORIGIN,403,'host_rejected');
    if(!path.startsWith('/api/')) {
      assert(['GET','HEAD'].includes(request.method),405,'method_not_allowed');
      const asset=await env.ASSETS.fetch(request),headers=safeHeaders({'Content-Type':asset.headers.get('Content-Type')||'application/octet-stream'});
      headers.set('Cache-Control','no-cache');
      // Discord frames an Activity only when it launches the page with frame_id; only Discord may frame it.
      if(url.searchParams.has('frame_id')){headers.delete('X-Frame-Options');headers.set('Content-Security-Policy',headers.get('Content-Security-Policy').replace("frame-ancestors 'none'",ACTIVITY_FRAME_ANCESTORS));}
      return new Response(asset.body,{status:asset.status,headers});
    }
    const method=request.method;
    if(path==='/api/discord/interactions'&&method==='POST')return await interaction(store,request,env);
    // CF-Connecting-IP is used only on Workers. Local adapters strip forwarded client headers.
    const ip=request.headers.get('CF-Connecting-IP')||'local';
    const ipKey=await sha256(`${env.RATE_LIMIT_HASH_KEY}|${ip}`);
    await store.quota(`api:${ipKey}`,240,60000);
    if(path==='/api/activity/config'&&method==='GET')return activityConfig(env);
    if(path==='/api/activity/session'&&method==='POST'){await store.quota(`activity-session:${ipKey}`,60,3600000);return await createActivitySession(store,request,env);}
    const {session,setCookie}=await readSession(store,request,env,{create:path==='/api/me'&&method==='GET'});
    const headers=setCookie?{'Set-Cookie':setCookie}:{};
    if(method==='POST') {
      checkMutation(request,session,env);
      await store.quota(`mutation:${session.token_hash}`,60,60000);
    }
    if(path==='/api/me'&&method==='GET') {
      const condition=session.user_id?'user_id=?':'owner_session_hash=?',owner=session.user_id||session.token_hash;
      const active=await store.one(`SELECT id FROM matches WHERE ${condition} AND status='active' ORDER BY created_at DESC LIMIT 1`,owner);
      return json({user:session.user?{id:session.user.discord_id,name:session.user.display_name}:null,csrf:session.csrf,
        discordConfigured:!!(env.DISCORD_CLIENT_ID&&env.DISCORD_CLIENT_SECRET),jevConfigured:!!env.TYPESAFE_API_KEY,
        context:session.context?.expiresAt>Date.now()?session.context:null,activeMatchId:active?.id??null},200,headers);
    }
    if(path==='/api/auth/discord'&&method==='GET')return new Response(null,{status:302,headers:safeHeaders({Location:await beginOAuth(store,session,env)})});
    if(path==='/api/auth/discord/callback'&&method==='GET')return new Response(null,{status:302,headers:safeHeaders({'Set-Cookie':await completeOAuth(store,session,url.searchParams,env),Location:env.ORIGIN+'/'})});
    if(path==='/api/logout'&&method==='POST'){await store.run('DELETE FROM sessions WHERE token_hash=?',session.token_hash);return json({ok:true},200,{'Set-Cookie':cookieHeader('',{secure:env.LOCAL_DEVELOPMENT!=='true',maxAge:0})});}
    if(path==='/api/context/redeem'&&method==='POST'){const input=await bodyJson(request);return json({context:await redeemContext(store,session,input.token,env)});}
    if(path==='/api/games'&&method==='POST')return json(snapshot(await createMatch(store,session,await bodyJson(request),env)),201);
    const game=path.match(/^\/api\/games\/([a-zA-Z0-9-]{1,80})(?:\/(actions|advance|replay))?$/);
    if(game) {
      const [,id,operation]=game;
      if(!operation&&method==='GET')return json(snapshot((await ownedMatch(store,id,session,env)).match));
      if(operation==='actions'&&method==='POST')return json(snapshot(await humanAction(store,session,id,await bodyJson(request),env)));
      if(operation==='advance'&&method==='POST'){const result=await advance(store,session,id,env);return json({...snapshot(result.match),pending:result.pending},result.pending?202:200);}
      if(operation==='replay'&&method==='GET') {
        const {match}=await ownedMatch(store,id,session,env);assert(match.state.phase!=='active',409,'replay_unavailable_until_finished');
        await verifyMatch(match);const {context,...exported}=match;
        return json({...exported,verification:'server-record-verified',warning:'This exported label is informational. Offline verification cannot establish server provenance.'});
      }
      throw new HttpError(405,'method_not_allowed');
    }
    if(path==='/api/analytics'&&method==='GET')return json(await personalAnalytics(store,session,url.searchParams));
    if(path==='/api/leaderboard'&&method==='GET')return json(await leaderboard(store,session,url.searchParams,env));
    throw new HttpError(404,'not_found');
  } catch(error) {
    const status=error.status||(['RuleError'].includes(error.constructor.name)?422:500);
    const code=status===500?'internal_error':error.code||error.message;
    await store.telemetry(status===429?'rate_limited':'request_rejected',{details:{status,reason:code}});
    if(status===500)console.error(JSON.stringify({event:'internal_error',type:error.constructor.name,message:error.message?.slice(0,160)}));
    return json({error:code},status,status===429?{'Retry-After':'60'}:{});
  }
}
export async function maintenance(env) {
  const store=new Store(env.DB),now=Date.now();
  const expired=await store.all("SELECT id,user_id,owner_session_hash FROM matches WHERE status='active' AND expires_at<=? LIMIT 100",now);
  for(const row of expired)try{await ownedMatch(store,row.id,{user_id:row.user_id,token_hash:row.owner_session_hash},env);}catch{await store.telemetry('maintenance_error',{matchId:row.id});}
  const matchDays=Math.max(1,Number(env.MATCH_RETENTION_DAYS)||90),resultDays=Math.max(matchDays,Number(env.RESULT_RETENTION_DAYS)||730);
  await store.batch([
    store.statement('DELETE FROM grants WHERE expires_at<?',now-86400000),
    store.statement('DELETE FROM rate_limits WHERE window_start<?',now-2*86400000),
    store.statement('DELETE FROM sessions WHERE expires_at<?',now-86400000),
    store.statement("DELETE FROM matches WHERE status!='active' AND finished_at<?",now-matchDays*86400000),
    store.statement('DELETE FROM results WHERE finished_at<?',now-resultDays*86400000),
    store.statement('DELETE FROM telemetry WHERE at<?',now-matchDays*86400000)
  ]);
}
export default {fetch:handle,scheduled:(_event,env,ctx)=>ctx.waitUntil(maintenance(env))};
