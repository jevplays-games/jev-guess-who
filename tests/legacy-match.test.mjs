// Matches stored IN PROGRESS by the pre-rename build (origin/main 172e75d, gameId 'guess-who') must still be
// playable after the rename: finished, resigned, advanced and expired, never a 5xx.
// The fixture was produced by running tests/fixtures/gen-legacy-in-progress.mjs against an origin/main checkout.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setup} from './helpers.mjs';
import {humanAction,advance,ownedMatch,verifyMatch} from '../server/matches.js';
import {handle,maintenance} from '../server/app.js';
import {getLegalActions} from '../public/shared/rules.js';

const fixture=JSON.parse(await readFile(new URL('./fixtures/guess-who-in-progress.json',import.meta.url),'utf8'));
const COLUMNS=['id','user_id','owner_session_hash','request_id','mode','league_id','guild_id','channel_id','revision','status','eligible','payload_json','created_at','expires_at'];

async function load(store,row,ownerHash,{expired=false}={}){
  const r={...row,owner_session_hash:ownerHash};
  if(expired){const p=JSON.parse(r.payload_json);p.expiresAt=Date.now()-1000;r.payload_json=JSON.stringify(p);r.expires_at=p.expiresAt;}
  await store.run(`INSERT INTO matches(${COLUMNS.join(',')}) VALUES(${COLUMNS.map(()=>'?').join(',')})`,...COLUMNS.map(c=>r[c]));
  return r.id;
}
const act=(store,session,id,match,action,env)=>humanAction(store,session,id,{actionId:crypto.randomUUID(),expectedRevision:match.state.revision,action},env);
async function toHumanTurn(store,session,id,env){
  let {match}=await ownedMatch(store,id,session,env);
  for(let i=0;i<4&&match.state.phase==='active'&&match.state.turn==='jev';i++)({match}=await advance(store,session,id,env));
  return match;
}

test('the fixture really is pre-rename and in progress',()=>{
  assert.deepEqual(Object.keys(fixture.rows).sort(),['freshHuman','jevToMove','midGameHuman']);
  for(const row of Object.values(fixture.rows)){const p=JSON.parse(row.payload_json);assert.equal(row.status,'active');assert.equal(p.state.gameId,'guess-who');assert.equal(p.state.phase,'active');}
  assert.equal(JSON.parse(fixture.rows.jevToMove.payload_json).state.turn,'jev');
  assert.ok(JSON.parse(fixture.rows.midGameHuman.payload_json).events.length>=2);
});

for(const [name,row] of Object.entries(fixture.rows)){
  test(`pre-rename in-progress match "${name}" can be finished with a correct guess`,async()=>{
    const {DB,store,env,session}=await setup();
    try{
      const id=await load(store,row,session.token_hash),match=await toHumanTurn(store,session,id,env);
      if(match.state.phase==='active'){
        const guess=getLegalActions(match.state,'human').find(a=>a.type==='guess'&&a.characterId===match.state.secrets.jev);
        const done=await act(store,session,id,match,guess,env);
        assert.equal(done.state.phase,'finished');assert.deepEqual(done.state.outcome,{winner:'human',reason:'correct_guess'});
      }
      const {match:stored}=await ownedMatch(store,id,session,env);assert.equal(stored.state.gameId,'guess-who');
      await verifyMatch(stored);
    }finally{DB.close();}
  });
  test(`pre-rename in-progress match "${name}" can be resigned`,async()=>{
    const {DB,store,env,session}=await setup();
    try{
      const id=await load(store,row,session.token_hash),match=await toHumanTurn(store,session,id,env);
      if(match.state.phase==='active'){const done=await act(store,session,id,match,{type:'resign'},env);assert.deepEqual(done.state.outcome,{winner:'jev',reason:'resignation'});}
      await verifyMatch((await ownedMatch(store,id,session,env)).match);
    }finally{DB.close();}
  });
  test(`pre-rename in-progress match "${name}" expires through maintenance`,async()=>{
    const {DB,store,env,session}=await setup();
    try{
      const id=await load(store,row,session.token_hash,{expired:true});
      await maintenance(env);
      const status=(await store.one('SELECT status FROM matches WHERE id=?',id)).status;assert.equal(status,'finished');
      const {match}=await ownedMatch(store,id,session,env);assert.deepEqual(match.state.outcome,{winner:'jev',reason:'expiration'});
      await verifyMatch(match);
      assert.equal(await store.one("SELECT COUNT(*) AS n FROM telemetry WHERE event='maintenance_error'").then(r=>r.n),0);
    }finally{DB.close();}
  });
}

test('over HTTP, a pre-rename in-progress match is read, played, advanced, resigned and exported without a 5xx',async()=>{
  const {DB,store,env}=await setup();
  try{
    const me=await handle(new Request(env.ORIGIN+'/api/me'),env),{csrf}=await me.json(),cookie=me.headers.get('set-cookie').split(';')[0];
    const {token_hash}=await store.one('SELECT token_hash FROM sessions ORDER BY created_at DESC LIMIT 1');
    const call=(path,method='GET',body)=>handle(new Request(env.ORIGIN+path,{method,headers:{cookie,Origin:env.ORIGIN,'X-CSRF-Token':csrf,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env);
    for(const row of Object.values(fixture.rows)){
      const id=await load(store,row,token_hash);
      let r=await call(`/api/games/${id}`);assert.equal(r.status,200);let snap=await r.json();
      for(let i=0;i<4&&snap.phase==='active'&&snap.turn==='jev';i++){r=await call(`/api/games/${id}/advance`,'POST');assert.ok(r.status<500,`advance ${r.status}`);snap=await r.json();}
      const ask=snap.legalActions?.find(a=>a.type==='ask');
      if(snap.phase==='active'&&ask){r=await call(`/api/games/${id}/actions`,'POST',{actionId:crypto.randomUUID(),expectedRevision:snap.revision,action:ask});assert.equal(r.status,200,`ask ${r.status}`);snap=await r.json();
        for(let i=0;i<4&&snap.phase==='active'&&snap.turn==='jev';i++){r=await call(`/api/games/${id}/advance`,'POST');assert.ok(r.status<500);snap=await r.json();}}
      if(snap.phase==='active'){r=await call(`/api/games/${id}/actions`,'POST',{actionId:crypto.randomUUID(),expectedRevision:snap.revision,action:{type:'resign'}});assert.equal(r.status,200,`resign ${r.status}`);snap=await r.json();}
      assert.equal(snap.phase,'finished');
      r=await call(`/api/games/${id}/replay`);assert.equal(r.status,200);const replay=await r.json();assert.equal(replay.state.gameId,'guess-who');
    }
  }finally{DB.close();}
});
