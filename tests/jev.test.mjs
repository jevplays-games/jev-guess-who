import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,projectForDecision} from '../public/shared/rules.js';
import {bit} from '../public/shared/roster.js';
import {buildRequest,validateResponse,chooseJevAction} from '../server/jev.js';
import {configuration} from '../server/matches.js';
import {providerMock} from './helpers.mjs';
const view=projectForDecision(createInitialState({human:'c01',jev:'c02',starter:'jev'}));
const config=configuration({},'normal');
test('strict schema accepts a real-shape mocked Choice with usage',()=>{
  const {payload,candidates}=buildRequest(view,'normal','jev-1.13.0');const checked=validateResponse(providerMock(payload),candidates,'jev-1.13.0');assert.equal(checked.confidence,1);assert.equal(checked.usage.input_tokens,256);
});
test('provider rejects invented actions, model mismatch, missing/invalid probabilities and invalid confidence',()=>{
  const {payload,candidates}=buildRequest(view,'normal','jev-1.13.0');
  const mutations=[r=>r.model='jev-other',r=>r.answers.action.choice='invented',r=>r.answers.action.confidence=2,r=>delete r.answers.action.probabilities[candidates[0].id],r=>r.answers.action.probabilities[candidates[0].id]=NaN,r=>r.answers.action.probabilities.extra=0];
  for(const mutate of mutations){const response=providerMock(payload);mutate(response);assert.throws(()=>validateResponse(response,candidates,'jev-1.13.0'),/invalid_response/);}
});
test('equal max-probability ties use stable action ID',()=>{
  const candidates=[{id:'b'},{id:'a'}];const r={model:'pin',answers:{action:{type:'choice',choice:'b',confidence:0,probabilities:{a:.5,b:.5}}}};
  assert.equal(validateResponse(r,candidates,'pin').selected.id,'a');
});
test('missing credentials trigger explicit fallback, not a fabricated JEV decision',async()=>{
  const decision=await chooseJevAction(view,config,{});assert.equal(decision.source,'fallback');assert.equal(decision.fallbackReason,'key_not_configured');assert.equal(decision.confidence,null);assert.equal(decision.attempts.length,0);
});
test('successful mocked provider call returns a legal JEV decision and safe input',async()=>{
  let sent;const decision=await chooseJevAction(view,config,{TYPESAFE_API_KEY:'test-only',JEV_TIMEOUT_MS:1000},{fetchImpl:async(_url,init)=>{sent=JSON.parse(init.body);return Response.json(providerMock(sent));}});
  assert.equal(decision.source,'jev');assert.equal(decision.attempts.length,1);assert.equal(sent.state.secrets,undefined);assert.equal(sent.state.ownSecret,undefined);
});
test('invalid output retries once then records explicit fallback',async()=>{
  let calls=0;const decision=await chooseJevAction(view,config,{TYPESAFE_API_KEY:'test-only',JEV_TIMEOUT_MS:1000},{fetchImpl:async()=>{calls++;return Response.json({bad:true});}});
  assert.equal(calls,2);assert.equal(decision.source,'fallback');assert.equal(decision.attempts.filter(a=>a.error==='invalid_response').length,2);
});
test('authentication failure does not retry',async()=>{
  let calls=0;const d=await chooseJevAction(view,config,{TYPESAFE_API_KEY:'test-only'},{fetchImpl:async()=>{calls++;return new Response('',{status:401});}});
  assert.equal(calls,1);assert.equal(d.fallbackReason,'authentication_error');
});
test('Retry-After beyond remaining budget uses fallback immediately',async()=>{
  let calls=0;const d=await chooseJevAction(view,config,{TYPESAFE_API_KEY:'test-only',JEV_TIMEOUT_MS:1000},{fetchImpl:async()=>{calls++;return new Response('',{status:429,headers:{'Retry-After':'60'}});}});
  assert.equal(calls,1);assert.equal(d.fallbackReason,'http_429');
});
test('timeout is bounded and categorized',async()=>{
  const d=await chooseJevAction(view,config,{TYPESAFE_API_KEY:'test-only',JEV_TIMEOUT_MS:50},{fetchImpl:(_url,init)=>new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(Error('aborted'))))});
  assert.equal(d.fallbackReason,'timeout');assert.equal(d.source,'fallback');
});
test('singleton is forced through rules without billing the provider',async()=>{
  let called=false;const d=await chooseJevAction({...view,myMask:bit('c01')},config,{TYPESAFE_API_KEY:'test-only'},{fetchImpl:()=>{called=true;throw Error();}});
  assert.equal(called,false);assert.equal(d.source,'forced_rule');assert.equal(d.action.characterId,'c01');
});
