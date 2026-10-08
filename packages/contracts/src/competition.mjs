// Shared, data-only publication contract. No author-provided comparator or code is executed.
export const COMPETITION_LIMITS = Object.freeze({boards:3,metrics:4,magnitude:1_000_000_000_000,moves:8192,runsPerHour:60,retainedRuns:20000});
export const competitionKey = /^[a-z][a-z0-9-]{0,47}$/;
const fail = message => { throw Object.assign(new Error(message),{code:'MANIFEST_COMPETITION_INVALID',statusCode:400}); };
const object = (value,allowed) => { if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key)))fail('Unknown or invalid competition fields.'); };
const text = (value,max) => typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\u0000-\u001f]/.test(value);
export function normalizeCompetition(value) {
  object(value,['version','boards']);
  if(value.version!==1||!Array.isArray(value.boards)||!value.boards.length||value.boards.length>COMPETITION_LIMITS.boards)fail('Competition requires version 1 and 1–3 boards.');
  const keys=new Set();
  const boards=value.boards.map(board=>{
    object(board,['key','title','modeKey','rulesetVersion','period','metrics','ranking','verification','verifier']);
    if(typeof board.key!=='string'||!competitionKey.test(board.key)||typeof board.modeKey!=='string'||!competitionKey.test(board.modeKey)||keys.has(board.key)||!text(board.title,60)||!Number.isSafeInteger(board.rulesetVersion)||board.rulesetVersion<1||board.rulesetVersion>100000)fail('Invalid board identity or version.');
    keys.add(board.key);
    if(!['all-time','daily'].includes(board.period)||!['client_reported','replay_verified'].includes(board.verification))fail('Unsupported period or verification.');
    if(!Array.isArray(board.metrics)||!board.metrics.length||board.metrics.length>COMPETITION_LIMITS.metrics)fail('A board requires 1–4 integer metrics.');
    const metricKeys=new Set();
    const metrics=board.metrics.map(metric=>{
      object(metric,['key','label','unit','min','max']);
      if(typeof metric.key!=='string'||!competitionKey.test(metric.key)||metricKeys.has(metric.key)||!text(metric.label,24)||typeof metric.unit!=='string'||metric.unit.length>12||/[\u0000-\u001f]/.test(metric.unit))fail('Invalid metric.');
      metricKeys.add(metric.key);
      if(!Number.isSafeInteger(metric.min)||!Number.isSafeInteger(metric.max)||metric.min>metric.max||Math.abs(metric.min)>COMPETITION_LIMITS.magnitude||Math.abs(metric.max)>COMPETITION_LIMITS.magnitude)fail('Metrics require bounded safe integers.');
      return {key:metric.key,label:metric.label,unit:metric.unit,min:metric.min,max:metric.max};
    });
    const ranked=new Set();
    if(!Array.isArray(board.ranking)||!board.ranking.length||board.ranking.length>metrics.length)fail('Invalid ranking.');
    const ranking=board.ranking.map(clause=>{
      object(clause,['metric','direction']);
      if(!metricKeys.has(clause.metric)||ranked.has(clause.metric)||!['asc','desc'].includes(clause.direction))fail('Invalid ranking clause.');
      ranked.add(clause.metric);return {metric:clause.metric,direction:clause.direction};
    });
    if(board.verification==='replay_verified'){
      if(board.verifier!=='tile-merge-v1'||metrics.some(metric=>!['score','max-tile','moves'].includes(metric.key)))fail('A platform-supported verifier and its metrics are required.');
    }else if(board.verifier!==undefined)fail('Client-reported boards cannot claim a verifier.');
    return {key:board.key,title:board.title,modeKey:board.modeKey,rulesetVersion:board.rulesetVersion,period:board.period,metrics,ranking,verification:board.verification,...(board.verifier?{verifier:board.verifier}:{})};
  });
  return {version:1,boards};
}
export function validateCompetitionMetrics(definition,metrics) {
  if(!metrics||typeof metrics!=='object'||Array.isArray(metrics)||Object.keys(metrics).length!==definition.metrics.length||Object.keys(metrics).some(key=>!definition.metrics.some(metric=>metric.key===key)))fail('Submit exactly the declared metrics.');
  for(const metric of definition.metrics)if(!Number.isSafeInteger(metrics[metric.key])||metrics[metric.key]<metric.min||metrics[metric.key]>metric.max)fail('Metric is outside its declared integer range.');
  return Object.fromEntries(definition.metrics.map(metric=>[metric.key,metrics[metric.key]]));
}
export const competitionSortKey = (definition,metrics) => definition.ranking.map(clause=>metrics[clause.metric]*(clause.direction==='desc'?-1:1));
