import {readFile} from 'node:fs/promises';
import {verifyMatch} from '../server/matches.js';
import {replay as replayRules} from '../public/shared/rules.js';
import {canonical} from '../server/security.js';
const filename=process.argv[2];
if(!filename)throw Error('Usage: npm run verify -- path/to/replay.json');
const record=JSON.parse(await readFile(filename,'utf8'));
let verification;
if(record.offline===true){
  if(record.eligible!==false||record.state?.phase==='active')throw Error('Offline replay must be terminal and unranked.');
  const reconstructed=replayRules(record.initial,record.events);
  if(canonical(reconstructed)!==canonical(record.state))throw Error('Offline replay state mismatch.');
  verification='Offline rules/state only; no seed commitment, official result, or authenticated provider evidence.';
}else{
  await verifyMatch(record);
  verification='Rules, commitment, decision evidence and analytics consistency; not proof of server issuance or provider provenance.';
}
console.log(JSON.stringify({valid:true,matchId:record.state.matchId,outcome:record.state.outcome,verification},null,2));
