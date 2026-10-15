import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {opponentSourceLabel,resultLabel,LAST_ANSWER_PLACEHOLDER,EVIDENCE_PLACEHOLDER} from '../public/shared/match-labels.js';
import {createInitialState,applyAction} from '../public/shared/rules.js';

test('the opponent is never labelled Jev when the host has no Jev key, even before its first move',()=>{
  assert.equal(opponentSourceLabel({practice:false,fallback:false,jevConfigured:false}),'Local heuristic');
  assert.equal(opponentSourceLabel({practice:false,fallback:true,jevConfigured:false}),'Fallback heuristic');
  assert.equal(opponentSourceLabel({practice:true,fallback:false,jevConfigured:true}),'Local heuristic');
  assert.equal(opponentSourceLabel({practice:false,fallback:true,jevConfigured:true}),'Fallback heuristic');
  assert.equal(opponentSourceLabel({practice:false,fallback:false,jevConfigured:true}),'Jev');
});

test('the result plaque says how the human won',()=>{
  const finish=(actor,guess)=>applyAction(createInitialState({human:'c01',jev:'c02',starter:actor}),actor,{type:'guess',characterId:guess}).state.outcome;
  const jevWrong=finish('jev','c03');assert.deepEqual(jevWrong,{winner:'human',reason:'wrong_guess'});
  assert.equal(resultLabel(jevWrong),'The opponent guessed wrong. You win.');
  const humanRight=finish('human','c02');assert.deepEqual(humanRight,{winner:'human',reason:'correct_guess'});
  assert.equal(resultLabel(humanRight),'You found the answer.');
  assert.equal(resultLabel({winner:'human',reason:'resignation'}),'The opponent resigned. You win.');
  assert.equal(resultLabel({winner:'jev',reason:'correct_guess'}),'Match complete.');
  assert.equal(resultLabel(null),'');
});

test('a new match resets the opponent panel to the page placeholder',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8'),game=await readFile(new URL('../public/game.js',import.meta.url),'utf8');
  assert.match(html,new RegExp(`id="last-answer"[^>]*>${LAST_ANSWER_PLACEHOLDER.replace('.','\\.')}`));
  assert.match(game,/\$\('last-answer'\)\.textContent=last\?[^;]*:LAST_ANSWER_PLACEHOLDER;/);
});

test('a new match resets the decision evidence panel instead of keeping an earlier match\'s decision',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8'),game=await readFile(new URL('../public/game.js',import.meta.url),'utf8');
  assert.ok(html.includes(`<div id="decision-evidence"><p class="muted">${EVIDENCE_PLACEHOLDER}</p>`));
  assert.match(game,/if\(!decision\)\{panel\.replaceChildren\(el\('p',EVIDENCE_PLACEHOLDER,'muted'\)\);return;\}/);
});
test('the no-key Casual option stays short and honest',async()=>{
  const game=await readFile(new URL('../public/game.js',import.meta.url),'utf8'),label=game.match(/casual\.textContent='([^']+)'/)[1];
  assert.equal(label,'Casual · no Jev key');assert.ok(label.length<='Casual · online Jev'.length+1);assert.doesNotMatch(label,/online Jev/);
});
