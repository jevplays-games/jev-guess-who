import {assert,sha256,randomHex} from './security.js';
export class Store {
  constructor(db){this.db=db;}
  statement(sql,...args){return this.db.prepare(sql).bind(...args);}
  async one(sql,...args){return this.statement(sql,...args).first();}
  async all(sql,...args){return (await this.statement(sql,...args).all()).results;}
  async run(sql,...args){return this.statement(sql,...args).run();}
  async batch(statements){return this.db.batch(statements);}
  async quota(key,limit,windowMs,now=Date.now()) {
    const hash=await sha256(key),start=Math.floor(now/windowMs)*windowMs;
    const row=await this.one(`INSERT INTO rate_limits(key_hash,window_start,count) VALUES(?,?,1)
      ON CONFLICT(key_hash,window_start) DO UPDATE SET count=count+1 RETURNING count`,hash,start);
    assert(row.count<=limit,429,'rate_limit');
  }
  async telemetry(event,{matchId=null,actorKey=null,details={}}={}) {
    // Allowlist, never arbitrary request payloads, credentials, seeds, or live identities.
    const allowed=['reason','status','source','difficulty','mode','revision','latencyMs','candidateCount','eligible','attempts','inputTokens','outputTokens','requestBytes','buildMs','confidence','searchDepth','identityKind'];
    const safe=Object.fromEntries(Object.entries(details).filter(([k,v])=>allowed.includes(k)&&['string','number','boolean'].includes(typeof v)));
    try{await this.run('INSERT INTO telemetry(at,event,match_id,actor_key,details_json) VALUES(?,?,?,?,?)',Date.now(),event,matchId,actorKey,JSON.stringify(safe));}
    catch{console.warn(JSON.stringify({event:'telemetry_write_failed'}));}
  }
  async getMatch(id){const row=await this.one('SELECT * FROM matches WHERE id=?',id);return row?{row,match:JSON.parse(row.payload_json)}:null;}
  async lease(id,revision,now=Date.now()) {
    const leaseId=randomHex(16);
    const r=await this.run(`UPDATE matches SET lease_id=?,lease_expires_at=? WHERE id=? AND revision=? AND status='active'
      AND (lease_id IS NULL OR lease_expires_at<=?)`,leaseId,now+20000,id,revision,now);
    return r.meta.changes===1?leaseId:null;
  }
  async commit(match,expectedRevision,{leaseId=null,result=null}={}) {
    const token=randomHex(16),args=[match.state.revision,match.state.phase,Number(match.eligible),JSON.stringify(match),token,match.finishedAt??null,match.state.matchId,expectedRevision];
    let guard='';if(leaseId){guard=' AND lease_id=?';args.push(leaseId);}
    const statements=[this.statement(`UPDATE matches SET revision=?,status=?,eligible=?,payload_json=?,commit_id=?,finished_at=?,lease_id=NULL,lease_expires_at=NULL WHERE id=? AND revision=?${guard}`,...args)];
    if(result)statements.push(this.statement(`INSERT OR IGNORE INTO results(match_id,user_id,league_id,difficulty,guild_id,channel_id,season_id,outcome,reason,created_at,finished_at,metrics_json)
      SELECT id,user_id,league_id,?,guild_id,channel_id,?,?,?,?,?,? FROM matches WHERE id=? AND commit_id=? AND eligible=1 AND status='finished'`,
      match.config.difficulty,result.seasonId,result.outcome,match.state.outcome.reason,match.createdAt,match.finishedAt,JSON.stringify(result.metrics),match.state.matchId,token));
    const committed=await this.batch(statements);return committed[0].meta.changes===1;
  }
}
