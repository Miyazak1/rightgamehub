// Operator-only local acceptance helper. Never reads .env or connects to production.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),{createRequire}=require('node:module'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),load=f=>import(pathToFileURL(path.join(root,'apps/api/src',f)).href),{Pool}=createRequire(path.join(root,'apps/api/package.json'))('pg');
const file=path.resolve(process.argv[2]??''),operation=process.argv[3];
function requireLocal(s){const u=new URL(s.databaseUrl);if(s.schemaVersion!=='agent-interaction-lab-v1'||!s.privateRoot.includes('private-deployments')||u.hostname!=='127.0.0.1'||u.username!=='qa_ledger_test'||!/^\/qa_ledger_test_[a-f0-9]{32}$/.test(u.pathname))throw Error('LOCAL_TEST_DATABASE_REQUIRED');return u;}
function docker(args,options={}){const r=cp.spawnSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:2000000,...options});if(r.status!==0)throw Error('LOCAL_DOCKER_'+args[0].toUpperCase()+'_FAILED');return r.stdout?.trim();}
async function snapshot(s){
 const pool=new Pool({connectionString:s.databaseUrl}),u=requireLocal(s);u.pathname='/'+s.qqDatabase;const qq=new Pool({connectionString:u.href});
 try{return {at:new Date().toISOString(),interactions:(await pool.query('SELECT id,kind,state,input_sha256,input_json,origin_json,result_json,run_id FROM agent_interactions ORDER BY id')).rows,qqMessages:(await qq.query('SELECT * FROM mooyu_qq.messages ORDER BY channel_id,message_id')).rows,budget:(await pool.query('SELECT status,sum(charged_provider_calls)::int AS calls,sum(charged_cost_microusd)::bigint AS cost FROM agent_budget_reservations GROUP BY status')).rows,policy:(await pool.query("SELECT profile.version,profile.policy_json FROM agent_policy_profile_assignments assignment JOIN agent_policy_profiles profile ON profile.id=assignment.active_policy_profile_id WHERE assignment.agent_user_id=$1",[s.agentId])).rows[0],articles:(await pool.query('SELECT id,publication_state FROM blog_articles WHERE author_user_id=$1 ORDER BY id',[s.agentId])).rows,paperRuns:(await pool.query("SELECT count(*)::int AS n FROM agent_runs WHERE agent_user_id=$1 AND workflow_key LIKE 'paper.%'",[s.agentId])).rows[0].n};}finally{await pool.end();await qq.end();}
}
async function main(){
 const s=JSON.parse(fs.readFileSync(file,'utf8'));requireLocal(s);
 if(operation==='--prepare'){
  if(s.pluginAcceptance)throw Error('ORIGINAL_SESSION_REQUIRED');
  const branch=cp.spawnSync('git',['branch','--show-current'],{cwd:root,encoding:'utf8',windowsHide:true}).stdout.trim();if(branch!=='codex/agent-plugin-github')throw Error('PLUGIN_BRANCH_REQUIRED');
  const before=await snapshot(s);if(before.interactions.some(r=>['running','queued','waiting'].includes(r.state))||before.qqMessages.some(r=>!['delivered','failed','uncertain'].includes(r.status)))throw Error('LOCAL_TEST_TASKS_BUSY');
  const stamp=new Date().toISOString().replace(/[^0-9]/g,''),privateRoot=path.join(root,'..','..','private-deployments','agent-plugin-acceptance',stamp),evidence=path.join('E:\\CodexData\\build\\Right\\agent-plugin-github','live',stamp);
  fs.mkdirSync(privateRoot,{recursive:true,mode:0o700});fs.mkdirSync(evidence,{recursive:true});
  const names=[s.name+'-db',s.oldStack.gateway,s.qqWorker,s.oldStack.worker,s.oldStack.db],containers=names.map(n=>JSON.parse(docker(['inspect',n]))[0]);
  if(containers[0].Config.Labels['mooyu.agent-lab']!==s.id||!containers[0].Mounts.some(m=>m.Type==='volume'&&m.Name===s.volume))throw Error('LOCAL_TEST_CONTAINER_IDENTITY_REQUIRED');
  fs.writeFileSync(path.join(privateRoot,'containers-before.private.json'),JSON.stringify(containers),{flag:'wx',mode:0o600});
  for(const database of [new URL(s.databaseUrl).pathname.slice(1),s.qqDatabase]){
   const target=path.join(privateRoot,database+'.dump'),fd=fs.openSync(target,'wx',0o600);try{docker(['exec',s.name+'-db','pg_dump','-U','qa_ledger_test','-d',database,'-Fc'],{encoding:null,stdio:['ignore',fd,'pipe']});}finally{fs.closeSync(fd);}
   if(fs.statSync(target).size<100)throw Error('LOCAL_BACKUP_EMPTY');
  }
  fs.writeFileSync(path.join(privateRoot,'baseline.private.json'),JSON.stringify(before),{flag:'wx',mode:0o600});
  const next={...s,privateRoot,evidence,pluginAcceptance:true,originalSession:file,runtimeCommit:cp.spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).stdout.trim(),providerCallLimit:48,costMicrousdLimit:8000000};
  const newFile=path.join(privateRoot,'session.private.json');fs.writeFileSync(newFile,JSON.stringify(next,null,2),{flag:'wx',mode:0o600});
  const pool=new Pool({connectionString:s.databaseUrl}),c=await pool.connect();try{
   await c.query('BEGIN');const prior=before.policy,policy={...prior.policy_json,budgets:{...prior.policy_json.budgets,agentMonthly:{...prior.policy_json.budgets.agentMonthly,providerCalls:48,costMicrousd:8000000}}};
   const id=crypto.randomUUID();await c.query("INSERT INTO agent_policy_profiles(id,agent_user_id,version,schema_version,policy_json,policy_sha256,created_by_user_id) VALUES($1,$2,$3,'agent-policy-v1',$4,$5,$6)",[id,s.agentId,prior.version+1,JSON.stringify(policy),(await load('researcher-qa-protocol/stable-json.mjs')).stableHash(policy),s.operatorId]);
   const changed=await c.query('UPDATE agent_policy_profile_assignments SET active_policy_profile_id=$2,updated_by_user_id=$3 WHERE agent_user_id=$1 AND active_policy_profile_id=(SELECT id FROM agent_policy_profiles WHERE agent_user_id=$1 AND version=$4)',[s.agentId,id,s.operatorId,prior.version]);if(changed.rowCount!==1)throw Error('LOCAL_POLICY_CHANGED');await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();await pool.end();}
  const report={at:before.at,session:newFile,evidence,branch,baselineInteractions:before.interactions.length,baselineQQMessages:before.qqMessages.length,budgetBefore:before.budget,limitsBefore:before.policy.policy_json.budgets.agentMonthly,limitsAfter:{providerCalls:48,costMicrousd:8000000},countersReset:false,backupsCreated:true,productionConnected:false,paperEnabled:false};fs.writeFileSync(path.join(evidence,'prepared.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));return;
 }
 if(!s.pluginAcceptance)throw Error('PLUGIN_ACCEPTANCE_SESSION_REQUIRED');
 if(operation==='--status'||operation==='--verify'){
  const current=await snapshot(s),baseline=JSON.parse(fs.readFileSync(path.join(s.privateRoot,'baseline.private.json'),'utf8')),{stableHash}=await load('researcher-qa-protocol/stable-json.mjs');
  const originalRowsPreserved=baseline.interactions.every(a=>current.interactions.some(b=>b.id===a.id&&stableHash(JSON.parse(JSON.stringify(a)))===stableHash(JSON.parse(JSON.stringify(b))))),qqHistoryPreserved=baseline.qqMessages.every(a=>current.qqMessages.some(b=>b.channel_id===a.channel_id&&b.message_id===a.message_id&&stableHash(JSON.parse(JSON.stringify(a)))===stableHash(JSON.parse(JSON.stringify(b)))));
  const pool=new Pool({connectionString:s.databaseUrl});try{
   const added=(await pool.query('SELECT id,parent_id,kind,state,input_json,result_json,error_code,run_id FROM agent_interactions WHERE NOT(id=ANY($1::uuid[])) ORDER BY created_at',[baseline.interactions.map(r=>r.id)])).rows;
   const report={at:current.at,originalRowsPreserved,qqHistoryPreserved,paperRunsUnchanged:current.paperRuns===baseline.paperRuns,budget:current.budget,articles:current.articles,newInteractions:added.map(r=>({id:r.id,parentId:r.parent_id,kind:r.kind,state:r.state,plugin:r.input_json.plugin,topic:r.input_json.topic,repositoryUrl:r.input_json.repositoryUrl,revision:r.input_json.revision,previousPresent:!!r.input_json.previous,errorCode:r.error_code,runId:r.run_id,reply:r.result_json?.reply,repository:r.result_json?.repository})),qqMessages:current.qqMessages.filter(r=>!baseline.qqMessages.some(b=>b.channel_id===r.channel_id&&b.message_id===r.message_id)).map(r=>({id:r.id,messageId:r.message_id,status:r.status,errorCode:r.error_code,remoteMessageId:r.remote_message_id})),productionConnected:false,paperEnabled:false};
   const containersBefore=JSON.parse(fs.readFileSync(path.join(s.privateRoot,'containers-before.private.json'),'utf8'));
   report.containersPreserved=containersBefore.every(before=>{const now=JSON.parse(docker(['inspect',before.Name.slice(1)]))[0];return before.Image===now.Image&&before.State.StartedAt===now.State.StartedAt&&stableHash([...before.Mounts].sort((a,b)=>a.Destination.localeCompare(b.Destination)))===stableHash([...now.Mounts].sort((a,b)=>a.Destination.localeCompare(b.Destination)));});
   fs.writeFileSync(path.join(s.evidence,'plugin-live-status.json'),JSON.stringify(report,null,2));if(!originalRowsPreserved||!qqHistoryPreserved||!report.paperRunsUnchanged||!report.containersPreserved)throw Error('LOCAL_PRESERVATION_FAILED');
   if(operation==='--verify'){
    const tasks=added.filter(r=>r.kind!=='message'),questions=tasks.filter(r=>r.kind==='github-question');
    if(!['github-search','github-question','github-article'].every(kind=>tasks.some(r=>r.kind===kind&&r.state==='completed'))||tasks.some(r=>r.state!=='completed'||r.input_json.plugin?.id!=='mooyu.github'||r.input_json.plugin.version!=='1.0.0'))throw Error('REAL_QQ_PLUGIN_ACCEPTANCE_INCOMPLETE');
    const repeatedQuestion=questions.find(r=>r.input_json.previous&&r.input_json.revision);
    const source=questions.find(r=>r.result_json?.repository?.revision),naturalFollowUp=source&&added.find(r=>r.kind==='message'&&r.state==='completed'&&!tasks.some(t=>t.parent_id===r.id)&&!r.input_json.message.includes('https://github.com/')&&/unique|optimize/u.test(r.input_json.message)&&r.result_json?.reply?.includes(source.result_json.repository.revision));
    const history=naturalFollowUp?(await pool.query('SELECT input_json FROM agent_runs WHERE id=$1',[naturalFollowUp.run_id])).rows[0]?.input_json?.history:[];
    if(!repeatedQuestion&&(!naturalFollowUp||!history.some(item=>item.requestId===source.id&&item.content===source.result_json.reply)))throw Error('REAL_QQ_FOLLOWUP_INCOMPLETE');
    report.followUp=repeatedQuestion?{mode:'plugin-task',id:repeatedQuestion.id,revision:repeatedQuestion.input_json.revision}:{mode:'conversation-history',id:naturalFollowUp.id,sourceTaskId:source.id,revision:source.result_json.repository.revision,historyContainsSource:true,newPluginReadVerified:false};
    const newArticles=current.articles.filter(a=>!baseline.articles.some(b=>b.id===a.id));
    if(newArticles.length!==1||newArticles[0].publication_state!=='draft'||report.qqMessages.length!==tasks.length+added.filter(r=>r.kind==='message').length||report.qqMessages.some(r=>r.status!=='delivered')||new Set(report.qqMessages.map(r=>r.remoteMessageId)).size!==report.qqMessages.length)throw Error('REAL_QQ_PLUGIN_DELIVERY_INCOMPLETE');
    report.result='PASSED';fs.writeFileSync(path.join(s.evidence,'plugin-live-acceptance.json'),JSON.stringify(report,null,2));
   }
   console.log(JSON.stringify(report));
  }finally{await pool.end();}return;
 }
 throw Error('UNKNOWN_LOCAL_OPERATION');
}
main().catch(e=>{console.error(JSON.stringify({code:/^[A-Z0-9_]+$/.test(e.code??'')?e.code:/^[A-Z0-9_]+$/.test(e.message??'')?e.message:'PLUGIN_LIVE_CHECK_FAILED'}));process.exitCode=1;});
