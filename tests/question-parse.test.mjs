import {test} from 'node:test';
import assert from 'node:assert/strict';
import {matchQuestion, scoreQuestion} from '../public/shared/question-parse.js';
import {PREDICATES} from '../public/shared/roster.js';

const id = (text, isLegal) => {
  const r = matchQuestion(text, isLegal);
  return r.status === 'ok' ? r.predicate.id : r.status;
};

test('typed phrasings resolve to the predicate they describe', () => {
  assert.equal(id('does your character wear glasses?'), 'glasses');
  assert.equal(id('Glasses'), 'glasses');
  assert.equal(id('is he wearing specs'), 'glasses');
  assert.equal(id('do they have a beard'), 'beard');
  assert.equal(id('moustache?'), 'moustache');
  assert.equal(id('mustache'), 'moustache');            // the other spelling
  assert.equal(id('are they wearing a hat'), 'hat');
  assert.equal(id('does she wear earrings'), 'earrings');
  assert.equal(id('scarf'), 'scarf');
});

test('the qualifier decides between the hair questions, not the word "hair"', () => {
  assert.equal(id('does your character have long hair'), 'long_hair');
  assert.equal(id('curly hair?'), 'curly_hair');
  assert.equal(id('is their hair black'), 'hair_black');
  assert.equal(id('brown hair'), 'hair_brown');
  assert.equal(id('are they blonde'), 'hair_blond');
  assert.equal(id('ginger?'), 'hair_red');
  assert.equal(id('red hair'), 'hair_red');
});

test('a bare "hair" is ambiguous rather than a silent guess', () => {
  const r = matchQuestion('does your character have hair');
  assert.notEqual(r.status, 'ok');
});

test('questions the rules cannot answer are rejected, with the legal set offered', () => {
  const r = matchQuestion('is your character happy?');
  assert.equal(r.status, 'unknown');
  assert.equal(r.options.length, PREDICATES.length);
});

test('empty input is its own state, not an error', () => {
  assert.equal(matchQuestion('').status, 'empty');
  assert.equal(matchQuestion('   ').status, 'empty');
});

test('an already-asked question resolves to spent and lists what is left', () => {
  const isLegal = x => x !== 'glasses';
  const r = matchQuestion('glasses', isLegal);
  assert.equal(r.status, 'spent');
  assert.ok(r.options.length > 0);
  assert.ok(!r.options.some(p => p.id === 'glasses'));
});

test('every predicate is reachable by typing its own label', () => {
  for (const p of PREDICATES) assert.equal(id(p.label), p.id, `unreachable: ${p.label}`);
});

test('scoring prefers the more specific phrase', () => {
  const scores = scoreQuestion('long hair');
  assert.equal(scores[0].id, 'long_hair');
});

test('two questions joined into one are refused, not half-answered', () => {
  // Reported: "Does the character have glasses, and have earrings?" silently
  // resolved to earrings alone and spent the turn on it.
  for (const q of ['Does the character have glasses, and have earrings?',
                   'glasses and earrings',
                   'does your character wear glasses or a hat',
                   'a hat, plus a scarf']) {
    const r = matchQuestion(q);
    assert.equal(r.status, 'compound', q);
    assert.ok(r.options.length >= 2, q);
  }
});

test('a joined question with only one half recognised warns instead of going quiet', () => {
  // The other half was a typo ("earlings"), so only glasses resolves. It may be
  // asked, but the player has to be told the rest is being dropped.
  const r = matchQuestion('Does the character have glasses, and have earlings?');
  assert.equal(r.status, 'ok');
  assert.equal(r.predicate.id, 'glasses');
  assert.equal(r.warning, 'one_per_turn');
});

test('a plain single question carries no warning', () => {
  const r = matchQuestion('does your character wear glasses');
  assert.equal(r.status, 'ok');
  assert.equal(r.warning, undefined);
});

test('phrases match on whole words only', () => {
  // "earlings", "early" and "earnest" must not hit the `ear` phrase.
  for (const q of ['early riser?', 'is he earnest', 'earlings'])
    assert.notEqual(matchQuestion(q).status, 'ok', q);
});
