import {mkdir,writeFile,appendFile} from 'node:fs/promises';
import path from 'node:path';
import {ROSTER,count,ids} from '../public/shared/roster.js';
import {createInitialState,applyAction,projectForDecision,getLegalActions,actionId} from '../public/shared/rules.js';
import {balancedAction,questionCandidates,localDecision} from '../public/shared/strategy.js';
import {analyzeAction,analyzeMatch,aggregateAnalytics,csv,decisionRows,wilson,mean} from '../public/shared/analytics.js';
import {chooseJevAction} from '../server/jev.js';
import {configuration,leagueFor} from '../server/matches.js';
import {initializeFromSeed} from '../server/security.js';

const args=Object.fromEntries(process.argv.slice(2).map(s=>{const [k,v]=s.replace(/^--/,'').split('=');return [k,v??true];}));
const live=!!args.live,limit=Math.max(1,Math.min(1152,Number(args.limit)||1152)),repeats=Math.max(1,Math.min(100,Number(args.repeats)||1));
if(live&&(!args['confirm-paid']||!process.env.TYPESAFE_API_KEY))throw Error('Live inference requires TYPESAFE_API_KEY and explicit --live --confirm-paid. No paid calls are made by default.');
const output=path.resolve(args.out||(live?'reports/live-benchmark':'reports/benchmark'));
await mkdir(output,{recursive:true});
const liveDifficulty=args.difficulty||'jev';
const matrix=live?[{id:args['jev-vs-jev']?'jev-vs-jev':`balanced-vs-jev-${liveDifficulty}`,human:args['jev-vs-jev']?'jev':'balanced',opponent:'jev',difficulty:liveDifficulty}]:[
  {id:'fixed-vs-balanced',human:'fixed',opponent:'balanced',difficulty:'normal'},
  {id:'random-safe-vs-balanced',human:'random-safe',opponent:'balanced',difficulty:'normal'},
  {id:'random-risk-vs-balanced',human:'random-risk',opponent:'balanced',difficulty:'normal'},
  {id:'balanced-vs-balanced',human:'balanced',opponent:'balanced',difficulty:'normal'},
  {id:'balanced-vs-search-hard',human:'balanced',opponent:'search',difficulty:'hard'}
];
function rng(seed){let x=seed>>>0;return ()=>{x+=0x6D2B79F5;let t=x;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};}
const memo=new Map();
function scripted(view,policy,random,difficulty){
  if(policy==='search'){
    const key=`${view.myMask}/${view.opponentMask}/${difficulty}`;
    if(!memo.has(key))memo.set(key,localDecision(view,difficulty));return structuredClone(memo.get(key));
  }
  let action;
  if(policy==='balanced')action=balancedAction(view.myMask);
  else if(policy==='fixed')action=count(view.myMask)===1?{type:'guess',characterId:ids(view.myMask)[0]}:questionCandidates(view.myMask)[0].action;
  else {
    let candidates=questionCandidates(view.myMask).map(c=>c.action);
    if(policy==='random-risk'||candidates.length===0)candidates.push(...ids(view.myMask).map(characterId=>({type:'guess',characterId})));
    action=candidates[Math.floor(random()*candidates.length)];
  }
  return {action,actionId:actionId(action),source:'local_heuristic',policy,confidence:null,probabilities:null,latencyMs:null,candidateCount:getLegalActions({phase:'active',turn:'jev',possible:{jev:view.myMask}},'jev').length,attempts:[]};
}
const start=Date.now(),allRows=[],suiteSummaries={},turnFile=path.join(output,'decisions.csv');let turnHeader=false;
await writeFile(turnFile,'');
for(const suite of matrix){
  const reports=[],matchRows=[];let scenario=0;
  for(let repeat=0;repeat<repeats;repeat++)for(const h of ROSTER)for(const j of ROSTER)for(const starter of ['human','jev']){
    const position=scenario++%(24*24*2);if(position>=limit)continue;
    const initial={human:h.id,jev:j.id,starter,matchId:`${suite.id}-r${repeat}-s${position}`};
    const config=configuration(process.env,suite.difficulty,live?'casual':'practice');
    const game={formatVersion:1,config,leagueId:await leagueFor(config),mode:'benchmark',eligible:false,initial,createdAt:Date.now(),finishedAt:null,state:createInitialState(initial),events:[]};
    const random=rng(0x9e3779b9+position*17+repeat*31);
    while(game.state.phase==='active'){
      const actor=game.state.turn,policy=actor==='human'?suite.human:suite.opponent,view=projectForDecision(game.state,actor),before=game.state;
      const decision=policy==='jev'?await chooseJevAction(view,config,process.env):scripted(view,policy,random,suite.difficulty);
      const step=applyAction(before,actor,decision.action),now=Date.now();game.state=step.state;
      game.events.push(analyzeAction(before,step.state,step.event,{timestamp:now,previousTimestamp:game.events.at(-1)?.timestamp??game.createdAt,decision}));
      if(game.state.revision>25)throw Error('termination_bound_broken');
    }
    game.finishedAt=Date.now();const report=analyzeMatch(game);reports.push(report);
    const row={suite:suite.id,repeat,scenario:position,humanSecret:h.id,jevSecret:j.id,starter,winner:game.state.outcome.winner,reason:game.state.outcome.reason,humanQuestions:game.state.questionsAsked.human,jevQuestions:game.state.questionsAsked.jev,turns:game.state.revision,providerAttempts:report.provider.attempts,fallbacks:report.provider.fallbackDecisions,eligible:false};
    matchRows.push(row);allRows.push(row);
    const turnRows=decisionRows(game.events).map(r=>({suite:suite.id,repeat,scenario:position,...r}));
    const encoded=csv(turnRows,Object.keys(turnRows[0]));await appendFile(turnFile,turnHeader?encoded.slice(encoded.indexOf('\r\n')+2):encoded);turnHeader=true;
  }
  const aggregate=aggregateAnalytics(reports),completeNoFallback=reports.filter(r=>!r.provider.fallbackDecisions),jevWins=completeNoFallback.filter(r=>r.winner==='jev').length;
  suiteSummaries[suite.id]={...aggregate,policy:{human:suite.human,opponent:suite.opponent,difficulty:suite.difficulty},
    strictOpponent:{games:completeNoFallback.length,wins:jevWins,winRate:completeNoFallback.length?jevWins/completeNoFallback.length:null,interval:wilson(jevWins,completeNoFallback.length)},
    scenarioCoverage:{possible:1152,tested:limit,repeats,exhaustiveInitialPositions:limit===1152},
    interpretation:live?'Live JEV; fallback matches excluded from strict opponent results.':'Scripted/local simulation only. Not evidence of live JEV strength.'};
  await writeFile(path.join(output,`${suite.id}.json`),JSON.stringify(suiteSummaries[suite.id],null,2));
  console.log(`${suite.id}: ${reports.length} games; human wins ${aggregate.overall.wins}; opponent wins ${aggregate.overall.losses}`);
}
await writeFile(path.join(output,'matches.csv'),csv(allRows,Object.keys(allRows[0])));
const paired=Object.fromEntries(Object.keys(suiteSummaries).map(name=>{
  const rows=allRows.filter(r=>r.suite===name),groups=new Map();for(const r of rows){const key=`${r.repeat}/${r.humanSecret}/${r.jevSecret}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
  const pairs=[...groups.values()].filter(g=>g.length===2);
  return [name,{completeStarterPairs:pairs.length,humanWinsBoth:pairs.filter(p=>p.every(r=>r.winner==='human')).length,splitPairs:pairs.filter(p=>p[0].winner!==p[1].winner).length,opponentWinsBoth:pairs.filter(p=>p.every(r=>r.winner==='jev')).length}];
}));
const summary={generatedAt:new Date().toISOString(),live,totalMatches:allRows.length,totalDecisionRows:allRows.reduce((s,r)=>s+r.turns,0),elapsedMs:Date.now()-start,
  runtime:process.version,seedPolicy:'Mulberry32 fixed per scenario/repeat for scripted random policies; all secret pairs enumerated',
  paidCallsEnabled:live,suites:suiteSummaries,pairedStarterSensitivity:paired,
  limitations:['This is exhaustive only over the 1,152 starting configurations for the selected policies, not over every legal action sequence.',
    'Local policy results do not predict live JEV strength.','Repeated games and paired starts are correlated; binomial intervals are descriptive.',
    'Scripted decision timing is not a provider-latency measurement.','Changing the roster or rules invalidates direct comparisons.']};
await writeFile(path.join(output,'summary.json'),JSON.stringify(summary,null,2));
const lines=['# Benchmark report','',`Generated: ${summary.generatedAt}`,`Runtime: ${process.version}`,`Mode: ${live?'LIVE, explicitly authorized':'LOCAL SCRIPTED — no live JEV calls'}`,`Games: ${summary.totalMatches}; decisions: ${summary.totalDecisionRows}.`,'',
 '| Matchup | Games | Human wins | Opponent wins | Human win rate |','|---|---:|---:|---:|---:|',
 ...Object.entries(suiteSummaries).map(([name,s])=>`| ${name} | ${s.overall.finished} | ${s.overall.wins} | ${s.overall.losses} | ${(s.overall.winRate*100).toFixed(2)}% |`),'',...summary.limitations.map(s=>'- '+s)];
await writeFile(path.join(output,'REPORT.md'),lines.join('\n')+'\n');
console.log(`Saved ${output}. ${live?'Live':'Local'} benchmark complete.`);
