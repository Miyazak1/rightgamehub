import crypto from 'node:crypto';
export const SCHEDULER_BASE='sha256:ee818f213525cb81a984c4c7dba8c4b4096a85e7d22da3c98df06dcb1bce2843';
export const BASE_GRAPH='72cb11e1d230bfa0627ae36d2accfdc5a3d92b460e41e694544d024c63b93ec8';
export const MODULE_HASHES={
 'apps/api/src/agent-blog-public-schedule.mjs':'d88062fd342b9738d2bf3525a76e2c25f9c8308dad89e90a4d2997d5a435ee78',
 'apps/api/src/agent-blog-public-request-repository.mjs':'5341afac9b3606de566e3344c46a56ac22724495a336574fa748015e993c0cc7',
};
export const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
export function patchSchedulerModules(sources){
 const names=Object.keys(MODULE_HASHES);if(Object.keys(sources).length!==2)throw Error('EXACT_ORIGINAL_MODULE_SET_REQUIRED');
 const out={};for(const name of names){const old=sources[name];if(typeof old!=='string'||hash(old)!==MODULE_HASHES[name])throw Error('PINNED_ORIGINAL_MODULE_REQUIRED');
  const from=name.endsWith('/agent-blog-public-schedule.mjs')?"'instanceId',$2::text,'state',$3::text,'heartbeatAt',clock_timestamp()),true),":"SELECT * FROM agent_blog_public_requests WHERE agent_user_id=$1\n      AND (status='waiting'";
  const to=name.endsWith('/agent-blog-public-schedule.mjs')?"'instanceId',$2::text,'state',$3::text,'heartbeatAt',clock_timestamp(),'interactionProtocolVersion',1),true),":"SELECT * FROM agent_blog_public_requests WHERE agent_user_id=$1\n      AND coalesce(snapshot_json->>'executionSource','public-runtime')<>'agent-interaction-v1'\n      AND (status='waiting'";
  if(old.split(from).length!==2)throw Error('UNIQUE_COMPATIBILITY_PATCH_ANCHOR_REQUIRED');out[name]=old.replace(from,to);
 }return out;
}
export const GRAPH_PROBE=String.raw`
const fs=require('node:fs'),p=require('node:path').posix,c=require('node:crypto'),todo=['apps/api/src/agent-blog-public-schedule-worker-cli.mjs'],seen=new Set(),rows=[],sources={};
while(todo.length){const f=todo.pop();if(seen.has(f))continue;seen.add(f);if(!f.startsWith('apps/api/src/'))throw Error('UNEXPECTED_SOURCE_PATH');const s=fs.readFileSync('/app/'+f,'utf8').replace(/\r\n?/g,'\n');rows.push([f,c.createHash('sha256').update(s).digest('hex')]);if(['apps/api/src/agent-blog-public-schedule.mjs','apps/api/src/agent-blog-public-request-repository.mjs'].includes(f))sources[f]=s;for(const m of s.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+\.mjs)['"]/g))todo.push(p.normalize(p.join(p.dirname(f),m[1])));}
rows.sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);console.log(JSON.stringify({modules:rows.length,hash:c.createHash('sha256').update(JSON.stringify(rows)).digest('hex'),rows,sources}));
`;
export function verifyCompatGraph(base,actual){
 if(base.modules!==70||base.hash!==BASE_GRAPH||hash(JSON.stringify(base.rows))!==BASE_GRAPH)throw Error('ORIGINAL_GRAPH_REQUIRED');
 const patched=patchSchedulerModules(base.sources),expected=base.rows.map(([f,h])=>[f,Object.hasOwn(patched,f)?hash(patched[f]):h]);
 if(actual.modules!==70||JSON.stringify(actual.rows)!==JSON.stringify(expected)||actual.hash!==hash(JSON.stringify(expected))||Object.keys(patched).some(f=>actual.sources[f]!==patched[f]))throw Error('EXACT_TWO_MODULE_PATCH_REQUIRED');
 return{baseGraphSha256:BASE_GRAPH,candidateGraphSha256:actual.hash,totalModules:70,changedModules:Object.keys(patched),unchangedModules:68};
}
