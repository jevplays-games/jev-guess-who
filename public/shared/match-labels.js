// Player-facing labels that must stay honest about who is playing and why a match ended.
// Pure functions (no DOM, no I/O) so the tests can pin the wording.

// jevConfigured comes from /api/me. When the host has no Jev key, a casual match is decided by the
// fallback heuristic from its first move, so it is never labelled 'Jev'.
export function opponentSourceLabel({practice=false,fallback=false,jevConfigured=true}={}) {
  if(fallback)return 'Fallback heuristic';
  if(practice||jevConfigured===false)return 'Local heuristic';
  return 'Jev';
}

export function resultLabel(outcome) {
  if(!outcome)return '';
  if(outcome.winner==='human'){
    if(outcome.reason==='wrong_guess')return 'The opponent guessed wrong. You win.';
    if(outcome.reason==='resignation')return 'The opponent resigned. You win.';
    return 'You found the answer.';
  }
  return 'Match complete.';
}

export const LAST_ANSWER_PLACEHOLDER='Questions and answers appear here.';
