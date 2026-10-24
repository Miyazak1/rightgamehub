const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const contractsUrl = pathToFileURL(path.join(root, 'apps/api/src/agent-runtime-contracts.mjs'));

function manifest() {
  return {
    schemaVersion: 'agent-workflow-v1',
    workflowKey: 'blog.project.single',
    workflowVersion: 1,
    inputSchema: 'blog-project-input-v1',
    outputSchema: 'blog-article-output-v1',
    requiredCapabilities: [{ key: 'blog.article.publish', version: 1 }],
    defaultBudget: { providerCalls: 4, toolCalls: 12, inputTokens: 80000, outputTokens: 12000, wallClockSeconds: 1800 },
    stages: [
      { key: 'select-subject', kind: 'deterministic', dependsOn: [], maxAttempts: 2, timeoutSeconds: 60 },
      { key: 'publish', kind: 'domain-write', dependsOn: ['select-subject'], maxAttempts: 1, timeoutSeconds: 60, capability: { key: 'blog.article.publish', version: 1 }, idempotencyMode: 'queryable' },
    ],
  };
}

test('workflow manifests are bounded, deterministic DAG contracts', async () => {
  const { normalizeWorkflowManifest, workflowManifestDigest, AgentRuntimeContractError } = await import(contractsUrl.href);
  const input = manifest();
  const normalized = normalizeWorkflowManifest(input);
  assert.deepEqual(normalized, input);
  assert.notEqual(normalized, input);
  assert.match(workflowManifestDigest(input), /^[a-f0-9]{64}$/u);
  assert.equal(workflowManifestDigest(input), workflowManifestDigest({
    workflowVersion: 1,
    workflowKey: 'blog.project.single',
    schemaVersion: 'agent-workflow-v1',
    outputSchema: 'blog-article-output-v1',
    inputSchema: 'blog-project-input-v1',
    requiredCapabilities: [{ version: 1, key: 'blog.article.publish' }],
    defaultBudget: { wallClockSeconds: 1800, outputTokens: 12000, inputTokens: 80000, toolCalls: 12, providerCalls: 4 },
    stages: input.stages.map(stage => ({ ...stage })),
  }));
  const missing = manifest();
  missing.stages[1].dependsOn = ['missing-stage'];
  assert.throws(() => normalizeWorkflowManifest(missing), error => error instanceof AgentRuntimeContractError && error.code === 'AGENT_WORKFLOW_DEPENDENCY_MISSING');
  const cycle = manifest();
  cycle.stages[0].dependsOn = ['publish'];
  assert.throws(() => normalizeWorkflowManifest(cycle), error => error.code === 'AGENT_WORKFLOW_CYCLE');
  const unsafeWrite = manifest();
  delete unsafeWrite.stages[1].idempotencyMode;
  assert.throws(() => normalizeWorkflowManifest(unsafeWrite), error => error.code === 'AGENT_WORKFLOW_WRITE_IDEMPOTENCY_REQUIRED');
  const undeclared = manifest();
  undeclared.stages[1].capability.key = 'tool.execute';
  assert.throws(() => normalizeWorkflowManifest(undeclared), error => error.code === 'AGENT_WORKFLOW_STAGE_CAPABILITY_UNDECLARED');
});

test('runtime state machines fail closed at terminal and unsafe transitions', async () => {
  const { assertStateTransition } = await import(contractsUrl.href);
  assert.equal(assertStateTransition('run', 'queued', 'running'), true);
  assert.equal(assertStateTransition('stage', 'running', 'succeeded'), true);
  assert.equal(assertStateTransition('action', 'sent', 'uncertain'), true);
  assert.throws(() => assertStateTransition('run', 'queued', 'succeeded'), /AGENT_RUNTIME_STATE_TRANSITION_DENIED/u);
  assert.throws(() => assertStateTransition('stage', 'succeeded', 'queued'), /AGENT_RUNTIME_STATE_TRANSITION_DENIED/u);
  assert.throws(() => assertStateTransition('action', 'sending', 'succeeded'), /AGENT_RUNTIME_STATE_TRANSITION_DENIED/u);
});

test('schedule idempotency binds schedule and logical fire time', async () => {
  const { scheduleRunIdempotencyKey } = await import(contractsUrl.href);
  const first = scheduleRunIdempotencyKey('schedule-a', '2026-10-25T02:00:00.000Z');
  assert.equal(first, scheduleRunIdempotencyKey('schedule-a', '2026-10-25T02:00:00.000Z'));
  assert.notEqual(first, scheduleRunIdempotencyKey('schedule-a', '2026-10-26T02:00:00.000Z'));
  assert.match(first, /^schedule:[a-f0-9]{64}$/u);
});

test('foundation migration and repository retain leases, append-only audit and no legacy blog coupling', () => {
  const migration = fs.readFileSync(path.join(root, 'apps/api/migrations/0123_agent_runtime_foundation.sql'), 'utf8');
  const recoveryMigration = fs.readFileSync(path.join(root, 'apps/api/migrations/0124_agent_runtime_worker_recovery.sql'), 'utf8');
  const repository = fs.readFileSync(path.join(root, 'apps/api/src/agent-runtime-repository.mjs'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'apps/api/src/agent-runtime-worker.mjs'), 'utf8');
  for (const table of ['agent_workflow_definitions', 'agent_capability_grants', 'agent_policy_profiles', 'agent_runs', 'agent_run_stages', 'agent_run_actions', 'agent_run_events', 'agent_schedules', 'agent_runtime_outbox']) {
    assert.match(migration, new RegExp(`CREATE TABLE ${table}\\b`, 'u'));
  }
  assert.match(migration, /Agent run events are append-only/u);
  assert.match(migration, /Agent run frozen fields or terminal state cannot change/u);
  assert.match(migration, /Invalid Agent run state transition/u);
  assert.match(migration, /FOREIGN KEY\(run_id,action_id\)/u);
  assert.match(migration, /agent_runtime_account_seed/u);
  assert.match(repository, /FOR UPDATE OF account,s SKIP LOCKED/u);
  assert.match(repository, /leased_by=\$2 AND lease_token=\$3 AND lease_until>now\(\)/u);
  assert.doesNotMatch(repository, /agent_blog_runs|agent_blog_automation_settings/u);
  assert.match(recoveryMigration, /CREATE TABLE agent_runtime_workers/u);
  assert.match(recoveryMigration, /Agent runtime outbox identity or terminal state cannot change/u);
  assert.match(worker, /AGENT_RUNTIME_HANDLER_NOT_REGISTERED/u);
  assert.doesNotMatch(worker, /agent_blog_runs|agent_blog_automation_settings|deepseek/u);
});
