import {ROSTER_VERSION,FULL_MASK,PREDICATES,MASKS,character,hasTrait,ids,bit} from './roster.js';
export const RULES_VERSION='gw-1';
export class RuleError extends Error { constructor(code) { super(code); this.code=code; } }
const requireRule=(ok,code)=>{if(!ok)throw new RuleError(code);};
export const other=actor=>actor==='human'?'jev':'human';
export const actionId=a=>a.type==='ask'?`ask:${a.predicateId}`:a.type==='guess'?`guess:${a.characterId}`:a.type;
export function createInitialState({human,jev,starter='human',matchId='local'}) {
  requireRule(character(human)&&character(jev),'unknown_secret');
  requireRule(['human','jev'].includes(starter),'invalid_starter');
  return {gameId:'guess-who',rulesVersion:RULES_VERSION,rosterVersion:ROSTER_VERSION,matchId,
    revision:0,phase:'active',turn:starter,secrets:{human,jev},possible:{human:FULL_MASK,jev:FULL_MASK},
    asked:{human:[],jev:[]},questionsAsked:{human:0,jev:0},turnsTaken:{human:0,jev:0},outcome:null};
}
export function legalForMask(mask,{resign=false}={}) {
  const actions=PREDICATES.filter(p=>(mask&MASKS[p.id])!==0&&(mask&MASKS[p.id])!==mask).map(p=>({type:'ask',predicateId:p.id}));
  actions.push(...ids(mask).map(characterId=>({type:'guess',characterId})));
  if(resign)actions.push({type:'resign'});
  return actions;
}
export function getLegalActions(state,actor=state.turn) {
  if(state.phase!=='active'||actor!==state.turn)return [];
  return legalForMask(state.possible[actor],{resign:actor==='human'});
}
export function normalizeAction(action) {
  requireRule(action&&typeof action==='object'&&!Array.isArray(action),'invalid_action');
  const keys=Object.keys(action).sort().join(',');
  if(action.type==='ask')requireRule(keys==='predicateId,type'&&typeof action.predicateId==='string','invalid_action');
  else if(action.type==='guess')requireRule(keys==='characterId,type'&&typeof action.characterId==='string','invalid_action');
  else requireRule(action.type==='resign'&&keys==='type','invalid_action');
  return {...action};
}
export function applyAction(state,actor,rawAction) {
  requireRule(state.phase==='active','match_terminal');
  requireRule(actor===state.turn,'wrong_turn');
  const action=normalizeAction(rawAction);
  requireRule(getLegalActions(state,actor).some(a=>actionId(a)===actionId(action)),'illegal_action');
  const next=structuredClone(state), opponent=other(actor);
  const event={sequence:state.revision+1,actor,action};
  next.turnsTaken[actor]++;next.revision++;
  if(action.type==='ask') {
    const answer=hasTrait(character(state.secrets[opponent]),action.predicateId);
    const mask=MASKS[action.predicateId];
    next.possible[actor]&=answer?mask:(FULL_MASK^mask);
    requireRule((next.possible[actor]&bit(state.secrets[opponent]))!==0,'secret_eliminated');
    next.asked[actor].push(action.predicateId);next.questionsAsked[actor]++;
    next.turn=opponent;event.answer=answer;
  } else {
    const correct=action.type==='guess'&&action.characterId===state.secrets[opponent];
    next.phase='finished';next.turn=null;
    next.outcome={winner:correct?actor:opponent,reason:action.type==='resign'?'resignation':correct?'correct_guess':'wrong_guess'};
    if(action.type==='guess')event.correct=correct;
  }
  return {state:next,event};
}
export function expire(state) {
  requireRule(state.phase==='active','match_terminal');
  const next=structuredClone(state);next.phase='finished';next.turn=null;next.revision++;
  next.outcome={winner:'jev',reason:'expiration'};
  return {state:next,event:{sequence:next.revision,actor:'system',action:{type:'expire'}}};
}
export function projectForHuman(state) {
  const {secrets,...safe}=structuredClone(state);
  safe.ownSecret=secrets.human;
  if(state.phase!=='active')safe.revealedSecrets=secrets;
  safe.legalActions=getLegalActions(state,'human');
  return safe;
}
export function projectForDecision(state,actor=state.turn) {
  requireRule(['human','jev'].includes(actor),'invalid_actor');
  return {rulesVersion:state.rulesVersion,rosterVersion:state.rosterVersion,
    myMask:state.possible[actor],opponentMask:state.possible[other(actor)],
    questionsAsked:{me:state.questionsAsked[actor],opponent:state.questionsAsked[other(actor)]}};
}
export const getOutcome=state=>state.outcome;
export const serialize=state=>JSON.stringify(state);
export function deserialize(text) {
  const s=JSON.parse(text);requireRule(s.rulesVersion===RULES_VERSION&&s.rosterVersion===ROSTER_VERSION,'version_mismatch');return s;
}
export function replay(initial,events) {
  let state=createInitialState(initial);
  for(const event of events) {
    const result=event.actor==='system'&&event.action.type==='expire'?expire(state):applyAction(state,event.actor,event.action);
    for(const key of ['sequence','answer','correct'])requireRule(result.event[key]===event[key],`replay_${key}`);
    state=result.state;
  }
  return state;
}
