const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const harness = require('./support/researcher-qa-db.cjs');

const nodeInput = deviceKeySha256 => ({ pairingCode: null, deviceKeySha256,
  runtimeVersion: '1.2.3', resources: { cpuCores: 8, memoryMiB: 16384,
    diskMiB: 100000, gpuMemoryMiB: 0 }, metadata: { userPresent: true, app: 'fixture' } });
const pairInput = { deviceLabel: 'Fixture desktop', kind: 'desktop', platform: 'windows-x64',
  permissions: { files: 'user-selected', networkDomains: ['api.github.com'], devices: [] } };

test('trusted execution node pairing uses dedicated rotating credentials and revocation evidence',
  { skip: !harness.enabled }, async () => {
    const { admin } = await harness.setup();
    const { createAgentCapabilityExecutionService } = await harness.load('agent-capability-execution-service.mjs');
    const { createAgentExecutionNodeAccessService } = await harness.load('agent-execution-node-access-service.mjs');
    const { PostgresAgentRuntimeRepository } = await harness.load('agent-runtime-repository.mjs');
    const operatorId = crypto.randomUUID();
    await admin.query("INSERT INTO users(id,display_name,role)VALUES($1,'Node operator','admin')", [operatorId]);
    const capabilityService = createAgentCapabilityExecutionService({ pool: admin,
      authorizeOperator: async () => true, authorizeNodeOwner: async () => true });
    const access = createAgentExecutionNodeAccessService({ pool: admin,
      authorizeOperator: async () => true, capabilityService,
      runtimeRepository: new PostgresAgentRuntimeRepository(admin) });
    const actor = { userId: operatorId }, deviceKeySha256 = 'c'.repeat(64);

    const pairing = await access.createPairing(actor, pairInput);
    assert.equal(pairing.pairingCode.length >= 40, true);
    const storedPairing = (await admin.query(`SELECT pairing_code_hash,status,attempts
      FROM agent_execution_node_pairings WHERE id=$1`, [pairing.pairingId])).rows[0];
    assert.equal(Buffer.isBuffer(storedPairing.pairing_code_hash), true);
    assert.equal(storedPairing.pairing_code_hash.toString('utf8').includes(pairing.pairingCode), false);
    await assert.rejects(access.claimPairing({ ...nodeInput(deviceKeySha256),
      pairingId: pairing.pairingId, pairingCode: 'x'.repeat(43) }), /PAIRING_INVALID/);
    assert.equal((await admin.query('SELECT attempts FROM agent_execution_node_pairings WHERE id=$1',
      [pairing.pairingId])).rows[0].attempts, 1);

    const session = await access.claimPairing({ ...nodeInput(deviceKeySha256),
      pairingId: pairing.pairingId, pairingCode: pairing.pairingCode });
    assert.equal(session.node.kind, 'desktop');
    assert.deepEqual(session.scopes.sort(),
      ['node:heartbeat', 'node:snapshot', 'packages:write', 'leases:claim'].sort());
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM device_grants WHERE user_id=$1',
      [operatorId])).rows[0].n, 0, 'execution nodes must not receive a human login grant');
    const principal = await access.authenticateNodeBearer(`Bearer ${session.accessToken}`);
    assert.equal(principal.nodeId, session.node.id);
    const heartbeat = await access.heartbeat(principal, { resources: { cpuCores: 6,
      memoryMiB: 12000, diskMiB: 90000, gpuMemoryMiB: 0 }, metadata: { userPresent: false } });
    assert.equal(heartbeat.resources.cpuCores, 6);
    const nodeSnapshot = await access.nodeSnapshot(principal);
    assert.equal(nodeSnapshot.node.id, session.node.id);

    const rotated = await access.refreshSession({ renewalToken: session.renewalToken });
    await assert.rejects(access.authenticateNodeBearer(`Bearer ${session.accessToken}`), /TOKEN_INVALID/);
    assert.equal((await access.authenticateNodeBearer(`Bearer ${rotated.accessToken}`)).nodeId, session.node.id);
    await assert.rejects(access.refreshSession({ renewalToken: session.renewalToken }), /TOKEN_INVALID/);
    await assert.rejects(access.authenticateNodeBearer(`Bearer ${rotated.accessToken}`), /TOKEN_INVALID/,
      'renewal-token reuse revokes the narrow execution grant');

    const secondPairing = await access.createPairing(actor, pairInput);
    const secondSession = await access.claimPairing({ ...nodeInput(deviceKeySha256),
      pairingId: secondPairing.pairingId, pairingCode: secondPairing.pairingCode });
    assert.equal(secondSession.node.id, session.node.id, 're-pairing preserves the device identity');
    const revoked = await access.revokeNode(actor, secondSession.node.id,
      'Fixture operator revoked this execution device.');
    assert.equal(revoked.status, 'revoked');
    await assert.rejects(access.authenticateNodeBearer(`Bearer ${secondSession.accessToken}`), /TOKEN_INVALID/);
    const view = await access.snapshot(actor);
    assert.equal(view.sessions.some(item => item.status === 'revoked'), true);
    assert.equal((await admin.query(`SELECT count(*)::int AS n FROM agent_execution_node_access_events
      WHERE owner_user_id=$1`, [operatorId])).rows[0].n >= 7, true);
    await assert.rejects(admin.query(`UPDATE agent_execution_node_access_events SET payload_json='{}'
      WHERE owner_user_id=$1`, [operatorId]));
  });
