const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const harness = require('./support/researcher-qa-db.cjs');

const sha = character => character.repeat(64);

function executionManifest() {
  return {
    format: 'mooyu.capability-execution', schemaVersion: 1,
    capabilityId: `fixture.paper.layout.${crypto.randomBytes(4).toString('hex')}`,
    capabilityVersion: '1.0.0', contract: { key: 'research.paper.layout', version: 1 },
    placements: [{ target: 'desktop', adapter: 'native-package', priority: 100,
      platforms: ['windows-x64'],
      resources: { cpuCores: 2, memoryMiB: 2048, diskMiB: 4096, gpuMemoryMiB: 0 },
      permissions: { files: 'user-selected', networkDomains: [], devices: [] },
      dataPolicy: { localOnly: true, upload: 'never' }, offline: true, background: true,
      package: { url: 'https://downloads.mooyu.fun/capabilities/paper-layout/1.0.0/windows-x64.zip',
        sha256: sha('a'), signature: 'fixture-release-signature-that-is-long-enough',
        keyId: 'mooyu-release-fixture', sizeBytes: 420000000 } }],
    selectionPolicy: { preference: ['desktop'], cloudFallback: 'never',
      requiresUserPresence: false, queueWhenOffline: true },
  };
}

function workflow() {
  return { schemaVersion: 'agent-workflow-v1',
    workflowKey: `fabric.fixture.${crypto.randomBytes(5).toString('hex')}`, workflowVersion: 1,
    inputSchema: 'fabric-input-v1', outputSchema: 'fabric-output-v1', requiredCapabilities: [],
    defaultBudget: { providerCalls: 0, toolCalls: 1, inputTokens: 0, outputTokens: 0, wallClockSeconds: 300 },
    stages: [{ key: 'layout', kind: 'deterministic', dependsOn: [], maxAttempts: 2, timeoutSeconds: 120 }] };
}

test('capability execution fabric persists signed local placement evidence',
  { skip: !harness.enabled }, async () => {
    const { admin } = await harness.setup();
    const { createAgentAccountService } = await harness.load('agent-account-service.mjs');
    const { PostgresAgentAccountRepository } = await harness.load('agent-account-repository.mjs');
    const { PostgresAgentRuntimeRepository } = await harness.load('agent-runtime-repository.mjs');
    const { createAgentCapabilityExecutionService } = await harness.load('agent-capability-execution-service.mjs');
    const operatorId = crypto.randomUUID();
    await admin.query("INSERT INTO users(id,display_name,role)VALUES($1,'Fabric operator','admin')", [operatorId]);
    const account = await createAgentAccountService({ repository: new PostgresAgentAccountRepository(admin),
      authorizeOperator: async () => true }).provision({ userId: operatorId }, {
      provisionKey: `fabric-${crypto.randomUUID()}`, displayName: 'Fabric Agent',
      handle: `fabric-${crypto.randomBytes(5).toString('hex')}`, badgeLabel: 'AI 助手',
      operatorLabel: 'Fabric fixture', capabilities: [], metadata: {},
    });
    const runtime = new PostgresAgentRuntimeRepository(admin), definition = workflow();
    await runtime.registerWorkflow({ actorUserId: operatorId, manifest: definition });
    await runtime.activateWorkflow(definition.workflowKey, definition.workflowVersion);
    const createRun = suffix => runtime.createRun({ agentUserId: account.agentUserId,
      workflowKey: definition.workflowKey, workflowVersion: definition.workflowVersion,
      triggerKind: 'manual', idempotencyKey: `fabric:${suffix}:${crypto.randomUUID()}`,
      input: { suffix }, config: {} });
    const firstRun = await createRun('download');
    const firstStage = (await admin.query('SELECT id FROM agent_run_stages WHERE run_id=$1', [firstRun.id])).rows[0];

    const service = createAgentCapabilityExecutionService({ pool: admin,
      authorizeOperator: async () => true, authorizeNodeOwner: async () => true });
    const actor = { userId: operatorId }, manifest = executionManifest();
    const registered = await service.registerManifest(actor, manifest);
    assert.equal(registered.status, 'draft');
    assert.equal((await service.registerManifest(actor, manifest)).existing, true);
    await service.activateManifest(actor, manifest.capabilityId, manifest.capabilityVersion);
    await assert.rejects(admin.query(`UPDATE agent_capability_execution_manifests
      SET manifest_json=jsonb_set(manifest_json,'{schemaVersion}','2')
      WHERE capability_id=$1 AND capability_version=$2`,
    [manifest.capabilityId, manifest.capabilityVersion]));

    const node = await service.registerNode(actor, { id: crypto.randomUUID(), kind: 'desktop',
      platform: 'windows-x64', deviceKeySha256: sha('b'), runtimeVersion: '1.0.0',
      resources: { cpuCores: 8, memoryMiB: 16384, diskMiB: 100000, gpuMemoryMiB: 0 },
      permissions: { files: 'user-selected', networkDomains: [], devices: [] },
      metadata: { userPresent: true, label: 'fixture desktop' } });
    const download = await service.selectPlacement(actor, { stageId: firstStage.id,
      capabilityId: manifest.capabilityId, capabilityVersion: manifest.capabilityVersion,
      cloudConsent: false, userPresent: true });
    assert.equal(download.status, 'download-required');
    assert.equal(download.nodeId, node.id);
    assert.equal((await service.selectPlacement(actor, { stageId: firstStage.id,
      capabilityId: manifest.capabilityId, capabilityVersion: manifest.capabilityVersion,
      cloudConsent: false, userPresent: true })).existing, true);

    for (const eventType of ['download-started', 'download-completed', 'signature-verified', 'install-ready']) {
      await service.reportPackageEvent(actor, node.id, { capabilityId: manifest.capabilityId,
        capabilityVersion: manifest.capabilityVersion, packageSha256: sha('a'), eventType,
        payload: eventType === 'signature-verified' ? { verifiedBy: 'fixture-release-key' } : {} });
    }
    const secondRun = await createRun('ready');
    const secondStage = (await admin.query('SELECT id FROM agent_run_stages WHERE run_id=$1', [secondRun.id])).rows[0];
    const ready = await service.selectPlacement(actor, { stageId: secondStage.id,
      capabilityId: manifest.capabilityId, capabilityVersion: manifest.capabilityVersion,
      cloudConsent: false, userPresent: true });
    assert.equal(ready.status, 'ready');
    assert.equal(ready.target, 'desktop');
    const snapshot = await service.snapshot(actor);
    assert.equal(snapshot.nodes.length >= 1, true);
    assert.equal(snapshot.installations.some(item => item.status === 'ready'
      && item.capabilityId === manifest.capabilityId), true);
    assert.equal((await admin.query(`SELECT count(*)::int AS n FROM agent_capability_package_receipts
      WHERE node_id=$1`, [node.id])).rows[0].n, 4);
    await assert.rejects(admin.query(`UPDATE agent_stage_placement_decisions
      SET decision_status='unavailable' WHERE id=$1`, [ready.decisionId]));
    await assert.rejects(admin.query(`DELETE FROM agent_capability_package_receipts WHERE node_id=$1`, [node.id]));
  });
