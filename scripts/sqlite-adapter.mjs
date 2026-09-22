import {DatabaseSync} from 'node:sqlite';
/** Implements the small D1 subset consumed by Store, including atomic batch. */
export function openDatabase(path=':memory:') {
  const sqlite=new DatabaseSync(path);sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
  class Statement {
    constructor(sql,args=[]){this.sql=sql;this.args=args;}
    bind(...args){return new Statement(this.sql,args);}
    async first(column){const row=sqlite.prepare(this.sql).get(...this.args);return row?(column?row[column]:{...row}):null;}
    async all(){return {results:sqlite.prepare(this.sql).all(...this.args).map(r=>({...r})),success:true};}
    runSync(){const r=sqlite.prepare(this.sql).run(...this.args);return {success:true,meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};}
    async run(){return this.runSync();}
  }
  return {sqlite,prepare:sql=>new Statement(sql),exec:sql=>sqlite.exec(sql),
    async batch(statements){sqlite.exec('BEGIN IMMEDIATE');try{const result=statements.map(s=>s.runSync());sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}},
    close:()=>sqlite.close()};
}
