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
  await admin.end();
});
