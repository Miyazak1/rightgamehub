// Read-only task failure attribution. No retry, protocol rewrite or model calls.
import {spawnSync} from 'node:child_process';
const code=String.raw`
import {createRequire} from 'node:module';const {Pool}=createRequire('/app/apps/api/package.json')('pg');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000,options:'-c default_transaction_read_only=on -c statement_timeout=8000 -c lock_timeout=1000'}),c=await pool.connect();
const agent='c98abda1-d115-4e05-9c2e-43f68119386a';
try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
const tasks=(await c.query("SELECT id,parent_id,kind,state,error_code,run_id,attempts,created_at,updated_at,(coalesce(input_json->>'message',input_json->>'topic','') ~* '(生图|图像|image|diffusion)') AS image_model_topic FROM agent_interactions WHERE agent_user_id=$1 AND channel='qq' AND origin_json->>'groupId'='905757031' AND created_at>now()-interval '24 hours' ORDER BY created_at DESC,id DESC LIMIT 8",[agent])).rows;
console.log('recentQQTasks '+JSON.stringify(tasks));
const schedulers=(await c.query("SELECT workflow_key,enabled,config_json#>>'{worker,state}' AS worker_state,config_json#>>'{worker,interactionProtocolVersion}' AS interaction_protocol,config_json#>>'{worker,heartbeatAt}' AS heartbeat_at,next_fire_at FROM agent_schedules WHERE agent_user_id=$1 AND workflow_key='blog.project.discovery-shadow'",[agent])).rows;
console.log('schedulerProtocol '+JSON.stringify(schedulers));
const stages=(await c.query("SELECT i.id AS interaction_id,s.stage_key,s.status,s.error_code FROM agent_interactions i JOIN agent_run_stages s ON s.run_id=i.run_id WHERE i.agent_user_id=$1 AND i.channel='qq' AND i.origin_json->>'groupId'='905757031' AND i.state IN ('failed','needs-review','waiting') AND i.created_at>now()-interval '24 hours' ORDER BY i.created_at DESC,s.stage_key LIMIT 12",[agent])).rows;
console.log('failedTaskStages '+JSON.stringify(stages));
const grants=(await c.query("SELECT capability_key,contract_version,status FROM agent_capability_grants WHERE agent_user_id=$1 AND capability_key IN ('research.github.discover','research.github.read','provider.text.generate','blog.article.draft') ORDER BY capability_key,contract_version",[agent])).rows;
console.log('existingCapabilityGrants '+JSON.stringify(grants));
await c.query('ROLLBACK');console.log('DIAGNOSTIC '+JSON.stringify({readOnly:true,taskRetried:false,schedulerProtocolModified:false,permissionsOrBudgetsChanged:false,loginDataTouched:false}));
}catch(e){await c.query('ROLLBACK').catch(()=>{});console.log('DIAGNOSTIC '+JSON.stringify({readFailed:true,code:/^[A-Z0-9_]{1,80}$/.test(e.code??'')?e.code:'READ_FAILED'}));process.exitCode=1;}finally{c.release();await pool.end();}
`;
const r=spawnSync('docker',['exec','gamehub-production-api-1','node','--input-type=module','-e',code],{encoding:'utf8',timeout:50000,maxBuffer:2*1024*1024});
if(r.status!==0){console.log(r.stdout?.trim()||JSON.stringify({result:'READONLY_FAILURE_DIAGNOSTIC_UNAVAILABLE'}));process.exitCode=1;}else console.log(r.stdout.trim());
