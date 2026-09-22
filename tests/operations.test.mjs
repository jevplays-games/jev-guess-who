import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregateOperations} from '../public/shared/operations-analytics.js';
test('operator activity separates guest sessions and Discord players',()=>{
 const day=86400000,asOf=50*day,events=[
  {at:asOf-100,event:'game_started',actor_key:'discord-a',details:{identityKind:'discord'}},
  {at:asOf-50,event:'game_started',actor_key:'discord-a',details:{identityKind:'discord'}},
  {at:asOf-100,event:'game_started',actor_key:'guest-a',details:{identityKind:'guest'}}];
 const report=aggregateOperations(events,{asOf});assert.equal(report.activity.discord.daily,1);assert.equal(report.activity.guestSessions.daily,1);assert.equal(report.funnelEventCounts.gameStarts,3);
});
test('retention excludes unmatured dates and measures exact-day returns',()=>{
 const day=86400000,events=[0,1,7].map(d=>({at:(10+d)*day,event:'game_started',actor_key:'player',details:{identityKind:'discord'}}));
 const report=aggregateOperations(events,{asOf:20*day});assert.equal(report.firstObservedDiscordRetention.day1.rate,1);assert.equal(report.firstObservedDiscordRetention.day7.rate,1);assert.equal(report.firstObservedDiscordRetention.day30.rate,null);
});
test('all provider attempts, including orphaned/stale calls, contribute to operations',()=>{
 const events=[{at:1,event:'jev_attempt',details:{reason:'success',latencyMs:12,inputTokens:100,outputTokens:5}},{at:2,event:'jev_stale_response',details:{}}];
 const report=aggregateOperations(events,{asOf:3});assert.equal(report.provider.attempts,1);assert.equal(report.provider.staleResponses,1);assert.equal(report.provider.knownInputTokens,100);
});
