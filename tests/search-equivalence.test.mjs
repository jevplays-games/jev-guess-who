import test from 'node:test';
import assert from 'node:assert/strict';
import {FULL_MASK,count as fastCount} from '../public/shared/roster.js';
import * as fast from '../public/shared/strategy.js';
import * as ref from './reference-strategy.mjs';
import {createInitialState,applyAction,projectForDecision} from '../public/shared/rules.js';
import {buildRequest} from '../server/jev.js';
import {canonical,sha256} from '../server/security.js';

const refCount=mask=>{let n=0;for(let x=mask>>>0;x;x&=x-1)n++;return n;};
function rng(seed){let s=seed>>>0;return()=>(s=(Math.imul(s,1664525)+1013904223)>>>0)/2**32;}
function randomMask(rnd,n){let m=0,c=0;while(c<n){const b=1<<Math.floor(rnd()*24);if(!(m&b)){m|=b;c++;}}return m;}
const strip=r=>JSON.stringify(r);

test('popcount matches the reference loop',()=>{
  const rnd=rng(1);
  for(let i=0;i<5000;i++){const m=Math.floor(rnd()*FULL_MASK);assert.equal(fastCount(m),refCount(m));}
  assert.equal(fastCount(0),0);assert.equal(fastCount(FULL_MASK),24);
});
test('balancedAction, completionDistribution and frontier match the reference',()=>{
  const rnd=rng(2);
  for(let i=0;i<400;i++){
    const a=randomMask(rnd,1+Math.floor(rnd()*24)),b=randomMask(rnd,1+Math.floor(rnd()*24));
    assert.deepEqual(fast.balancedAction(a),ref.balancedAction(a));
    assert.deepEqual(fast.completionDistribution(a),ref.completionDistribution(a));
    assert.equal(fast.frontierWinProbability(a,b),ref.frontierWinProbability(a,b));
    assert.equal(fast.frontierWinProbability(a,b),ref.frontierWinProbability(a,b));// cached path
  }
});
test('buildCandidates and localDecision are byte-identical to the reference for random situations on every difficulty',()=>{
  const rnd=rng(3);let compared=0,budgetHit=0;
  const sizes=[24,24,23,20,16,12,8,6,4,3,2,1];
  for(let i=0;i<60;i++){
    const n=sizes[Math.floor(rnd()*sizes.length)],m=sizes[Math.floor(rnd()*sizes.length)];
    const view={rulesVersion:'gw-1',rosterVersion:'original24-1',myMask:randomMask(rnd,n),opponentMask:randomMask(rnd,m),questionsAsked:{me:0,opponent:0}};
    for(const d of ref.DIFFICULTIES){
      const r=ref.buildCandidates(view,d),f=fast.buildCandidates(view,d);
      assert.equal(strip(f),strip(r),`buildCandidates ${d} ${n}/${m}`);
      assert.equal(strip(fast.localDecision(view,d)),strip(ref.localDecision(view,d)));
      if(r.search&&r.search.completedDepth<(d==='hard'?2:6))budgetHit++;compared++;
    }
  }
  assert.ok(compared>=240);assert.ok(budgetHit>0,'budget-exhaustion path must be exercised');
});
test('searchActions agrees for odd depth/budget settings (node accounting and partial depth)',()=>{
  const rnd=rng(4);
  for(let i=0;i<40;i++){
    const view={myMask:randomMask(rnd,2+Math.floor(rnd()*22)),opponentMask:randomMask(rnd,2+Math.floor(rnd()*22))};
    const cands=ref.buildCandidates(view,'normal').candidates;
    const opts={maxDepth:1+Math.floor(rnd()*7),nodeBudget:[1,7,50,300,2000,50000][Math.floor(rnd()*6)]};
    const run=f=>{try{return strip(f(view,cands,opts));}catch(e){return `threw:${typeof e==='symbol'?e.description:e.message}`;}};// tiny budgets exhaust inside the depth-0 pass and throw in both
    assert.equal(run(fast.searchActions),run(ref.searchActions));
  }
});
test('request payloads and input hashes are identical along full jev-difficulty games',async()=>{
  const rnd=rng(5);let hashes=0;
  for(let g=0;g<5;g++){
    let state=createInitialState({human:`c${String(1+Math.floor(rnd()*24)).padStart(2,'0')}`,jev:`c${String(1+Math.floor(rnd()*24)).padStart(2,'0')}`,starter:'jev'});
    while(state.phase==='active'){
      const actor=state.turn,view=projectForDecision(state,actor);
      if(actor==='jev'){
        for(const d of ['hard','jev']){
          const built=buildRequest(view,d,'jev-1.13.0'),r=ref.buildCandidates(view,d);
          assert.equal(canonical(built.candidates),canonical(r.candidates));assert.equal(strip(built.search),strip(r.search));
          const ids=Object.keys(built.payload.questions.action.criteria);assert.equal(ids.join(),r.candidates.map(c=>c.id).join());
          assert.equal(await sha256(canonical(built.payload)),await sha256(canonical({...built.payload,questions:{action:{...built.payload.questions.action,criteria:Object.fromEntries(r.candidates.map(c=>[c.id,c]))}}})));hashes++;
        }
      }
      const a=ref.localDecision(view,actor==='jev'?'jev':'normal').action;
      state=applyAction(state,actor,a).state;
    }
  }
  assert.ok(hashes>=10);
});
