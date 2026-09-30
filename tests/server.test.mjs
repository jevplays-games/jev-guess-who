import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,userSession,providerMock} from './helpers.mjs';
import {createMatch,humanAction,advance,verifyMatch,snapshot,leaderboard,configuration,leagueFor,personalAnalytics,seasonId,ownedMatch} from '../server/matches.js';
import {handle,maintenance} from '../server/app.js';
import {balancedAction} from '../public/shared/strategy.js';
import {getLegalActions} from '../public/shared/rules.js';
import {sha256,randomHex} from '../server/security.js';
const input=(mode='practice',difficulty='normal')=>({requestId:crypto.randomUUID(),gameId:'guess-who',mode,difficulty});
async function humanTurn(store,session,match,env){if(match.state.turn==='jev')return (await advance(store,session,match.state.matchId,env)).match;return match;}

test('server creates secret-safe snapshots; other sessions cannot read a match',async()=>{
  const {DB,store,session,env}=await setup();
  try{const match=await createMatch(store,session,input(),env),safe=snapshot(match);
    assert.equal(safe.seed,undefined);assert.equal(safe.initial,undefined);assert.equal(safe.secrets,undefined);assert.equal(safe.revealedSecrets,undefined);assert.equal(safe.ownSecret,match.initial.human);
    await assert.rejects(()=>ownedMatch(store,match.state.matchId,{token_hash:'wrong',user_id:null},env),/match_not_found/);
  }finally{DB.close();}
});
test('create idempotency does not create extra games and rejects conflicting reuse',async()=>{
  const {DB,store,session,env}=await setup();
  try{const request=input(),a=await createMatch(store,session,request,env),b=await createMatch(store,session,request,env);assert.equal(a.state.matchId,b.state.matchId);
    await assert.rejects(()=>createMatch(store,session,{...request,difficulty:'hard'},env),/request_id_conflict/);
  }finally{DB.close();}
});
test('duplicate human action is idempotent; altered payload and stale revision fail',async()=>{
  const {DB,store,session,env}=await setup();
  try{let m=await humanTurn(store,session,await createMatch(store,session,input(),env),env);
    const request={actionId:crypto.randomUUID(),expectedRevision:m.state.revision,action:balancedAction(m.state.possible.human)};
    const a=await humanAction(store,session,m.state.matchId,request,env),b=await humanAction(store,session,m.state.matchId,request,env);assert.deepEqual(a.state,b.state);
    await assert.rejects(()=>humanAction(store,session,m.state.matchId,{...request,action:{type:'resign'}},env),/action_id_conflict/);
    await assert.rejects(()=>humanAction(store,session,m.state.matchId,{...request,actionId:crypto.randomUUID()},env),/stale_revision/);
  }finally{DB.close();}
});
test('persisted lease suppresses concurrent JEV advances',async()=>{
  const {DB,store,session,env}=await setup();
  try{let m=await createMatch(store,session,input(),env);
    if(m.state.turn==='human')m=await humanAction(store,session,m.state.matchId,{actionId:crypto.randomUUID(),expectedRevision:m.state.revision,action:balancedAction(m.state.possible.human)},env);
    const before=m.state.revision;
    const results=await Promise.all([advance(store,session,m.state.matchId,env),advance(store,session,m.state.matchId,env)]);
    assert.equal((await store.getMatch(m.state.matchId)).match.state.revision,before+1);
    assert.ok(results.some(r=>r.pending));
  }finally{DB.close();}
});
test('completed replay is validated and rejects seed, event, difficulty and state tampering',async()=>{
  const {DB,store,session,env}=await setup();
  try{let m=await humanTurn(store,session,await createMatch(store,session,input(),env),env);
    m=await humanAction(store,session,m.state.matchId,{actionId:crypto.randomUUID(),expectedRevision:m.state.revision,action:{type:'guess',characterId:m.state.secrets.jev}},env);
    await verifyMatch(m);
    for(const mutate of [x=>x.seed='01'.repeat(32),x=>x.config.difficulty='hard',x=>x.state.outcome.winner='jev',x=>x.events[0].sequence=99]){const bad=structuredClone(m);mutate(bad);await assert.rejects(()=>verifyMatch(bad));}
  }finally{DB.close();}
});
test('ranked match requires identity, configured JEV and pinned model; one active ranked attempt',async()=>{
  const {DB,store,session,env}=await setup();
  try{await assert.rejects(()=>createMatch(store,session,input('ranked'),env),/discord_required/);await userSession(store,session);
    await assert.rejects(()=>createMatch(store,session,input('ranked'),env),/jev_not_configured/);
    env.TYPESAFE_API_KEY='test-only';env.JEV_MODEL='jev-latest';await assert.rejects(()=>createMatch(store,session,input('ranked'),env),/pinned_model_required/);
    env.JEV_MODEL='jev-1.13.0';await createMatch(store,session,input('ranked'),env);
    await assert.rejects(()=>createMatch(store,session,input('ranked'),env),/active_ranked_match/);
  }finally{DB.close();}
});
test('mocked JEV ranked completion inserts one official result, never two',async()=>{
  const {DB,store,session,env}=await setup();await userSession(store,session);env.TYPESAFE_API_KEY='test-only';
  try{let m=await createMatch(store,session,input('ranked'),env);
    if(m.state.turn==='jev')m=(await advance(store,session,m.state.matchId,env,{fetchImpl:async(_url,init)=>Response.json(providerMock(JSON.parse(init.body)))})).match;
    const request={actionId:crypto.randomUUID(),expectedRevision:m.state.revision,action:{type:'guess',characterId:m.state.secrets.jev}};
    m=await humanAction(store,session,m.state.matchId,request,env);await humanAction(store,session,m.state.matchId,request,env);
    assert.equal(m.eligible,true);assert.equal((await store.one('SELECT COUNT(*) AS n FROM results')).n,1);
    const board=await leaderboard(store,session,new URLSearchParams({difficulty:'normal',period:'all',scope:'world'}),env);
    assert.equal(board.entries.length,1);assert.equal(board.entries[0].provisional,true);
  }finally{DB.close();}
});
test('fallback permanently disqualifies a ranked game',async()=>{
  const {DB,store,session,env}=await setup();await userSession(store,session);env.TYPESAFE_API_KEY='test-only';
  try{let m=await createMatch(store,session,input('ranked'),env);
    if(m.state.turn==='human')m=await humanAction(store,session,m.state.matchId,{actionId:crypto.randomUUID(),expectedRevision:m.state.revision,action:balancedAction(m.state.possible.human)},env);
    m=(await advance(store,session,m.state.matchId,env,{fetchImpl:async()=>new Response('',{status:401})})).match;
    assert.equal(m.eligible,false);assert.ok(m.eligibilityReason.startsWith('jev_fallback'));
    if(m.state.phase==='active'&&m.state.turn==='human')m=await humanAction(store,session,m.state.matchId,{actionId:crypto.randomUUID(),expectedRevision:m.state.revision,action:{type:'resign'}},env);
    assert.equal((await store.one('SELECT COUNT(*) AS n FROM results')).n,0);
  }finally{DB.close();}
});
test('compare-and-swap loser cannot insert an unrelated result in D1 batch',async()=>{
  const {DB,store,session,env}=await setup();await userSession(store,session);
  try{const m=await createMatch(store,session,input(),env);m.eligible=true;m.state.phase='finished';m.state.outcome={winner:'human',reason:'correct_guess'};m.finishedAt=Date.now();
    assert.equal(await store.commit(m,999,{result:{seasonId:'2026-09-21',outcome:'win',metrics:{}}}),false);
    assert.equal((await store.one('SELECT COUNT(*) AS n FROM results')).n,0);
  }finally{DB.close();}
});
test('expired eligible match becomes a verified loss',async()=>{
  const {DB,store,session,env}=await setup();await userSession(store,session);env.TYPESAFE_API_KEY='test-only';
  try{const m=await createMatch(store,session,input('ranked'),env);m.createdAt-=86400000;m.expiresAt=Date.now()-1;
    await store.run('UPDATE matches SET expires_at=?,payload_json=? WHERE id=?',m.expiresAt,JSON.stringify(m),m.state.matchId);
    const loaded=await ownedMatch(store,m.state.matchId,session,env);assert.equal(loaded.match.state.outcome.reason,'expiration');
    assert.equal((await store.one('SELECT outcome FROM results')).outcome,'loss');
  }finally{DB.close();}
});
test('leaderboard scopes and difficulty separate cohorts, reject stale context and bind cursors',async()=>{
  const {DB,store,session,env}=await setup();await userSession(store,session);
  try{
    const now=Date.now(),league=await leagueFor(configuration(env,'normal','ranked'));
    for(let i=0;i<60;i++){
      const uid=String(123456789012345600n+BigInt(i));if(uid!==session.user_id)await store.run('INSERT INTO users(discord_id,display_name,created_at,last_seen_at) VALUES(?,?,?,?)',uid,'Player '+i,now,now);
      await store.run('INSERT INTO results(match_id,user_id,league_id,difficulty,guild_id,channel_id,season_id,outcome,reason,created_at,finished_at,metrics_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',`fixture-${i}`,uid,league,'normal',i%2?'guild-a':'guild-b',i%3?'channel-a':'channel-b',seasonId(now),'win','correct_guess',now,now,'{}');
    }
    const world=await leaderboard(store,session,new URLSearchParams({period:'all'}),env);assert.equal(world.entries.length,50);assert.ok(world.nextCursor);
    const page2=await leaderboard(store,session,new URLSearchParams({period:'all',cursor:world.nextCursor}),env);assert.equal(page2.entries.length,10);
    await assert.rejects(()=>leaderboard(store,session,new URLSearchParams({period:'all',scope:'channel'}),env),/fresh_discord_context_required/);
    session.context={guildId:'guild-a',channelId:'channel-a',expiresAt:now+300000};
    const channel=await leaderboard(store,session,new URLSearchParams({period:'all',scope:'channel'}),env);assert.equal(channel.entries.length,20);
    const server=await leaderboard(store,session,new URLSearchParams({period:'all',scope:'server'}),env);assert.equal(server.entries.length,30);
    const hard=await leaderboard(store,session,new URLSearchParams({period:'all',difficulty:'hard'}),env);assert.equal(hard.entries.length,0);
    await assert.rejects(()=>leaderboard(store,session,new URLSearchParams({period:'all',scope:'server',cursor:world.nextCursor}),env),/cursor_mismatch/);
  }finally{DB.close();}
});
test('analytics is owner-scoped and carries explicit coverage',async()=>{
  const {DB,store,session,env}=await setup();
  try{await createMatch(store,session,input(),env);const data=await personalAnalytics(store,session,new URLSearchParams());assert.equal(data.coverage.availableStoredMatches,1);assert.equal(data.coverage.truncated,false);
    const empty=await personalAnalytics(store,{token_hash:'unknown'},new URLSearchParams());assert.equal(empty.matches.length,0);
  }finally{DB.close();}
});
test('HTTP layer rejects absent CSRF, cross-origin, unknown endpoints and score forgery',async()=>{
  const {DB,store,env}=await setup();
  try{const first=await handle(new Request(env.ORIGIN+'/api/me'),env);assert.equal(first.status,200);
    const data=await first.json(),cookie=first.headers.get('set-cookie').split(';')[0];
    const bad=await handle(new Request(env.ORIGIN+'/api/games',{method:'POST',headers:{cookie,Origin:env.ORIGIN,'Content-Type':'application/json'},body:JSON.stringify(input())}),env);assert.equal(bad.status,403);
    const forged=await handle(new Request(env.ORIGIN+'/api/game/result',{method:'POST',headers:{cookie,Origin:env.ORIGIN,'X-CSRF-Token':data.csrf,'Content-Type':'application/json'},body:'{"winner":"human"}'}),env);assert.equal(forged.status,404);
    const wrongHost=await handle(new Request('https://attacker.example/api/me'),env);assert.equal(wrongHost.status,403);
    const health=await handle(new Request('https://platform.preview.example/api/health'),env);assert.equal(health.status,200);assert.deepEqual(await health.json(),{ok:true,game:'guess-who',version:'1.0.0'});
    assert.equal((await handle(new Request('https://platform.preview.example/api/health',{method:'POST'}),env)).status,403);
    assert.equal((await handle(new Request('https://platform.preview.example/'),env)).status,403);
  }finally{DB.close();}
});
