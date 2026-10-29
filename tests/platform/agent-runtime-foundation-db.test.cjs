const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const harness = require('./support/researcher-qa-db.cjs');

function manifest() {
  return {
    schemaVersion: 'agent-workflow-v1', workflowKey: `foundation.test.${crypto.randomBytes(5).toString('hex')}`, workflowVersion: 1,
    inputSchema: 'foundation-input-v1', outputSchema: 'foundation-output-v1',
    requiredCapabilities: [{ key: 'blog.article.publish', version: 1 }],
    defaultBudget: { providerCalls: 0, toolCalls: 2, inputTokens: 0, outputTokens: 0, wallClockSeconds: 120 },
    stages: [
      { key: 'prepare', kind: 'deterministic', dependsOn: [], maxAttempts: 1, timeoutSeconds: 30 },
      { key: 'publish', kind: 'domain-write', dependsOn: ['prepare'], maxAttempts: 2, timeoutSeconds: 30, capability: { key: 'blog.article.publish', version: 1 }, idempotencyMode: 'queryable' },
    ],
  };
}

test('Agent durable runtime foundation on isolated PostgreSQL', { skip: !harness.enabled }, async () => {
  const { admin } = await harness.setup();
  const { createAgentAccountService } = await harness.load('agent-account-service.mjs');
  const { PostgresAgentAccountRepository } = await harness.load('agent-account-repository.mjs');
  const { PostgresAgentRuntimeRepository } = await harness.load('agent-runtime-repository.mjs');
  const { createAgentRuntimeWorker } = await harness.load('agent-runtime-worker.mjs');
  const { createAgentRuntimeReadService } = await harness.load('agent-runtime-read-service.mjs');
  const { createAgentRuntimePolicyService } = await harness.load('agent-runtime-policy-service.mjs');
  const { PostgresAgentProviderGatewayRepository } = await harness.load('agent-provider-gateway-repository.mjs');
  const { createAgentProviderGateway } = await harness.load('agent-provider-gateway.mjs');
  const { createAgentSecretVault } = await harness.load('agent-secret-vault.mjs');
  const operatorId = crypto.randomUUID();
  await admin.query("INSERT INTO users(id,display_name,role) VALUES($1,'Foundation operator','admin')", [operatorId]);
  const accountService = createAgentAccountService({ repository: new PostgresAgentAccountRepository(admin), authorizeOperator: async () => true });
  const account = await accountService.provision({ userId: operatorId }, {
    provisionKey: `foundation-${crypto.randomUUID()}`,
    displayName: 'Foundation Agent', handle: `foundation-${crypto.randomBytes(5).toString('hex')}`,
    badgeLabel: 'AI 助手', operatorLabel: 'Foundation test', capabilities: ['blog:auto-publish'], metadata: {},
  });
  const seeded = (await admin.query(`SELECT
      (SELECT count(*)::int FROM agent_policy_profile_assignments WHERE agent_user_id=$1) AS policies,
      (SELECT count(*)::int FROM agent_capability_grants WHERE agent_user_id=$1 AND capability_key='blog.article.publish' AND status='active') AS grants`, [account.agentUserId])).rows[0];
  assert.deepEqual(seeded, { policies: 1, grants: 1 });

  const runtime = new PostgresAgentRuntimeRepository(admin);
  const definition = manifest();
  const registered = await runtime.registerWorkflow({ actorUserId: operatorId, manifest: definition });
  assert.equal(registered.status, 'draft');
  assert.equal((await runtime.registerWorkflow({ actorUserId: operatorId, manifest: definition })).manifestSha256, registered.manifestSha256);
  await runtime.activateWorkflow(definition.workflowKey, 1);

  const request = {
    agentUserId: account.agentUserId, workflowKey: definition.workflowKey, workflowVersion: 1,
    triggerKind: 'manual', idempotencyKey: `manual:${crypto.randomUUID()}`, input: { subject: 'fixture' }, config: { locale: 'zh-CN' },
  };
  const run = await runtime.createRun(request);
  assert.equal(run.status, 'queued');
  assert.equal((await runtime.createRun(request)).id, run.id);
  await assert.rejects(runtime.createRun({ ...request, input: { subject: 'changed' } }), error => error.code === 'AGENT_RUN_IDEMPOTENCY_CONFLICT');
  await assert.rejects(admin.query("UPDATE agent_runs SET status='waiting' WHERE id=$1", [run.id]));

  const claims = await Promise.all([runtime.claimNextStage('foundation-worker-a', 60, null, run.id), runtime.claimNextStage('foundation-worker-b', 60, null, run.id)]);
  const rootClaims = claims.filter(item => item?.runId === run.id);
  assert.equal(rootClaims.length, 1);
  const prepare = rootClaims[0];
  await runtime.startStage({ stageId: prepare.id, workerId: prepare.leasedBy, leaseToken: prepare.leaseToken });
  const completed = await runtime.completeStage({ stageId: prepare.id, workerId: prepare.leasedBy, leaseToken: prepare.leaseToken, outputRef: { selected: true } });
  assert.equal(completed.unlocked.length, 1);
  await assert.rejects(runtime.renewStageLease({ stageId: prepare.id, workerId: prepare.leasedBy, leaseToken: prepare.leaseToken }), error => error.code === 'AGENT_RUNTIME_LEASE_LOST');

  const publish = await runtime.claimNextStage('foundation-worker-publish', 60, null, run.id);
  assert.equal(publish.runId, run.id);
  await runtime.startStage({ stageId: publish.id, workerId: publish.leasedBy, leaseToken: publish.leaseToken });
  const action = await runtime.createAction({
    runId: run.id, stageId: publish.id, idempotencyKey: `publish:${run.id}`,
    action: { actionKey: 'publish-article', actionKind: 'domain-write', capabilityKey: 'blog.article.publish', contractVersion: 1, riskLevel: 'L3' },
    request: { runId: run.id }, policyDecision: { schemaVersion: 'agent-policy-decision-v1', decision: 'allow' },
  });
  assert.equal(action.status, 'prepared');
  await assert.rejects(admin.query("UPDATE agent_run_actions SET status='succeeded',sent_at=now(),acknowledged_at=now(),finished_at=now() WHERE id=$1", [action.id]));
  await assert.rejects(runtime.completeStage({ stageId: publish.id, workerId: publish.leasedBy, leaseToken: publish.leaseToken, outputRef: { unsafe: true } }), error => error.code === 'AGENT_RUNTIME_ACTIONS_INCOMPLETE');
  assert.equal((await runtime.createAction({
    runId: run.id, stageId: publish.id, idempotencyKey: `publish:${run.id}`,
    action: { actionKey: 'publish-article', actionKind: 'domain-write', capabilityKey: 'blog.article.publish', contractVersion: 1, riskLevel: 'L3' },
    request: { runId: run.id }, policyDecision: { schemaVersion: 'agent-policy-decision-v1', decision: 'allow' },
  })).id, action.id);
  await runtime.transitionAction({ actionId: action.id, from: 'prepared', to: 'authorized' });
  await runtime.transitionAction({ actionId: action.id, from: 'authorized', to: 'reserved', reservationRef: `budget:${action.id}` });
  await runtime.transitionAction({ actionId: action.id, from: 'reserved', to: 'sending' });
  await runtime.transitionAction({ actionId: action.id, from: 'sending', to: 'sent', providerRequestId: `provider:${action.id}` });
  await runtime.transitionAction({ actionId: action.id, from: 'sent', to: 'acknowledged', responseRef: { receipt: action.id }, responseSha256: 'a'.repeat(64), usage: { billableRequests: 1 } });
  const settled = await runtime.transitionAction({ actionId: action.id, from: 'acknowledged', to: 'succeeded', usage: { billableRequests: 1 } });
  assert.equal(settled.status, 'succeeded');
  assert.equal((await runtime.transitionAction({ actionId: action.id, from: 'acknowledged', to: 'succeeded', usage: { billableRequests: 1 } })).existing, true);
  await runtime.completeStage({ stageId: publish.id, workerId: publish.leasedBy, leaseToken: publish.leaseToken, outputRef: { ready: true } });
  const outputId = crypto.randomUUID();
  assert.equal((await runtime.finalizeRun({ runId: run.id, outputType: 'blog.article', outputId })).status, 'succeeded');
  assert.equal(Number((await admin.query('SELECT count(*)::int AS n FROM agent_run_events WHERE run_id=$1', [run.id])).rows[0].n) >= 5, true);
  await assert.rejects(admin.query("UPDATE agent_runs SET status='running',finished_at=NULL WHERE id=$1", [run.id]));
  await assert.rejects(admin.query('DELETE FROM agent_run_events WHERE run_id=$1', [run.id]));

  const workerManifest = {
    schemaVersion: 'agent-workflow-v1', workflowKey: `foundation.worker.${crypto.randomBytes(5).toString('hex')}`, workflowVersion: 1,
    inputSchema: 'foundation-input-v1', outputSchema: 'foundation-output-v1', requiredCapabilities: [],
    defaultBudget: { providerCalls: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, wallClockSeconds: 120 },
    stages: [{ key: 'execute', kind: 'deterministic', dependsOn: [], maxAttempts: 2, timeoutSeconds: 30 }],
  };
  await runtime.registerWorkflow({ actorUserId: operatorId, manifest: workerManifest });
  await runtime.activateWorkflow(workerManifest.workflowKey, 1);
  const workerRun = await runtime.createRun({
    agentUserId: account.agentUserId, workflowKey: workerManifest.workflowKey, workflowVersion: 1,
    triggerKind: 'system', idempotencyKey: `worker:${crypto.randomUUID()}`, input: { fixture: true }, config: {},
  });
  const decoyRun = await runtime.createRun({
    agentUserId: account.agentUserId, workflowKey: workerManifest.workflowKey, workflowVersion: 1,
    triggerKind: 'system', idempotencyKey: `worker-decoy:${crypto.randomUUID()}`, input: { fixture: 'decoy' }, config: {},
  });
  const workerOutputId = crypto.randomUUID();
  const worker = createAgentRuntimeWorker({
    repository: runtime, workerId: 'foundation-runtime-worker', instanceId: crypto.randomUUID(),
    leaseSeconds: 30, heartbeatSeconds: 5, outboxBatch: 25, targetRunId: workerRun.id,
    handlers: { [`${workerManifest.workflowKey}:execute`]: async context => ({
      outputRef: { inputHash: context.run.inputSha256 }, runOutput: { type: 'foundation.result', id: workerOutputId },
    }) },
  });
  const workerResult = await worker.runOnce();
  assert.equal(workerResult.status, 'completed');
  assert.equal(workerResult.run.outputId, workerOutputId);
  assert.equal((await admin.query('SELECT status FROM agent_runs WHERE id=$1', [workerRun.id])).rows[0].status, 'succeeded');
  assert.equal((await admin.query('SELECT status FROM agent_runs WHERE id=$1', [decoyRun.id])).rows[0].status, 'queued');
  await worker.stop();
  assert.equal((await admin.query("SELECT status FROM agent_runtime_workers WHERE worker_id='foundation-runtime-worker'")).rows[0].status, 'offline');
  const decoyWorker = createAgentRuntimeWorker({
    repository: runtime, workerId: 'foundation-runtime-decoy-worker', instanceId: crypto.randomUUID(),
    leaseSeconds: 30, heartbeatSeconds: 5, outboxBatch: 25, targetRunId: decoyRun.id,
    handlers: { [`${workerManifest.workflowKey}:execute`]: async () => ({
      outputRef: { decoy: true }, runOutput: { type: 'foundation.result', id: crypto.randomUUID() },
    }) },
  });
  assert.equal((await decoyWorker.runOnce()).status, 'completed');
  await decoyWorker.stop();
  assert.equal(Number((await admin.query("SELECT count(*)::int AS n FROM agent_runtime_outbox WHERE status='pending'", [])).rows[0].n) >= 2, true);

  const recoveryManifest = { ...workerManifest, workflowKey: `foundation.recovery.${crypto.randomBytes(5).toString('hex')}` };
  await runtime.registerWorkflow({ actorUserId: operatorId, manifest: recoveryManifest });
  await runtime.activateWorkflow(recoveryManifest.workflowKey, 1);
  const recoveryRun = await runtime.createRun({
    agentUserId: account.agentUserId, workflowKey: recoveryManifest.workflowKey, workflowVersion: 1,
    triggerKind: 'system', idempotencyKey: `recovery:${crypto.randomUUID()}`, input: {}, config: {},
  });
  const crashed = await runtime.claimNextStage('crashed-worker', 15, [`${recoveryManifest.workflowKey}:execute`]);
  await runtime.startStage({ stageId: crashed.id, workerId: 'crashed-worker', leaseToken: crashed.leaseToken });
  await admin.query("UPDATE agent_run_stages SET lease_until=now()-interval '1 second' WHERE id=$1", [crashed.id]);
  const recovered = await runtime.recoverExpiredStages({ workerId: 'recovery-worker', baseBackoffSeconds: 0 });
  assert.deepEqual(recovered, { examined: 1, requeued: 1, failed: 0, uncertain: 0 });
  await assert.rejects(runtime.completeStage({ stageId: crashed.id, workerId: 'crashed-worker', leaseToken: crashed.leaseToken }), error => error.code === 'AGENT_RUNTIME_LEASE_LOST');
  const reclaimed = await runtime.claimNextStage('replacement-worker', 30, [`${recoveryManifest.workflowKey}:execute`]);
  assert.equal(reclaimed.attempt, 2);
  await runtime.startStage({ stageId: reclaimed.id, workerId: 'replacement-worker', leaseToken: reclaimed.leaseToken });
  await runtime.completeStage({ stageId: reclaimed.id, workerId: 'replacement-worker', leaseToken: reclaimed.leaseToken,
    outputRef: { recovered: true }, runOutput: { type: 'foundation.result', id: crypto.randomUUID() } });

  const secondAccount = await accountService.provision({ userId: operatorId }, {
    provisionKey: `foundation-fair-${crypto.randomUUID()}`, displayName: 'Foundation Agent Two',
    handle: `foundation-two-${crypto.randomBytes(4).toString('hex')}`, badgeLabel: 'AI 助手',
    operatorLabel: 'Foundation test', capabilities: [], metadata: {},
  });
  const fairRuns = [];
  for (const agentUserId of [account.agentUserId, account.agentUserId, secondAccount.agentUserId]) fairRuns.push(await runtime.createRun({
    agentUserId, workflowKey: recoveryManifest.workflowKey, workflowVersion: 1, triggerKind: 'system',
    idempotencyKey: `fair:${crypto.randomUUID()}`, input: {}, config: {},
  }));
  const fairClaims = await Promise.all([
    runtime.claimNextStage('fair-worker-a', 30, [`${recoveryManifest.workflowKey}:execute`]),
    runtime.claimNextStage('fair-worker-b', 30, [`${recoveryManifest.workflowKey}:execute`]),
  ]);
  const firstAgentRuns = new Set(fairRuns.slice(0, 2).map(item => item.id));
  assert.equal(fairClaims.some(item => firstAgentRuns.has(item.runId)), true);
  assert.equal(fairClaims.some(item => item.runId === fairRuns[2].id), true);
  for (const claim of fairClaims) {
    await runtime.startStage({ stageId: claim.id, workerId: claim.leasedBy, leaseToken: claim.leaseToken });
    await runtime.completeStage({ stageId: claim.id, workerId: claim.leasedBy, leaseToken: claim.leaseToken,
      outputRef: { fair: true }, runOutput: { type: 'foundation.result', id: crypto.randomUUID() } });
  }
  const finalFairClaim = await runtime.claimNextStage('fair-worker-c', 30, [`${recoveryManifest.workflowKey}:execute`]);
  await runtime.startStage({ stageId: finalFairClaim.id, workerId: finalFairClaim.leasedBy, leaseToken: finalFairClaim.leaseToken });
  await runtime.completeStage({ stageId: finalFairClaim.id, workerId: finalFairClaim.leasedBy, leaseToken: finalFairClaim.leaseToken,
    outputRef: { fair: true }, runOutput: { type: 'foundation.result', id: crypto.randomUUID() } });

  const uncertainManifest = {
    ...workerManifest, workflowKey: `foundation.uncertain.${crypto.randomBytes(5).toString('hex')}`,
    requiredCapabilities: [{ key: 'blog.article.publish', version: 1 }],
    stages: [{ key: 'write', kind: 'domain-write', dependsOn: [], maxAttempts: 3, timeoutSeconds: 30,
      capability: { key: 'blog.article.publish', version: 1 }, idempotencyMode: 'queryable' }],
  };
  await runtime.registerWorkflow({ actorUserId: operatorId, manifest: uncertainManifest });
  await runtime.activateWorkflow(uncertainManifest.workflowKey, 1);
  const uncertainRun = await runtime.createRun({
    agentUserId: account.agentUserId, workflowKey: uncertainManifest.workflowKey, workflowVersion: 1,
    triggerKind: 'system', idempotencyKey: `uncertain:${crypto.randomUUID()}`, input: {}, config: {},
  });
  const uncertainStage = await runtime.claimNextStage('uncertain-worker', 15, [`${uncertainManifest.workflowKey}:write`]);
  await runtime.startStage({ stageId: uncertainStage.id, workerId: 'uncertain-worker', leaseToken: uncertainStage.leaseToken });
  const uncertainAction = await runtime.createAction({
    runId: uncertainRun.id, stageId: uncertainStage.id, idempotencyKey: `external:${uncertainRun.id}`,
    action: { actionKey: 'external-write', actionKind: 'domain-write', capabilityKey: 'blog.article.publish', contractVersion: 1, riskLevel: 'L3' },
    request: { runId: uncertainRun.id }, policyDecision: { decision: 'allow' },
  });
  await runtime.transitionAction({ actionId: uncertainAction.id, from: 'prepared', to: 'authorized' });
  await runtime.transitionAction({ actionId: uncertainAction.id, from: 'authorized', to: 'reserved' });
  await runtime.transitionAction({ actionId: uncertainAction.id, from: 'reserved', to: 'sending' });
  await runtime.transitionAction({ actionId: uncertainAction.id, from: 'sending', to: 'sent', providerRequestId: `request:${uncertainAction.id}` });
  await admin.query("UPDATE agent_run_stages SET lease_until=now()-interval '1 second' WHERE id=$1", [uncertainStage.id]);
  const uncertainRecovery = await runtime.recoverExpiredStages({ workerId: 'recovery-worker', baseBackoffSeconds: 0 });
  assert.deepEqual(uncertainRecovery, { examined: 1, requeued: 0, failed: 0, uncertain: 1 });
  assert.deepEqual((await admin.query(`SELECT
      (SELECT status FROM agent_runs WHERE id=$1) AS run_status,
      (SELECT status FROM agent_run_stages WHERE id=$2) AS stage_status,
      (SELECT status FROM agent_run_actions WHERE id=$3) AS action_status`,
  [uncertainRun.id, uncertainStage.id, uncertainAction.id])).rows[0],
  { run_status: 'uncertain', stage_status: 'uncertain', action_status: 'uncertain' });

  const explicitUnknownRun = await runtime.createRun({
    agentUserId: account.agentUserId, workflowKey: uncertainManifest.workflowKey, workflowVersion: 1,
    triggerKind: 'system', idempotencyKey: `explicit-uncertain:${crypto.randomUUID()}`, input: {}, config: {},
  });
  const explicitUnknownStage = await runtime.claimNextStage('explicit-uncertain-worker', 30,
    [`${uncertainManifest.workflowKey}:write`]);
  await runtime.startStage({ stageId: explicitUnknownStage.id, workerId: explicitUnknownStage.leasedBy,
    leaseToken: explicitUnknownStage.leaseToken });
  const explicitUnknownAction = await runtime.createAction({
    runId: explicitUnknownRun.id, stageId: explicitUnknownStage.id,
    idempotencyKey: `database-write:${explicitUnknownRun.id}`,
    action: { actionKey: 'database-write', actionKind: 'domain-write',
      capabilityKey: 'blog.article.publish', contractVersion: 1, riskLevel: 'L3' },
    request: { runId: explicitUnknownRun.id }, policyDecision: { decision: 'allow' },
  });
  await runtime.transitionAction({ actionId: explicitUnknownAction.id, from: 'prepared', to: 'authorized' });
  await runtime.failStage({ stageId: explicitUnknownStage.id,
    workerId: explicitUnknownStage.leasedBy, leaseToken: explicitUnknownStage.leaseToken,
    errorCode: 'DATABASE_COMMIT_OUTCOME_UNKNOWN', errorMessage: 'Commit outcome could not be queried.',
    retryable: false, uncertain: true });
  assert.deepEqual((await admin.query(`SELECT
      (SELECT status FROM agent_runs WHERE id=$1) AS run_status,
      (SELECT status FROM agent_run_stages WHERE id=$2) AS stage_status,
      (SELECT status FROM agent_run_actions WHERE id=$3) AS action_status`,
  [explicitUnknownRun.id, explicitUnknownStage.id, explicitUnknownAction.id])).rows[0],
  { run_status: 'uncertain', stage_status: 'uncertain', action_status: 'uncertain' });

  const staleOutbox = (await admin.query("SELECT * FROM agent_runtime_outbox WHERE status='pending' ORDER BY created_at DESC LIMIT 1")).rows[0];
  if (staleOutbox) {
    await admin.query("UPDATE agent_runtime_outbox SET status='dispatching',attempts=attempts+1,lease_token=$2,lease_until=now()-interval '1 second' WHERE id=$1", [staleOutbox.id, crypto.randomUUID()]);
    assert.equal((await runtime.recoverExpiredOutbox({ baseBackoffSeconds: 0 })).requeued, 1);
  }

  const providerManifest = {
    schemaVersion: 'agent-workflow-v1', workflowKey: `foundation.provider.${crypto.randomBytes(5).toString('hex')}`, workflowVersion: 1,
    inputSchema: 'foundation-input-v1', outputSchema: 'foundation-output-v1',
    requiredCapabilities: [{ key: 'blog.article.publish', version: 1 }],
    defaultBudget: { providerCalls: 1, toolCalls: 0, inputTokens: 1000, outputTokens: 500, wallClockSeconds: 120 },
    stages: [{ key: 'generate', kind: 'provider', dependsOn: [], maxAttempts: 1, timeoutSeconds: 30,
      capability: { key: 'blog.article.publish', version: 1 }, idempotencyMode: 'key' }],
  };
  await runtime.registerWorkflow({ actorUserId: operatorId, manifest: providerManifest });
  await runtime.activateWorkflow(providerManifest.workflowKey, 1);
  const providerRun = await runtime.createRun({
    agentUserId: account.agentUserId, workflowKey: providerManifest.workflowKey, workflowVersion: 1,
    triggerKind: 'system', idempotencyKey: `provider:${crypto.randomUUID()}`, input: {}, config: {},
  });
  const providerStage = await runtime.claimNextStage('provider-worker', 30, [`${providerManifest.workflowKey}:generate`]);
  await runtime.startStage({ stageId: providerStage.id, workerId: providerStage.leasedBy, leaseToken: providerStage.leaseToken });
  const governance = new PostgresAgentProviderGatewayRepository(admin, {
    agentMonthlyLimits: { providerCalls: 10, inputTokens: 10000, outputTokens: 10000, costMicrousd: 100000 },
    platformMonthlyLimits: { providerCalls: 100, inputTokens: 100000, outputTokens: 100000, costMicrousd: 1000000 },
  });
  await governance.registerModel({
    provider: 'deepseek', modelId: 'fixture-json', catalogVersion: 1, status: 'active',
    taskClasses: ['structured-generation'], supportsJsonSchema: true,
    maxInputTokens: 1000, maxOutputTokens: 500,
    inputPriceMicrousdPerMillion: 1000000, outputPriceMicrousdPerMillion: 2000000,
    config: { fixture: true },
  });
  const vault = createAgentSecretVault({ masterKey: 'ab'.repeat(32) });
  const encrypted = vault.encrypt(account.agentUserId, 'deepseek', 'fixture-secret-key-1234567890');
  await admin.query(`INSERT INTO agent_provider_secrets(
    agent_user_id,provider,ciphertext,nonce,auth_tag,key_fingerprint,key_last_four,updated_by_user_id
  ) VALUES($1,'deepseek',$2,$3,$4,$5,$6,$7)`, [account.agentUserId, encrypted.ciphertext, encrypted.nonce,
    encrypted.authTag, encrypted.fingerprint, encrypted.lastFour, operatorId]);
  const gateway = createAgentProviderGateway({
    runtimeRepository: runtime, governanceRepository: governance,
    policyService: createAgentRuntimePolicyService({ pool: admin }), secretVault: vault,
    adapters: { deepseek: async input => {
      assert.equal(input.apiKey, 'fixture-secret-key-1234567890');
      return { providerRequestId: `fixture:${crypto.randomUUID()}`, output: { answer: '受控结果' },
        responseRef: { artifactId: crypto.randomUUID() },
        usage: { providerCalls: 1, inputTokens: 70, outputTokens: 20, costMicrousd: 150 } };
    } },
    responseSchemas: { 'foundation-answer@1': output => {
      if (!output || typeof output.answer !== 'string') throw new Error('invalid fixture output');
      return { answer: output.answer };
    } },
  });
  const providerRequest = {
    runId: providerRun.id, stageId: providerStage.id, workerId: providerStage.leasedBy, leaseToken: providerStage.leaseToken,
    action: { actionKey: 'generate-json', actionKind: 'provider', capabilityKey: 'blog.article.publish', contractVersion: 1, riskLevel: 'L1' },
    idempotencyKey: `provider-action:${providerRun.id}`, resource: { type: 'blog', owner: 'public' },
    modelPolicy: { taskClass: 'structured-generation', requiresJsonSchema: true, maxInputTokens: 100,
      maxOutputTokens: 50, maxCostMicrousd: 1000, latencyClass: 'batch', preferredProvider: 'deepseek',
      preferredModel: 'fixture-json' },
    promptTemplate: { key: 'fixture.prompt', version: 1 }, responseSchema: { key: 'foundation-answer', version: 1 },
    request: { prompt: 'fixture' }, tokenCeiling: 50, timeoutSeconds: 10, estimatedInputTokens: 80,
  };
  const providerResult = await gateway.invoke(providerRequest);
  assert.equal(providerResult.status, 'succeeded');
  assert.deepEqual(providerResult.output, { answer: '受控结果' });
  assert.match(providerResult.outputArtifactId, /^[a-f0-9-]{36}$/u);
  assert.match(providerResult.outputSha256, /^[a-f0-9]{64}$/u);
  assert.deepEqual(providerResult.chargedUsage, { providerCalls: 1, inputTokens: 80, outputTokens: 50, costMicrousd: 200 });
  const providerReplay = await gateway.invoke(providerRequest);
  assert.equal(providerReplay.replayed, true);
  assert.deepEqual(providerReplay.output, { answer: '受控结果' });
  assert.equal(providerReplay.outputArtifactId, providerResult.outputArtifactId);
  const durableProviderOutput = (await admin.query(`SELECT output.*,action.response_sha256
    FROM agent_provider_output_artifacts output JOIN agent_run_actions action ON action.id=output.action_id
    WHERE output.id=$1`, [providerResult.outputArtifactId])).rows[0];
  assert.deepEqual(durableProviderOutput.content_json, { answer: '受控结果' });
  assert.equal(durableProviderOutput.content_sha256, providerResult.outputSha256);
  assert.equal(durableProviderOutput.response_sha256, providerResult.outputSha256);
  await assert.rejects(admin.query('UPDATE agent_provider_output_artifacts SET size_bytes=size_bytes+1 WHERE id=$1',
    [providerResult.outputArtifactId]), /immutable/u);
  await assert.rejects(gateway.invoke({ ...providerRequest, idempotencyKey: `provider-action:${crypto.randomUUID()}`,
    action: { ...providerRequest.action, actionKey: 'generate-json-two' } }), error => error.code === 'AGENT_RUN_BUDGET_EXCEEDED');
  const providerLedger = (await admin.query(`SELECT r.status,r.charged_cost_microusd,c.status AS call_status,a.status AS action_status
    FROM agent_budget_reservations r JOIN agent_provider_calls c ON c.reservation_id=r.id
    JOIN agent_run_actions a ON a.id=r.action_id WHERE r.run_id=$1`, [providerRun.id])).rows[0];
  assert.deepEqual({ ...providerLedger, charged_cost_microusd: Number(providerLedger.charged_cost_microusd) },
    { status: 'settled', charged_cost_microusd: 200, call_status: 'succeeded', action_status: 'succeeded' });
  assert.equal((await admin.query('SELECT position($2::bytea in ciphertext) AS plaintext_at FROM agent_provider_secrets WHERE agent_user_id=$1 AND provider=$3',
    [account.agentUserId, Buffer.from('fixture-secret-key-1234567890'), 'deepseek'])).rows[0].plaintext_at, 0);
  await runtime.completeStage({ stageId: providerStage.id, workerId: providerStage.leasedBy, leaseToken: providerStage.leaseToken,
    outputRef: { generated: true }, runOutput: { type: 'foundation.result', id: crypto.randomUUID() } });

  const concurrentRun = await runtime.createRun({
    agentUserId: account.agentUserId, workflowKey: providerManifest.workflowKey, workflowVersion: 1,
    triggerKind: 'system', idempotencyKey: `provider-concurrent:${crypto.randomUUID()}`, input: {}, config: {},
  });
  const concurrentStage = await runtime.claimNextStage('provider-concurrent-worker', 30, [`${providerManifest.workflowKey}:generate`]);
  await runtime.startStage({ stageId: concurrentStage.id, workerId: concurrentStage.leasedBy, leaseToken: concurrentStage.leaseToken });
  const concurrentBase = { ...providerRequest, runId: concurrentRun.id, stageId: concurrentStage.id,
    workerId: concurrentStage.leasedBy, leaseToken: concurrentStage.leaseToken };
  const concurrentResults = await Promise.allSettled([
    gateway.invoke({ ...concurrentBase, idempotencyKey: `provider-concurrent-a:${concurrentRun.id}`,
      action: { ...concurrentBase.action, actionKey: 'generate-a' } }),
    gateway.invoke({ ...concurrentBase, idempotencyKey: `provider-concurrent-b:${concurrentRun.id}`,
      action: { ...concurrentBase.action, actionKey: 'generate-b' } }),
  ]);
  assert.equal(concurrentResults.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(concurrentResults.filter(item => item.status === 'rejected' && item.reason?.code === 'AGENT_RUN_BUDGET_EXCEEDED').length, 1);
  assert.equal(Number((await admin.query(`SELECT count(*)::int AS n FROM agent_budget_reservations
    WHERE run_id=$1`, [concurrentRun.id])).rows[0].n), 1);
  await runtime.completeStage({ stageId: concurrentStage.id, workerId: concurrentStage.leasedBy, leaseToken: concurrentStage.leaseToken,
    outputRef: { concurrentBudget: true }, runOutput: { type: 'foundation.result', id: crypto.randomUUID() } });

  const revokedRun = await runtime.createRun({
    agentUserId: account.agentUserId, workflowKey: providerManifest.workflowKey, workflowVersion: 1,
    triggerKind: 'system', idempotencyKey: `provider-revoked:${crypto.randomUUID()}`, input: {}, config: {},
  });
  const revokedStage = await runtime.claimNextStage('provider-revoked-worker', 30, [`${providerManifest.workflowKey}:generate`]);
  await runtime.startStage({ stageId: revokedStage.id, workerId: revokedStage.leasedBy, leaseToken: revokedStage.leaseToken });
  await admin.query(`UPDATE agent_capability_grants SET status='revoked',revoked_at=now()
    WHERE agent_user_id=$1 AND capability_key='blog.article.publish' AND status='active'`, [account.agentUserId]);
  await assert.rejects(gateway.invoke({ ...providerRequest, runId: revokedRun.id, stageId: revokedStage.id,
    workerId: revokedStage.leasedBy, leaseToken: revokedStage.leaseToken,
    idempotencyKey: `provider-revoked-action:${revokedRun.id}` }), error => error.code === 'AGENT_POLICY_DENIED');
  assert.equal(Number((await admin.query('SELECT count(*)::int AS n FROM agent_budget_reservations WHERE run_id=$1', [revokedRun.id])).rows[0].n), 0);
  await runtime.failStage({ stageId: revokedStage.id, workerId: revokedStage.leasedBy, leaseToken: revokedStage.leaseToken,
    errorCode: 'AGENT_POLICY_DENIED', errorMessage: 'Capability was revoked.', retryable: false });

  const runtimeRead = createAgentRuntimeReadService({ pool: admin, authorizeOperator: async actor => actor?.role === 'admin' });
  const summaries = await runtimeRead.listRuns({ userId: operatorId, role: 'admin' }, account.agentUserId, 20);
  assert(summaries.some(item => item.id === workerRun.id && item.status === 'succeeded' && item.stageCount === 1));
  const timeline = await runtimeRead.timeline({ userId: operatorId, role: 'admin' }, account.agentUserId, uncertainRun.id);
  assert.equal(timeline.run.status, 'uncertain');
  assert.equal(timeline.stages[0].status, 'uncertain');
  assert.equal(timeline.actions[0].status, 'uncertain');
  assert(timeline.events.some(event => event.eventType === 'stage.uncertain'));
  const providerTimeline = await runtimeRead.timeline({ userId: operatorId, role: 'admin' }, account.agentUserId, providerRun.id);
  assert.equal(providerTimeline.budgetReservations[0].charged.costMicrousd, 200);
  assert.equal(providerTimeline.providerCalls[0].status, 'succeeded');
  assert.equal(providerTimeline.providerOutputArtifacts.length, 1);
  assert.equal(providerTimeline.providerOutputArtifacts[0].id, providerResult.outputArtifactId);
  assert.equal(Object.hasOwn(providerTimeline.providerOutputArtifacts[0], 'content'), false);
  await assert.rejects(runtimeRead.listRuns({ userId: operatorId, role: 'user' }, account.agentUserId), error => error.code === 'AGENT_OPERATOR_REQUIRED');
  await admin.end();
});
