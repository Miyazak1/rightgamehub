const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const harness = require('./support/researcher-qa-db.cjs');

test('Agent tool gateway persists one bounded immutable artifact on isolated PostgreSQL', { skip: !harness.enabled }, async () => {
  const { admin } = await harness.setup();
  const { createAgentAccountService } = await harness.load('agent-account-service.mjs');
  const { PostgresAgentAccountRepository } = await harness.load('agent-account-repository.mjs');
  const { PostgresAgentRuntimeRepository } = await harness.load('agent-runtime-repository.mjs');
  const { createAgentRuntimePolicyService } = await harness.load('agent-runtime-policy-service.mjs');
  const { createAgentRuntimeReadService } = await harness.load('agent-runtime-read-service.mjs');
  const { PostgresAgentToolGatewayRepository } = await harness.load('agent-tool-gateway-repository.mjs');
  const { createAgentToolGateway } = await harness.load('agent-tool-gateway.mjs');
  const { GITHUB_REPOSITORY_READ_TOOL } = await harness.load('agent-github-repository-tool.mjs');
  const operatorId = crypto.randomUUID();
  await admin.query("INSERT INTO users(id,display_name,role) VALUES($1,'Tool operator','admin')", [operatorId]);
  const accounts = createAgentAccountService({ repository: new PostgresAgentAccountRepository(admin), authorizeOperator: async () => true });
  const account = await accounts.provision({ userId: operatorId }, {
    provisionKey: `tool-${crypto.randomUUID()}`, displayName: 'Tool Agent',
    handle: `tool-${crypto.randomBytes(5).toString('hex')}`, badgeLabel: 'AI 助手', operatorLabel: 'Tool test',
    capabilities: ['blog:auto-publish'], metadata: {},
  });
  const runtime = new PostgresAgentRuntimeRepository(admin);
  const workflow = {
    schemaVersion: 'agent-workflow-v1', workflowKey: `tool.test.${crypto.randomBytes(5).toString('hex')}`, workflowVersion: 1,
    inputSchema: 'tool-test-input-v1', outputSchema: 'tool-test-output-v1',
    requiredCapabilities: [{ key: 'research.github.read', version: 1 }],
    defaultBudget: { providerCalls: 0, toolCalls: 1, inputTokens: 0, outputTokens: 0, wallClockSeconds: 120 },
    stages: [{ key: 'research', kind: 'tool', dependsOn: [], maxAttempts: 1, timeoutSeconds: 30,
      capability: { key: 'research.github.read', version: 1 }, idempotencyMode: 'key' }],
  };
  await runtime.registerWorkflow({ actorUserId: operatorId, manifest: workflow });
  await runtime.activateWorkflow(workflow.workflowKey, 1);
  const run = await runtime.createRun({
    agentUserId: account.agentUserId, workflowKey: workflow.workflowKey, workflowVersion: 1,
    triggerKind: 'manual', idempotencyKey: `tool-run:${crypto.randomUUID()}`, input: {}, config: {},
  });
  const stage = await runtime.claimNextStage('tool-worker', 30, [`${workflow.workflowKey}:research`]);
  await runtime.startStage({ stageId: stage.id, workerId: stage.leasedBy, leaseToken: stage.leaseToken });
  const tools = new PostgresAgentToolGatewayRepository(admin);
  assert.equal((await tools.registerTool(GITHUB_REPOSITORY_READ_TOOL)).toolKey, GITHUB_REPOSITORY_READ_TOOL.toolKey);
  assert.equal((await tools.registerTool(GITHUB_REPOSITORY_READ_TOOL)).existing, true);
  const output = {
    schemaVersion: 'fixture-evidence-v1', repository: { key: 'owner/project' },
    sourceVersion: { revision: 'a'.repeat(40) }, metadata: { stars: 42 }, readme: { text: 'Fixture' },
  };
  const gateway = createAgentToolGateway({
    runtimeRepository: runtime, toolRepository: tools, policyService: createAgentRuntimePolicyService({ pool: admin }),
    adapters: { 'research.github.repository.read@1': async () => ({
      receiptId: `github:owner/project@${'a'.repeat(40)}`, output,
      responseRef: { canonicalUri: 'https://github.com/owner/project', revision: 'a'.repeat(40) }, usage: { toolCalls: 1 },
    }) },
    inputSchemas: { 'github.repository.read.input@1': value => value },
    outputSchemas: { 'github.repository.read.output@1': value => value },
  });
  const base = {
    runId: run.id, stageId: stage.id, workerId: stage.leasedBy, leaseToken: stage.leaseToken,
    action: { actionKey: 'read-repository', actionKind: 'tool', capabilityKey: 'research.github.read', contractVersion: 1, riskLevel: 'L1' },
    idempotencyKey: `tool-action:${run.id}`, resource: { type: 'github.repository', owner: 'public', id: 'owner/project' },
    tool: { toolKey: GITHUB_REPOSITORY_READ_TOOL.toolKey, contractVersion: 1 }, request: { repository: 'owner/project' },
  };
  const competing = [base, { ...base, idempotencyKey: `tool-action-two:${run.id}`,
    action: { ...base.action, actionKey: 'read-repository-two' } }];
  const outcomes = await Promise.allSettled(competing.map(input => gateway.invoke(input)));
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(item => item.status === 'rejected' && item.reason?.code === 'AGENT_RUN_TOOL_BUDGET_EXCEEDED').length, 1);
  const winner = outcomes.findIndex(item => item.status === 'fulfilled');
  const result = outcomes[winner].value;
  assert.equal(result.status, 'succeeded');
  assert.equal((await gateway.invoke(competing[winner])).replayed, true);
  const artifact = (await admin.query(`SELECT artifact.*,call.status AS call_status,action.status AS action_status
    FROM agent_tool_artifacts artifact JOIN agent_tool_calls call ON call.id=artifact.tool_call_id
    JOIN agent_run_actions action ON action.id=artifact.action_id WHERE action.run_id=$1`, [run.id])).rows[0];
  assert.equal(artifact.call_status, 'succeeded');
  assert.equal(artifact.action_status, 'succeeded');
  assert.equal(artifact.content_json.repository.key, 'owner/project');
  assert.equal(artifact.content_sha256, result.responseRef.sha256);
  assert.equal((await admin.query('SELECT usage_json FROM agent_runs WHERE id=$1', [run.id])).rows[0].usage_json.toolCalls, 1);
  await assert.rejects(admin.query('UPDATE agent_tool_artifacts SET size_bytes=size_bytes+1 WHERE id=$1', [artifact.id]), /immutable/u);
  assert.equal(Number((await admin.query('SELECT count(*)::int AS n FROM agent_tool_calls call JOIN agent_run_actions action ON action.id=call.action_id WHERE action.run_id=$1', [run.id])).rows[0].n), 1);
  const readService = createAgentRuntimeReadService({ pool: admin, authorizeOperator: async () => true });
  const timeline = await readService.timeline({ userId: operatorId }, account.agentUserId, run.id);
  assert.equal(timeline.toolCalls[0].status, 'succeeded');
  assert.equal(timeline.toolArtifacts[0].contentSha256, artifact.content_sha256);
  assert.equal(Object.hasOwn(timeline.toolArtifacts[0], 'content'), false);
  await runtime.completeStage({ stageId: stage.id, workerId: stage.leasedBy, leaseToken: stage.leaseToken,
    outputRef: { artifactId: result.artifactId }, runOutput: { type: 'tool.fixture', id: result.artifactId } });
  await admin.end();
});
