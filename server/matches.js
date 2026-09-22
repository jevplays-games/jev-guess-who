import {createInitialState,applyAction,projectForHuman,projectForDecision,replay,expire,actionId,getLegalActions,RULES_VERSION} from '../public/shared/rules.js';
import {ROSTER_VERSION} from '../public/shared/roster.js';
import {DIFFICULTIES,localDecision,POLICY_VERSION} from '../public/shared/strategy.js';
import {analyzeAction,analyzeMatch,aggregateAnalytics,wilson} from '../public/shared/analytics.js';
import {chooseJevAction,PROMPT_VERSION,buildRequest,validateResponse} from './jev.js';
import {assert,randomHex,initializeFromSeed,sha256,canonical,sign,unsign} from './security.js';
export function seasonId(timestamp) {const d=new Date(timestamp);d.setUTCHours(0,0,0,0);d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return d.toISOString().slice(0,10);}
export function configuration(env,difficulty,mode='casual') {
  const rate=env.JEV_INPUT_USD_PER_MILLION;
  return {rulesVersion:RULES_VERSION,rosterVersion:ROSTER_VERSION,difficulty,
    model:env.JEV_MODEL||'jev-1.13.0',promptVersion:PROMPT_VERSION,policyVersion:POLICY_VERSION,rngVersion:'gw-rng-1',
    opponent:mode==='practice'?'local':'jev',inputUsdPerMillion:rate!==''&&rate!=null&&Number.isFinite(Number(rate))&&Number(rate)>=0?Number(rate):null};
}
export async function leagueFor(config) {const {inputUsdPerMillion,...competitive}=config;return (await sha256(canonical(competitive))).slice(0,24);}
export function own(row,session) {return row.user_id?row.user_id===session.user_id:row.owner_session_hash===session.token_hash;}
export async function ownedMatch(store,id,session,env) {
  const loaded=await store.getMatch(id);assert(loaded&&own(loaded.row,session),404,'match_not_found');
  if(loaded.match.state.phase==='active'&&loaded.match.expiresAt<=Date.now()) {
    const match=loaded.match,before=match.state,ended=expire(before);match.state=ended.state;match.finishedAt=match.expiresAt;
    match.events.push(analyzeAction(before,ended.state,ended.event,{timestamp:match.finishedAt,previousTimestamp:match.events.at(-1)?.timestamp??match.createdAt}));
    const result=match.eligible?await resultFor(match):null;
    if(await store.commit(match,before.revision,{result}))await store.telemetry('game_expired',{matchId:id,details:{eligible:match.eligible}});
    return store.getMatch(id);
  }
  return loaded;
}
export async function createMatch(store,session,input,env) {
  assert(input.gameId==='guess-who',400,'unknown_game');
  assert(DIFFICULTIES.includes(input.difficulty),400,'invalid_difficulty');
  assert(['practice','casual','ranked'].includes(input.mode),400,'invalid_mode');
  assert(typeof input.requestId==='string'&&/^[a-zA-Z0-9_-]{8,80}$/.test(input.requestId),400,'invalid_request_id');
  const existing=await store.one('SELECT * FROM matches WHERE owner_session_hash=? AND request_id=?',session.token_hash,input.requestId);
  if(existing){const m=JSON.parse(existing.payload_json);assert(m.mode===input.mode&&m.config.difficulty===input.difficulty,409,'request_id_conflict');return m;}
  if(input.mode==='ranked') {
    assert(session.user_id,401,'discord_required');assert(env.TYPESAFE_API_KEY,503,'jev_not_configured');
    assert(/^jev-\d+\.\d+\.\d+$/.test(env.JEV_MODEL||'jev-1.13.0'),503,'pinned_model_required');
    const active=await store.one("SELECT id FROM matches WHERE user_id=? AND status='active' AND mode='ranked'",session.user_id);
    if(active){await ownedMatch(store,active.id,session,env);const still=await store.one("SELECT id FROM matches WHERE id=? AND status='active'",active.id);assert(!still,409,'active_ranked_match');}
  }
  await store.quota(`create:${session.user_id||session.token_hash}`,session.user_id?30:10,3600000);
  const now=Date.now(),id=crypto.randomUUID(),seed=randomHex(32),config=configuration(env,input.difficulty,input.mode);
  const {initial,commitment}=await initializeFromSeed(seed,id,config),leagueId=await leagueFor(config);
  const context=session.context&&session.context.expiresAt>now?session.context:null;
  const match={formatVersion:1,mode:input.mode,config,leagueId,createdAt:now,expiresAt:now+86400000,finishedAt:null,
    eligible:input.mode==='ranked',eligibilityReason:input.mode==='ranked'?null:input.mode==='practice'?'local_practice':'casual_or_guest',
    context:context?{guildId:context.guildId,channelId:context.channelId,interactionId:context.interactionId}:null,
    initial,seed,commitment,state:createInitialState(initial),events:[]};
  try{await store.run(`INSERT INTO matches(id,user_id,owner_session_hash,request_id,mode,league_id,guild_id,channel_id,revision,status,eligible,payload_json,created_at,expires_at)
    VALUES(?,?,?,?,?,?,?,?,0,'active',?,?,?,?)`,id,session.user_id??null,session.token_hash,input.requestId,input.mode,leagueId,context?.guildId??null,context?.channelId??null,Number(match.eligible),JSON.stringify(match),now,match.expiresAt);}
  catch(error){if(/UNIQUE|constraint/i.test(error.message))throw Object.assign(Error('active_or_duplicate_match'),{status:409,code:'active_or_duplicate_match'});throw error;}
  await store.telemetry('game_started',{matchId:id,actorKey:session.actorKey,details:{difficulty:input.difficulty,mode:input.mode,eligible:match.eligible,identityKind:session.user_id?'discord':'guest'}});return match;
}
export function snapshot(match) {
  return {...projectForHuman(match.state),mode:match.mode,config:match.config,leagueId:match.leagueId,createdAt:match.createdAt,expiresAt:match.expiresAt,
    commitment:match.commitment,eligible:match.eligible,eligibilityReason:match.eligibilityReason,
    context:match.context?{guildId:match.context.guildId,channelId:match.context.channelId}:null,
    history:match.events,analytics:analyzeMatch(match)};
}
export async function verifyMatch(match) {
  assert(match.formatVersion===1,422,'replay_version');
  assert(match.config.rulesVersion===RULES_VERSION&&match.config.rosterVersion===ROSTER_VERSION&&match.config.policyVersion===POLICY_VERSION&&match.config.promptVersion===PROMPT_VERSION,422,'configuration_mismatch');
  assert(DIFFICULTIES.includes(match.config.difficulty),422,'configuration_mismatch');
  const derived=await initializeFromSeed(match.seed,match.state.matchId,match.config);
  assert(derived.commitment===match.commitment&&canonical(derived.initial)===canonical(match.initial),422,'commitment_mismatch');
  assert(match.leagueId===await leagueFor(match.config),422,'league_mismatch');
  let priorState=createInitialState(match.initial),priorTimestamp=match.createdAt;
  for(const event of match.events) {
    assert(Number.isFinite(event.timestamp)&&event.timestamp>=priorTimestamp,422,'event_timestamp_invalid');
    if(event.actor==='jev'&&['jev','forced_rule'].includes(event.decision?.source)) {
      const built=buildRequest(projectForDecision(priorState,'jev'),match.config.difficulty,match.config.model);
      assert(event.decision.inputHash===await sha256(canonical(built.payload)),422,'decision_input_mismatch');
      if(event.decision.source==='forced_rule')assert(built.candidates.length===1&&built.candidates[0].id===actionId(event.action),422,'forced_decision_invalid');
      else {
        const checked=validateResponse({model:event.decision.model,answers:{action:{type:'choice',choice:event.decision.actionId,probabilities:event.decision.probabilities,confidence:event.decision.confidence}}},built.candidates,match.config.model);
        assert(checked.selected.id===actionId(event.action),422,'decision_selection_mismatch');
      }
      assert(canonical(event.decision.candidateEvidence)===canonical(built.candidates),422,'candidate_evidence_mismatch');
    }
    const step=event.actor==='system'?expire(priorState):applyAction(priorState,event.actor,event.action);
    const checkedEvent=analyzeAction(priorState,step.state,step.event,{timestamp:event.timestamp,previousTimestamp:priorTimestamp,decision:event.decision||null,requestId:event.requestId||null});
    assert(canonical(checkedEvent.metrics)===canonical(event.metrics),422,'analytics_mismatch');
    priorState=step.state;priorTimestamp=event.timestamp;
  }
  const state=replay(match.initial,match.events);
  assert(canonical(state)===canonical(match.state),422,'replay_state_mismatch');
  if(match.eligible) {
    assert(match.mode==='ranked'&&match.config.opponent==='jev',422,'eligibility_mismatch');
    for(const event of match.events.filter(e=>e.actor==='jev')) {
      assert(['jev','forced_rule'].includes(event.decision?.source),422,'unverified_opponent');
      assert(event.decision.actionId===actionId(event.action),422,'decision_mismatch');
      assert(event.decision.model===match.config.model,422,'model_mismatch');
    }
  }
  return state;
}
async function resultFor(match) {
  await verifyMatch(match);assert(match.state.phase==='finished',422,'not_terminal');
  const metrics=analyzeMatch(match);delete metrics.events;
  return {seasonId:seasonId(match.createdAt),outcome:match.state.outcome.winner==='human'?'win':'loss',metrics};
}
export async function humanAction(store,session,id,input,env) {
  const {match}=await ownedMatch(store,id,session,env);
  assert(typeof input.actionId==='string'&&/^[a-zA-Z0-9_-]{8,80}$/.test(input.actionId),400,'invalid_action_id');
  const prior=match.events.find(e=>e.requestId===input.actionId);
  if(prior){assert(canonical(prior.action)===canonical(input.action),409,'action_id_conflict');return match;}
  assert(Number.isInteger(input.expectedRevision)&&input.expectedRevision===match.state.revision,409,'stale_revision');
  const before=match.state,step=applyAction(before,'human',input.action),now=Date.now();
  match.state=step.state;match.events.push(analyzeAction(before,step.state,step.event,{timestamp:now,previousTimestamp:match.events.at(-1)?.timestamp??match.createdAt,requestId:input.actionId}));
  if(step.state.phase==='finished')match.finishedAt=now;
  const result=match.eligible&&match.finishedAt?await resultFor(match):null;
  assert(await store.commit(match,before.revision,{result}),409,'stale_revision');
  await store.telemetry(match.finishedAt?'game_completed':'human_action',{matchId:id,actorKey:session.actorKey,details:{revision:match.state.revision,eligible:match.eligible}});return match;
}
export async function advance(store,session,id,env,{fetchImpl=fetch}={}) {
  const loaded=await ownedMatch(store,id,session,env),match=loaded.match;
  if(match.state.phase!=='active'||match.state.turn!=='jev')return {match,pending:false};
  const revision=match.state.revision,leaseId=await store.lease(id,revision);
  if(!leaseId)return {match,pending:true};
  const view=projectForDecision(match.state,'jev');
  const start=performance.now();
  const decision=match.config.opponent==='local'?localDecision(view,match.config.difficulty):await chooseJevAction(view,match.config,env,{fetchImpl});
  if(decision.source==='local_heuristic')decision.latencyMs=performance.now()-start;
  // Persist every attempted inference before the game CAS, including subsequently discarded responses.
  for(const attempt of decision.attempts||[])await store.telemetry('jev_attempt',{matchId:id,details:{
    status:attempt.status??0,reason:attempt.error||'success',latencyMs:attempt.latencyMs,
    inputTokens:attempt.usage?.input_tokens,outputTokens:attempt.usage?.output_tokens,
    requestBytes:decision.requestBytes,source:decision.source,difficulty:match.config.difficulty}});
  assert(getLegalActions(match.state,'jev').some(a=>actionId(a)===decision.actionId),500,'adapter_illegal_action');
  // No provider response is applied after expiry, even if the lease was obtained earlier.
  if(Date.now()>=match.expiresAt){const refreshed=await ownedMatch(store,id,session,env);return {match:refreshed.match,pending:false};}
  const before=match.state,step=applyAction(before,'jev',decision.action),now=Date.now();
  match.state=step.state;match.events.push(analyzeAction(before,step.state,step.event,{timestamp:now,previousTimestamp:match.events.at(-1)?.timestamp??match.createdAt,decision}));
  if(decision.source==='fallback'){match.eligible=false;match.eligibilityReason=`jev_fallback:${decision.fallbackReason}`;}
  if(step.state.phase==='finished')match.finishedAt=now;
  const result=match.eligible&&match.finishedAt?await resultFor(match):null;
  if(!await store.commit(match,revision,{leaseId,result})){await store.telemetry('jev_stale_response',{matchId:id,details:{revision,source:decision.source}});return {match:(await store.getMatch(id)).match,pending:false};}
  await store.telemetry(decision.source==='fallback'?'jev_fallback':'jev_decision',{matchId:id,details:{source:decision.source,latencyMs:decision.latencyMs,candidateCount:decision.candidateCount,revision:match.state.revision,eligible:match.eligible,attempts:decision.attempts?.length??0}});
  if(match.finishedAt)await store.telemetry('game_completed',{matchId:id,details:{eligible:match.eligible}});
  return {match,pending:false};
}
export async function personalAnalytics(store,session,params) {
  const where=session.user_id?'user_id=?':'owner_session_hash=?',value=session.user_id||session.token_hash;
  const cutoff=Date.now(),rows=await store.all(`SELECT payload_json FROM matches WHERE ${where} AND created_at<=? ORDER BY created_at DESC LIMIT 501`,value,cutoff);
  const total=await store.one(`SELECT count(*) AS n FROM matches WHERE ${where} AND created_at<=?`,value,cutoff);
  let reports=rows.slice(0,500).map(r=>analyzeMatch(JSON.parse(r.payload_json)));
  for(const [field,parameter] of [['difficulty','difficulty'],['mode','mode'],['starter','starter']])if(params.get(parameter)&&params.get(parameter)!=='all')reports=reports.filter(r=>r[field]===params.get(parameter));
  const from=params.get('from');if(from){assert(!Number.isNaN(Date.parse(from)),400,'invalid_from');reports=reports.filter(r=>r.createdAt>=Date.parse(from));}
  return {coverage:{asOf:cutoff,availableStoredMatches:total.n,scanned:Math.min(total.n,500),filtered:reports.length,truncated:total.n>500,retention:'Detailed history is retained according to deployment policy.'},summary:aggregateAnalytics(reports),matches:reports.map(({events,...summary})=>({...summary,detailEndpoint:`/api/games/${summary.matchId}`}))};
}
export async function leaderboard(store,session,params,env) {
  const difficulty=params.get('difficulty')||'normal',scope=params.get('scope')||'world',period=params.get('period')||'week';
  assert(DIFFICULTIES.includes(difficulty)&&['world','server','channel'].includes(scope)&&['week','all'].includes(period),400,'invalid_leaderboard_filter');
  if(scope!=='world')assert(session.user_id&&session.context?.expiresAt>Date.now(),403,'fresh_discord_context_required');
  const leagueId=await leagueFor(configuration(env,difficulty,'ranked')),where=['r.league_id=?','u.blocked=0'],args=[leagueId];
  const now=Date.now(),season=seasonId(now);
  if(period==='week'){where.push('r.season_id=?');args.push(season);}
  if(scope!=='world'){where.push('r.guild_id=?');args.push(session.context.guildId);}
  if(scope==='channel'){where.push('r.channel_id=?');args.push(session.context.channelId);}
  const filter={leagueId,scope,period,season:period==='week'?season:null,guildId:scope!=='world'?session.context.guildId:null,channelId:scope==='channel'?session.context.channelId:null};
  let cutoff=Number((await store.one('SELECT COALESCE(MAX(id),0) AS id FROM results')).id),offset=0;
  if(params.get('cursor')){const c=await unsign(params.get('cursor'),env.LAUNCH_SIGNING_KEY);assert(c.kind==='leaderboard'&&canonical(c.filter)===canonical(filter)&&Number.isInteger(c.offset)&&c.offset>=0&&Number.isInteger(c.cutoff),400,'cursor_mismatch');cutoff=c.cutoff;offset=c.offset;}
  where.push('r.id<=?');args.push(cutoff);
  // Rank on the SQL side before LIMIT. No 500-player preselection bias.
  const cte=`WITH grouped AS (
    SELECT r.user_id,MAX(u.display_name) AS display_name,COUNT(*) AS games,SUM(CASE WHEN outcome='win' THEN 1 ELSE 0 END) AS wins
    FROM results r JOIN users u ON u.discord_id=r.user_id WHERE ${where.join(' AND ')} GROUP BY r.user_id
  ), stats AS (SELECT *,wins*1.0/games AS p,3.8416/games AS z2n FROM grouped),
  ranked AS (SELECT *,((p+z2n/2)-1.96*sqrt(p*(1-p)/games+3.8416/(4.0*games*games)))/(1+z2n) AS ranking_value FROM stats)`;
  const entries=await store.all(`${cte} SELECT user_id,display_name,games,wins,ranking_value FROM ranked ORDER BY (games>=20) DESC,ranking_value DESC,wins DESC,user_id ASC LIMIT 51 OFFSET ?`,...args,offset);
  const more=entries.length>50,visible=entries.slice(0,50).map((e,i)=>({...e,rank:e.games>=20?offset+i+1:null,losses:e.games-e.wins,winRate:e.wins/e.games,provisional:e.games<20,winInterval:wilson(e.wins,e.games)}));
  const nextCursor=more?await sign({kind:'leaderboard',filter,cutoff,offset:offset+50,expiresAt:now+300000},env.LAUNCH_SIGNING_KEY):null;
  return {scope,period,difficulty,leagueId,season:period==='week'?season:null,minimumGames:20,entries:visible,nextCursor,cutoff};
}
