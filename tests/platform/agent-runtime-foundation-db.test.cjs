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

  const claims = await Promise.all([runtime.claimNextStage('foundation-worker-a', 60), runtime.claimNextStage('foundation-worker-b', 60)]);
  const rootClaims = claims.filter(item => item?.runId === run.id);
  assert.equal(rootClaims.length, 1);
  const prepare = rootClaims[0];
  await runtime.startStage({ stageId: prepare.id, workerId: prepare.leasedBy, leaseToken: prepare.leaseToken });
  const completed = await runtime.completeStage({ stageId: prepare.id, workerId: prepare.leasedBy, leaseToken: prepare.leaseToken, outputRef: { selected: true } });
  assert.equal(completed.unlocked.length, 1);
  await assert.rejects(runtime.renewStageLease({ stageId: prepare.id, workerId: prepare.leasedBy, leaseToken: prepare.leaseToken }), error => error.code === 'AGENT_RUNTIME_LEASE_LOST');

  const publish = await runtime.claimNextStage('foundation-worker-publish', 60);
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
  const workerOutputId = crypto.randomUUID();
  const worker = createAgentRuntimeWorker({
    repository: runtime, workerId: 'foundation-runtime-worker', instanceId: crypto.randomUUID(),
    leaseSeconds: 30, heartbeatSeconds: 5, outboxBatch: 25,
    handlers: { [`${workerManifest.workflowKey}:execute`]: async context => ({
      outputRef: { inputHash: context.run.inputSha256 }, runOutput: { type: 'foundation.result', id: workerOutputId },
    }) },
  });
  const workerResult = await worker.runOnce();
  assert.equal(workerResult.status, 'completed');
  assert.equal(workerResult.run.outputId, workerOutputId);
  assert.equal((await admin.query('SELECT status FROM agent_runs WHERE id=$1', [workerRun.id])).rows[0].status, 'succeeded');
  assert.equal((await admin.query("SELECT count(*)::int AS n FROM agent_runtime_outbox WHERE status='pending'", [])).rows[0].n, 0);
  await worker.stop();
  assert.equal((await admin.query("SELECT status FROM agent_runtime_workers WHERE worker_id='foundation-runtime-worker'")).rows[0].status, 'offline');

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

  const staleOutbox = (await admin.query("SELECT * FROM agent_runtime_outbox WHERE status='pending' ORDER BY created_at DESC LIMIT 1")).rows[0];
  if (staleOutbox) {
    await admin.query("UPDATE agent_runtime_outbox SET status='dispatching',attempts=attempts+1,lease_token=$2,lease_until=now()-interval '1 second' WHERE id=$1", [staleOutbox.id, crypto.randomUUID()]);
    assert.equal((await runtime.recoverExpiredOutbox({ baseBackoffSeconds: 0 })).requeued, 1);
  }
  const runtimeRead = createAgentRuntimeReadService({ pool: admin, authorizeOperator: async actor => actor?.role === 'admin' });
  const summaries = await runtimeRead.listRuns({ userId: operatorId, role: 'admin' }, account.agentUserId, 20);
  assert(summaries.some(item => item.id === workerRun.id && item.status === 'succeeded' && item.stageCount === 1));
  const timeline = await runtimeRead.timeline({ userId: operatorId, role: 'admin' }, account.agentUserId, uncertainRun.id);
  assert.equal(timeline.run.status, 'uncertain');
  assert.equal(timeline.stages[0].status, 'uncertain');
  assert.equal(timeline.actions[0].status, 'uncertain');
  assert(timeline.events.some(event => event.eventType === 'stage.uncertain'));
  await assert.rejects(runtimeRead.listRuns({ userId: operatorId, role: 'user' }, account.agentUserId), error => error.code === 'AGENT_OPERATOR_REQUIRED');
  await admin.end();
});
