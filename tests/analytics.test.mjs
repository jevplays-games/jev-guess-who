import test from 'node:test';
import assert from 'node:assert/strict';
import {distribution,percentile,wilson,analyzeAction,analyzeMatch,aggregateAnalytics,csv,decisionDistribution} from '../public/shared/analytics.js';
import {createInitialState,applyAction} from '../public/shared/rules.js';
test('quantiles are interpolated and missing data remains null',()=>{
  assert.equal(percentile([1,2,3,4],.5),2.5);assert.equal(distribution([]).mean,null);assert.equal(distribution([null,undefined,NaN]).n,0);
  assert.equal(distribution([0]).mean,0);assert.equal(distribution([0]).n,1);
});
test('Wilson boundaries and small samples',()=>{
  assert.deepEqual(wilson(0,0),{lower:null,upper:null});assert.equal(wilson(0,20).lower,0);
  assert.ok(wilson(1,1).lower<wilson(20,20).lower);assert.ok(wilson(20,20).upper<=1);
});
test('public information analytics never use a hidden answer to score question quality',()=>{
  const before=createInitialState({human:'c01',jev:'c02'}),step=applyAction(before,'human',{type:'ask',predicateId:'glasses'});
  const event=analyzeAction(before,step.state,step.event,{timestamp:2000,previousTimestamp:1000});
  assert.equal(event.metrics.expectedInformationGain,1);assert.equal(event.metrics.realizedInformationGain,1);assert.equal(event.metrics.informationGainRegret,0);assert.equal(event.metrics.wallTurnMs,1000);
});
test('guess probability is uniform prior, not model selection confidence',()=>{
  const initial={human:'c01',jev:'c02'},before=createInitialState(initial),step=applyAction(before,'human',{type:'guess',characterId:'c02'});
  const event=analyzeAction(before,step.state,step.event,{timestamp:2000,previousTimestamp:1000});
  const report=analyzeMatch({initial,state:step.state,events:[event],createdAt:1000,finishedAt:2000,mode:'practice',config:{opponent:'local',difficulty:'normal'}});
  const aggregate=aggregateAnalytics([report]);assert.equal(aggregate.guessCalibration[24].expectedProbability,1/24);assert.equal(aggregate.guessCalibration[24].observedRate,1);
  assert.equal(aggregate.confidence.mean,null);assert.equal(aggregate.provider.measuredInputCostUsd,null);
});
test('partial provider usage cannot be presented as a complete bill',()=>{
  const state=createInitialState({human:'c01',jev:'c02'}),decision={source:'jev',attempts:[{error:'timeout',usage:null},{error:null,usage:{input_tokens:100,output_tokens:5}}]};
  const report=analyzeMatch({state,createdAt:0,config:{opponent:'jev',inputUsdPerMillion:1},events:[{actor:'jev',action:{type:'ask'},decision}]});
  assert.equal(report.provider.knownInputTokens,100);assert.equal(report.provider.usageCoverage,.5);assert.equal(report.provider.inputCostUsd,null);assert.equal(report.provider.knownInputCostLowerBoundUsd,.0001);
});
test('selection entropy and probability margin are measured separately',()=>{
  const d=decisionDistribution({a:.5,b:.5});assert.equal(d.entropy,1);assert.equal(d.normalizedEntropy,1);assert.equal(d.topMargin,0);
});
test('CSV quotes safely and neutralizes spreadsheet formula injection',()=>{
  const text=csv([{name:'=SUM(1,2)',value:'a"b\nc'}],['name','value']);assert.ok(text.includes("'=SUM(1,2)"));assert.ok(text.includes('a""b\nc'));
});
