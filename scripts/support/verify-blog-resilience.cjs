const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs/promises'),path=require('node:path');
const {spawn}=require('node:child_process');
module.exports=async function(state,{token,directory,progress}){
  const {admin,account,config,masterKey,result:first}=state;
  const history=(await admin.query('SELECT id,payload_json FROM agent_editorial_memory_events WHERE agent_user_id=$1 ORDER BY id',[account.agentUserId])).rows;
  const env={...process.env,DATABASE_URL:process.env.QA_LEDGER_TEST_URL,
    AGENT_SECRET_ENCRYPTION_KEY:masterKey,AGENT_GITHUB_RESEARCH_TOKEN:token,
    AGENT_BLOG_PUBLIC_RUNTIME_ENABLED:'true',AGENT_BLOG_PUBLIC_RUNTIME_AGENT_USER_ID:account.agentUserId,
    AGENT_BLOG_PUBLIC_RUNTIME_MODEL_ID:config.modelId,AGENT_BLOG_PUBLIC_RUNTIME_DAILY_RUN_LIMIT:'4'};
  const rows=[];
  async function run(requestId,scenario,label){
    const resultPath=path.join(directory,label+'.json');
    const handle=await fs.open(path.join(directory,label+'.log'),'w');
    try{
      const code=await new Promise((resolve,reject)=>{
        const child=spawn(process.execPath,['scripts/support/blog-resilience-child.mjs'],{windowsHide:true,
          stdio:['ignore',handle.fd,handle.fd],timeout:900000,env:{...env,MOOYU_TEST_REQUEST_ID:requestId,
            MOOYU_FAULT_SCENARIO:scenario,MOOYU_TEST_RESULT:resultPath}});
        child.once('error',reject);child.once('exit',value=>resolve(value));
      });
      let output=null;try{output=JSON.parse(await fs.readFile(resultPath,'utf8'));}catch{}
      return {code,output};
    }finally{await handle.close();}
  }
  for(const scenario of ['network','exit','database']){
    const requestId=crypto.randomUUID();await progress({event:'fault-start',scenario});
    const interrupted=await run(requestId,scenario,scenario+'-first');
    if(scenario==='network'){
      assert.equal(interrupted.code,0,'network fault must retry within the durable budget');
      assert.equal(interrupted.output.injected,true);
    }else{
      assert.equal(interrupted.code,scenario==='exit'?86:87);
      // Simulate elapsed downtime without modifying immutable inputs/results.
      // Only owner lease timestamps are expired; the real recovery queries run.
      await admin.query(`UPDATE agent_run_stages stage SET lease_until=now()-interval '1 second'
        FROM agent_runs run WHERE stage.run_id=run.id AND run.agent_user_id=$1
          AND stage.status IN ('leased','running')`,[account.agentUserId]);
      await admin.query(`UPDATE agent_blog_public_requests SET lease_until=now()-interval '1 second',next_attempt_at=now()
        WHERE agent_user_id=$1 AND request_id=$2 AND status='running'`,[account.agentUserId,requestId]);
      await admin.query(`UPDATE agent_blog_public_requests SET next_attempt_at=now()
        WHERE agent_user_id=$1 AND request_id=$2 AND status='waiting'`,[account.agentUserId,requestId]);
      const resumed=await run(requestId,'none',scenario+'-resume');
      assert.equal(resumed.code,0,'same request must resume after '+scenario);
    }
    const calls=async()=>Number((await admin.query(`SELECT count(*)::int AS n FROM agent_provider_calls call
      JOIN agent_run_actions action ON action.id=call.action_id JOIN agent_runs run ON run.id=action.run_id
      WHERE run.agent_user_id=$1`,[account.agentUserId])).rows[0].n);
    const before=await calls();
    const replay=await run(requestId,'none',scenario+'-replay');assert.equal(replay.code,0);
    assert.equal(await calls(),before);
    const runId=replay.output.result.publication.runId;
    const receipts=(await admin.query('SELECT article_id FROM agent_blog_foundation_publications WHERE run_id=$1',[runId])).rows;
    assert.equal(receipts.length,1);
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM blog_article_events WHERE article_id=$1 AND action='published'",[receipts[0].article_id])).rows[0].n,1);
    rows.push({scenario,requestId,runId,receipts:1,replayCalls:0});
    await progress({event:'fault-complete',scenario,runId});
  }
  const retained=(await admin.query('SELECT id,payload_json FROM agent_editorial_memory_events WHERE agent_user_id=$1 AND id=ANY($2::uuid[]) ORDER BY id',[account.agentUserId,history.map(row=>row.id)])).rows;
  assert.deepEqual(retained,history);
  assert.equal((await admin.query("SELECT count(*)::int AS n FROM agent_runs WHERE agent_user_id=$1 AND workflow_key LIKE 'paper.%'",[account.agentUserId])).rows[0].n,0);
  await progress({event:'daemon-fault-start'});
  const {PostgresAgentBlogPublicScheduleRepository}=await import('../../apps/api/src/agent-blog-public-schedule.mjs');
  await new PostgresAgentBlogPublicScheduleRepository(admin).ensureDaily({agentUserId:account.agentUserId,enabled:true});
  const circuitOpen=()=>admin.query(`UPDATE agent_provider_circuits SET state='open',retry_at=now()+interval '1 hour',
    probe_lease_token=NULL,probe_lease_until=NULL WHERE provider='deepseek' AND model_id=$1`,[config.modelId]);
  const circuitClose=()=>admin.query(`UPDATE agent_provider_circuits SET state='closed',retry_at=NULL,
    probe_lease_token=NULL,probe_lease_until=NULL WHERE provider='deepseek' AND model_id=$1`,[config.modelId]);
  await circuitOpen();
  const handle=await fs.open(path.join(directory,'daemon.log'),'w');
  const child=spawn(process.execPath,['apps/api/src/agent-blog-public-schedule-worker-cli.mjs'],{windowsHide:true,
    stdio:['ignore',handle.fd,handle.fd],env:{...env,AGENT_BLOG_PUBLIC_SCHEDULE_ENABLED:'true',AGENT_BLOG_PUBLIC_SCHEDULE_POLL_MS:'1000'}});
  let exited=false;const exit=new Promise(resolve=>child.once('exit',code=>{exited=true;resolve(code);}));
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  try{
    await pause(2500);assert.equal(exited,false,'temporary provider blocker must not kill the scheduler');
    await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='gamehub-agent-blog-public-scheduler'");
    await pause(2000);assert.equal(exited,false,'database socket failure must not kill the scheduler');
    await circuitClose();
    await pause(2500);assert.equal(exited,false);
    const log=await fs.readFile(path.join(directory,'daemon.log'),'utf8');
    assert.match(log,/AGENT_BLOG_PUBLIC_RUNTIME_PROVIDER_CIRCUIT_OPEN/);
    assert.match(log,/"event":"database-unavailable"|"event":"loop-error"/);
    assert.match(log,/"blocked":false/);
  }finally{
    try{await circuitClose();}finally{
      child.kill();await Promise.race([exit,pause(10000)]);if(!exited)child.kill('SIGKILL');await exit;await handle.close();
    }
  }
  await progress({event:'daemon-fault-complete',temporaryBlockerRecovered:true,databaseReconnected:true});
  const evidence={
    requests:(await admin.query(`SELECT request_id,status,attempt_count,error_code,safe_for_next FROM agent_blog_public_requests
      WHERE agent_user_id=$1 ORDER BY created_at`,[account.agentUserId])).rows,
    runs:(await admin.query('SELECT id,workflow_key,workflow_version,status,error_code FROM agent_runs WHERE agent_user_id=$1 ORDER BY created_at',[account.agentUserId])).rows,
    stages:(await admin.query(`SELECT stage.run_id,stage.stage_key,stage.status,stage.attempt FROM agent_run_stages stage
      JOIN agent_runs run ON run.id=stage.run_id WHERE run.agent_user_id=$1 ORDER BY run.created_at,stage.ordinal`,[account.agentUserId])).rows,
    receipts:(await admin.query('SELECT run_id,article_id FROM agent_blog_foundation_publications WHERE agent_user_id=$1',[account.agentUserId])).rows,
    network:(await admin.query(`SELECT request_id,count(*)::int AS reserved_requests FROM agent_blog_public_network_requests
      WHERE agent_user_id=$1 GROUP BY request_id`,[account.agentUserId])).rows,
    budgets:(await admin.query(`SELECT status,sum(charged_provider_calls)::int AS charged_calls FROM agent_budget_reservations
      WHERE agent_user_id=$1 GROUP BY status`,[account.agentUserId])).rows,
    recoveryEvents:(await admin.query('SELECT request_id,event_type,detail_json FROM agent_blog_public_recovery_events WHERE agent_user_id=$1 ORDER BY created_at',[account.agentUserId])).rows};
  assert.ok(evidence.requests.every(row=>row.status==='completed'));
  assert.ok(evidence.network.every(row=>row.reserved_requests<=43));
  await fs.writeFile(path.join(directory,'recovery-evidence.json'),JSON.stringify(evidence,null,2));
  return {passed:true,scenarios:rows,historyPreserved:true,paperEnabled:false,firstRunId:first.publication.runId,
    daemon:{temporaryBlockerRecovered:true,databaseReconnected:true}};
};
