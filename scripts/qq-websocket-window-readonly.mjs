// Diagnose the exact release-window checks without changing services or data.
import {WINDOW_QUERIES,OUTBOX_WINDOW_SQL,assessOutboxWindow} from './agent-server-cutover.mjs';
export function collectWSWindow(reader,databases,emit=console.log){
 const blocking=[],missing=[];
 for(const [db,table,where,optional]of WINDOW_QUERIES){
  if(!reader.exists(databases[db],table)){emit(JSON.stringify({section:'window',database:db,table,missing:true,optional:!!optional}));if(!optional)missing.push(table);continue;}
  if(table==='agent_runtime_outbox'){
   const summary=assessOutboxWindow(JSON.parse(reader.sql(databases[db],OUTBOX_WINDOW_SQL)));emit(JSON.stringify({section:'window',database:db,table,...summary}));if(summary.blocking)blocking.push({database:db,table,count:summary.blocking});continue;
  }
  const count=Number(reader.sql(databases[db],`SELECT count(*) FROM ${table} t WHERE ${where}`));if(!Number.isSafeInteger(count)||count<0)throw Error('INVALID_WINDOW_COUNT');
  const row={section:'window',database:db,table,count};
  if(count){
   row.sample=JSON.parse(reader.sql(databases[db],`SELECT COALESCE(json_agg(s),'[]'::json) FROM (SELECT json_build_object('id',COALESCE(to_jsonb(t)->>'id',to_jsonb(t)->>'message_id'),'state',COALESCE(to_jsonb(t)->>'status',to_jsonb(t)->>'state'),'createdAt',to_jsonb(t)->>'created_at','updatedAt',to_jsonb(t)->>'updated_at','finishedAt',to_jsonb(t)->>'finished_at','leaseUntil',to_jsonb(t)->>'lease_until','attempts',COALESCE(to_jsonb(t)->>'attempts',to_jsonb(t)->>'attempt_count'),'runId',to_jsonb(t)->>'run_id','workflowKey',to_jsonb(t)->>'workflow_key','kind',to_jsonb(t)->>'kind') AS item FROM ${table} t WHERE ${where} ORDER BY COALESCE(to_jsonb(t)->>'created_at',to_jsonb(t)->>'updated_at','') LIMIT 3) s`));
   blocking.push({database:db,table,count});
  }
  emit(JSON.stringify(row));
 }
 const result={result:'QQ_WEBSOCKET_WINDOW_READONLY_COMPLETE',blocking,missing,atomicAcrossTables:false,servicesRestarted:false,tasksRetried:false,configurationWritten:false,locksModified:false,qqLoginOrQrRequested:false,rawMessagesOrCredentialsPrinted:false};emit(JSON.stringify(result));return result;
}
export const WS_WINDOW_READONLY_NODE=String.raw`
import {spawnSync} from 'node:child_process';
import {Cutover,WINDOW_QUERIES,OUTBOX_WINDOW_SQL,assessOutboxWindow} from '/www/backup/gamehub/qq-websocket-owner-release-20261127-r1/scripts/agent-server-cutover.mjs';
const inspect=name=>{const r=spawnSync('docker',['inspect',name],{encoding:'utf8',timeout:10000,maxBuffer:1048576});if(r.status!==0)throw Error('CONTAINER_READ_FAILED');return JSON.parse(r.stdout)[0];};
const reference=(name,key,container)=>{const c=inspect(name),entry=c.Config.Env.find(v=>v.startsWith(key+'='));if(!entry)throw Error('DATABASE_REFERENCE_REQUIRED');const u=new URL(entry.slice(key.length+1)),user=decodeURIComponent(u.username),database=decodeURIComponent(u.pathname.slice(1));if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(user)||!/^\w+$/.test(database))throw Error('DATABASE_REFERENCE_INVALID');return {container,user,database};};
const databases={api:reference('gamehub-production-api-1','DATABASE_URL','gamehub-production-postgres-1'),qq:reference('mooyu-qq-worker-1','QQ_DATABASE_URL','mooyu-qq-postgres-1')};
const reader=new Cutover('/www/backup/gamehub/qq-websocket-owner-release-20261127-r1');
`;
export function wsWindowReadonlyCommand(){
 return `(
set -euo pipefail
base='/www/backup/gamehub/qq-websocket-owner-release-20261127-r1'
cd "$base"
sha256sum --check SHA256SUMS
runtime=''
for candidate in /root/mooyu-qq-gateway-runtime-20261124-*/node /root/mooyu-github-search-runtime-20261124-*/node; do
  if test -f "$candidate" && test -x "$candidate" && test ! -L "$candidate"; then
    case "$("$candidate" --version)" in v22.*) runtime="$candidate"; break ;; esac
  fi
done
test -n "$runtime" || { echo VERIFIED_PRIVATE_NODE_NOT_FOUND; exit 2; }
"$runtime" --input-type=module <<'NODE'
${WS_WINDOW_READONLY_NODE}
${collectWSWindow.toString()}
try { collectWSWindow(reader,databases); }
catch(e) { console.log(JSON.stringify({result:'QQ_WEBSOCKET_WINDOW_READ_FAILED',code:/^[A-Z0-9_]+$/.test(e.message??'')?e.message:'READ_FAILED',servicesRestarted:false,tasksRetried:false}));process.exitCode=1; }
NODE
)
`;
}
