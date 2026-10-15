// Run against an origin/main checkout: node gen-legacy.mjs <main-worktree> <out.json>
import {writeFile} from 'node:fs/promises';
const [root,out]=process.argv.slice(2);
const {setup}=await import(`${root}/tests/helpers.mjs`);
const {createMatch,humanAction,advance}=await import(`${root}/server/matches.js`);
const {getLegalActions}=await import(`${root}/public/shared/rules.js`);
const {DB,store,env,session}=await setup();
const want={freshHuman:'human',midGameHuman:'human',jevToMove:'jev'},made={};
for(let i=0;i<200&&Object.keys(made).length<3;i++){
  const m=await createMatch(store,session,{requestId:crypto.randomUUID(),gameId:'guess-who',mode:'practice',difficulty:'normal'},env);
  const key=Object.keys(want).find(k=>!made[k]&&want[k]===m.state.turn);
  if(!key){await humanAction(store,session,m.state.matchId,{actionId:crypto.randomUUID(),expectedRevision:m.state.revision,action:{type:'resign'}},env).catch(()=>{});continue;}
  if(key==='midGameHuman'){
    const ask=getLegalActions(m.state,'human').find(a=>a.type==='ask');
    const after=await humanAction(store,session,m.state.matchId,{actionId:crypto.randomUUID(),expectedRevision:m.state.revision,action:ask},env);
    await advance(store,session,m.state.matchId,env);
  }
  made[key]=m.state.matchId;
}
const rows={};for(const [k,id] of Object.entries(made))rows[k]=await store.one('SELECT * FROM matches WHERE id=?',id);
for(const r of Object.values(rows)){const p=JSON.parse(r.payload_json);console.log(r.id,r.status,p.state.gameId,p.state.turn,p.state.revision,p.events.length);}
await writeFile(out,JSON.stringify({generatedBy:'origin/main 172e75d (pre-rename build), scripts: practice matches left in progress',ownerSessionHash:session.token_hash,rows},null,1)+'\n');
DB.close();
