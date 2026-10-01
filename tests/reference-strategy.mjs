import {MASKS,FULL_MASK,PREDICATES,ids} from '../public/shared/roster.js';
import {legalForMask,actionId} from '../public/shared/rules.js';
export const POLICY_VERSION='race-1';
// Original (pre-optimization) implementation, kept verbatim as the equivalence oracle for the fast paths in public/shared/strategy.js.
function count(mask) { let n=0; for (let x=mask>>>0; x; x&=x-1) n++; return n; }
export const DIFFICULTIES=Object.freeze(['easy','normal','hard','jev']);
const label=id=>PREDICATES.find(p=>p.id===id)?.label||id;
export function questionFeatures(mask,id) {
  const n=count(mask),yes=count(mask&MASKS[id]),no=n-yes,p=yes/n;
  const informationGain=p===0||p===1?0:-p*Math.log2(p)-(1-p)*Math.log2(1-p);
  return {before:n,yes,no,yesProbability:p,expectedRemaining:(yes*yes+no*no)/n,
    worstCaseRemaining:Math.max(yes,no),informationGain,balance:1-Math.abs(yes-no)/n,
    singletonProbability:((yes===1?1:0)+(no===1?1:0))/n};
}
export function questionCandidates(mask) {
  return legalForMask(mask).filter(a=>a.type==='ask').map(a=>({id:actionId(a),action:a,label:label(a.predicateId),...questionFeatures(mask,a.predicateId)}));
}
function canonicalQuestions(mask) {
  const seen=new Set();return questionCandidates(mask).sort((a,b)=>a.id.localeCompare(b.id)).filter(c=>{
    const yes=mask&MASKS[c.action.predicateId],no=mask^yes,key=Math.min(yes,no);
    if(seen.has(key))return false;seen.add(key);return true;
  });
}
export function balancedAction(mask) {
  if(count(mask)===1)return {type:'guess',characterId:ids(mask)[0]};
  return questionCandidates(mask).sort((a,b)=>a.worstCaseRemaining-b.worstCaseRemaining||a.id.localeCompare(b.id))[0].action;
}
export function fallbackAction(view) {
  if(count(view.myMask)===1||count(view.opponentMask)===1)return {type:'guess',characterId:ids(view.myMask)[0]};
  return balancedAction(view.myMask);
}
// Distribution over the number of future own turns needed by a greedy no-risk policy.
const completionMemo=new Map();
export function completionDistribution(mask) {
  if(completionMemo.has(mask))return completionMemo.get(mask);
  if(count(mask)===1)return [0,1];
  const a=balancedAction(mask),yes=mask&MASKS[a.predicateId],no=mask^yes,n=count(mask),out=[];
  for(const branch of [yes,no]) {
    const probability=count(branch)/n,dist=completionDistribution(branch);
    dist.forEach((p,i)=>{out[i+1]=(out[i+1]||0)+p*probability;});
  }
  const normalized=Array.from({length:out.length},(_,i)=>out[i]||0);
  completionMemo.set(mask,normalized);return normalized;
}
export function frontierWinProbability(myMask,opponentMask) {
  const me=completionDistribution(myMask),them=completionDistribution(opponentMask);let win=0;
  me.forEach((p,t)=>them.forEach((q,u)=>{if(t<=u)win+=p*q;}));return win;
}
/** Bounded expectiminimax. Uniform independent surviving secrets; actor moves next. */
export function searchActions(view,candidates,{maxDepth=6,nodeBudget=50000}={}) {
  let nodes=0,completedDepth=0;const memo=new Map();
  const budget=Symbol('search budget');
  function value(my,opp,depth) {
    if(++nodes>nodeBudget)throw budget;
    const n=count(my);if(n===1)return 1;
    if(depth<=0)return frontierWinProbability(my,opp);
    const key=`${my}:${opp}:${depth}`;if(memo.has(key))return memo.get(key);
    let best=1/n;
    for(const c of canonicalQuestions(my)) {
      const yes=my&MASKS[c.action.predicateId],no=my^yes;
      const v=1-(count(yes)*value(opp,yes,depth-1)+count(no)*value(opp,no,depth-1))/n;
      best=Math.max(best,v);
    }
    memo.set(key,best);return best;
  }
  const assess=(c,depth)=>{
    if(c.action.type==='guess')return 1/count(view.myMask);
    const yes=view.myMask&MASKS[c.action.predicateId],no=view.myMask^yes,n=count(view.myMask);
    return 1-(count(yes)*value(view.opponentMask,yes,depth)+count(no)*value(view.opponentMask,no,depth))/n;
  };
  let scores=candidates.map(c=>assess(c,0));
  for(let depth=1;depth<=maxDepth;depth++) {
    try {const iteration=candidates.map(c=>assess(c,depth-1));scores=iteration;completedDepth=depth;}
    catch(e){if(e!==budget)throw e;break;}
  }
  return {scores,completedDepth,nodes:Math.min(nodes,nodeBudget),nodeBudget,
    estimateAssumption:'uniform-independent-secrets; optimal bounded turns; greedy completion frontier'};
}
export function buildCandidates(view,difficulty='normal') {
  if(!DIFFICULTIES.includes(difficulty))throw Error('invalid_difficulty');
  let questions=difficulty==='easy'?questionCandidates(view.myMask).slice(0,4):canonicalQuestions(view.myMask);
  const guesses=(count(view.myMask)===1||['hard','jev'].includes(difficulty))?ids(view.myMask).map(id=>({
    id:`guess:${id}`,action:{type:'guess',characterId:id},label:`Final guess ${id}; wrong guesses lose`,
    before:count(view.myMask),guessWinProbability:1/count(view.myMask)})):[];
  const candidates=[...questions,...guesses].sort((a,b)=>a.id.localeCompare(b.id));
  if(!candidates.length)throw Error('no_candidates');
  const search=['hard','jev'].includes(difficulty)?searchActions(view,candidates,{
    maxDepth:difficulty==='hard'?2:6,nodeBudget:difficulty==='hard'?5000:50000}):null;
  if(search) candidates.forEach((c,i)=>c.estimatedWinProbability=search.scores[i]);
  return {candidates,search:search?{...search,scores:undefined}:null};
}
export function localDecision(view,difficulty='normal') {
  const {candidates,search}=buildCandidates(view,difficulty);
  let selected;
  if(difficulty==='easy')selected=candidates[0];
  else if(difficulty==='normal') {
    const desired=count(view.opponentMask)===1?fallbackAction(view):balancedAction(view.myMask);
    selected=candidates.find(c=>c.id===actionId(desired))||candidates.slice().sort((a,b)=>(a.expectedRemaining??1)-(b.expectedRemaining??1)||a.id.localeCompare(b.id))[0];
  } else selected=candidates.slice().sort((a,b)=>b.estimatedWinProbability-a.estimatedWinProbability||a.id.localeCompare(b.id))[0];
  return {action:selected.action,actionId:selected.id,source:'local_heuristic',candidateCount:candidates.length,
    selectedFeatures:selected,search,confidence:null,probabilities:null,latencyMs:0,usage:null};
}
