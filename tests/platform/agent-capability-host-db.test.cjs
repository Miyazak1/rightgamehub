const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const harness = require('./support/researcher-qa-db.cjs');

const sha = character => character.repeat(64);

function workflow() {
  return {
    schemaVersion: 'agent-workflow-v1',
    workflowKey: `host.fixture.${crypto.randomBytes(5).toString('hex')}`,
    workflowVersion: 1,
    inputSchema: 'host-fixture-input-v1',
    outputSchema: 'host-fixture-output-v1',
    requiredCapabilities: [{ key: 'research.paper.layout', version: 1 }],
    defaultBudget: {
      providerCalls: 0, toolCalls: 1, inputTokens: 0, outputTokens: 0, wallClockSeconds: 300,
    },
    stages: [{ key: 'layout', kind: 'deterministic', dependsOn: [], maxAttempts: 2,
      timeoutSeconds: 120, capability: { key: 'research.paper.layout', version: 1 } }],
  };
}

function executionManifest() {
  return {
    format: 'mooyu.capability-execution',
    schemaVersion: 1,
    capabilityId: `fixture.host.layout.${crypto.randomBytes(4).toString('hex')}`,
    capabilityVersion: '1.0.0',
    contract: { key: 'research.paper.layout', version: 1 },
    placements: [{
      target: 'desktop', adapter: 'native-package', priority: 100,
      platforms: ['windows-x64'],
      resources: { cpuCores: 1, memoryMiB: 512, diskMiB: 1024, gpuMemoryMiB: 0 },
      permissions: { files: 'user-selected', networkDomains: [], devices: [] },
      dataPolicy: { localOnly: true, upload: 'never' },
      offline: true, background: true,
      package: {
        url: 'https://downloads.mooyu.fun/capabilities/host-fixture/1.0.0/windows-x64.zip',
        sha256: sha('a'), signature: 'fixture-release-signature-that-is-long-enough',
        keyId: 'mooyu-release-fixture', sizeBytes: 4096,
      },
    }],
    selectionPolicy: { preference: ['desktop'], cloudFallback: 'never',
      requiresUserPresence: false, queueWhenOffline: true },
  };
}

const profile = {
  schemaVersion: 'capability-host-profile-v1', host: 'cursor', hostVersion: '1.0.0',
  surface: 'sidebar', connection: 'control-plane',
  features: { submit: true, cancel: true, resume: true, artifacts: true,
    fileConsent: true, background: false },
};

test('capability host gateway reuses Runtime ledger with explicit immutable binding',
  { skip: !harness.enabled }, async () => {
    const { admin } = await harness.setup();
    const { createAgentAccountService } = await harness.load('agent-account-service.mjs');
    const { PostgresAgentAccountRepository } = await harness.load('agent-account-repository.mjs');
    const { PostgresAgentRuntimeRepository } = await harness.load('agent-runtime-repository.mjs');
    const { createAgentCapabilityExecutionService } = await harness.load('agent-capability-execution-service.mjs');
    const { createAgentCapabilityHostService } = await harness.load('agent-capability-host-service.mjs');
    const operatorId = crypto.randomUUID();
    await admin.query("INSERT INTO users(id,display_name,role)VALUES($1,'Host operator','admin')", [operatorId]);
    const account = await createAgentAccountService({
      repository: new PostgresAgentAccountRepository(admin), authorizeOperator: async () => true,
    }).provision({ userId: operatorId }, {
      provisionKey: `host-${crypto.randomUUID()}`, displayName: 'Host Agent',
      handle: `host-${crypto.randomBytes(5).toString('hex')}`, badgeLabel: 'AI 助手',
      operatorLabel: 'Host fixture', capabilities: [], metadata: {},
    });
    await admin.query(`INSERT INTO agent_capability_grants(id,agent_user_id,capability_key,
        contract_version,scope_json,risk_ceiling,granted_by_user_id,reason)
      VALUES($1,$2,'research.paper.layout',1,'{}','L2',$3,'Capability host fixture')`,
    [crypto.randomUUID(), account.agentUserId, operatorId]);

    const runtime = new PostgresAgentRuntimeRepository(admin);
    const definition = workflow();
    await runtime.registerWorkflow({ actorUserId: operatorId, manifest: definition });
    await runtime.activateWorkflow(definition.workflowKey, definition.workflowVersion);
    const capabilityService = createAgentCapabilityExecutionService({ pool: admin,
      authorizeOperator: async () => true, authorizeNodeOwner: async () => true });
    const manifest = executionManifest();
    await capabilityService.registerManifest({ userId: operatorId }, manifest);
    await capabilityService.activateManifest({ userId: operatorId },
      manifest.capabilityId, manifest.capabilityVersion);

    const host = createAgentCapabilityHostService({ pool: admin, runtimeRepository: runtime,
      authorizeOperator: async () => true });
    const actor = { userId: operatorId };
    const binding = {
      capabilityId: manifest.capabilityId, capabilityVersion: manifest.capabilityVersion,
      workflowKey: definition.workflowKey, workflowVersion: definition.workflowVersion,
      features: { cancel: true, resume: true, artifacts: true, openMode: 'host-preview' },
    };
    assert.equal((await host.registerBinding(actor, binding)).existing, false);
    assert.equal((await host.registerBinding(actor, binding)).existing, true);
    await assert.rejects(admin.query(`UPDATE agent_capability_host_bindings
      SET settings_json=jsonb_set(settings_json,'{features,cancel}','false')
      WHERE capability_id=$1 AND capability_version=$2`,
    [manifest.capabilityId, manifest.capabilityVersion]));

    const before = await host.snapshot(actor, account.agentUserId, profile);
    assert.deepEqual(before.runs, []);
    const submission = {
      capabilityId: manifest.capabilityId, capabilityVersion: manifest.capabilityVersion,
      contractKey: 'research.paper.layout@1', input: { localDocumentId: 'fixture-document' },
      idempotencyKey: `cursor-host-${crypto.randomUUID()}`,
    };
    const run = await host.submit(actor, account.agentUserId, profile, submission);
    assert.equal(run.state, 'queued');
    assert.equal(run.capabilityId, manifest.capabilityId);
    assert.equal(run.contractKey, 'research.paper.layout@1');
    assert.equal(run.progress.total, 1);
    assert.equal((await host.submit(actor, account.agentUserId, profile, submission)).runId, run.runId);

    const stored = (await admin.query(`SELECT trigger_kind,trigger_ref,config_snapshot
      FROM agent_runs WHERE id=$1`, [run.runId])).rows[0];
    assert.equal(stored.trigger_kind, 'interaction');
    assert.equal(stored.trigger_ref, 'host:cursor');
    assert.equal(stored.config_snapshot.capabilityHost.profile.host, 'cursor');
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM agent_runs WHERE id=$1',
      [run.runId])).rows[0].n, 1);

    const cancelled = await host.cancel(actor, account.agentUserId, run.runId, profile);
    assert.equal(cancelled.state, 'cancelled');
    assert.equal((await admin.query(`SELECT count(*)::int AS n FROM agent_run_events
      WHERE run_id=$1 AND event_type='run.host-cancelled'`, [run.runId])).rows[0].n, 1);
  });
