import {count} from './roster.js';
import {actionId,other} from './rules.js';
import {questionCandidates,questionFeatures} from './strategy.js';
export const ANALYTICS_VERSION='analytics-1';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
export const sum=values=>values.filter(finite).reduce((a,b)=>a+b,0);
export const mean=values=>{const v=values.filter(finite);return v.length?sum(v)/v.length:null;};
export function percentile(values,p) {
  const v=values.filter(finite).sort((a,b)=>a-b);if(!v.length)return null;
  const i=(v.length-1)*p,lo=Math.floor(i),hi=Math.ceil(i);return v[lo]+(v[hi]-v[lo])*(i-lo);
}
export function distribution(values) {
  const v=values.filter(finite);
  return {n:v.length,min:v.length?Math.min(...v):null,mean:mean(v),p50:percentile(v,.5),p90:percentile(v,.9),p95:percentile(v,.95),p99:percentile(v,.99),max:v.length?Math.max(...v):null};
}
export function wilson(wins,total,z=1.96) {
  if(!total)return {lower:null,upper:null};
  const p=wins/total,d=1+z*z/total,center=(p+z*z/(2*total))/d;
  const radius=z*Math.sqrt(p*(1-p)/total+z*z/(4*total*total))/d;
  return {lower:Math.max(0,center-radius),upper:Math.min(1,center+radius)};
}
export function decisionDistribution(probabilities) {
  if(!probabilities)return {entropy:null,normalizedEntropy:null,topMargin:null};
  const values=Object.values(probabilities).filter(finite).sort((a,b)=>b-a);
  const entropy=-sum(values.filter(p=>p>0).map(p=>p*Math.log2(p)));
  return {entropy,normalizedEntropy:values.length>1?entropy/Math.log2(values.length):0,topMargin:values.length?values[0]-(values[1]||0):null};
}
/** Only public pre-action masks are used. No counterfactual uses the actual secret. */
export function analyzeAction(before,after,event,{timestamp,previousTimestamp,decision=null,requestId=null}={}) {
  const actor=event.actor;
  if(actor==='system')return {...event,timestamp,requestId,metrics:{wallTurnMs:null}};
  const beforeCount=count(before.possible[actor]),afterCount=count(after.possible[actor]);
  const questions=questionCandidates(before.possible[actor]);
  const metrics={beforeCount,afterCount,opponentBeforeCount:count(before.possible[other(actor)]),
    eliminated:event.action.type==='ask'?beforeCount-afterCount:0,
    entropyBefore:Math.log2(beforeCount),entropyAfter:Math.log2(afterCount),
    realizedInformationGain:event.action.type==='ask'?Math.log2(beforeCount/afterCount):null,
    wallTurnMs:finite(timestamp)&&finite(previousTimestamp)?Math.max(0,timestamp-previousTimestamp):null,
    expectedInformationGain:null,informationGainRegret:null,splitBalance:null,expectedRemaining:null,
    guessWinProbability:event.action.type==='guess'?1/beforeCount:null,riskyGuess:event.action.type==='guess'?beforeCount>1:null};
  if(event.action.type==='ask') {
    const f=questionFeatures(before.possible[actor],event.action.predicateId);
    Object.assign(metrics,{expectedInformationGain:f.informationGain,informationGainRegret:Math.max(0,Math.max(...questions.map(q=>q.informationGain))-f.informationGain),splitBalance:f.balance,expectedRemaining:f.expectedRemaining,worstCaseRemaining:f.worstCaseRemaining,singletonProbability:f.singletonProbability});
  }
  if(decision?.selectedFeatures?.estimatedWinProbability!=null && decision.candidateEvidence?.length) {
    metrics.searchRegret = Math.max(0,Math.max(...decision.candidateEvidence.map(c=>c.estimatedWinProbability).filter(finite))-decision.selectedFeatures.estimatedWinProbability);
  } else metrics.searchRegret=null;
  return {...event,timestamp,requestId,metrics,decision:decision?{...decision,...decisionDistribution(decision.probabilities)}:null};
}
export function analyzeMatch(match) {
  const events=match.events||[],state=match.state,config=match.config||{};
  const terminal=state.phase!=='active',winner=terminal?state.outcome?.winner:null;
  const decisions=events.filter(e=>e.decision).map(e=>e.decision);
  const attempts=decisions.flatMap(d=>d.attempts||[]), providerDecisions=decisions.filter(d=>d.source==='jev');
  const source=decisions.some(d=>d.source==='fallback')?'fallback':decisions.some(d=>d.source==='local_heuristic')?'local_heuristic':config.opponent==='local'?'local_heuristic':'jev';
  const actors={};
  for(const actor of ['human','jev']) {
    const rows=events.filter(e=>e.actor===actor),questions=rows.filter(e=>e.action.type==='ask'),guesses=rows.filter(e=>e.action.type==='guess');
    actors[actor]={turns:state.turnsTaken[actor],questions:state.questionsAsked[actor],remaining:count(state.possible[actor]),
      guesses:guesses.length,correctGuesses:guesses.filter(e=>e.correct===true).length,riskyGuesses:guesses.filter(e=>e.metrics?.riskyGuess).length,
      totalEliminated:sum(questions.map(e=>e.metrics?.eliminated)),
      expectedInformationGain:distribution(questions.map(e=>e.metrics?.expectedInformationGain)),
      realizedInformationGain:distribution(questions.map(e=>e.metrics?.realizedInformationGain)),
      informationGainRegret:distribution(questions.map(e=>e.metrics?.informationGainRegret)),
      splitBalance:distribution(questions.map(e=>e.metrics?.splitBalance)),
      wallTurnMs:distribution(rows.map(e=>e.metrics?.wallTurnMs))};
  }
  const successfulUsage=attempts.filter(a=>a.usage&&Number.isInteger(a.usage.input_tokens));
  const usageKnown=attempts.length>0&&successfulUsage.length===attempts.length;
  const knownInputTokens=sum(successfulUsage.map(a=>a.usage.input_tokens));
  const rate=config.inputUsdPerMillion;
  return {analyticsVersion:ANALYTICS_VERSION,matchId:state.matchId,createdAt:match.createdAt,finishedAt:match.finishedAt??null,
    difficulty:config.difficulty??'normal',leagueId:match.leagueId??null,starter:match.initial?.starter??null,
    mode:match.mode??'practice',source,phase:state.phase,winner,reason:state.outcome?.reason??null,
    eligible:!!match.eligible,durationMs:terminal&&finite(match.finishedAt)?match.finishedAt-match.createdAt:null,
    actors,provider:{decisions:providerDecisions.length,forcedDecisions:decisions.filter(d=>d.source==='forced_rule').length,
      fallbackDecisions:decisions.filter(d=>d.source==='fallback').length,attempts:attempts.length,
      retries:sum(decisions.map(d=>Math.max(0,(d.attempts?.length||0)-1))),
      invalidAttempts:attempts.filter(a=>a.error==='invalid_response').length,
      timeoutAttempts:attempts.filter(a=>a.error==='timeout').length,
      failedAttempts:attempts.filter(a=>a.error).length,
      errorReasons:Object.fromEntries([...new Set(attempts.filter(a=>a.error).map(a=>a.error))].map(reason=>[reason,attempts.filter(a=>a.error===reason).length])),
      latencyMs:distribution(providerDecisions.map(d=>d.latencyMs)),
      attemptLatencyMs:distribution(attempts.map(a=>a.latencyMs)),
      buildMs:distribution(decisions.map(d=>d.buildMs)),
      candidateCount:distribution(decisions.map(d=>d.candidateCount)),
      confidence:distribution(providerDecisions.map(d=>d.confidence)),
      normalizedEntropy:distribution(providerDecisions.map(d=>d.normalizedEntropy)),
      completedSearchDepth:distribution(decisions.map(d=>d.search?.completedDepth)),
      searchRegret:distribution(events.filter(e=>e.decision?.source==='jev').map(e=>e.metrics?.searchRegret)),
      knownInputTokens,knownOutputTokens:sum(successfulUsage.map(a=>a.usage.output_tokens)),
      usageCoverage:attempts.length?successfulUsage.length/attempts.length:null,
      inputCostUsd:usageKnown&&finite(rate)?knownInputTokens*rate/1e6:null,
      knownInputCostLowerBoundUsd:finite(rate)&&successfulUsage.length?knownInputTokens*rate/1e6:null,
      pricingInputUsdPerMillion:finite(rate)?rate:null},events};
}
function cohort(rows) {
  const finished=rows.filter(r=>r.phase==='finished'),wins=finished.filter(r=>r.winner==='human').length;
  return {started:rows.length,finished:finished.length,active:rows.filter(r=>r.phase==='active').length,
    wins,losses:finished.length-wins,winRate:finished.length?wins/finished.length:null,winInterval:wilson(wins,finished.length),
    averageHumanQuestions:mean(finished.map(r=>r.actors.human.questions)),averageJevQuestions:mean(finished.map(r=>r.actors.jev.questions)),
    eligible:rows.filter(r=>r.eligible).length,expirations:rows.filter(r=>r.reason==='expiration').length,
    resignations:rows.filter(r=>r.reason==='resignation').length};
}
export function aggregateAnalytics(rows) {
  const groups=key=>Object.fromEntries([...new Set(rows.map(key))].sort().map(k=>[k,cohort(rows.filter(r=>key(r)===k))]));
  const events=rows.flatMap(r=>r.events||[]),questions=events.filter(e=>e.action.type==='ask'),guesses=events.filter(e=>e.action.type==='guess');
  let currentStreak=0,bestStreak=0;
  rows.filter(r=>r.phase==='finished').sort((a,b)=>(a.finishedAt-b.finishedAt)||a.matchId.localeCompare(b.matchId)).forEach(r=>{currentStreak=r.winner==='human'?currentStreak+1:0;bestStreak=Math.max(bestStreak,currentStreak);});
  const predicates=Object.fromEntries([...new Set(questions.map(e=>e.action.predicateId))].sort().map(id=>{
    const q=questions.filter(e=>e.action.predicateId===id);
    return [id,{uses:q.length,yes:q.filter(e=>e.answer).length,no:q.filter(e=>!e.answer).length,
      meanEliminated:mean(q.map(e=>e.metrics?.eliminated)),meanInformationGain:mean(q.map(e=>e.metrics?.expectedInformationGain)),
      meanRegret:mean(q.map(e=>e.metrics?.informationGainRegret)),humanUses:q.filter(e=>e.actor==='human').length,jevUses:q.filter(e=>e.actor==='jev').length}];
  }));
  const guessCalibration=Object.fromEntries([...new Set(guesses.map(e=>e.metrics?.beforeCount))].filter(finite).sort((a,b)=>a-b).map(n=>{
    const g=guesses.filter(e=>e.metrics?.beforeCount===n),correct=g.filter(e=>e.correct).length;
    return [n,{guesses:g.length,correct,expectedProbability:1/n,observedRate:correct/g.length,interval:wilson(correct,g.length)}];
  }));
  const decisions=events.filter(e=>e.decision?.source==='jev').map(e=>e.decision),attempts=events.flatMap(e=>e.decision?.attempts||[]);
  return {analyticsVersion:ANALYTICS_VERSION,overall:cohort(rows),streaks:{current:currentStreak,best:bestStreak},
    byDifficulty:groups(r=>r.difficulty),byStarter:groups(r=>r.starter||'unknown'),bySource:groups(r=>r.source),
    byMode:groups(r=>r.mode),byLeague:groups(r=>r.leagueId||'unranked'),byDay:groups(r=>finite(r.createdAt)?new Date(r.createdAt).toISOString().slice(0,10):'unknown'),
    byDifficultyAndStarter:groups(r=>`${r.difficulty}/${r.starter}`),predicates,guessCalibration,
    durationMs:distribution(rows.map(r=>r.durationMs)),humanWallTurnMs:distribution(events.filter(e=>e.actor==='human').map(e=>e.metrics?.wallTurnMs)),
    jevLatencyMs:distribution(decisions.map(d=>d.latencyMs)),confidence:distribution(decisions.map(d=>d.confidence)),
    candidateCount:distribution(decisions.map(d=>d.candidateCount)),
    provider:{attempts:attempts.length,failures:attempts.filter(a=>a.error).length,
      invalid:attempts.filter(a=>a.error==='invalid_response').length,timeouts:attempts.filter(a=>a.error==='timeout').length,
      fallbackDecisions:events.filter(e=>e.decision?.source==='fallback').length,
      knownInputTokens:sum(rows.map(r=>r.provider.knownInputTokens)),
      measuredCostMatches:rows.filter(r=>finite(r.provider.inputCostUsd)).length,
      measuredInputCostUsd:rows.some(r=>finite(r.provider.inputCostUsd))?sum(rows.map(r=>r.provider.inputCostUsd)):null},
    caveats:['Mixed-cohort overall statistics are descriptive, not an opponent-strength ranking.',
      'Wall-turn time includes idle time, network transit and reconnections.',
      'Selection confidence is not a predicted win probability.',
      'Unknown measurements are null; partial usage is not a complete bill.',
      'Search estimates and question-information regret are policy-relative, not proofs of optimal play.',
      'Binomial intervals are descriptive; repeated players and decisions are not independent observations.']};
}
/** CSV formula-injection protection also applies to downloaded display names. */
export function csv(rows,columns) {
  const cell=value=>{let s=value==null?'':typeof value==='object'?JSON.stringify(value):String(value);
    if(/^[\s]*[=+@\-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
  return [columns.map(cell).join(','),...rows.map(row=>columns.map(c=>cell(row[c])).join(','))].join('\r\n')+'\r\n';
}
export const decisionRows=events=>events.map(e=>({sequence:e.sequence,actor:e.actor,action:actionId(e.action),answer:e.answer??null,correct:e.correct??null,timestamp:e.timestamp,
  ...e.metrics,source:e.decision?.source??null,latencyMs:e.decision?.latencyMs??null,confidence:e.decision?.confidence??null,
  candidateCount:e.decision?.candidateCount??null,searchDepth:e.decision?.search?.completedDepth??null,
  fallbackReason:e.decision?.fallbackReason??null}));
