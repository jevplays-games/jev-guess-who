import {readFile} from 'node:fs/promises';
import {openDatabase} from '../scripts/sqlite-adapter.mjs';
import {Store} from '../server/store.js';
import {randomHex,sha256} from '../server/security.js';
export async function setup(){
  const DB=openDatabase();DB.exec(await readFile(new URL('../migrations/001.sql',import.meta.url),'utf8'));
  const store=new Store(DB),env={DB,ORIGIN:'http://localhost:8787',LOCAL_DEVELOPMENT:'true',LAUNCH_SIGNING_KEY:'a'.repeat(64),RATE_LIMIT_HASH_KEY:'b'.repeat(64),ASSETS:{fetch:()=>new Response('asset')}};
  const session={token_hash:await sha256(randomHex()),user_id:null,csrf:randomHex(),context:null,actorKey:'test-actor'};
  await store.run('INSERT INTO sessions(token_hash,csrf,created_at,expires_at) VALUES(?,?,?,?)',session.token_hash,session.csrf,Date.now(),Date.now()+86400000);
  return {DB,store,env,session};
}
export async function userSession(store,session,id='123456789012345678'){
  const now=Date.now();await store.run('INSERT INTO users(discord_id,display_name,created_at,last_seen_at) VALUES(?,?,?,?)',id,'Test User',now,now);
  await store.run('UPDATE sessions SET user_id=? WHERE token_hash=?',id,session.token_hash);session.user_id=id;return session;
}
export function providerMock(payload,{model='jev-1.13.0',choice=null,confidence=1}={}){
  const ids=Object.keys(payload.questions.action.criteria),selected=choice||ids[0];
  return {model,answers:{action:{type:'choice',choice:selected,confidence,probabilities:Object.fromEntries(ids.map(id=>[id,id===selected?1:0]))}},usage:{input_tokens:256,output_tokens:32}};
}
