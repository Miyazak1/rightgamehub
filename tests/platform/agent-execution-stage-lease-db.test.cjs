const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const harness = require('./support/researcher-qa-db.cjs');

const sha = character => character.repeat(64);

function executionManifest() {
  return {
    format: 'mooyu.capability-execution', schemaVersion: 1,
    capabilityId: `fixture.local.layout.${crypto.randomBytes(4).toString('hex')}`,
    capabilityVersion: '1.0.0', contract: { key: 'research.paper.layout', version: 1 },
    placements: [{ target: 'desktop', adapter: 'native-package', priority: 100,
      platforms: ['windows-x64'],
      resources: { cpuCores: 1, memoryMiB: 512, diskMiB: 1024, gpuMemoryMiB: 0 },
      permissions: { files: 'user-selected', networkDomains: [], devices: [] },
      dataPolicy: { localOnly: true, upload: 'never' }, offline: true, background: true,
      package: { url: 'https://downloads.mooyu.fun/capabilities/layout-fixture/1.0.0/windows-x64.zip',
        sha256: sha('a'), signature: 'fixture-release-signature-that-is-long-enough',
        keyId: 'mooyu-release-fixture', sizeBytes: 4096 } }],
    selectionPolicy: { preference: ['desktop'], cloudFallback: 'never',
      requiresUserPresence: false, queueWhenOffline: true },
  };
}

function workflow() {
  return { schemaVersion: 'agent-workflow-v1',
    workflowKey: `lease.fixture.${crypto.randomBytes(5).toString('hex')}`, workflowVersion: 1,
    inputSchema: 'lease-input-v1', outputSchema: 'lease-output-v1',
    requiredCapabilities: [{ key: 'research.paper.layout', version: 1 }],
    defaultBudget: { providerCalls: 0, toolCalls: 1, inputTokens: 0, outputTokens: 0,
      wallClockSeconds: 300 },
    stages: [
      { key: 'layout', kind: 'deterministic', dependsOn: [], maxAttempts: 3,
        timeoutSeconds: 120, capability: { key: 'research.paper.layout', version: 1 } },
      { key: 'finish', kind: 'deterministic', dependsOn: ['layout'], maxAttempts: 1,
        timeoutSeconds: 30 },
    ] };
}

const pairingInput = { deviceLabel: 'Lease fixture desktop', kind: 'desktop',
  platform: 'windows-x64', permissions: { files: 'user-selected', networkDomains: [], devices: [] } };

test('trusted local stage lease completes atomically and preserves Runtime as the only queue',
  { skip: !harness.enabled }, async () => {
    const { admin } = await harness.setup();
    const { createAgentAccountService } = await harness.load('agent-account-service.mjs');
    const { PostgresAgentAccountRepository } = await harness.load('agent-account-repository.mjs');
    const { PostgresAgentRuntimeRepository } = await harness.load('agent-runtime-repository.mjs');
    const { createAgentCapabilityExecutionService } = await harness.load('agent-capability-execution-service.mjs');
    const { createAgentExecutionNodeAccessService } = await harness.load('agent-execution-node-access-service.mjs');
    const operatorId = crypto.randomUUID();
    await admin.query("INSERT INTO users(id,display_name,role)VALUES($1,'Lease operator','admin')", [operatorId]);
    const account = await createAgentAccountService({ repository: new PostgresAgentAccountRepository(admin),
      authorizeOperator: async () => true }).provision({ userId: operatorId }, {
      provisionKey: `lease-${crypto.randomUUID()}`, displayName: 'Lease Agent',
      handle: `lease-${crypto.randomBytes(5).toString('hex')}`, badgeLabel: 'AI 助手',
      operatorLabel: 'Lease fixture', capabilities: [], metadata: {},
    });
    await admin.query(`INSERT INTO agent_capability_grants(id,agent_user_id,capability_key,
        contract_version,scope_json,risk_ceiling,granted_by_user_id,reason)
      VALUES($1,$2,'research.paper.layout',1,'{}','L2',$3,'Local execution lease fixture')`,
    [crypto.randomUUID(), account.agentUserId, operatorId]);

    const runtime = new PostgresAgentRuntimeRepository(admin), definition = workflow();
    await runtime.registerWorkflow({ actorUserId: operatorId, manifest: definition });
    await runtime.activateWorkflow(definition.workflowKey, definition.workflowVersion);
    const capabilityService = createAgentCapabilityExecutionService({ pool: admin,
      authorizeOperator: async () => true, authorizeNodeOwner: async () => true });
    const access = createAgentExecutionNodeAccessService({ pool: admin,
      authorizeOperator: async () => true, capabilityService, runtimeRepository: runtime });
    const actor = { userId: operatorId }, manifest = executionManifest();
    await capabilityService.registerManifest(actor, manifest);
    await capabilityService.activateManifest(actor, manifest.capabilityId, manifest.capabilityVersion);

    const pairing = await access.createPairing(actor, pairingInput);
    const session = await access.claimPairing({ pairingId: pairing.pairingId,
      pairingCode: pairing.pairingCode, deviceKeySha256: sha('b'), runtimeVersion: '1.0.0',
      resources: { cpuCores: 4, memoryMiB: 8192, diskMiB: 50000, gpuMemoryMiB: 0 },
      metadata: { userPresent: true, app: 'lease-fixture' } });
    const principal = await access.authenticateNodeBearer(`Bearer ${session.accessToken}`);
    for (const eventType of ['download-started', 'download-completed', 'signature-verified', 'install-ready']) {
      await access.reportPackageEvent(principal, { capabilityId: manifest.capabilityId,
        capabilityVersion: manifest.capabilityVersion, packageSha256: sha('a'), eventType,
        payload: eventType === 'signature-verified' ? { verifiedBy: 'fixture-release-key' } : {} });
    }

    const createRun = suffix => runtime.createRun({ agentUserId: account.agentUserId,
      workflowKey: definition.workflowKey, workflowVersion: definition.workflowVersion,
      triggerKind: 'manual', idempotencyKey: `lease:${suffix}:${crypto.randomUUID()}`,
      input: { localDocumentId: suffix }, config: { privacy: 'local-only' } });
    const firstRun = await createRun('complete');
    const firstStage = (await admin.query(`SELECT * FROM agent_run_stages
      WHERE run_id=$1 AND stage_key='layout'`, [firstRun.id])).rows[0];
    const ready = await capabilityService.selectPlacement(actor, { stageId: firstStage.id,
      capabilityId: manifest.capabilityId, capabilityVersion: manifest.capabilityVersion,
      cloudConsent: false, userPresent: true });
    assert.equal(ready.status, 'ready');
    assert.equal(await runtime.claimNextStage('server-worker', 60,
      [`${definition.workflowKey}:layout`], firstRun.id), null,
    'the server worker must not steal a stage placed on a local node');

    const claimed = await access.claimStageLease(principal, { leaseSeconds: 90 });
    assert.equal(claimed.status, 'claimed');
    assert.equal(claimed.stage.stageKey, 'layout');
    assert.equal(claimed.capability.contract.key, 'research.paper.layout');
    assert.equal(claimed.input.value.localDocumentId, 'complete');
    assert.equal(Object.hasOwn(claimed.stage, 'leaseToken'), false,
      'the stage view must not duplicate the raw lease credential');
    const storedLease = (await admin.query(`SELECT * FROM agent_execution_stage_leases
      WHERE id=$1`, [claimed.lease.id])).rows[0];
    assert.notEqual(storedLease.lease_token_sha256, claimed.lease.token);
    assert.equal(storedLease.lease_token_sha256,
      crypto.createHash('sha256').update(claimed.lease.token).digest('hex'));
    assert.equal(storedLease.manifest_sha256, claimed.capability.manifestSha256);
    assert.equal(storedLease.run_input_sha256, claimed.input.sha256);
    const renewal = await access.renewStageLease(principal, claimed.lease.id,
      { leaseToken: claimed.lease.token, leaseSeconds: 120 });
    assert.equal(new Date(renewal.expiresAt) > new Date(claimed.lease.expiresAt), true);

    const submissionId = crypto.randomUUID();
    const result = { schemaVersion: 'capability-output-ref-v1', artifactId: crypto.randomUUID(),
      storage: 'node-local', sha256: sha('d'), sizeBytes: 2048,
      mediaType: 'application/vnd.mooyu.paper-layout+json',
      contract: { key: 'research.paper.layout', version: 1 },
      metadata: { localDocumentId: 'complete', pageCount: 12 } };
    await assert.rejects(access.completeStageLease(principal, claimed.lease.id, {
      leaseToken: claimed.lease.token, submissionId: crypto.randomUUID(),
      result: { ...result, contract: { key: 'research.paper.layout', version: 2 } },
    }), error => error.code === 'CAPABILITY_EXECUTION_RESULT_CONTRACT_MISMATCH');
    const completed = await access.completeStageLease(principal, claimed.lease.id,
      { leaseToken: claimed.lease.token, submissionId, result });
    assert.equal(completed.stage.status, 'succeeded');
    assert.equal(completed.unlocked[0].stageKey, 'finish');
    const replay = await access.completeStageLease(principal, claimed.lease.id,
      { leaseToken: claimed.lease.token, submissionId, result });
    assert.equal(replay.existing, true);
    await assert.rejects(access.completeStageLease(principal, claimed.lease.id,
      { leaseToken: claimed.lease.token, submissionId,
        result: { ...result, artifactId: crypto.randomUUID() } }),
    error => error.code === 'CAPABILITY_EXECUTION_RESULT_IDEMPOTENCY_CONFLICT');
    const receipt = (await admin.query(`SELECT * FROM agent_execution_stage_result_receipts
      WHERE execution_lease_id=$1`, [claimed.lease.id])).rows[0];
    assert.equal(receipt.result_ref_json.artifactId, result.artifactId);
    await assert.rejects(admin.query(`UPDATE agent_execution_stage_result_receipts
      SET result_sha256=$2 WHERE id=$1`, [receipt.id, sha('e')]));
    await assert.rejects(admin.query(`DELETE FROM agent_execution_stage_result_receipts WHERE id=$1`,
      [receipt.id]));

    const retryRun = await createRun('retry');
    const retryStage = (await admin.query(`SELECT * FROM agent_run_stages
      WHERE run_id=$1 AND stage_key='layout'`, [retryRun.id])).rows[0];
    await capabilityService.selectPlacement(actor, { stageId: retryStage.id,
      capabilityId: manifest.capabilityId, capabilityVersion: manifest.capabilityVersion,
      cloudConsent: false, userPresent: true });
    const retryClaim = await access.claimStageLease(principal, { leaseSeconds: 90 });
    assert.equal(retryClaim.stage.id, retryStage.id);
    const failed = await access.failStageLease(principal, retryClaim.lease.id, {
      leaseToken: retryClaim.lease.token, errorCode: 'FIXTURE_SAFE_FAILURE',
      errorMessage: 'The local fixture failed before producing an external side effect.',
      retryable: true, outcome: 'safe-failure' });
    assert.equal(failed.retryScheduled, true);
    assert.equal(failed.stage.status, 'queued');
    assert.equal(await runtime.claimNextStage('server-worker-after-retry', 60,
      [`${definition.workflowKey}:layout`], retryRun.id), null,
    'a retry remains local-only until a fresh placement decision exists');
    const secondPlacement = await capabilityService.selectPlacement(actor, { stageId: retryStage.id,
      capabilityId: manifest.capabilityId, capabilityVersion: manifest.capabilityVersion,
      cloudConsent: false, userPresent: true });
    assert.equal(secondPlacement.existing, false);
    assert.equal((await access.claimStageLease(principal, { leaseSeconds: 90 })).stage.id,
      retryStage.id);
  });
