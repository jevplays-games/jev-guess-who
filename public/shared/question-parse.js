/* Resolve a typed question to one of the game's legal predicates.

   This is an INPUT METHOD, not a rule. The typed text never leaves the browser
   and is never sent to the model or the server: the ask action still carries a
   predicateId drawn from the finite set in roster.js, and the server still
   validates it against legalActions. Free-form questions are deliberately not
   forwarded anywhere -- answering an arbitrary question would mean handing the
   opponent's secret to something that could read it, which the model is never
   given. So the player may phrase a question however they like, as long as it
   resolves to a question the rules can actually answer.

   Matching is scored on the most specific phrase present, because the obvious
   token is rarely the distinguishing one: "long hair", "curly hair" and "black
   hair" all contain "hair", and only the qualifier separates them. */
import {PREDICATES} from './roster.js';

// Phrases that identify each predicate, longest-wins. Written as the words a
// player actually types, not the words the label uses.
const PHRASES = Object.freeze({
  glasses:    ['glasses', 'spectacles', 'specs', 'eyeglasses', 'eyewear'],
  hat:        ['hat', 'cap', 'beanie', 'headwear', 'head covering', 'on their head', 'on his head', 'on her head'],
  earrings:   ['earrings', 'earring', 'ear rings', 'studs', 'ear'],
  scarf:      ['scarf', 'scarves', 'neckerchief', 'around their neck', 'neck'],
  beard:      ['beard', 'bearded', 'goatee'],
  moustache:  ['moustache', 'mustache', 'moustaches', 'tache', 'stache'],
  long_hair:  ['long hair', 'longhair', 'long haired', 'hair long', 'hair is long'],
  curly_hair: ['curly hair', 'curly', 'curls', 'curled hair', 'wavy hair', 'wavy', 'hair curly', 'hair is curly'],
  hair_black: ['black hair', 'dark hair', 'black haired', 'raven hair', 'hair black', 'hair is black', 'hair is dark'],
  hair_brown: ['brown hair', 'brunette', 'brown haired', 'hair brown', 'hair is brown'],
  hair_blond: ['blond hair', 'blonde hair', 'blond', 'blonde', 'fair hair', 'hair blond', 'hair blonde', 'hair is blond', 'hair is blonde'],
  hair_red:   ['red hair', 'ginger', 'redhead', 'red haired', 'auburn', 'hair red', 'hair is red'],
});

const normalise = text => ` ${String(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;

/** Score every predicate against the text. Higher is a more specific hit. */
export function scoreQuestion(text) {
  const haystack = normalise(text);
  if (haystack.trim() === '') return [];
  return PREDICATES.map(p => {
    let score = 0;
    for (const phrase of PHRASES[p.id] ?? []) {
      // Both boundaries required. normalise() already wraps the text in spaces,
      // so a trailing phrase still matches -- while an unbounded prefix test
      // made "earlings" hit `ear`, and would have hit "early" and "earnest" too.
      if (!haystack.includes(` ${phrase} `)) continue;
      // Word count is the specificity signal: "black hair" must beat "hair".
      score = Math.max(score, phrase.split(' ').length * 10 + phrase.length);
    }
    return {...p, score};
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
}

// "and", "or", a comma: the player joined two questions into one.
const JOINER = /(^| )(and|or|plus|also|as well as|both)( |$)|,/;

/**
 * Resolve typed text to a single predicate.
 * @param {string} text what the player typed
 * @param {(id:string)=>boolean} [isLegal] narrows to questions still allowed
 * @returns {{status:'ok',predicate:object,warning?:string}
 *          |{status:'ambiguous'|'unknown'|'empty'|'spent'|'compound',options:object[]}}
 */
export function matchQuestion(text, isLegal = () => true) {
  const all = scoreQuestion(text);
  if (!String(text).trim()) return {status: 'empty', options: PREDICATES.filter(p => isLegal(p.id))};
  if (all.length === 0) return {status: 'unknown', options: PREDICATES.filter(p => isLegal(p.id))};
  // Two questions in one. A turn answers exactly one predicate, so answering
  // half of it and silently dropping the rest would spend the turn on a
  // question the player did not ask. Refuse and let them pick which half.
  if (all.length > 1 && JOINER.test(normalise(text))) {
    return {status: 'compound', options: all.filter(p => isLegal(p.id))};
  }
  // A tie on the top score means the text did not say which one it meant.
  const top = all.filter(x => x.score === all[0].score);
  if (top.length > 1) return {status: 'ambiguous', options: top.filter(p => isLegal(p.id))};
  if (!isLegal(all[0].id)) return {status: 'spent', options: PREDICATES.filter(p => isLegal(p.id))};
  // Joined two clauses but only one resolved -- often a typo in the other half
  // ("glasses, and have earlings"). Ask the one that resolved, but say so, so
  // the turn is not quietly spent on half the question.
  if (JOINER.test(normalise(text))) return {status: 'ok', predicate: all[0], warning: 'one_per_turn'};
  return {status: 'ok', predicate: all[0]};
}
