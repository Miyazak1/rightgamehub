const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const harness = require('./support/researcher-qa-db.cjs');

test('public citation repair uses durable governed calls and replays without another model charge', { skip: !harness.enabled }, async t => {
  const { admin } = await harness.setup();
  t.after(() => admin.end());
  const { createAgentAccountService } = await harness.load('agent-account-service.mjs');
  const { PostgresAgentAccountRepository } = await harness.load('agent-account-repository.mjs');
  const { PostgresAgentRuntimeRepository } = await harness.load('agent-runtime-repository.mjs');
  const { PostgresAgentProviderGatewayRepository } = await harness.load('agent-provider-gateway-repository.mjs');
  const { createAgentProviderGateway } = await harness.load('agent-provider-gateway.mjs');
  const { createAgentRuntimePolicyService } = await harness.load('agent-runtime-policy-service.mjs');
  const { createAgentSecretVault } = await harness.load('agent-secret-vault.mjs');
  const { createAgentBlogFoundationGenerationHandlers, BLOG_FOUNDATION_RESPONSE_SCHEMAS } =
    await harness.load('agent-blog-foundation-generation.mjs');
  const { stableHash } = await harness.load('researcher-qa-protocol/stable-json.mjs');
  const operatorId = crypto.randomUUID();
  await admin.query("INSERT INTO users(id,display_name,role) VALUES($1,'Citation fixture operator','admin')", [operatorId]);
  const account = await createAgentAccountService({ repository: new PostgresAgentAccountRepository(admin),
    authorizeOperator: async () => true }).provision({ userId: operatorId }, {
    provisionKey: 'citation-' + crypto.randomUUID(), displayName: 'Citation fixture',
    handle: 'citation-' + crypto.randomBytes(5).toString('hex'), badgeLabel: 'AI 助手',
    operatorLabel: 'Citation fixture', capabilities: ['blog:auto-publish'], metadata: {},
  });
  const runtime = new PostgresAgentRuntimeRepository(admin);
  const manifest = { schemaVersion: 'agent-workflow-v1', workflowKey: 'blog.project.single', workflowVersion: 2147482999,
    inputSchema: 'citation-fixture-input-v1', outputSchema: 'citation-fixture-output-v1',
    requiredCapabilities: [{ key: 'provider.text.generate', version: 1 }],
    defaultBudget: { providerCalls: 4, toolCalls: 0, inputTokens: 90000, outputTokens: 18000, wallClockSeconds: 600 },
    stages: [{ key: 'compose', kind: 'provider', dependsOn: [], maxAttempts: 2, timeoutSeconds: 600,
      capability: { key: 'provider.text.generate', version: 1 }, idempotencyMode: 'key' }] };
  await runtime.registerWorkflow({ actorUserId: operatorId, manifest });
  await runtime.activateWorkflow(manifest.workflowKey, manifest.workflowVersion);
  const governance = new PostgresAgentProviderGatewayRepository(admin);
  await governance.registerModel({ provider: 'deepseek', modelId: 'fixture-citation', catalogVersion: 1, status: 'active',
    taskClasses: ['structured-generation'], supportsJsonSchema: true, maxInputTokens: 60000, maxOutputTokens: 7000,
    inputPriceMicrousdPerMillion: 2000000, outputPriceMicrousdPerMillion: 4000000, config: { fixture: true } });
  const vault = createAgentSecretVault({ masterKey: 'cd'.repeat(32) });
  const secret = vault.encrypt(account.agentUserId, 'deepseek', 'synthetic-citation-fixture-key');
  await admin.query(`INSERT INTO agent_provider_secrets(agent_user_id,provider,ciphertext,nonce,auth_tag,
    key_fingerprint,key_last_four,updated_by_user_id) VALUES($1,'deepseek',$2,$3,$4,$5,$6,$7)`,
  [account.agentUserId, secret.ciphertext, secret.nonce, secret.authTag, secret.fingerprint, secret.lastFour, operatorId]);
  const text = '官方资料给出了可验证的使用步骤、明确的输入输出和适用边界，读者可以先进行小规模体验，再按照实际结果判断项目是否适合自己的需要。'.repeat(4);
  const article = indexes => ({ title: '从可验证的体验理解开放项目', summary: '根据固定版本的官方资料介绍项目的使用路径、结果验证和适用边界。',
    blocks: Array.from({ length: 6 }, () => ({ type: 'paragraph', text, citationIndexes: indexes })),
    followUpQuestions: ['如何完成第一次体验？', '如何验证输出结果？', '哪些情况不适合使用？'] });
  async function fixture({ invalidRepair = false, providerCalls = 4,cancelDuringDispatch=false } = {}) {
    const run = await runtime.createRun({ agentUserId: account.agentUserId, workflowKey: manifest.workflowKey,
      workflowVersion: manifest.workflowVersion, triggerKind: 'system', idempotencyKey: 'citation:' + crypto.randomUUID(),
      input: { topicScope: '根据固定版本官方资料研究开放工具', recentTitles: [], previousRepositoryUrls: [] },
      config: { model: { provider: 'deepseek', modelId: 'fixture-citation' } },
      budget: { ...manifest.defaultBudget, providerCalls } });
    const claimed = await runtime.claimNextStage('citation-fixture', 600, ['blog.project.single:compose'], run.id);
    const stage = await runtime.startStage({ stageId: claimed.id, workerId: claimed.leasedBy, leaseToken: claimed.leaseToken });
    let invocations = 0;
    let signalStarted;const dispatched=new Promise(resolve=>signalStarted=resolve);
    const {createAgentDeepSeekProviderAdapter}=await harness.load('agent-deepseek-provider-adapter.mjs');
    const cancellable=createAgentDeepSeekProviderAdapter({fetchImpl:async(_url,{signal})=>{
      invocations++;signalStarted();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
    }});
    const gateway = createAgentProviderGateway({ runtimeRepository: runtime, governanceRepository: governance,
      policyService: createAgentRuntimePolicyService({ pool: admin }), secretVault: vault,
      responseSchemas: BLOG_FOUNDATION_RESPONSE_SCHEMAS, adapters: { deepseek: cancelDuringDispatch?cancellable:async () => ({
        providerRequestId: 'fixture:' + crypto.randomUUID(), output: article(++invocations === 1 || invalidRepair ? [1, 3] : [1]),
        responseRef: {}, usage: { providerCalls: 1, inputTokens: 500, outputTokens: 1200, costMicrousd: 10 },
      }) } });
    const toolId = crypto.randomUUID(), selectionId = crypto.randomUUID(), saves = [];
    const source = { schemaVersion: 'github-repository-evidence-v1',
      repository: { key: 'owner/project', canonicalUrl: 'https://github.com/owner/project', owner: 'owner', name: 'project' },
      sourceVersion: { revision: 'a'.repeat(40), canonicalUri: 'https://github.com/owner/project/tree/' + 'a'.repeat(40),
        fetchedAt: '2026-11-16T00:00:00.000Z', contentSha256: '' },
      metadata: { name: 'project', fullName: 'owner/project', description: '用途明确的开放项目', homepage: null,
        defaultBranch: 'main', stars: 10, forks: 2, openIssues: 1, topics: ['tool'], licenseSpdx: 'MIT', archived: false, pushedAt: null },
      readme: { canonicalUri: 'https://github.com/owner/project/blob/' + 'a'.repeat(40) + '/README.md', path: 'README.md', text } };
    source.sourceVersion.contentSha256 = stableHash({ metadata: source.metadata, readme: source.readme });
    const handlers = createAgentBlogFoundationGenerationHandlers({ workflowKey: manifest.workflowKey, providerGateway: gateway,
      artifactRepository: { read: async () => ({ content: { schemaVersion: 'blog-subject-selection-v2',
        selection: { mode: 'single', selectedIndexes: [2], selectedToolArtifactIds: [toolId],
          repositoryUrls: ['https://github.com/owner/project'] } } }),
      readToolArtifact: async () => ({ id: toolId, content: source }),
      save: async value => { saves.push(value); return { id: crypto.randomUUID(), artifactKey: value.artifactKey, contentSha256: 'c'.repeat(64) }; } } });
    const context = await runtime.loadStageExecutionContext({ stageId: stage.id,
      workerId: claimed.leasedBy, leaseToken: claimed.leaseToken });
    context.prerequisites = [{ stageKey: 'select-subject', status: 'succeeded',
      outputRef: { artifactId: selectionId, artifactKey: 'blog.selection' } }];
    return { run, saves,gateway,stage,dispatched,execution:{workerId:claimed.leasedBy,leaseToken:claimed.leaseToken}, invocations: () => invocations, execute: () => handlers['blog.project.single:compose'](context,
      { workerId: claimed.leasedBy, leaseToken: claimed.leaseToken }) };
  }
  const usage = async runId => (await admin.query(`SELECT count(*)::int AS calls,
    COALESCE(sum(reservation.charged_provider_calls),0)::int AS charged
    FROM agent_provider_calls call JOIN agent_run_actions action ON action.id=call.action_id
    JOIN agent_budget_reservations reservation ON reservation.action_id=action.id
    WHERE action.run_id=$1 AND call.status='succeeded'`, [runId])).rows[0];
  await t.test('both outputs are audited, the valid action is retained and replay adds no charge', async () => {
    const f = await fixture(); await f.execute(); await f.execute();
    assert.equal(f.invocations(), 2);
    assert.deepEqual(await usage(f.run.id), { calls: 2, charged: 2 });
    const records = (await admin.query(`SELECT action.id,action.action_key,output.content_json
      FROM agent_run_actions action JOIN agent_provider_output_artifacts output ON output.action_id=action.id
      WHERE action.run_id=$1 ORDER BY action.action_key`, [f.run.id])).rows;
    assert.deepEqual(records[0].content_json.blocks[0].citationIndexes, [1, 3]);
    assert.deepEqual(records[1].content_json.blocks[0].citationIndexes, [1]);
    assert.equal(f.saves[0].actionId, records[1].id);
    assert.equal(f.saves[1].actionId, records[1].id);
  });
  await t.test('a second invalid response remains rejected with no composition', async () => {
    const f = await fixture({ invalidRepair: true });
    await assert.rejects(f.execute(), error => error.code === 'AGENT_BLOG_COMPOSITION_CITATION_INVALID');
    assert.equal(f.invocations(), 2); assert.equal(f.saves.length, 0);
    assert.deepEqual(await usage(f.run.id), { calls: 2, charged: 2 });
  });
  await t.test('the original run budget can refuse repair without another model invocation', async () => {
    const f = await fixture({ providerCalls: 1 });
    await assert.rejects(f.execute(), error => /BUDGET/u.test(error.code));
    assert.equal(f.invocations(), 1); assert.equal(f.saves.length, 0);
    assert.deepEqual(await usage(f.run.id), { calls: 1, charged: 1 });
  });
  await t.test('large escaped requests use immutable input artifacts and replay without another call',async()=>{
    const f=await fixture();
    const input={runId:f.run.id,stageId:f.stage.id,...f.execution,
      action:{actionKey:'large-request',actionKind:'provider',capabilityKey:'provider.text.generate',contractVersion:1,riskLevel:'L2'},
      idempotencyKey:'large-request:'+f.run.id,resource:{type:'provider.model',owner:account.agentUserId},
      modelPolicy:{taskClass:'structured-generation',requiresJsonSchema:true,maxInputTokens:60000,maxOutputTokens:7000,maxCostMicrousd:50000000,latencyClass:'batch',preferredProvider:'deepseek',preferredModel:'fixture-citation'},
      promptTemplate:{key:'blog.large-request',version:1},responseSchema:{key:'blog.article.composition',version:1},
      request:{messages:[{role:'user',content:'"\\'.repeat(18000)}]},tokenCeiling:7000,timeoutSeconds:120};
    assert.ok(Buffer.byteLength(JSON.stringify(input.request))>65536);
    const first=await f.gateway.invoke(input),again=await f.gateway.invoke(input);
    assert.equal(again.actionId,first.actionId);assert.equal(f.invocations(),1);
    // A fresh process has no in-memory gateway state or parent adapter cache.
    const child=require('node:child_process').spawnSync(process.execPath,['--input-type=module','-e',`
      import pg from './apps/api/node_modules/pg/lib/index.js';
      import {PostgresAgentRuntimeRepository} from './apps/api/src/agent-runtime-repository.mjs';
      import {PostgresAgentProviderGatewayRepository} from './apps/api/src/agent-provider-gateway-repository.mjs';
      import {createAgentProviderGateway} from './apps/api/src/agent-provider-gateway.mjs';
      import {createAgentRuntimePolicyService} from './apps/api/src/agent-runtime-policy-service.mjs';
      let text='';for await(const chunk of process.stdin)text+=chunk;
      const pool=new pg.Pool({connectionString:process.env.QA_LEDGER_TEST_URL,max:1});
      try{
        const gateway=createAgentProviderGateway({runtimeRepository:new PostgresAgentRuntimeRepository(pool),
          governanceRepository:new PostgresAgentProviderGatewayRepository(pool),
          policyService:createAgentRuntimePolicyService({pool}),secretVault:{},
          adapters:{deepseek:async()=>{throw Error('Restart must not dispatch');}},
          responseSchemas:{'blog.article.composition@1':value=>value}});
        const result=await gateway.invoke(JSON.parse(text));
        console.log(JSON.stringify({actionId:result.actionId,replayed:result.replayed}));
      }finally{await pool.end();}
    `],{cwd:require('node:path').resolve(__dirname,'../..'),input:JSON.stringify(input),encoding:'utf8',windowsHide:true,timeout:15000});
    assert.equal(child.status,0,child.stderr);
    assert.deepEqual(JSON.parse(child.stdout),{actionId:first.actionId,replayed:true});
    const record=(await admin.query(`SELECT action.request_json,action.request_sha256,
      octet_length(action.request_json::text) AS ledger_bytes,artifact.content_json,artifact.content_sha256,
      octet_length(artifact.content_json::text) AS artifact_bytes FROM agent_run_actions action
      JOIN agent_provider_input_artifacts artifact ON artifact.action_id=action.id WHERE action.id=$1`,[first.actionId])).rows[0];
    assert.ok(record.ledger_bytes<65536);assert.ok(record.artifact_bytes>65536);
    assert.equal(record.request_json.schemaVersion,'agent-provider-input-ref-v1');
    assert.equal(record.request_sha256,record.content_sha256);assert.equal(stableHash(record.content_json),record.content_sha256);
    await assert.rejects(admin.query('UPDATE agent_provider_input_artifacts SET content_json=content_json WHERE action_id=$1',[first.actionId]),/immutable/u);
    await assert.rejects(f.gateway.invoke({...input,request:{messages:[{role:'user',content:'changed'}]}}),e=>e.code==='AGENT_ACTION_IDEMPOTENCY_CONFLICT');
    assert.equal(f.invocations(),1);
  });
  await t.test('cancelling a dispatched provider call remains uncertain and cannot be dispatched twice',async()=>{
    const f=await fixture({cancelDuringDispatch:true}),controller=new AbortController();
    const input={runId:f.run.id,stageId:f.stage.id,...f.execution,signal:controller.signal,
      action:{actionKey:'cancel-request',actionKind:'provider',capabilityKey:'provider.text.generate',contractVersion:1,riskLevel:'L2'},
      idempotencyKey:'cancel-request:'+f.run.id,resource:{type:'provider.model',owner:account.agentUserId},
      modelPolicy:{taskClass:'structured-generation',requiresJsonSchema:true,maxInputTokens:60000,maxOutputTokens:7000,maxCostMicrousd:50000000,latencyClass:'batch',preferredProvider:'deepseek',preferredModel:'fixture-citation'},
      promptTemplate:{key:'blog.cancel-request',version:1},responseSchema:{key:'blog.article.composition',version:1},
      request:{messages:[{role:'user',content:'cancellation fixture'}]},tokenCeiling:7000,timeoutSeconds:60};
    const pending=f.gateway.invoke(input);await f.dispatched;controller.abort();
    await assert.rejects(pending,error=>error.code==='AGENT_PROVIDER_CANCELLED'&&error.uncertain===true);
    const record=(await admin.query(`SELECT call.status,reservation.status AS budget_status,reservation.charged_provider_calls
      FROM agent_provider_calls call JOIN agent_run_actions action ON action.id=call.action_id
      JOIN agent_budget_reservations reservation ON reservation.action_id=action.id WHERE action.run_id=$1`,[f.run.id])).rows[0];
    assert.equal(record.status,'uncertain');assert.equal(record.budget_status,'uncertain');assert.equal(record.charged_provider_calls,1);
    await assert.rejects(f.gateway.invoke({...input,signal:undefined}),error=>error.code==='AGENT_PROVIDER_OUTCOME_UNCERTAIN');
    assert.equal(f.invocations(),1);
    await runtime.failStage({stageId:f.stage.id,...f.execution,errorCode:'AGENT_PROVIDER_CANCELLED',errorMessage:'Fixture cancelled after dispatch.',retryable:false,uncertain:true});
    assert.equal((await admin.query('SELECT status FROM agent_runs WHERE id=$1',[f.run.id])).rows[0].status,'uncertain');
  });
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM blog_articles WHERE author_user_id=$1', [account.agentUserId])).rows[0].n, 0);
});
