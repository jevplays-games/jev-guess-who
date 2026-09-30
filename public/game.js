import {ROSTER,PREDICATES,FULL_MASK,MASKS,character,describe,count,ids} from './shared/roster.js';
import {createInitialState,applyAction,projectForHuman,projectForDecision,actionId} from './shared/rules.js';
import {localDecision,questionFeatures} from './shared/strategy.js';
import {analyzeAction,analyzeMatch,aggregateAnalytics,decisionRows,csv} from './shared/analytics.js';
import {matchQuestion} from './shared/question-parse.js';
const $=id=>document.getElementById(id);
const f=(n,d=2)=>typeof n==='number'&&Number.isFinite(n)?n.toLocaleString(undefined,{maximumFractionDigits:d}):'—';
const pct=n=>typeof n==='number'?`${f(n*100,1)}%`:'—';
const ms=n=>typeof n==='number'?`${f(n,0)} ms`:'—';
const humanName=actor=>actor==='human'?'You':actor==='jev'?'Opponent':'System';
const el=(tag,text,className)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(className)n.className=className;return n;};
const option=(value,label)=>{const n=el('option',label);n.value=value;return n;};
const labelAction=a=>a.type==='ask'?PREDICATES.find(p=>p.id===a.predicateId)?.label:a.type==='guess'?`Guess ${character(a.characterId)?.name||a.characterId}`:a.type==='expire'?'Match expired':'Resign';
let questionMatch={status:'empty',options:[]};
let bearer=null; // set only inside a Discord Activity, where cookies are not sent
let me=null,current=null,busy=false,offline=false,offlineMatch=null,analyticsData=null,lastPending=null,leaderboardCursor=null;
let exportedOffline=new Set();
function notice(message=''){ $('notice').textContent=message;$('notice').hidden=!message; }
const readable={discord_required:'Sign in with Discord to use this feature.',jev_not_configured:'The JEV API key is not configured. Choose Practice to play the local opponent.',active_ranked_match:'Finish or resume your existing ranked match first.',fresh_discord_context_required:'Launch /play-jev from the relevant Discord channel to establish fresh context.',csrf_rejected:'Your session changed. Use Refresh / reconnect.',stale_revision:'The match changed in another request or tab. Use Refresh / reconnect.',rate_limit:'Request limit reached. Retry after the cooldown.',session_required:'Your session expired. Use Refresh / reconnect.',discord_not_configured:'Discord credentials have not been configured by the host.'};
async function api(url,{method='GET',body}={}) {
  const response=await fetch(url,{method,credentials:'same-origin',headers:{...(bearer?{Authorization:`Bearer ${bearer}`}:{}),...(method==='POST'?{'Content-Type':'application/json','X-CSRF-Token':me?.csrf||''}:{})},...(body?{body:JSON.stringify(body)}:{})});
  let data;try{data=await response.json();}catch{throw Error('The server returned an unreadable response.');}
  if(!response.ok)throw Object.assign(Error(readable[data.error]||data.error||'Request failed'),{code:data.error,status:response.status});return data;
}
async function guarded(fn){if(busy)return;busy=true;renderControls();try{notice();await fn();}catch(error){notice(error.message);}finally{busy=false;renderControls();}}
function persistSetting(key,value){try{localStorage.setItem('gw:'+key,String(value));}catch{}}
function setting(key,fallback){try{return localStorage.getItem('gw:'+key)??fallback;}catch{return fallback;}}
function saveBlob(name,text,type='application/json') {
  const url=URL.createObjectURL(new Blob([text],{type})),a=el('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function activate(tab){
  for(const name of ['play','analytics','leaderboard']){$(`tab-${name}`).setAttribute('aria-selected',String(name===tab));$(`panel-${name}`).hidden=name!==tab;}
  if(tab==='analytics')loadAnalytics().catch(e=>notice(e.message));
  if(tab==='leaderboard')loadLeaderboard(false).catch(e=>notice(e.message));
}
for(const name of ['play','analytics','leaderboard'])$(`tab-${name}`).addEventListener('click',()=>activate(name));
document.querySelector('[role=tablist]').addEventListener('keydown',event=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  const tabs=['play','analytics','leaderboard'],currentIndex=tabs.findIndex(name=>$(`tab-${name}`)===document.activeElement);
  const i=event.key==='Home'?0:event.key==='End'?2:(currentIndex+(event.key==='ArrowRight'?1:2))%3;
  event.preventDefault();$(`tab-${tabs[i]}`).focus();activate(tabs[i]);
});
async function confirm(title,detail) {
  $('confirm-title').textContent=title;$('confirm-detail').textContent=detail;
  const dialog=$('confirm-dialog');dialog.returnValue='cancel';dialog.showModal();
  return new Promise(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue==='confirm'),{once:true}));
}
function renderControls(){
  const humanTurn=current?.phase==='active'&&current.turn==='human'&&!busy;
  $('ask').disabled=!humanTurn||!current?.legalActions.some(a=>a.type==='ask')||questionMatch.status!=='ok';
  $('question').disabled=!humanTurn;$('resign').disabled=!humanTurn;
  $('new-game').disabled=busy;$('resume').disabled=busy;
  $('export-replay').disabled=!current||current.phase==='active';$('export-turns').disabled=!current?.history?.length;
  for(const card of $('board').querySelectorAll('button'))card.disabled=!humanTurn||!(current.possible.human&(1<<Number(card.dataset.index)));
}
function renderBoard(){
  const mask=current?.possible.human??FULL_MASK,showEliminated=$('show-eliminated').checked,textMode=$('text-mode').checked;
  const board=$('board');board.replaceChildren();board.classList.toggle('text-mode',textMode);
  ROSTER.forEach((c,index)=>{
    const remaining=!!(mask&(1<<index));if(!showEliminated&&!remaining)return;
    const button=el('button',null,`character${remaining?'':' eliminated'}`);button.dataset.index=index;
    button.setAttribute('aria-label',`${describe(c)}. ${remaining?'Select to make a final guess.':'Eliminated.'}`);
    if(!textMode){const image=el('img');image.src=`/portraits/${c.id}.svg`;image.alt='';image.width=120;image.height=120;button.append(image);}
    button.append(el('span',c.name,'name'));
    if(textMode)button.append(el('span',describe(c).split('; ').slice(1).join(' · '),'traits'));
    button.addEventListener('click',()=>guarded(async()=>{
      if(await confirm(`Guess ${c.name}?`,'A wrong final guess immediately loses. This takes your entire turn.'))await sendAction({type:'guess',characterId:c.id});
    }));board.append(button);
  });renderControls();
}
function render(){
  renderBoard();if(!current)return;
  const practice=current.config.opponent==='local'||offline;
  const humanRemaining=count(current.possible.human);
  $('remaining').textContent=humanRemaining;$('remaining-count').textContent=humanRemaining;$('jev-remaining').textContent=count(current.possible.jev);$('jev-questions').textContent=current.questionsAsked.jev;
  $('turn-status').textContent=current.phase==='active'?(current.turn==='human'?'Your turn. Choose a question.':'Opponent is choosing…'):(current.outcome.winner==='human'?'You found the answer.':'Match complete.');
  $('eligibility').textContent=current.eligible?'Ranked · eligible':current.eligibilityReason?.startsWith('jev_fallback')?'Unranked · JEV fallback':practice?(offline?'Offline practice':'Practice · local heuristic'):'Casual · not ranked';
  const fallback=current.history.some(e=>e.decision?.source==='fallback');
  $('opponent-source').textContent=fallback?'Fallback heuristic':practice?'Local heuristic':'JEV';
  const c=character(current.ownSecret),image=el('img');image.src=`/portraits/${c.id}.svg`;image.alt=describe(c);
  const identity=el('div');identity.append(el('h3',c.name),el('p',describe(c).split('; ').slice(1).join(' · '),'identity-traits'));$('secret').replaceChildren(image,identity);
  // The datalist offers the questions still open, so typing stays optional and
  // a player can pick from the list exactly as before.
  // value, not id: a datalist inserts the option's VALUE into the input, and
  // the input holds what the player typed, not a predicate id.
  $('question-options').replaceChildren(...PREDICATES.filter(p=>isAskable(p.id)).map(p=>option(p.label,p.label)));
  previewQuestion();
  $('opponent-board').replaceChildren(...ROSTER.map((c,i)=>el('span',c.name,current.possible.jev&(1<<i)?'':'eliminated')));
  const last=current.history.at(-1);
  if(last)$('last-answer').textContent=`${humanName(last.actor)}: ${labelAction(last.action)}${typeof last.answer==='boolean'?` ${last.answer?'Yes.':'No.'}`:''}`;
  $('history').replaceChildren();
  if(!current.history.length)$('history').append(el('p','No turns yet.','muted'));
  for(const event of current.history){const row=el('div',null,'history-entry');row.append(el('span',String(event.sequence).padStart(2,'0'),'muted'),el('span',humanName(event.actor),'actor'),el('span',labelAction(event.action)),el('span',typeof event.answer==='boolean'?(event.answer?'Yes':'No'):typeof event.correct==='boolean'?(event.correct?'Correct':'Incorrect'):'','answer'));$('history').append(row);}
  $('history').scrollTop=$('history').scrollHeight;
  renderEvidence();$('result').hidden=current.phase==='active';
  if(current.phase!=='active'){
    const result=$('result');result.replaceChildren(el('h3',current.outcome.winner==='human'?'You win.':'Opponent wins.'));
    result.append(el('p',`Your secret: ${character(current.revealedSecrets.human).name}. Opponent's secret: ${character(current.revealedSecrets.jev).name}.`));
    result.append(el('p',`End reason: ${current.outcome.reason.replaceAll('_',' ')}. Questions: you ${current.questionsAsked.human}, opponent ${current.questionsAsked.jev}.`));
    result.append(el('p',current.eligible?'Verified ranked outcome recorded.':'Unranked result. It does not affect official leaderboards.','muted'));
  }
  renderControls();
}
const isAskable=id=>!!current?.legalActions.some(a=>a.type==='ask'&&a.predicateId===id);
function previewQuestion(){
  if(!current)return;
  questionMatch=matchQuestion($('question').value,isAskable);
  const preview=$('question-preview'),suggestions=$('question-suggestions');
  suggestions.replaceChildren();suggestions.hidden=true;
  if(!current.legalActions.some(a=>a.type==='ask')){
    preview.textContent='No questions remain. Select a character to make your final guess.';renderControls();return;
  }
  if(questionMatch.status==='ok'){
    const {id,label}=questionMatch.predicate,features=questionFeatures(current.possible.human,id);
    // A turn answers one predicate. If they joined two clauses, say which one
    // is actually going to be asked before it costs them the turn.
    const warn=questionMatch.warning==='one_per_turn'?'One question per turn, so only this one will be asked. ':'';
    preview.textContent=`${warn}${label} · public split ${features.yes} yes / ${features.no} no · expected ${f(features.expectedRemaining)} remaining · ${f(features.informationGain)} bits of expected information.`;
  }else{
    preview.textContent={
      empty:'Type a question in your own words, or pick one from the list.',
      unknown:'No rule can answer that. This game only reads glasses, hats, earrings, scarves, beards, moustaches, and hair length, curl and colour.',
      ambiguous:'That could mean more than one question. Choose which you meant:',
      compound:'That is two questions, and a turn answers only one. Pick the one to ask:',
      spent:'You have already asked that one. Still open:',
    }[questionMatch.status];
    // Offer the legal questions as one-click buttons rather than making the
    // player guess the wording a second time.
    const options=(questionMatch.options??[]).slice(0,6);
    if(options.length){
      suggestions.hidden=false;
      for(const p of options){
        const b=el('button',p.label,'jv-link-btn');b.type='button';
        b.addEventListener('click',()=>{$('question').value=p.label;previewQuestion();$('question').focus();});
        suggestions.append(b);
      }
    }
  }
  renderControls();
}
$('question').addEventListener('input',previewQuestion);
$('question').addEventListener('change',previewQuestion);
$('question').addEventListener('keydown',event=>{if(event.key==='Enter'&&!$('ask').disabled){event.preventDefault();$('ask').click();}});
function evidenceRow(label,value){const r=el('div',null,'evidence-row');r.append(el('span',label),el('strong',value));return r;}
function renderEvidence(){
  const panel=$('decision-evidence');panel.hidden=!$('analysis-toggle').checked;
  const decision=current?.history.filter(e=>e.decision).at(-1)?.decision;if(!decision)return;
  panel.replaceChildren(el('p',labelAction(decision.action)));
  panel.append(evidenceRow('Source',decision.source),evidenceRow('Candidates',f(decision.candidateCount,0)),evidenceRow('Decision latency',ms(decision.latencyMs)),evidenceRow('Selection confidence',pct(decision.confidence)));
  if(decision.selectedFeatures?.expectedRemaining!=null)panel.append(evidenceRow('Expected remaining',f(decision.selectedFeatures.expectedRemaining)));
  if(decision.selectedFeatures?.estimatedWinProbability!=null)panel.append(evidenceRow('Search win estimate',pct(decision.selectedFeatures.estimatedWinProbability)));
  if(decision.search)panel.append(evidenceRow('Completed search depth',f(decision.search.completedDepth,0)),evidenceRow('Search nodes',f(decision.search.nodes,0)));
  if(decision.fallbackReason)panel.append(el('p',`JEV unavailable: ${decision.fallbackReason}. The fallback is deterministic, not JEV. Official ranking is disabled.`, 'muted'));
  panel.append(el('p','Evidence is computed from public candidates. Selection confidence is not the probability of winning.','muted'));
  if(decision.probabilities){const d=el('details');d.append(el('summary','Full selection distribution'));d.append(makeTable(['Action','Probability'],Object.entries(decision.probabilities).sort((a,b)=>b[1]-a[1]).map(([id,p])=>[id,pct(p)])));panel.append(d);}
}
function snapshotOffline(){return {...projectForHuman(offlineMatch.state),mode:'practice',config:offlineMatch.config,history:offlineMatch.events,eligible:false,eligibilityReason:'offline_practice',analytics:analyzeMatch(offlineMatch),createdAt:offlineMatch.createdAt};}
function offlineStart(difficulty){
  const draw=bound=>{for(;;){const value=crypto.getRandomValues(new Uint8Array(1))[0];if(value<256-(256%bound))return value%bound;}};
  const initial={human:ROSTER[draw(24)].id,jev:ROSTER[draw(24)].id,starter:draw(2)?'jev':'human',matchId:crypto.randomUUID()};
  offlineMatch={formatVersion:1,offline:true,mode:'practice',eligible:false,initial,createdAt:Date.now(),finishedAt:null,config:{difficulty,opponent:'local'},state:createInitialState(initial),events:[]};
  current=snapshotOffline();render();
}
function offlineApply(actor,action,decision=null){
  const before=offlineMatch.state,step=applyAction(before,actor,action),now=Date.now();
  offlineMatch.state=step.state;offlineMatch.events.push(analyzeAction(before,step.state,step.event,{timestamp:now,previousTimestamp:offlineMatch.events.at(-1)?.timestamp??offlineMatch.createdAt,decision}));
  if(step.state.phase==='finished')offlineMatch.finishedAt=now;
  current=snapshotOffline();
  if(offlineMatch.finishedAt&&!exportedOffline.has(current.matchId)){
    exportedOffline.add(current.matchId);
    let saved=[];try{saved=JSON.parse(setting('offline-stats','[]'));}catch{}
    saved.push(analyzeMatch(offlineMatch));persistSetting('offline-stats',JSON.stringify(saved.slice(-100)));
  }
}
async function progressOpponent(){
  if(current?.phase!=='active'||current.turn!=='jev')return;
  render();
  if(offline){await new Promise(r=>setTimeout(r,100));const decision=localDecision(projectForDecision(offlineMatch.state,'jev'),offlineMatch.config.difficulty);offlineApply('jev',decision.action,decision);render();return;}
  for(let i=0;i<12&&current.turn==='jev'&&current.phase==='active';i++){
    const result=await api(`/api/games/${current.matchId}/advance`,{method:'POST',body:{}});current=result;render();
    if(result.pending)await new Promise(r=>setTimeout(r,1000));
  }
  if(current.phase==='active'&&current.turn==='jev')notice('The opponent turn is still pending. Use Refresh / reconnect to resume.');
}
async function sendAction(action){
  if(offline)offlineApply('human',action);
  else {
    const body={actionId:crypto.randomUUID(),expectedRevision:current.revision,action};
    lastPending={url:`/api/games/${current.matchId}/actions`,body};current=await api(lastPending.url,{method:'POST',body});lastPending=null;
  }
  render();await progressOpponent();
}
$('ask').addEventListener('click',()=>guarded(async()=>{
  // Re-resolve at the moment of asking: the legal set may have moved since
  // the text was typed. Only a predicateId from that set is ever sent.
  const resolved=matchQuestion($('question').value,isAskable);
  if(resolved.status!=='ok'){previewQuestion();throw Error('Pick a question the rules can answer.');}
  await sendAction({type:'ask',predicateId:resolved.predicate.id});
  $('question').value='';previewQuestion();
}));
$('resign').addEventListener('click',()=>guarded(async()=>{if(await confirm('Resign this match?','Resignation is recorded as a loss in an eligible ranked match.'))await sendAction({type:'resign'});}));
async function startGame(){
  const difficulty=$('difficulty').value,mode=$('mode').value;persistSetting('difficulty',difficulty);
  if(current?.phase==='active'&&current.mode==='ranked')throw Error('Resume or finish your active ranked match before starting another.');
  if(offline){offlineStart(difficulty);notice('Offline practice: a local heuristic, not JEV. Results remain in this browser.');}
  else current=await api('/api/games',{method:'POST',body:{gameId:'guess-who',difficulty,mode,requestId:crypto.randomUUID()}});
  activate('play');render();await progressOpponent();
}
$('new-game').addEventListener('click',()=>guarded(startGame));
/* Auto-start: the board is playable as soon as the page is, with no click.
   Returns early if a game is already live, because initialize() has just
   resumed any active match -- so a reload rejoins rather than opening a second
   one, and the ranked guard above still applies.
   Ranked needs a signed-in Discord account AND hosted JEV; anything less falls
   back to casual, or to practice offline, so an auto-started game is never
   relabeled as JEV and never claims a rank the player could not claim by hand. */
async function autoStart(){
  if(current&&current.phase!=='complete')return;
  if(!offline)$('mode').value=me?.user&&me?.jevConfigured?'ranked':me?.jevConfigured?'casual':'practice';
  await guarded(startGame);
}
$('resume').addEventListener('click',()=>guarded(async()=>{
  if(offline){await progressOpponent();return;}
  me=await api('/api/me');
  if(lastPending){current=await api(lastPending.url,{method:'POST',body:lastPending.body});lastPending=null;}
  else if(current)current=await api(`/api/games/${current.matchId}`);
  else if(me.activeMatchId)current=await api(`/api/games/${me.activeMatchId}`);
  render();await progressOpponent();
}));
$('show-eliminated').addEventListener('change',renderBoard);$('text-mode').addEventListener('change',()=>{persistSetting('text-mode',$('text-mode').checked);renderBoard();});
$('analysis-toggle').addEventListener('change',()=>{persistSetting('analysis',$('analysis-toggle').checked);renderEvidence();});
$('rules-button').addEventListener('click',()=>$('rules-dialog').showModal());
$('login').addEventListener('click',()=>{if(!me?.discordConfigured){notice('Discord is not configured on this host. See docs/DEPLOYMENT.md in the project.');return;}location.assign('/api/auth/discord');});
$('logout').addEventListener('click',()=>guarded(async()=>{await api('/api/logout',{method:'POST',body:{}});location.reload();}));
$('export-turns').addEventListener('click',()=>{
  const rows=decisionRows(current.history);saveBlob(`guess-who-${current.matchId}-turns.csv`,csv(rows,Object.keys(rows[0]||{})),'text/csv;charset=utf-8');
});
$('export-replay').addEventListener('click',()=>guarded(async()=>{
  const replay=offline?{...offlineMatch,verification:'unranked-offline-only'}:await api(`/api/games/${current.matchId}/replay`);
  saveBlob(`guess-who-${current.matchId}-replay.json`,JSON.stringify(replay,null,2));
}));
function makeTable(headers,rows){
  const wrap=el('div',null,'table-wrap'),table=el('table'),thead=el('thead'),head=el('tr'),body=el('tbody');
  headers.forEach(h=>{const cell=el('th',h);cell.scope='col';head.append(cell);});thead.append(head);
  rows.forEach(row=>{const tr=el('tr');row.forEach(value=>tr.append(el('td',value==null?'—':String(value))));body.append(tr);});
  if(!rows.length){const tr=el('tr'),td=el('td','No observations in this selection.','muted');td.colSpan=headers.length;tr.append(td);body.append(tr);}
  table.append(thead,body);wrap.append(table);return wrap;
}
function cohortTable(groups){return makeTable(['Cohort','Finished','W–L','Win rate','95% interval','Human questions','Opponent questions'],Object.entries(groups).map(([key,g])=>[key,f(g.finished,0),`${g.wins}–${g.losses}`,pct(g.winRate),`${pct(g.winInterval.lower)} – ${pct(g.winInterval.upper)}`,f(g.averageHumanQuestions),f(g.averageJevQuestions)]));}
function trace(events){
  const ns='http://www.w3.org/2000/svg',node=(name,attributes={})=>{const n=document.createElementNS(ns,name);Object.entries(attributes).forEach(([k,v])=>n.setAttribute(k,String(v)));return n;};
  const svg=node('svg',{viewBox:'0 0 700 180',class:'trace',role:'img','aria-label':'Remaining candidate counts by turn. Human and opponent lines.'});
  const title=node('title');title.textContent='Candidate reduction trace';svg.append(title);
  [1,8,16,24].forEach(n=>{const y=145-(n-1)*5;svg.append(node('line',{x1:32,x2:680,y1:y,y2:y,class:'guide'}));const t=node('text',{x:6,y:y+4});t.textContent=n;svg.append(t);});
  for(const actor of ['human','jev']){let remaining=24;const points=[[32,30]];
    events.forEach((event,index)=>{if(event.actor===actor&&event.metrics)remaining=event.metrics.afterCount;points.push([32+(index+1)*648/Math.max(1,events.length),145-(remaining-1)*5]);});
    svg.append(node('polyline',{points:points.map(p=>p.join(',')).join(' '),class:actor+'-line'}));}
  const label=node('text',{x:320,y:171});label.textContent='Committed turns';svg.append(label);return svg;
}
function renderAnalytics(){
  if(!analyticsData)return;const {summary:s,matches,coverage}=analyticsData,container=$('analytics-content');container.replaceChildren();
  $('coverage').textContent=`${coverage.filtered} selected matches; ${coverage.scanned} scanned of ${coverage.availableStoredMatches} stored. ${coverage.truncated?'History is truncated to the latest 500 matches. ':''}Snapshot: ${new Date(coverage.asOf).toLocaleString()}. Offline and server records are not mixed.`;
  const kpis=el('div',null,'kpi-grid');
  for(const [label,value] of [['Completed matches',f(s.overall.finished,0)],['Human win rate',pct(s.overall.winRate)],['Current / best streak',`${s.streaks.current} / ${s.streaks.best}`],['JEV median latency',ms(s.jevLatencyMs.p50)],['Provider attempts',f(s.provider.attempts,0)],['Fallback decisions',f(s.provider.fallbackDecisions,0)],['Known input tokens',f(s.provider.knownInputTokens,0)],['Measured input cost',s.provider.measuredInputCostUsd==null?'Unavailable / incomplete':`$${f(s.provider.measuredInputCostUsd,6)}`]]){const card=el('div',null,'kpi');card.append(el('strong',value),el('span',label));kpis.append(card);}container.append(kpis);
  const currentReport=current?.analytics||analyticsData.currentDetail||matches[0];
  if(currentReport){container.append(el('h3','Current / most recent match: candidate trace'));if(currentReport.events?.length)container.append(trace(currentReport.events));else container.append(el('p','No committed turn details are available for this trace.','muted'));const legend=el('div',null,'legend');legend.append(el('span','Human candidates','human'),el('span','Opponent candidates','jev'));container.append(legend);
    container.append(makeTable(['Actor','Turns','Questions','Remaining','Mean split balance','Mean expected information','Mean information regret','Risky guesses'],Object.entries(currentReport.actors).map(([actor,a])=>[humanName(actor),a.turns,a.questions,a.remaining,f(a.splitBalance.mean),f(a.expectedInformationGain.mean)+' bits',f(a.informationGainRegret.mean)+' bits',a.riskyGuesses])));
  }
  for(const [title,groups] of [['Difficulty cohorts',s.byDifficulty],['Opponent-source cohorts',s.bySource],['Difficulty × starting player',s.byDifficultyAndStarter],['Match-type cohorts',s.byMode],['Competition configurations',s.byLeague],['Daily cohorts · UTC',s.byDay]]){container.append(el('h3',title),cohortTable(groups));}
  container.append(el('h3','Question usage and information efficiency'),makeTable(['Predicate','Uses','Human / opponent','Yes / no','Mean eliminated','Expected bits','Regret bits'],Object.entries(s.predicates).map(([id,p])=>[id,p.uses,`${p.humanUses} / ${p.jevUses}`,`${p.yes} / ${p.no}`,f(p.meanEliminated),f(p.meanInformationGain),f(p.meanRegret)])));
  container.append(el('h3','Guess calibration · both actors'),el('p','Expected probability is 1 / remaining candidates under uniform secrets. This is not JEV selection confidence. Small samples and repeated games require caution.','muted'),makeTable(['Remaining','Guesses','Correct','Expected rate','Observed rate','95% interval'],Object.entries(s.guessCalibration).map(([n,g])=>[n,g.guesses,g.correct,pct(g.expectedProbability),pct(g.observedRate),`${pct(g.interval.lower)} – ${pct(g.interval.upper)}`])));
  container.append(el('h3','Timing and decision distributions'),makeTable(['Metric','Samples','Minimum','Mean','p50','p90','p95','p99','Maximum'],[['Match duration (ms)',s.durationMs],['Human wall-turn time (ms)',s.humanWallTurnMs],['Successful JEV decision (ms)',s.jevLatencyMs],['Selection confidence',s.confidence],['Candidate count',s.candidateCount]].map(([name,d])=>[name,d.n,...['min','mean','p50','p90','p95','p99','max'].map(k=>f(d[k]))])));
  container.append(el('h3','Provider reliability'),makeTable(['Attempts','Failed attempts','Invalid responses','Timeouts','Fallback decisions','Cost-measured matches'],[[s.provider.attempts,s.provider.failures,s.provider.invalid,s.provider.timeouts,s.provider.fallbackDecisions,s.provider.measuredCostMatches]]));
  container.append(el('h3','Match history'),makeTable(['Started','Mode','Difficulty','Source','Starter','Result','Reason','Eligible','Questions H / J'],matches.map(m=>[new Date(m.createdAt).toLocaleString(),m.mode,m.difficulty,m.source,m.starter,m.winner||m.phase,m.reason||'—',m.eligible?'Yes':'No',`${m.actors.human.questions} / ${m.actors.jev.questions}`])));
  if(currentReport?.events?.length){const details=el('details');details.append(el('summary','Full per-turn analytics · current match'));const rows=decisionRows(currentReport.events);const columns=['sequence','actor','action','beforeCount','afterCount','eliminated','expectedInformationGain','realizedInformationGain','informationGainRegret','wallTurnMs','source','latencyMs','confidence','searchDepth'];details.append(makeTable(columns,rows.map(r=>columns.map(c=>typeof r[c]==='number'?f(r[c]):r[c]))));container.append(details);}
  container.append(el('h3','Interpretation and coverage'));s.caveats.forEach(text=>container.append(el('p',text,'muted')));
}
async function loadAnalytics(){
  if(offline){let matches=[];try{matches=JSON.parse(setting('offline-stats','[]'));}catch{}
    if(current?.phase==='active')matches.push(current.analytics);
    for(const field of ['difficulty','mode','starter']){const filter=$(`analytics-${field}`).value;if(filter!=='all')matches=matches.filter(m=>m[field]===filter);}
    analyticsData={coverage:{asOf:Date.now(),filtered:matches.length,scanned:matches.length,availableStoredMatches:matches.length,truncated:false},summary:aggregateAnalytics(matches),matches};
  }else {
    const params=new URLSearchParams({difficulty:$('analytics-difficulty').value,mode:$('analytics-mode').value,starter:$('analytics-starter').value});
    analyticsData=await api(`/api/analytics?${params}`);
    if(!current&&analyticsData.matches[0]?.detailEndpoint)analyticsData.currentDetail=(await api(analyticsData.matches[0].detailEndpoint)).analytics;
  }
  renderAnalytics();
}
$('refresh-analytics').addEventListener('click',()=>guarded(loadAnalytics));
for(const field of ['difficulty','mode','starter'])$(`analytics-${field}`).addEventListener('change',()=>loadAnalytics().catch(e=>notice(e.message)));
$('export-analytics').addEventListener('click',()=>{if(analyticsData)saveBlob('guess-who-analytics.json',JSON.stringify(analyticsData,null,2));});
$('export-matches').addEventListener('click',()=>{
  if(!analyticsData)return;const rows=analyticsData.matches.map(m=>({matchId:m.matchId,createdAt:new Date(m.createdAt).toISOString(),mode:m.mode,difficulty:m.difficulty,leagueId:m.leagueId,source:m.source,starter:m.starter,phase:m.phase,winner:m.winner,reason:m.reason,eligible:m.eligible,humanQuestions:m.actors.human.questions,jevQuestions:m.actors.jev.questions,durationMs:m.durationMs,providerAttempts:m.provider.attempts,fallbacks:m.provider.fallbackDecisions,knownInputTokens:m.provider.knownInputTokens,inputCostUsd:m.provider.inputCostUsd}));
  saveBlob('guess-who-matches.csv',csv(rows,Object.keys(rows[0]||{matchId:null})),'text/csv;charset=utf-8');
});
async function loadLeaderboard(next=false){
  const container=$('leaderboard-content');
  if(offline){container.replaceChildren(el('p','Official leaderboards require the online server. Offline practice never contributes.','muted'));return;}
  const params=new URLSearchParams({scope:$('leaderboard-scope').value,period:$('leaderboard-period').value,difficulty:$('difficulty').value});
  if(next&&leaderboardCursor)params.set('cursor',leaderboardCursor);
  const data=await api('/api/leaderboard?'+params);leaderboardCursor=data.nextCursor;
  container.replaceChildren(makeTable(['Rank','Player','Games','Wins','Losses','Win rate','Wilson lower bound'],data.entries.map(e=>[e.provisional?'Provisional':e.rank,e.display_name,e.games,e.wins,e.losses,pct(e.winRate),f(e.ranking_value,4)])));
  $('leaderboard-more').hidden=!leaderboardCursor;
}
$('refresh-leaderboard').addEventListener('click',()=>guarded(()=>loadLeaderboard(false)));
$('leaderboard-more').addEventListener('click',()=>guarded(()=>loadLeaderboard(true)));
async function initialize(){
  $('difficulty').value=setting('difficulty','jev');if(!$('difficulty').value)$('difficulty').value='jev';
  $('analysis-toggle').checked=setting('analysis','true')==='true';$('text-mode').checked=setting('text-mode','false')==='true';renderBoard();
  const launch=new URLSearchParams(location.hash.slice(1)).get('launch');
  if(launch){try{sessionStorage.setItem('gw:launch',launch);}catch{}history.replaceState(null,'',location.pathname);}
  if(new URLSearchParams(location.search).has('frame_id')){
    try{bearer=(await (await import('/activity.js')).signInWithDiscord(api)).token;}
    catch(error){notice(`Could not sign in through Discord. ${error.message}`);}
  }
  try{
    me=await api('/api/me');$('identity').textContent=me.user?.name||'Guest';$('login').hidden=!!me.user;$('logout').hidden=!me.user;
    if(!me.discordConfigured)$('login').textContent='Discord setup required';
    if(me.jevConfigured)$('mode').value='casual';
    let token;try{token=sessionStorage.getItem('gw:launch');}catch{}
    if(token&&me.user){try{await api('/api/context/redeem',{method:'POST',body:{token}});notice('Discord community context verified.');}finally{sessionStorage.removeItem('gw:launch');}}
    else if(token)notice('Sign in with the Discord account that launched this game to verify community context.');
    if(me.activeMatchId){current=await api(`/api/games/${me.activeMatchId}`);$('difficulty').value=current.config.difficulty;render();await guarded(progressOpponent);}
  }catch(error){
    // An HTTP authorization/service error is not permission to relabel an existing ranked game.
    if(error.status){notice(error.message);await autoStart();return;}
    offline=true;$('login').disabled=true;$('mode').value='practice';$('mode').disabled=true;
    notice('Offline practice with a local heuristic. No official results can be submitted.');
  }
  // Outside the try: a server that is down must still leave a playable board.
  await autoStart();
}
initialize();
