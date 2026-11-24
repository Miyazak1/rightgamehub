import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
const code=String.raw`
import {createRequire} from 'node:module';const {Pool}=createRequire('/app/apps/api/package.json')('pg');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000,options:'-c default_transaction_read_only=on -c statement_timeout=8000 -c lock_timeout=1000'});
const agent='c98abda1-d115-4e05-9c2e-43f68119386a';
const safe=v=>typeof v==='string'&&/^AGENT_[A-Z0-9_]+(?: \[\$(?:\.[A-Za-z]+|\[\d+\])*:[a-z_0-9]+\])?$/.test(v)?v:v==null?null:'DETAIL_REDACTED';
const topic=s=>/MOOYU_QA_SELECTOR/.test(s)?'10-marker':/至少\s*1000/.test(s)&&/不超过\s*100/.test(s)?'9-conflict':/依赖许可证/.test(s)?'8-license-checker':/语音识别/.test(s)?'7-speech-memory':/模型权重|权重许可/.test(s)?'6-model-license':/SQLite/.test(s)?'5-sqlite-created':/命令行备份/.test(s)?'4-backup-release':/Markdown/.test(s)?'3-rust-stars':/工作流引擎/.test(s)?'2-offline-workflow':/CSS\s*selector/i.test(s)?'1-selector':'other';
let client;
try{
 client=await pool.connect();await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const tasks=(await client.query("SELECT i.id,i.state,i.error_code,i.run_id,i.created_at,i.attempts,i.input_json->>'userRequest' AS request,r.status AS run_status,r.error_code AS run_error FROM agent_interactions i LEFT JOIN agent_runs r ON r.id=i.run_id WHERE i.agent_user_id=$1 AND i.channel='qq' AND i.origin_json->>'groupId'='905757031' AND i.kind='github-search' AND i.created_at >= '2026-11-24T00:00:00Z'::timestamptz ORDER BY i.created_at DESC,i.id DESC LIMIT 20",[agent])).rows;
 const ids=tasks.map(t=>t.run_id).filter(Boolean);
 const stages=ids.length?(await client.query("SELECT s.run_id,s.stage_key,s.status,s.error_code,p.status AS provider_status,p.error_code AS provider_error,p.error_message AS provider_detail,p.response_schema_key,p.response_ref_json->>'finishReason' AS finish_reason,p.token_ceiling FROM agent_run_stages s LEFT JOIN agent_run_actions a ON a.run_id=s.run_id AND a.stage_id=s.id LEFT JOIN agent_provider_calls p ON p.action_id=a.id WHERE s.run_id=ANY($1::uuid[]) ORDER BY s.run_id,s.stage_key,a.created_at",[ids])).rows:[];
 const plans=ids.length?(await client.query("SELECT run_id,content_json->'criteria' AS criteria,content_json->'responseRequirements' AS responses FROM agent_runtime_stage_artifacts WHERE run_id=ANY($1::uuid[]) AND artifact_key='agent.github.search-plan'",[ids])).rows:[];
 console.log('BATCH_TASK_COUNT '+tasks.length);
 for(const t of tasks){
  const p=plans.find(p=>p.run_id===t.run_id);
  console.log('TASK '+JSON.stringify({topic:topic(t.request??''),id:t.id,createdAt:t.created_at,state:t.state,error:safe(t.error_code),run:t.run_id,runStatus:t.run_status,runError:safe(t.run_error),attempts:t.attempts,stages:stages.filter(s=>s.run_id===t.run_id).map(s=>({stage:s.stage_key,status:s.status,error:safe(s.error_code),providerStatus:s.provider_status,providerError:safe(s.provider_error),validation:safe(s.provider_detail),schema:s.response_schema_key,finish:['stop','length','content_filter','tool_calls'].includes(s.finish_reason)?s.finish_reason:null,tokenCeiling:s.token_ceiling})),plan:p?{criteria:Array.isArray(p.criteria)?p.criteria.map(c=>({id:c.id,kind:c.kind,requirement:c.requirement})):null,responses:Array.isArray(p.responses)?p.responses.map(r=>({id:r.id,kind:r.kind})):[]}:null}));
 }
 await client.query('ROLLBACK');console.log('READONLY_COMPLETE '+JSON.stringify({readOnly:true,tasksRetried:false,providerCalled:false,eventsDispatched:false,permissionsOrBudgetsChanged:false,serverFilesWritten:false,servicesRestarted:false,loginDataTouched:false}));
}catch(e){if(client)await client.query('ROLLBACK').catch(()=>{});console.log('READONLY_FAILED '+JSON.stringify({code:/^[A-Z0-9_]+$/.test(e.code??'')?e.code:'READ_FAILED'}));process.exitCode=1;}finally{client?.release();await pool.end();}
`;
const out=process.argv[2];if(!out||!path.resolve(out).toLowerCase().startsWith('e:\\codexdata\\build\\right\\agent-server-preflight\\')||fs.existsSync(out))throw Error('NEW_BUILD_DIRECTORY_REQUIRED');
if(spawnSync(process.execPath,['--input-type=module','--check'],{input:code,encoding:'utf8'}).status!==0)throw Error('NODE_SYNTAX_FAILED');
const shell="docker exec -i gamehub-production-api-1 node --input-type=module <<'NODE'\n"+code+"\nNODE\n";
if(spawnSync('C:\\Program Files\\Git\\bin\\bash.exe',['-n'],{input:shell,encoding:'utf8'}).status!==0)throw Error('BASH_SYNTAX_FAILED');
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'server-github-batch-readonly.txt'),shell);console.log(path.join(out,'server-github-batch-readonly.txt'));
