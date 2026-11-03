const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn,spawnSync}=require('node:child_process');
const harness=require('./support/researcher-qa-db.cjs');

test('persistent private paper workspace uses existing auth/runtime, with models and publication closed', {skip:!harness.enabled||!process.env.PAPER_STUDY_TEST_REDIS_URL}, async t=>{
  const {admin}=await harness.setup();t.after(()=>admin.end());
  const load=harness.load;
  const {createAgentAccountService}=await load('agent-account-service.mjs'),{PostgresAgentAccountRepository}=await load('agent-account-repository.mjs');
  const {createPaperStudyDurableRuntime}=await load('paper-study-durable-runtime.mjs');
  const {PostgresPaperStudyRepository}=await load('paper-study-persistent-repository.mjs');
  const {createAuthService}=await load('auth-service.mjs'),{PostgresAuthRepository}=await load('auth-repository.mjs');
  const {createApp}=await load('app.mjs'),{stableHash}=await load('researcher-qa-protocol/stable-json.mjs');
  const {createPaperStudyReplayProcessor}=await import('../desktop/paper-study-replay.mjs');
  const actorAdmin=crypto.randomUUID();await admin.query("INSERT INTO users(id,display_name,role) VALUES($1,'Isolated paper operator','admin')",[actorAdmin]);
  const account=await createAgentAccountService({repository:new PostgresAgentAccountRepository(admin),authorizeOperator:async()=>true}).provision({userId:actorAdmin},{provisionKey:'paper-study-'+crypto.randomUUID(),displayName:'Private paper execution',handle:'paper-'+crypto.randomBytes(6).toString('hex'),badgeLabel:'AI 助手',operatorLabel:'Isolated operator',capabilities:[],metadata:{privatePaperExecution:true}});
  let code;const auth=createAuthService({repository:new PostgresAuthRepository(admin),otpHmacKey:crypto.randomBytes(32).toString('hex'),mailer:{async sendVerificationCode(v){code=v.code;}}});
  const login=async email=>{const challenge=await auth.requestChallenge({email,clientKind:'browser'});return auth.verifyChallenge({challengeId:challenge.challengeId,code,deviceLabel:'Isolated paper client'});};
  const tokens=await login('paper-owner@example.test'),other=await login('paper-other@example.test');
  const actor=await auth.authenticateBearer('Bearer '+tokens.accessToken),stranger=await auth.authenticateBearer('Bearer '+other.accessToken);
  const pdf=fs.readFileSync(path.resolve(__dirname,'../../.runtime/paper-layout-audit/1706.03762v7.pdf'));
  const input={title:'Attention Is All You Need',filename:'paper.pdf',rightsConfirmed:true,arxivId:'1706.03762v7',pdfBase64:pdf.toString('base64')};
  const options={pool:admin,redisUrl:process.env.PAPER_STUDY_TEST_REDIS_URL,executionAgentUserId:account.agentUserId};
  let workspace=createPaperStudyDurableRuntime({...options,workerId:'paper-api-only'});t.after(()=>workspace.close());
  const app=createApp({config:{requestBodyLimit:65536,corsOrigins:[],nodeEnv:'test'},authService:auth,paperStudyService:workspace.service});t.after(()=>app.close());
  const request=(url,method='GET',payload,token=tokens.accessToken)=>app.inject({url,method,payload,headers:token?{authorization:'Bearer '+token}:{}});
  let documentId;
  await t.test('normal account auth, route-specific upload limit and transactionally idempotent import',async()=>{
    assert.equal((await request('/v1/me/paper-studies','GET',undefined,null)).statusCode,401);
    assert.ok(Buffer.byteLength(JSON.stringify(input))>65536);
    const responses=await Promise.all(Array.from({length:4},()=>request('/v1/me/paper-studies','POST',input)));
    responses.forEach(r=>assert.equal(r.statusCode,202,r.body));
    const ids=responses.map(r=>r.json().data.id);assert.equal(new Set(ids).size,1);documentId=ids[0];
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM paper_study_tasks WHERE document_id=$1',[documentId])).rows[0].n,1);
    assert.equal((await request('/v1/me/paper-studies/'+documentId,'GET',undefined,other.accessToken)).statusCode,404);
    assert.equal((await request('/v1/me/paper-studies/'+documentId+'/source','GET',undefined,other.accessToken)).statusCode,404);
    assert.deepEqual((await request('/v1/me/paper-studies','GET',undefined,other.accessToken)).json().data,[]);
    assert.equal((await request('/v1/me/paper-studies/'+documentId+'/analyze','POST',{})).json().error.code,'PAPER_STUDY_MODELS_DISABLED');
    assert.equal((await request('/v1/me/paper-studies/'+documentId+'/draft','POST',{})).json().error.code,'PAPER_STUDY_MODELS_DISABLED');
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM paper_study_tasks WHERE document_id=$1',[documentId])).rows[0].n,1);
  });
  await t.test('real HTTP and loopback proxy preserve the complete authenticated PDF response',async()=>{
    const {createDesktopBusinessTestProxy}=await load('desktop-business-test-gateway.mjs');
    const address=await app.listen({host:'127.0.0.1',port:0});
    const proxy=createDesktopBusinessTestProxy({hostname:'127.0.0.1',port:Number(new URL(address).port)});
    await new Promise(r=>proxy.listen(0,'127.0.0.1',r));
    try{
      for(const origin of [address,'http://127.0.0.1:'+proxy.address().port]){
        const endpoint=origin+'/v1/me/paper-studies';
        const denied=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(denied.status,401);await denied.text();
        // A fetch implementation may cancel a large body when its early 401
        // arrives. Use raw HTTP to verify the incomplete-upload boundary itself.
        const http=require('node:http');
        const early=await new Promise((resolve,reject)=>{
          const request=http.request(endpoint,{method:'POST',headers:{'Content-Type':'application/json','Content-Length':2*1024*1024}},response=>{
            response.resume();response.on('end',()=>{resolve({status:response.statusCode,connection:response.headers.connection});request.destroy();});
          });request.on('error',reject);request.write(Buffer.alloc(1024));
        });assert.deepEqual(early,{status:401,connection:'close'});
        await Promise.all(Array.from({length:3},async()=>{const r=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+tokens.accessToken,'Content-Type':'application/json'},body:JSON.stringify(input)});assert.equal(r.status,202);await r.json();}));
        const detail=await fetch(endpoint+'/'+documentId,{headers:{Authorization:'Bearer '+tokens.accessToken,'Content-Type':'application/json'}});await detail.json();
        const r=await fetch(origin+'/v1/me/paper-studies/'+documentId+'/source',{headers:{Authorization:'Bearer '+tokens.accessToken,'Content-Type':'application/json'},signal:AbortSignal.timeout(10000)});
        assert.equal(r.status,200);assert.equal((await r.json()).data.pdfBase64,input.pdfBase64);
      }
    }finally{proxy.closeAllConnections();await new Promise(r=>proxy.close(r));}
  });
  await t.test('crash after the durable checkpoint recovers without parsing twice; old leases cannot overwrite results',async()=>{
    await Promise.all([workspace.dispatch(),workspace.dispatch()]);
    const run=(await admin.query('SELECT runtime_run_id FROM paper_study_tasks WHERE document_id=$1',[documentId])).rows[0].runtime_run_id;
    assert.ok(run);assert.equal((await admin.query('SELECT count(*)::int AS n FROM agent_runs WHERE id=$1',[run])).rows[0].n,1);
    const exit=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['tests/desktop/paper-study-crash-worker.mjs'],{cwd:path.resolve(__dirname,'../..'),windowsHide:true,env:{...process.env,PAPER_STUDY_TEST_AGENT:account.agentUserId},stdio:['ignore','pipe','pipe']});let output='';child.stderr.on('data',b=>output+=b);child.once('error',reject);child.once('exit',c=>{if(c!==73)reject(Error('CHECKPOINT_CRASH_FAILED:'+output));else resolve(c);});});
    assert.equal(exit,73);
    const stage=(await admin.query('SELECT * FROM agent_run_stages WHERE run_id=$1',[run])).rows[0];
    assert.equal(stage.status,'running');
    const context=await workspace.runtime.loadStageExecutionContext({stageId:stage.id,workerId:stage.leased_by,leaseToken:stage.lease_token});
    const task=(await admin.query('SELECT * FROM paper_study_tasks WHERE document_id=$1',[documentId])).rows[0];assert.ok(task.result_json);
    await admin.query("UPDATE agent_run_stages SET lease_until=now()-interval '1 second' WHERE id=$1",[stage.id]);
    await workspace.close();
    workspace=createPaperStudyDurableRuntime({...options,workerId:'paper-study-worker',extract:async()=>{throw Error('MUST_NOT_REPARSE');}});
    const {runPaperStudyWorker}=await load('paper-study-worker-loop.mjs');
    const controller=new AbortController();let waiting=false,completed=false;
    await runPaperStudyWorker({signal:controller.signal,runtime:{async runOnce(){const result=await workspace.runOnce();if(result.status==='completed'){completed=true;controller.abort();}return result;}},
      onStatus(state){if(state.status==='waiting-for-worker-lease')waiting=true;},
      async wait(ms){
        assert.equal(waiting,true);
        // Advance only the isolated DB registration timestamp instead of sleeping
        // four minutes. Production retains the original stale-instance fence.
        await admin.query("UPDATE agent_runtime_workers SET last_seen_at=now()-interval '241 seconds' WHERE worker_id='paper-study-worker' AND status<>'offline'");
        await new Promise(r=>setTimeout(r,Math.max(ms,1100)));
      }});
    assert.equal(waiting,true);assert.equal(completed,true);
    assert.equal((await workspace.service.read(actor,documentId)).status,'imported');
    await assert.rejects(new PostgresPaperStudyRepository(admin).checkpoint(context,{workerId:stage.leased_by,leaseToken:stage.lease_token},task.result_json,{}),{code:'AGENT_RUNTIME_LEASE_LOST'});
    assert.equal((await workspace.service.source(actor,documentId)).pdfBase64,input.pdfBase64);
  });
  let draftId,draftHash;
  await t.test('offline verified analysis and draft persist across independent runtime instances without provider actions',async()=>{
    await workspace.close();
    const processor=Object.assign(await createPaperStudyReplayProcessor(),{executionKind:'offline-verified-recording'});
    workspace=createPaperStudyDurableRuntime({...options,workerId:'paper-offline-analysis',offlineProcessor:processor});
    await Promise.all(Array.from({length:4},()=>workspace.service.analyze(actor,documentId)));
    assert.equal((await workspace.runOnce()).status,'completed');
    assert.equal((await workspace.service.read(actor,documentId)).status,'analyzed');
    await workspace.close();
    workspace=createPaperStudyDurableRuntime({...options,workerId:'paper-offline-draft',offlineProcessor:Object.assign(await createPaperStudyReplayProcessor(),{executionKind:'offline-verified-recording'})});
    await Promise.all(Array.from({length:4},()=>workspace.service.draft(actor,documentId)));
    assert.equal((await workspace.runOnce()).status,'completed');
    const ready=await workspace.service.read(actor,documentId);assert.equal(ready.status,'draft-ready');draftId=ready.draft.id;draftHash=ready.draft.contentSha256;
    assert.equal(ready.draft.publicPublicationEnabled,false);assert.equal(ready.draft.manualReviewRequired,true);
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM paper_study_tasks WHERE document_id=$1',[documentId])).rows[0].n,3);
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM agent_provider_calls')).rows[0].n,0);
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM agent_run_actions')).rows[0].n,0);
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM agent_runs WHERE (budget_json->>'providerCalls')::int<>0")).rows[0].n,0);
    await assert.rejects(admin.query("UPDATE paper_study_documents SET draft_json=jsonb_set(draft_json,'{content,title}','\"tampered\"') WHERE id=$1",[documentId]),/PAPER_STUDY_CONTENT_IMMUTABLE/);
  });
  await t.test('Redis restart does not remove tasks, PDF, analysis or the identical private draft',async()=>{
    assert.equal(await workspace.service.ready(),true);
    await workspace.close();
    const name=process.env.PAPER_STUDY_TEST_REDIS_CONTAINER,label=process.env.PAPER_STUDY_TEST_LABEL;
    assert.match(name,/^paper-redis-[a-f0-9]{32}$/);assert.equal(name,'paper-redis-'+label);
    const inspect=spawnSync('docker',['inspect',name],{encoding:'utf8',windowsHide:true});assert.equal(inspect.status,0);
    const info=JSON.parse(inspect.stdout)[0];assert.equal(info.Name,'/'+name);assert.equal(info.Config.Labels['mooyu.paper-study.test'],label);assert.ok(info.Mounts.every(m=>m.Type==='tmpfs'));
    assert.equal(spawnSync('docker',['restart','--time','0',name],{encoding:'utf8',windowsHide:true}).status,0);
    const port=spawnSync('docker',['port',name,'6379/tcp'],{encoding:'utf8',windowsHide:true}).stdout.trim().match(/^127\.0\.0\.1:(\d+)$/)?.[1];assert.ok(port);
    options.redisUrl='redis://127.0.0.1:'+port;
    workspace=createPaperStudyDurableRuntime({...options,workerId:'paper-after-redis-restart'});
    for(let i=0;i<30&&!await workspace.service.ready();i++)await new Promise(r=>setTimeout(r,100));
    assert.equal(await workspace.service.ready(),true);
    const saved=await workspace.service.read(actor,documentId);assert.equal(saved.draft.id,draftId);assert.equal(saved.draft.contentSha256,draftHash);
    assert.equal(stableHash(saved.draft.content),draftHash);assert.equal((await workspace.service.source(actor,documentId)).pdfBase64,input.pdfBase64);
    assert.equal((await workspace.runOnce()).status,'idle');
    await assert.rejects(workspace.service.draft(actor,documentId),{code:'PAPER_STUDY_MODELS_DISABLED'});
    await assert.rejects(workspace.service.read(stranger,documentId),{code:'PAPER_STUDY_NOT_FOUND'});
  });
  await t.test('paper worker never recovers other workflows and frozen governance denies provider/publication actions',async()=>{
    const {paperStudyWorkflow}=await load('paper-study-durable-runtime.mjs');
    const foreign={...paperStudyWorkflow('import'),workflowKey:'unrelated.paper-test'};
    await workspace.runtime.registerWorkflow({actorUserId:actorAdmin,manifest:foreign});await workspace.runtime.activateWorkflow(foreign.workflowKey,1);
    const run=await workspace.runtime.createRun({agentUserId:account.agentUserId,workflowKey:foreign.workflowKey,workflowVersion:1,triggerKind:'manual',idempotencyKey:'unrelated-'+crypto.randomUUID(),input:{},config:{}});
    const claimed=await workspace.runtime.claimNextStage('unrelated-worker',15,[foreign.workflowKey+':process'],run.id);
    await admin.query("UPDATE agent_run_stages SET lease_until=now()-interval '1 second' WHERE id=$1",[claimed.id]);
    assert.equal((await workspace.runOnce()).status,'idle');
    assert.equal((await admin.query('SELECT status FROM agent_run_stages WHERE id=$1',[claimed.id])).rows[0].status,'leased');
    const {createAgentRuntimePolicyService}=await load('agent-runtime-policy-service.mjs');const policy=createAgentRuntimePolicyService({pool:admin});
    for(const capabilityKey of ['provider.text.generate','blog.article.publish']){
      const decision=await policy.decide({runId:run.id,stageId:claimed.id,action:{actionKey:'forbidden',actionKind:capabilityKey.startsWith('provider')?'provider':'domain-write',capabilityKey,contractVersion:1,riskLevel:'L2'},resource:{type:'paper.document',owner:account.agentUserId,id:documentId}});
      assert.equal(decision.decision,'deny');assert.ok(decision.reasonCodes.includes('CAPABILITY_NOT_FROZEN'));
    }
  });
  await t.test('same source belongs separately to each account and quota/Redis admission failures create no tasks',async()=>{
    const owned=await workspace.service.import(stranger,input);assert.notEqual(owned.id,documentId);
    const {createPersistentPaperStudyService}=await load('paper-study-persistent-service.mjs');
    const unavailable=createPersistentPaperStudyService({repository:workspace.repository,executionAgentUserId:account.agentUserId,signals:{async check(){throw Object.assign(Error(),{code:'PAPER_STUDY_REDIS_UNAVAILABLE',statusCode:503});}}});
    const before=(await admin.query('SELECT count(*)::int AS n FROM paper_study_tasks')).rows[0].n;
    await assert.rejects(unavailable.import(actor,{...input,pdfBase64:Buffer.from('%PDF-unavailable').toString('base64')}),{code:'PAPER_STUDY_REDIS_UNAVAILABLE'});
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM paper_study_tasks')).rows[0].n,before);
    for(let i=0;i<19;i++){const bytes=Buffer.from('%PDF-quota-'+i);await admin.query("INSERT INTO paper_study_documents(id,owner_user_id,title,filename,source_sha256,pdf_bytes,status) VALUES($1,$2,'quota','quota.pdf',$3,$4,'imported')",[crypto.randomUUID(),actor.userId,crypto.createHash('sha256').update(bytes).digest('hex'),bytes]);}
    await assert.rejects(workspace.service.import(actor,{...input,pdfBase64:Buffer.from('%PDF-new-over-quota').toString('base64')}),{code:'PAPER_STUDY_LIBRARY_LIMIT'});
  });
  await t.test('dispatch filters agent and operation before batch limit and drains subsequent batches',async()=>{
    const otherAgent=await createAgentAccountService({repository:new PostgresAgentAccountRepository(admin),authorizeOperator:async()=>true}).provision({userId:actorAdmin},{provisionKey:'filter-'+crypto.randomUUID(),displayName:'Other paper execution',handle:'filter-'+crypto.randomBytes(6).toString('hex'),badgeLabel:'AI 助手',operatorLabel:'Isolated operator',capabilities:[],metadata:{}});
    const ids=[];
    for(let i=0;i<77;i++){
      const id=crypto.randomUUID(),bytes=Buffer.from('%PDF-filter-'+i);ids.push(id);
      await admin.query("INSERT INTO paper_study_documents(id,owner_user_id,title,filename,source_sha256,pdf_bytes,status) VALUES($1,$2,'filter','filter.pdf',$3,$4,'importing')",[id,stranger.userId,crypto.createHash('sha256').update(bytes).digest('hex'),bytes]);
      await admin.query("INSERT INTO paper_study_tasks(id,document_id,operation,execution_agent_user_id,desired_run_id,created_at) VALUES($1,$2,$3,$4,$5,now()+$6*interval '1 second')",[crypto.randomUUID(),id,i>=25&&i<50?'analyze':'import',i<25?otherAgent.agentUserId:account.agentUserId,crypto.randomUUID(),i]);
    }
    await workspace.dispatch();await workspace.dispatch();await workspace.dispatch();
    const rows=(await admin.query('SELECT document_id,runtime_run_id FROM paper_study_tasks WHERE document_id=ANY($1::uuid[])',[ids])).rows;
    for(const [i,id]of ids.entries())assert.equal(!!rows.find(r=>r.document_id===id).runtime_run_id,i>=50);
    const count=(await admin.query('SELECT count(*)::int AS n FROM agent_runs r JOIN paper_study_tasks t ON t.runtime_run_id=r.id WHERE t.document_id=ANY($1::uuid[])',[ids.slice(50)])).rows[0].n;
    assert.equal(count,27);
  });
  fs.writeFileSync(process.env.PAPER_STUDY_TEST_RESULT,JSON.stringify({passed:true,modelCalls:0,providerActions:0,publication:false,realAuth:true,postgresPersistent:true,redisRestart:true,sameWorkerIdCrashRecovery:true,dispatchFiltersBeforeLimit:true,sourcePreserved:true,sameDraftId:true,contentSha256:draftHash},null,2));
});
