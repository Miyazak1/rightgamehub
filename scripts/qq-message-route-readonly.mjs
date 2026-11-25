// Passive incident collection: no native management authentication, login,
// QR request, task execution, policy update, or recovery operation.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import path from 'node:path';

export const QQ_ROUTE_SQL={
 policy:`SELECT channel_id,revision,login_revision,policy->>'enabled' AS enabled,
 policy->>'groupId'='905757031' AS group_matches,
 policy->'allowedUsers' ? '495469022' AS caller_9022_allowed,
 policy->'allowedUsers' ? '52399347' AS caller_9347_allowed FROM mooyu_qq.control_settings`,
 incident:`SELECT m.message_id,right(m.user_id,4) AS caller_suffix,m.created_at,m.updated_at,m.status,
 m.origin_group_id='905757031' AS group_matches,m.attempt_count,m.next_at,m.error_code,
 octet_length(m.input_text) AS input_bytes,octet_length(m.reply) AS reply_bytes,
 m.remote_message_id IS NOT NULL AS remote_id_present,l.interaction_id,l.task_id,l.task_settled,
 d.source_message_id FROM mooyu_qq.messages m
 LEFT JOIN mooyu_qq.agent_links l USING(channel_id,message_id)
 LEFT JOIN mooyu_qq.agent_deliveries d USING(channel_id,message_id)
 WHERE m.created_at BETWEEN '2026-11-25T04:55:00Z' AND '2026-11-25T05:20:00Z'
 ORDER BY m.created_at DESC LIMIT 30`,
 recent:`SELECT m.message_id,right(m.user_id,4) AS caller_suffix,m.created_at,m.updated_at,m.status,
 m.attempt_count,m.error_code,m.next_at,m.remote_message_id IS NOT NULL AS remote_id_present,
 l.interaction_id,l.task_id,l.task_settled FROM mooyu_qq.messages m
 LEFT JOIN mooyu_qq.agent_links l USING(channel_id,message_id)
 WHERE m.created_at>now()-interval '24 hours' ORDER BY m.created_at DESC LIMIT 16`,
 events:`SELECT message_id,event_type,created_at,CASE WHEN details->>'code' ~ '^[A-Z0-9_]{1,100}$'
 THEN details->>'code' END AS code FROM mooyu_qq.events
 WHERE created_at>now()-interval '24 hours' ORDER BY created_at DESC LIMIT 24`,
 states:`SELECT status,count(*)::int AS count,min(created_at) AS oldest,max(updated_at) AS latest
 FROM mooyu_qq.messages WHERE status<>'delivered' GROUP BY status`,
 limits:`SELECT right(m.user_id,4) AS caller_suffix,count(*)::int AS accepted_today,
 count(*) FILTER(WHERE m.created_at BETWEEN '2026-11-25T04:55:00Z' AND '2026-11-25T05:20:00Z')::int AS incident_window
 FROM mooyu_qq.messages m WHERE m.message_id !~ '^-' AND m.created_at>=
 (date_trunc('day',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai') GROUP BY m.user_id`,
 waits:`SELECT state,wait_event_type,wait_event,count(*)::int AS count FROM pg_stat_activity
 WHERE datname=current_database() AND pid<>pg_backend_pid() GROUP BY state,wait_event_type,wait_event`
};
export const API_ROUTE_SQL={
 grants:`SELECT right(actor_ref,4) AS caller_suffix,can_invoke,status,revision,updated_at
 FROM agent_channel_participants WHERE agent_user_id='c98abda1-d115-4e05-9c2e-43f68119386a' AND channel='qq'`,
 incident:`SELECT i.id,i.parent_id,i.kind,right(i.actor_ref,4) AS caller_suffix,i.event_ref,i.state,i.error_code,
 i.created_at,i.updated_at,i.attempts,i.next_attempt_at,i.run_id,r.status AS run_status,r.error_code AS run_error
 FROM agent_interactions i LEFT JOIN agent_runs r ON r.id=i.run_id
 WHERE i.agent_user_id='c98abda1-d115-4e05-9c2e-43f68119386a' AND i.channel='qq'
 AND i.created_at BETWEEN '2026-11-25T04:55:00Z' AND '2026-11-25T05:20:00Z'
 ORDER BY i.created_at DESC LIMIT 30`,
 recent:`SELECT i.id,i.parent_id,i.kind,right(i.actor_ref,4) AS caller_suffix,i.event_ref,i.state,i.error_code,
 i.created_at,i.updated_at,i.run_id,r.status AS run_status,r.error_code AS run_error
 FROM agent_interactions i LEFT JOIN agent_runs r ON r.id=i.run_id
 WHERE i.agent_user_id='c98abda1-d115-4e05-9c2e-43f68119386a' AND i.channel='qq'
 AND i.created_at>now()-interval '24 hours' ORDER BY i.created_at DESC LIMIT 12`
};

export const SNAPSHOT_PROBE=String.raw`
import fs from 'node:fs';import crypto from 'node:crypto';
import {qqSignature} from '/app/apps/api/src/qq-admin-protocol.mjs';
const time=String(Date.now()),id=crypto.randomUUID(),agent=process.env.QQ_ADMIN_AGENT_USER_ID;
const body=JSON.stringify({operation:'status',actorId:agent,agentUserId:agent,args:{}});
try{const secret=fs.readFileSync(process.env.QQ_ADMIN_SECRET_FILE,'utf8').trim();
const r=await fetch('http://127.0.0.1:6780/control',{method:'POST',headers:{'content-type':'application/json','x-qq-time':time,'x-qq-request':id,'x-qq-signature':qqSignature(secret,time,id,body)},body,signal:AbortSignal.timeout(10000)});
const v=await r.json();if(!r.ok)throw Error('READ_FAILED');const d=v.data,s=d.runtime??{};
const keys=['snapshotVersion','ready','available','loggedIn','coreReady','accountMatches','accountState','groupReady','groupState','connected','phase','observation','checkedAt','verifiedAt','probeFailure','transport'];
console.log(JSON.stringify({runtime:Object.fromEntries(keys.filter(k=>s[k]!==undefined).map(k=>[k,s[k]])),executionMode:d.binding?.executionMode,
channelRuntime:d.channelRuntime?{started:d.channelRuntime.started,stopped:d.channelRuntime.stopped,lastFault:d.channelRuntime.lastFault}:null,
paperEnabled:d.paperEnabled,states:d.status?.states,budget:d.status?.budget,
flags:{admin:process.env.QQ_ADMIN_ENABLED==='true',agentBridge:process.env.QQ_AGENT_INTERACTIONS_ENABLED==='true'}}));
}catch{console.log(JSON.stringify({readFailed:true,code:'SNAPSHOT_READ_FAILED'}));}`;

export const GATEWAY_CONFIG_PROBE=String.raw`
import fs from 'node:fs';const out=[];
for(const root of ['/data/napcat/config','/app/napcat/config'])try{
const file=root+'/onebot11_3922489710.json',st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size>1048576)continue;
const v=JSON.parse(fs.readFileSync(file,'utf8'));
out.push({clients:(v.network?.websocketClients??[]).map(c=>{let u;try{u=new URL(c.url);}catch{}
return {enabled:c.enable===true,managed:['mooyu-server','mooyu-admin-managed'].includes(c.name),
workerEndpoint:u?.protocol==='ws:'&&u?.hostname==='worker'&&u?.port==='6700'&&u?.pathname==='/onebot/v11',
messagePostFormat:['array','string'].includes(c.messagePostFormat)?c.messagePostFormat:'unknown',reportSelfMessage:c.reportSelfMessage===true};})});break;
}catch{}console.log(JSON.stringify({fileFound:out.length>0,configuration:out}));`;

export function databaseProbe(kind){
 const queries=kind==='qq'?QQ_ROUTE_SQL:API_ROUTE_SQL;
 return `import {createRequire} from 'node:module';
const {Pool}=createRequire('/app/apps/${kind==='qq'?'qq-channel':'api'}/package.json')('pg');
const pool=new Pool({connectionString:process.env.${kind==='qq'?'QQ_DATABASE_URL':'DATABASE_URL'},max:1,connectionTimeoutMillis:4000,query_timeout:9000,application_name:'qq-route-readonly',options:'-c default_transaction_read_only=on -c statement_timeout=8000 -c lock_timeout=1000'});
const out={},safe=e=>/^[A-Z0-9_]{1,80}$/.test(e.code??'')?e.code:'READ_FAILED';
try{for(const [key,sql] of Object.entries(${JSON.stringify(queries)})){try{out[key]=(await pool.query(sql)).rows;}catch(e){out[key]={readFailed:true,code:safe(e)};}}}
finally{await pool.end();}console.log(JSON.stringify(out));`;
}

const events=new Set(['admission','admission-failed','gateway-connected','gateway-disconnected','gateway-error','worker-waiting','database-error','stopped','listening','control-listening']);
export function summarizeWorkerLogs(raw){
 const summary={};for(const line of raw.split(/\r?\n/u)){
  const match=line.match(/^(\d{4}-\d\d-\d\dT\S+)\s+(\{.*\})$/u);if(!match)continue;
  try{const v=JSON.parse(match[2]);if(!events.has(v.event))continue;
   const code=/^[A-Z0-9_]{1,80}$/u.test(v.code??'')?v.code:null,key=v.event+(code?':'+code:'');
   const row=summary[key]??={count:0,lastAt:null,incidentWindowCount:0};row.count++;row.lastAt=match[1];
   if(Date.parse(match[1])>=Date.parse('2026-11-25T04:55:00Z')&&Date.parse(match[1])<=Date.parse('2026-11-25T05:20:00Z'))row.incidentWindowCount++;
  }catch{}
 }return summary;
}

export function collectRouteReport(run=spawnSync){
 const errors=[],emit=(section,data)=>console.log(JSON.stringify({section,...data}));
 const invoke=args=>{const r=run('docker',args,{encoding:'utf8',timeout:45000,maxBuffer:4*1024*1024});if(r.error||r.status!==0)throw Error('BOUNDED_READ_FAILED');return r.stdout;};
 const section=(name,fn)=>{try{emit(name,fn());}catch{errors.push(name);emit(name,{readFailed:true});}};
 emit('audit',{at:new Date().toISOString(),incidentLocal:'2026-11-25 13:05 Asia/Shanghai',callerSuffix:'9022',scope:'READ_ONLY_MESSAGE_ROUTE'});
 for(const name of ['mooyu-qq-napcat-1','mooyu-qq-worker-1','gamehub-production-api-1','gamehub-production-agent-interactions-1'])section(name,()=>{
  const c=JSON.parse(invoke(['inspect',name]))[0];return {image:c.Image,id:c.Id.slice(0,12),running:c.State.Running,restarting:c.State.Restarting,startedAt:c.State.StartedAt,restarts:c.RestartCount,health:c.State.Health?.Status??null};});
 section('workerSnapshot',()=>JSON.parse(invoke(['exec','mooyu-qq-worker-1','node','--input-type=module','-e',SNAPSHOT_PROBE])));
 section('gatewayEventConfig',()=>JSON.parse(invoke(['exec','mooyu-qq-napcat-1','node','--input-type=module','-e',GATEWAY_CONFIG_PROBE])));
 for(const [kind,container]of [['qq','mooyu-qq-worker-1'],['api','gamehub-production-api-1']])section(kind+'Database',()=>JSON.parse(invoke(['exec',container,'node','--input-type=module','-e',databaseProbe(kind)])));
 section('workerLogSummary',()=>{
  const r=run('docker',['logs','--since','2026-11-25T04:55:00Z','--tail','5000','--timestamps','mooyu-qq-worker-1'],{encoding:'utf8',timeout:20000,maxBuffer:8*1024*1024});
  if(r.status!==0||r.error)throw Error('LOG_READ_FAILED');return {boundedToLastLines:5000,counts:summarizeWorkerLogs(String(r.stdout??'')+'\n'+String(r.stderr??''))};});
 section('observationUpdateReceipt',()=>{
  const stage='/www/backup/gamehub/qq-observation-release-20261125-r1',index=stage+'/last-operation.private.json';if(!fs.existsSync(index))return {indexPresent:false};
  const read=p=>{const st=fs.lstatSync(p);if(!st.isFile()||st.isSymbolicLink()||st.size>1048576)throw Error('RECORD_INVALID');return JSON.parse(fs.readFileSync(p,'utf8'));};
  const i=read(index);if(!/^\/www\/backup\/gamehub\/qq-observation-operation-20261125-[A-Za-z0-9]+$/u.test(i.record??''))throw Error('RECORD_INVALID');
  const p=i.record+'/result.private.json';if(!fs.existsSync(p))return {indexPresent:true,resultPresent:false};const v=read(p);
  return {indexPresent:true,resultPresent:true,result:/^[A-Z0-9_]{1,100}$/u.test(v.result??'')?v.result:'unknown'};
 });
 emit('readOnlyEnd',{errors,newNapcatManagementClients:0,qqLoginRequested:false,qrRequested:false,configurationWritten:false,servicesRestarted:false,oldTasksRetried:false,messagesSent:false,rawMessagesLogsAndCredentialsPrinted:false});
 return errors;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){if(collectRouteReport().length)process.exitCode=1;}
