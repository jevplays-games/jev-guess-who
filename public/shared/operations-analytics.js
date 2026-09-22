import {distribution,sum} from './analytics.js';
/** Platform telemetry, not client-trusted analytics. Never accepts hidden game state. */
export function aggregateOperations(events,{asOf=Date.now()}={}) {
  const timeFiltered=events.filter(e=>e.at<=asOf),count=kind=>timeFiltered.filter(e=>e.event===kind).length;
  const details=e=>typeof e.details_json==='string'?JSON.parse(e.details_json):e.details||{};
  const starts=timeFiltered.filter(e=>e.event==='game_started'),attempts=timeFiltered.filter(e=>e.event==='jev_attempt');
  const actors=rows=>new Set(rows.map(e=>e.actor_key).filter(Boolean)).size;
  const active=(days,kind)=>actors(starts.filter(e=>e.at>=asOf-days*86400000&&(!kind||details(e).identityKind===kind)));
  const byDay={};
  for(const day of [...new Set(timeFiltered.map(e=>new Date(e.at).toISOString().slice(0,10)))].sort()) {
    const rows=timeFiltered.filter(e=>new Date(e.at).toISOString().slice(0,10)===day),s=rows.filter(e=>e.event==='game_started');
    byDay[day]={starts:s.length,activeDiscordPlayers:actors(s.filter(e=>details(e).identityKind==='discord')),
      activeGuestSessions:actors(s.filter(e=>details(e).identityKind==='guest')),
      completions:rows.filter(e=>e.event==='game_completed').length,expirations:rows.filter(e=>e.event==='game_expired').length,
      providerAttempts:rows.filter(e=>e.event==='jev_attempt').length,
      fallbacks:rows.filter(e=>e.event==='jev_fallback').length,requestRejections:rows.filter(e=>e.event==='request_rejected').length};
  }
  const firstStart=new Map(),daysByActor=new Map();
  for(const e of starts.filter(e=>e.actor_key&&details(e).identityKind==='discord')) {
    const day=Math.floor(e.at/86400000),key=e.actor_key;
    firstStart.set(key,Math.min(firstStart.get(key)??day,day));
    if(!daysByActor.has(key))daysByActor.set(key,new Set());daysByActor.get(key).add(day);
  }
  const retention={};
  for(const offset of [1,7,30]){
    let matured=0,returned=0;
    for(const [key,first] of firstStart)if(first+offset<Math.floor(asOf/86400000)){matured++;if(daysByActor.get(key).has(first+offset))returned++;}
    retention[`day${offset}`]={maturedPlayers:matured,returnedPlayers:returned,rate:matured?returned/matured:null};
  }
  const known=attempts.filter(e=>Number.isInteger(details(e).inputTokens));
  const reasons={};for(const e of attempts){const reason=details(e).reason||'unknown';reasons[reason]=(reasons[reason]||0)+1;}
  return {asOf,events:timeFiltered.length,counts:Object.fromEntries([...new Set(timeFiltered.map(e=>e.event))].sort().map(kind=>[kind,count(kind)])),
    activity:{discord:{daily:active(1,'discord'),weekly:active(7,'discord'),monthly:active(30,'discord')},guestSessions:{daily:active(1,'guest'),weekly:active(7,'guest'),monthly:active(30,'guest')}},
    funnelEventCounts:{oauthStarted:count('oauth_started'),discordLogins:count('discord_login'),contextRedemptions:count('context_redeemed'),gameStarts:starts.length,completions:count('game_completed'),expirations:count('game_expired')},
    provider:{attempts:attempts.length,reasons,latencyMs:distribution(attempts.map(e=>details(e).latencyMs)),knownInputTokens:sum(known.map(e=>details(e).inputTokens)),knownOutputTokens:sum(known.map(e=>details(e).outputTokens)),usageCoverage:attempts.length?known.length/attempts.length:null,staleResponses:count('jev_stale_response')},
    byDay,firstObservedDiscordRetention:retention,
    caveats:['Activity uses rolling 24-hour / 7-day / 30-day windows; byDay uses UTC calendar days.',
      'Guest session counts are not unique human counts. Discord accounts are not proven unique humans.',
      'Retention is exact-day return since first observed retained start, not lifetime acquisition cohorts.',
      'Only fully elapsed target UTC days enter the retention denominator.',
      'Funnel event counts are not a joined user-conversion funnel; logins rotate session identities.',
      'Telemetry retention and failed telemetry writes limit completeness. Usage absence never means zero cost.']};
}
