import test from 'node:test';
import assert from 'node:assert/strict';
import {ROSTER,FULL_MASK,validateRoster,ids,count,bit,PREDICATES,MASKS,hasTrait,character} from '../public/shared/roster.js';
import {createInitialState,applyAction,getLegalActions,projectForHuman,projectForDecision,replay,expire,actionId} from '../public/shared/rules.js';
import {balancedAction,localDecision,questionFeatures,buildCandidates,searchActions,frontierWinProbability} from '../public/shared/strategy.js';

test('roster has 24 unique distinguishable identities and balanced trait coverage',()=>assert.equal(validateRoster(),true));
test('all 1,152 initial secret/starter combinations terminate and replay deterministically',()=>{
  let checked=0;
  for(const human of ROSTER)for(const jev of ROSTER)for(const starter of ['human','jev']){
    const initial={human:human.id,jev:jev.id,starter},events=[];let state=createInitialState(initial);
    while(state.phase==='active'){
      const actor=state.turn,step=applyAction(state,actor,balancedAction(state.possible[actor]));events.push(step.event);state=step.state;
      assert.ok(state.possible.human&bit(jev.id));assert.ok(state.possible.jev&bit(human.id));assert.ok(state.revision<=25);
    }
    assert.deepEqual(replay(initial,events),state);checked++;
  }
  assert.equal(checked,1152);
});
test('correct and incorrect guesses consume one turn and end play',()=>{
  const state=createInitialState({human:'c01',jev:'c02'});
  const won=applyAction(state,'human',{type:'guess',characterId:'c02'}).state;
  const lost=applyAction(state,'human',{type:'guess',characterId:'c03'}).state;
  assert.equal(won.outcome.winner,'human');assert.equal(lost.outcome.winner,'jev');
  assert.throws(()=>applyAction(won,'human',{type:'resign'}),/match_terminal/);
  assert.equal(state.phase,'active');assert.equal(state.revision,0);
});
test('redundant questions, invalid keys, wrong actor and eliminated guesses are illegal',()=>{
  let state=createInitialState({human:'c01',jev:'c02'});
  assert.throws(()=>applyAction(state,'jev',{type:'ask',predicateId:'glasses'}),/wrong_turn/);
  assert.throws(()=>applyAction(state,'human',{type:'ask',predicateId:'glasses',secret:'c01'}),/invalid_action/);
  assert.throws(()=>applyAction(state,'human',{type:'guess',characterId:'unknown'}),/illegal_action/);
  state=applyAction(state,'human',{type:'ask',predicateId:'glasses'}).state;
  state=applyAction(state,'jev',{type:'ask',predicateId:'hat'}).state;
  assert.throws(()=>applyAction(state,'human',{type:'ask',predicateId:'glasses'}),/illegal_action/);
  const eliminated=ROSTER.find(c=>!(state.possible.human&bit(c.id)));
  assert.throws(()=>applyAction(state,'human',{type:'guess',characterId:eliminated.id}),/illegal_action/);
});
test('singleton requires a final guess and allows equal secrets',()=>{
  let state=createInitialState({human:'c01',jev:'c01'});
  while(state.phase==='active'&&count(state.possible.human)>1){
    const actor=state.turn;state=applyAction(state,actor,balancedAction(state.possible[actor])).state;
  }
  assert.equal(state.phase,'active');assert.equal(count(state.possible.human),1);
});
test('live human projection has no JEV secret or seed; decision view has neither secret',()=>{
  for(const h of ROSTER)for(const j of ROSTER){
    const state=createInitialState({human:h.id,jev:j.id});const view=projectForHuman(state),decision=projectForDecision(state);
    assert.equal(view.ownSecret,h.id);assert.equal(view.secrets,undefined);assert.equal(view.revealedSecrets,undefined);assert.equal(view.seed,undefined);
    assert.equal(JSON.stringify(decision).includes('secret'),false);
    assert.deepEqual(decision,projectForDecision(createInitialState({human:'c01',jev:'c01'})));
  }
});
test('decision inputs are identical for secrets consistent with identical observations',()=>{
  const template=createInitialState({human:'c01',jev:'c01'});
  const glasses=hasTrait(character('c01'),'glasses');
  const mask=glasses?MASKS.glasses:(FULL_MASK^MASKS.glasses);
  for(const human of ROSTER)for(const jev of ids(mask)){
    let state=createInitialState({human:human.id,jev});state=applyAction(state,'human',{type:'ask',predicateId:'glasses'}).state;
    template.possible.human=mask;template.questionsAsked.human=1;template.turn='jev';
    assert.deepEqual(projectForDecision(state),projectForDecision(template));
  }
});
test('replay rejects altered answers and revisions; expiration is an explicit terminal event',()=>{
  const initial={human:'c01',jev:'c02'},state=createInitialState(initial),{event}=applyAction(state,'human',{type:'ask',predicateId:'glasses'});
  assert.throws(()=>replay(initial,[{...event,answer:!event.answer}]),/replay_answer/);
  assert.throws(()=>replay(initial,[{...event,sequence:7}]),/replay_sequence/);
  const ended=expire(state);assert.equal(ended.state.outcome.reason,'expiration');assert.deepEqual(replay(initial,[ended.event]),ended.state);
});
test('question features match exact information formulas',()=>{
  const features=questionFeatures(FULL_MASK,'glasses');assert.equal(features.yes,12);assert.equal(features.no,12);assert.equal(features.informationGain,1);assert.equal(features.expectedRemaining,12);
});
test('all difficulty candidate sets are legal, bounded, deterministic and secret-free',()=>{
  const state=createInitialState({human:'c09',jev:'c18'}),view=projectForDecision(state);
  for(const level of ['easy','normal','hard','jev']){
    const a=buildCandidates(view,level),b=buildCandidates(view,level);assert.deepEqual(a,b);
    assert.ok(a.candidates.length<=36);for(const c of a.candidates)assert.ok(getLegalActions(state).some(x=>actionId(x)===c.id));
    if(a.search)assert.ok(a.search.nodes<=a.search.nodeBudget);
  }
});
test('two-candidate race yields exact 1/2 guess value and a guaranteed singleton win',()=>{
  const mask=bit('c01')|bit('c02');const view={myMask:mask,opponentMask:bit('c03')};
  const {candidates}=buildCandidates(view,'hard');
  for(const c of candidates){assert.equal(c.estimatedWinProbability,c.action.type==='guess'?.5:0);}
  assert.equal(frontierWinProbability(bit('c01'),FULL_MASK),1);
  assert.equal(localDecision(view,'hard').action.type,'guess');
});
