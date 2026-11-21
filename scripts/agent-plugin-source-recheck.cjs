// Local, read-only source recheck acceptance; credentials remain in the private session.
const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),{Pool}=createRequire(path.join(root,'apps/api/package.json'))('pg');
const load=f=>import(pathToFileURL(path.join(root,'apps/api/src',f)).href);
async function main(){
 const s=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),operation=process.argv[3],u=new URL(s.databaseUrl);
 if(!s.pluginAcceptance||u.hostname!=='127.0.0.1'||u.username!=='qa_ledger_test'||!/^\/qa_ledger_test_[a-f0-9]{32}$/.test(u.pathname))throw Error('LOCAL_TEST_REQUIRED');
 const pool=new Pool({connectionString:u.href});u.pathname='/'+s.qqDatabase;const qq=new Pool({connectionString:u.href});
 const baselineFile=path.join(s.privateRoot,'source-recheck-before.private.json'),plain=v=>JSON.parse(JSON.stringify(v));
 const {stableHash}=await load('researcher-qa-protocol/stable-json.mjs'),hash=v=>stableHash(plain(v));
 try{
  const interactions=(await pool.query('SELECT id,parent_id,kind,state,input_json,result_json,input_sha256,origin_json,run_id FROM agent_interactions ORDER BY id')).rows;
  const messages=(await qq.query('SELECT * FROM mooyu_qq.messages ORDER BY channel_id,message_id')).rows;
  const schedule=(await pool.query("SELECT id,workflow_key,workflow_version,timezone,schedule_spec_json,enabled,next_fire_at,last_fire_at,config_json-'worker' AS config FROM agent_schedules WHERE agent_user_id=$1 ORDER BY id",[s.agentId])).rows;
  const settings=(await pool.query('SELECT * FROM agent_blog_automation_settings WHERE agent_user_id=$1',[s.agentId])).rows;
  const articles=(await pool.query('SELECT id,publication_state FROM blog_articles WHERE author_user_id=$1 ORDER BY id',[s.agentId])).rows;
  const paperRuns=(await pool.query("SELECT count(*)::int AS n FROM agent_runs WHERE agent_user_id=$1 AND workflow_key LIKE 'paper.%'",[s.agentId])).rows[0].n;
  const calls=Number((await pool.query('SELECT sum(charged_provider_calls) AS n FROM agent_budget_reservations WHERE agent_user_id=$1',[s.agentId])).rows[0].n);
  if(operation==='--baseline'){
   if(interactions.some(r=>['running','queued','waiting'].includes(r.state)))throw Error('LOCAL_TEST_BUSY');
   fs.writeFileSync(baselineFile,JSON.stringify({at:new Date().toISOString(),interactions,messages,schedule,settings,articles,paperRuns,calls}),{flag:'wx',mode:0o600});
   console.log(JSON.stringify({baselineSaved:true,interactions:interactions.length,messages:messages.length,calls,scheduleEnabled:schedule.map(r=>r.enabled),paperRuns}));return;
  }
  if(!['--status','--verify'].includes(operation))throw Error('UNKNOWN_LOCAL_OPERATION');
  const before=JSON.parse(fs.readFileSync(baselineFile,'utf8')),prior=JSON.parse(fs.readFileSync(path.join(s.evidence,'plugin-live-acceptance.json'),'utf8'));
  const first=JSON.parse(fs.readFileSync(path.join(s.privateRoot,'baseline.private.json'),'utf8'));
  const earlierIds=new Set([...first.interactions,...prior.newInteractions].map(r=>r.id));
  const added=interactions.filter(r=>!earlierIds.has(r.id));
  const tasks=added.filter(r=>r.kind==='github-question'),details=[];
  for(const task of tasks){
   const parent=interactions.find(r=>r.id===task.parent_id);
   const artifacts=(await pool.query('SELECT artifact_key,content_json,source_tool_artifact_ids FROM agent_runtime_stage_artifacts WHERE run_id=$1 ORDER BY created_at',[task.run_id])).rows;
   const toolCalls=(await pool.query('SELECT action.action_key,call.tool_key,call.status,call.error_code,action.request_json FROM agent_tool_calls call JOIN agent_run_actions action ON action.id=call.action_id WHERE action.run_id=$1 ORDER BY call.created_at',[task.run_id])).rows;
   const link=(await qq.query('SELECT message_id,task_settled FROM mooyu_qq.agent_links WHERE task_id=$1',[task.id])).rows[0];
   const deliveries=link?(await qq.query('SELECT d.message_id,m.status,m.remote_message_id FROM mooyu_qq.agent_deliveries d JOIN mooyu_qq.messages m USING(channel_id,message_id) WHERE d.source_message_id=$1',[link.message_id])).rows:[];
   const evidence=artifacts.find(a=>a.artifact_key==='agent.github.question-evidence')?.content_json;
   const extended=artifacts.find(a=>a.artifact_key==='agent.github.question-extended')?.content_json;
   const refinement=artifacts.find(a=>a.artifact_key==='agent.github.question-refine');
   details.push({id:task.id,parentId:task.parent_id,state:task.state,plugin:task.input_json.plugin,repository:task.input_json.repositoryUrl,inputRevision:task.input_json.revision,previousPresent:!!task.input_json.previous,parentMessage:parent?.input_json.message,noRepositoryLink:!parent?.input_json.message.includes('https://github.com/'),runId:task.run_id,revision:task.result_json?.repository?.revision,reply:task.result_json?.reply,toolCalls,initialSources:evidence?.sources?.map(({path,fromLine,toLine})=>({path,fromLine,toLine})),refinePlan:refinement?.content_json,extendedSources:extended?.sources?.map(({path,fromLine,toLine})=>({path,fromLine,toLine})),extendedSourceToolArtifactIds:artifacts.find(a=>a.artifact_key==='agent.github.question-extended')?.source_tool_artifact_ids,deliveries,taskSettled:link?.task_settled});
  }
  const earlierAcceptancePreserved=prior.newInteractions.every(a=>interactions.some(b=>b.id===a.id&&a.kind===b.kind&&a.state===b.state&&a.reply===b.result_json?.reply&&a.runId===b.run_id&&hash(a.plugin??null)===hash(b.input_json.plugin??null)))&&prior.qqMessages.every(a=>messages.some(b=>b.message_id===a.messageId&&b.status===a.status&&b.remote_message_id===a.remoteMessageId));
  const report={at:new Date().toISOString(),earlierAcceptancePreserved,snapshotCapturedAfterTask:tasks.some(t=>before.interactions.some(b=>b.id===t.id)),originalInteractionsPreserved:before.interactions.every(a=>interactions.some(b=>b.id===a.id&&hash(a)===hash(b))),originalQQMessagesPreserved:before.messages.every(a=>messages.some(b=>b.channel_id===a.channel_id&&b.message_id===a.message_id&&hash(a)===hash(b))),schedulePreserved:hash(before.schedule)===hash(schedule),settingsPreserved:hash(before.settings)===hash(settings),articlesPreserved:hash(before.articles)===hash(articles),paperRunsUnchanged:before.paperRuns===paperRuns,callsAtSnapshot:before.calls,callsAtPriorAcceptance:prior.budget.reduce((n,r)=>n+r.calls,0),callsNow:calls,newInteractions:added.map(r=>({id:r.id,kind:r.kind,state:r.state,reply:r.result_json?.reply})),tasks:details,productionConnected:false,paperEnabled:false};
  fs.writeFileSync(path.join(s.evidence,'source-recheck-status.json'),JSON.stringify(report,null,2));
  report.priorArticlesPreserved=hash(prior.articles)===hash(articles);
  if(!report.earlierAcceptancePreserved||!report.originalInteractionsPreserved||!report.originalQQMessagesPreserved||!report.schedulePreserved||!report.settingsPreserved||!report.articlesPreserved||!report.priorArticlesPreserved||!report.paperRunsUnchanged)throw Error('SOURCE_RECHECK_PRESERVATION_FAILED');
  if(operation==='--verify'){
   const complete=details.find(t=>t.state==='completed'&&t.plugin?.id==='mooyu.github'&&t.plugin.version==='1.0.0'&&t.noRepositoryLink&&t.revision&&t.toolCalls.some(c=>c.tool_key==='research.github.code.read'&&c.status==='succeeded'&&c.request_json?.input?.operation==='file')&&t.refinePlan?.files?.length&&t.toolCalls.some(c=>c.action_key.startsWith('extend-file-')&&c.status==='succeeded')&&t.extendedSourceToolArtifactIds?.length&&t.taskSettled&&t.deliveries.length===1&&t.deliveries[0].status==='delivered');
   if(!complete)throw Error('REAL_QQ_SOURCE_RECHECK_INCOMPLETE');
   report.result='PASSED';report.verifiedTaskId=complete.id;fs.writeFileSync(path.join(s.evidence,'source-recheck-acceptance.json'),JSON.stringify(report,null,2));
  }
  console.log(JSON.stringify(report));
 }finally{await pool.end();await qq.end();}
}
main().catch(e=>{console.error(JSON.stringify({code:/^[A-Z0-9_]+$/.test(e.code??'')?e.code:/^[A-Z0-9_]+$/.test(e.message??'')?e.message:'SOURCE_RECHECK_FAILED'}));process.exitCode=1;});
