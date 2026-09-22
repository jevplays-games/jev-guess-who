import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {openDatabase} from './sqlite-adapter.mjs';
import {analyzeMatch,aggregateAnalytics,csv,decisionRows} from '../public/shared/analytics.js';
import {aggregateOperations} from '../public/shared/operations-analytics.js';
const args=Object.fromEntries(process.argv.slice(2).map(x=>{const [k,v]=x.replace(/^--/,'').split('=');return[k,v??true];}));
const database=path.resolve(args.db||'data/guess-who.sqlite'),out=path.resolve(args.out||'reports/operator-export'),limit=Math.max(1,Math.min(100000,Number(args.limit)||10000));
// Operator-only command: never exposed as a public HTTP endpoint.
const DB=openDatabase(database),asOf=Date.now();await mkdir(out,{recursive:true});
try {
  const total=(await DB.prepare('SELECT count(*) AS n FROM matches WHERE created_at<=?').bind(asOf).first()).n;
  const rows=(await DB.prepare('SELECT payload_json FROM matches WHERE created_at<=? ORDER BY created_at DESC LIMIT ?').bind(asOf,limit).all()).results;
  const reports=rows.map(r=>analyzeMatch(JSON.parse(r.payload_json))),decisions=reports.flatMap(r=>decisionRows(r.events).map(e=>({matchId:r.matchId,...e})));
  const telemetry=(await DB.prepare('SELECT * FROM telemetry WHERE at<=? ORDER BY at DESC LIMIT 100001').bind(asOf).all()).results;
  const telemetryTotal=(await DB.prepare('SELECT count(*) AS n FROM telemetry WHERE at<=?').bind(asOf).first()).n;
  const summary={coverage:{asOf,storedMatches:total,exportedMatches:rows.length,truncated:total>rows.length,telemetryStored:telemetryTotal,telemetryExported:Math.min(telemetry.length,100000),telemetryTruncated:telemetryTotal>100000},gameplay:aggregateAnalytics(reports),operations:aggregateOperations(telemetry.slice(0,100000),{asOf})};
  await writeFile(path.join(out,'summary.json'),JSON.stringify(summary,null,2));
  await writeFile(path.join(out,'matches.json'),JSON.stringify(reports.map(({events,...r})=>r),null,2));
  if(decisions.length)await writeFile(path.join(out,'decisions.csv'),csv(decisions,Object.keys(decisions[0])));
  console.log(JSON.stringify({out,...summary.coverage},null,2));
}finally{DB.close();}
