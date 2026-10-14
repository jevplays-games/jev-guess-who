// Noul Who was called Guess Who before the jevplay.games rename. Everything stored or issued under the
// old id ('guess-who') must keep working: old clients, exported replays, launch tokens, the old host.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setup,userSession} from './helpers.mjs';
import {createMatch,verifyMatch} from '../server/matches.js';
import {interaction,redeemContext} from '../server/discord.js';
import {handle} from '../server/app.js';
import {createInitialState,replay,GAME_ID,GAME_IDS} from '../public/shared/rules.js';
import {sign,sha256,randomHex} from '../server/security.js';
import {defaultDatabasePath} from '../scripts/sqlite-adapter.mjs';
const LEGACY='guess-who',fixture=fileURLToPath(new URL('./fixtures/guess-who-replay.json',import.meta.url));
const hex=b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');

test('new matches are noul-who; the guess-who alias is still accepted and nothing else is',async()=>{
  assert.equal(GAME_ID,'noul-who');assert.deepEqual(GAME_IDS,['noul-who',LEGACY]);
  assert.equal(createInitialState({human:'c01',jev:'c02'}).gameId,'noul-who');
  assert.equal(createInitialState({human:'c01',jev:'c02'},LEGACY).gameId,LEGACY);
  assert.throws(()=>createInitialState({human:'c01',jev:'c02'},'choice-four'),/unknown_game/);
  const {DB,store,session,env}=await setup();
  try{
    for(const gameId of GAME_IDS){const m=await createMatch(store,session,{requestId:crypto.randomUUID(),gameId,mode:'practice',difficulty:'normal'},env);assert.equal(m.state.gameId,'noul-who');await verifyMatch(m);}
    await assert.rejects(()=>createMatch(store,session,{requestId:crypto.randomUUID(),gameId:'choice-four',mode:'practice',difficulty:'normal'},env),/unknown_game/);
  }finally{DB.close();}
});
test('a replay exported before the rename (gameId guess-who) still verifies; tampering with its id does not',async()=>{
  const old=JSON.parse(await readFile(fixture,'utf8'));assert.equal(old.state.gameId,LEGACY);
  const state=await verifyMatch(old);assert.equal(state.gameId,LEGACY);assert.deepEqual(state,old.state);
  await assert.rejects(()=>verifyMatch({...old,state:{...old.state,gameId:'choice-four'}}),/unknown_game/);
  const cli=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/verify-replay.mjs',import.meta.url)),fixture],{encoding:'utf8'});
  assert.equal(cli.status,0,cli.stderr);assert.equal(JSON.parse(cli.stdout).valid,true);
});
test('an offline replay exported before the rename still reconstructs',()=>{
  const initial={human:'c01',jev:'c02'},state=createInitialState(initial,LEGACY);
  assert.deepEqual(replay(initial,[],LEGACY),state);assert.notDeepEqual(replay(initial,[]),state);
});
test('a launch token issued before the rename still redeems',async()=>{
  const {DB,store,session,env}=await setup();await userSession(store,session);
  try{
    const now=Date.now(),payload={kind:'launch',version:1,subject:session.user_id,guildId:'223456789012345678',channelId:'323456789012345678',gameId:LEGACY,issuedAt:now,expiresAt:now+300000,nonce:randomHex(),interactionId:'423456789012345678'};
    const token=await sign(payload,env.LAUNCH_SIGNING_KEY);
    await store.run('INSERT INTO grants(token_hash,kind,payload_json,expires_at) VALUES(?,?,?,?)',await sha256(token),'launch',JSON.stringify(payload),payload.expiresAt);
    await redeemContext(store,session,token,env);
    const row=await store.one('SELECT context_json FROM sessions WHERE token_hash=?',session.token_hash);assert.equal(JSON.parse(row.context_json).guildId,payload.guildId);
    const other={...payload,gameId:'choice-four',nonce:randomHex()},bad=await sign(other,env.LAUNCH_SIGNING_KEY);
    await assert.rejects(()=>redeemContext(store,session,bad,env),/launch_subject_rejected/);
  }finally{DB.close();}
});
test('/play-jev accepts both the old and the new game option until it is re-registered',async()=>{
  const {DB,store,env}=await setup();
  const pair=await crypto.subtle.generateKey({name:'Ed25519'},true,['sign','verify']);
  Object.assign(env,{DISCORD_PUBLIC_KEY:hex(await crypto.subtle.exportKey('raw',pair.publicKey)),DISCORD_CLIENT_ID:'123456789012345678'});
  const call=async(value,id)=>{
    const body=JSON.stringify({type:2,id,application_id:env.DISCORD_CLIENT_ID,guild_id:'223456789012345678',channel_id:'323456789012345678',member:{user:{id:'423456789012345678'}},authorizing_integration_owners:{'0':'223456789012345678'},data:{name:'play-jev',options:[{name:'game',value}]}});
    const timestamp=String(Math.floor(Date.now()/1000)),signature=hex(await crypto.subtle.sign('Ed25519',pair.privateKey,new TextEncoder().encode(timestamp+body)));
    return interaction(store,new Request(env.ORIGIN+'/api/discord/interactions',{method:'POST',headers:{'X-Signature-Ed25519':signature,'X-Signature-Timestamp':timestamp},body}),env);
  };
  try{
    for(const [value,id] of [['noul-who','523456789012345678'],[LEGACY,'623456789012345678']]){
      const reply=await(await call(value,id)).json();
      assert.match(reply.data.content,/^Play Noul Who against Jev\./);assert.equal(reply.data.components[0].components[0].label,'Play Noul Who');
      const grant=await store.one("SELECT payload_json FROM grants WHERE source_id=? AND kind='launch'",id);assert.equal(JSON.parse(grant.payload_json).gameId,'noul-who');
    }
    await assert.rejects(()=>call('choice-four','723456789012345678'),/unknown_game/);
  }finally{DB.close();}
});
test('the pre-rename host is served under its own origin, then 301s to the new origin at cutover',async()=>{
  const {DB,env}=await setup();
  Object.assign(env,{ORIGIN:'https://noul-who.jevplay.games',LEGACY_ORIGIN:'https://guess-who.jevplay.games',LEGACY_ORIGIN_MODE:'serve',LOCAL_DEVELOPMENT:'false'});
  try{
    for(const origin of [env.ORIGIN,env.LEGACY_ORIGIN]){const r=await handle(new Request(origin+'/api/me'),env);assert.equal(r.status,200,origin);}
    const login=await handle(new Request(env.LEGACY_ORIGIN+'/api/me'),env),{csrf}=await login.json(),cookie=login.headers.get('set-cookie').split(';')[0];
    const legacyPost=body=>handle(new Request(env.LEGACY_ORIGIN+'/api/games',{method:'POST',headers:{cookie,Origin:env.LEGACY_ORIGIN,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:JSON.stringify(body)}),env);
    assert.equal((await legacyPost({requestId:crypto.randomUUID(),gameId:LEGACY,mode:'practice',difficulty:'normal'})).status,201);
    assert.equal((await handle(new Request('https://attacker.example/api/me'),env)).status,403);
    env.LEGACY_ORIGIN_MODE='redirect';
    for(const method of ['GET','HEAD']){const r=await handle(new Request(env.LEGACY_ORIGIN+'/some/path?x=1',{method}),env);assert.equal(r.status,301);assert.equal(r.headers.get('location'),'https://noul-who.jevplay.games/some/path?x=1');}
    const post=await handle(new Request(env.LEGACY_ORIGIN+'/api/games?y=2',{method:'POST',body:'{}'}),env);assert.equal(post.status,308);assert.equal(post.headers.get('location'),'https://noul-who.jevplay.games/api/games?y=2');
    assert.equal((await handle(new Request(env.ORIGIN+'/api/me'),env)).status,200);
    assert.deepEqual(await(await handle(new Request(env.LEGACY_ORIGIN+'/api/health'),env)).json(),{ok:true,game:'noul-who',version:'1.0.0'});
  }finally{DB.close();}
});
test('the default local database moves to noul-who.sqlite but an existing guess-who.sqlite keeps being used',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'noul-who-db-'));
  try{
    assert.equal(defaultDatabasePath(root),path.join(root,'data/noul-who.sqlite'));
    await mkdir(path.join(root,'data'));await writeFile(path.join(root,'data/guess-who.sqlite'),'');
    assert.equal(defaultDatabasePath(root),path.join(root,'data/guess-who.sqlite'));
    await writeFile(path.join(root,'data/noul-who.sqlite'),'');
    assert.equal(defaultDatabasePath(root),path.join(root,'data/noul-who.sqlite'));
  }finally{await rm(root,{recursive:true,force:true});}
});
