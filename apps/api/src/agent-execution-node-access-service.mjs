import crypto from 'node:crypto';
import { withTransaction } from './database.mjs';
import { AgentCapabilityExecutionError } from './agent-capability-execution-service.mjs';
import { stableHash } from './researcher-qa-protocol/stable-json.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256 = /^[a-f0-9]{64}$/u;
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;
const DESKTOP_PLATFORMS = new Set(['windows-x64', 'windows-arm64', 'macos-x64', 'macos-arm64',
  'linux-x64', 'linux-arm64']);
const NODE_SCOPES = ['node:heartbeat', 'node:snapshot', 'packages:write', 'leases:claim'];

const fail = code => { throw new AgentCapabilityExecutionError(code); };
const id = value => typeof value === 'string' && UUID.test(value)
  ? value : fail('CAPABILITY_EXECUTION_INPUT_INVALID');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const json = value => JSON.stringify(value);
const opaqueToken = () => crypto.randomBytes(32).toString('base64url');
const tokenHash = token => crypto.createHash('sha256').update(token).digest();
const iso = value => value?.toISOString?.() ?? value ?? null;

function resources(value) {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'cpuCores,diskMiB,gpuMemoryMiB,memoryMiB'
    || Object.values(value).some(item => !Number.isSafeInteger(item) || item < 0)) {
    fail('CAPABILITY_EXECUTION_RESOURCES_INVALID');
  }
  return structuredClone(value);
}

function permissions(value) {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'devices,files,networkDomains'
    || !['none', 'user-selected', 'workspace'].includes(value.files)
    || !Array.isArray(value.networkDomains) || new Set(value.networkDomains).size !== value.networkDomains.length
    || value.networkDomains.length > 64 || value.networkDomains.some(domain => typeof domain !== 'string'
      || domain.length > 253
      || !/^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/iu.test(domain))
    || !Array.isArray(value.devices) || new Set(value.devices).size !== value.devices.length
    || value.devices.some(device => !['camera', 'microphone', 'gpu'].includes(device))) {
    fail('CAPABILITY_EXECUTION_PERMISSIONS_INVALID');
  }
  return structuredClone(value);
}

function publicNode(row) {
  return { id: row.id, ownerUserId: row.owner_user_id, kind: row.node_kind,
    platform: row.platform, runtimeVersion: row.runtime_version, status: row.status,
    resources: row.resource_json, permissions: row.permission_ceiling_json,
    metadata: row.metadata_json, lastSeenAt: iso(row.last_seen_at) };
}

export function createAgentExecutionNodeAccessService({ pool, authorizeOperator,
  capabilityService, runtimeRepository, clock = () => new Date(), accessTokenTtlMs = 15 * 60_000,
  renewalTokenTtlMs = 30 * 24 * 60 * 60_000 } = {}) {
  if (!pool || typeof authorizeOperator !== 'function' || !capabilityService
    || typeof capabilityService.heartbeatPairedNode !== 'function'
    || typeof capabilityService.reportPairedPackageEvent !== 'function'
    || typeof capabilityService.snapshotPairedNode !== 'function'
    || !runtimeRepository || typeof runtimeRepository.claimNextPlacedStage !== 'function'
    || typeof runtimeRepository.renewPlacedStageLease !== 'function'
    || typeof runtimeRepository.completePlacedStage !== 'function'
    || typeof runtimeRepository.failPlacedStage !== 'function') {
    fail('CAPABILITY_EXECUTION_ACCESS_DEPENDENCY_REQUIRED');
  }
  const requireOperator = async actor => {
    const userId = id(actor?.userId);
    if (await authorizeOperator(structuredClone(actor)) !== true) {
      fail('CAPABILITY_EXECUTION_OPERATOR_REQUIRED');
    }
    return userId;
  };
  const requireLeaseActor = actor => {
    if (actor?.principalType !== 'execution-node' || !UUID.test(String(actor.nodeId ?? ''))
      || !UUID.test(String(actor.ownerUserId ?? '')) || !UUID.test(String(actor.grantId ?? ''))
      || !Array.isArray(actor.scopes) || !actor.scopes.includes('leases:claim')) {
      fail('CAPABILITY_EXECUTION_NODE_AUTH_REQUIRED');
    }
    return { nodeId: actor.nodeId, ownerUserId: actor.ownerUserId, grantId: actor.grantId };
  };
  const runtimeCall = async operation => {
    try { return await operation(); } catch (error) {
      if (error?.code === 'AGENT_RUNTIME_LEASE_LOST') fail('CAPABILITY_EXECUTION_LEASE_LOST');
      if (error?.code === 'AGENT_RUNTIME_NODE_RESULT_IDEMPOTENCY_CONFLICT') {
        fail('CAPABILITY_EXECUTION_RESULT_IDEMPOTENCY_CONFLICT');
      }
      if (error?.code === 'AGENT_RUNTIME_NODE_RESULT_CONTRACT_MISMATCH') {
        fail('CAPABILITY_EXECUTION_RESULT_CONTRACT_MISMATCH');
      }
      if (String(error?.code ?? '').startsWith('AGENT_RUNTIME_')) {
        fail('CAPABILITY_EXECUTION_STAGE_LEASE_INVALID');
      }
      throw error;
    }
  };

  const normalizeResultRef = input => {
    if (!object(input) || Object.keys(input).sort().join(',')
      !== 'artifactId,contract,mediaType,metadata,schemaVersion,sha256,sizeBytes,storage'
      || input.schemaVersion !== 'capability-output-ref-v1'
      || !UUID.test(String(input.artifactId ?? '')) || input.storage !== 'node-local'
      || typeof input.sha256 !== 'string' || !SHA256.test(input.sha256)
      || !Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 0
      || input.sizeBytes > 50 * 1024 * 1024 * 1024
      || typeof input.mediaType !== 'string' || input.mediaType.length < 3
      || input.mediaType.length > 160 || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/iu.test(input.mediaType)
      || !object(input.contract) || Object.keys(input.contract).sort().join(',') !== 'key,version'
      || typeof input.contract.key !== 'string' || !/^[a-z][a-z0-9.-]{2,119}$/u.test(input.contract.key)
      || !Number.isSafeInteger(input.contract.version) || input.contract.version < 1
      || !object(input.metadata) || Buffer.byteLength(json(input.metadata), 'utf8') > 8192) {
      fail('CAPABILITY_EXECUTION_RESULT_INVALID');
    }
    return structuredClone(input);
  };
  const event = (client, { ownerUserId, nodeId = null, grantId = null, pairingId = null,
    eventType, payload = {} }) => client.query(`INSERT INTO agent_execution_node_access_events(
      id,owner_user_id,node_id,grant_id,pairing_id,event_type,payload_json)
    VALUES($1,$2,$3,$4,$5,$6,$7)`, [crypto.randomUUID(), ownerUserId, nodeId, grantId,
    pairingId, eventType, json(payload)]);

  const createPairing = async (actor, input) => {
    const ownerUserId = await requireOperator(actor);
    input = structuredClone(input);
    const deviceLabel = String(input.deviceLabel ?? '').trim().replace(/\s+/gu, ' ');
    const kind = input.kind;
    const platform = input.platform;
    const ttlSeconds = input.ttlSeconds == null ? 300 : input.ttlSeconds;
    if (deviceLabel.length < 1 || deviceLabel.length > 120
      || !['desktop', 'browser'].includes(kind)
      || (kind === 'browser' ? platform !== 'web' : !DESKTOP_PLATFORMS.has(platform))
      || !Number.isSafeInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 600) {
      fail('CAPABILITY_EXECUTION_PAIRING_INPUT_INVALID');
    }
    const ceiling = permissions(input.permissions);
    const pairingId = crypto.randomUUID(), pairingCode = opaqueToken(), now = clock();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    await withTransaction(pool, async client => {
      await client.query(`INSERT INTO agent_execution_node_pairings(id,owner_user_id,
          created_by_user_id,device_label,node_kind,platform,permission_ceiling_json,
          pairing_code_hash,expires_at)
        VALUES($1,$2,$2,$3,$4,$5,$6,$7,$8)`, [pairingId, ownerUserId, deviceLabel,
        kind, platform, json(ceiling), tokenHash(pairingCode), expiresAt]);
      await event(client, { ownerUserId, pairingId, eventType: 'pairing-created',
        payload: { deviceLabel, kind, platform, expiresAt: expiresAt.toISOString() } });
    });
    return { schemaVersion: 'agent-execution-node-pairing-v1', pairingId, pairingCode,
      expiresAt: expiresAt.toISOString(), deviceLabel, kind, platform, permissions: ceiling };
  };

  const claimPairing = async input => {
    input = structuredClone(input);
    const pairingId = id(input.pairingId), pairingCode = String(input.pairingCode ?? '');
    if (!/^[A-Za-z0-9_-]{40,64}$/u.test(pairingCode)
      || typeof input.deviceKeySha256 !== 'string' || !SHA256.test(input.deviceKeySha256)
      || typeof input.runtimeVersion !== 'string' || !SEMVER.test(input.runtimeVersion)
      || !object(input.metadata) || Buffer.byteLength(json(input.metadata)) > 16384) {
      fail('CAPABILITY_EXECUTION_PAIRING_INVALID');
    }
    const available = resources(input.resources), now = clock();
    const accessToken = opaqueToken(), renewalToken = opaqueToken();
    const accessExpiresAt = new Date(now.getTime() + accessTokenTtlMs);
    const renewalExpiresAt = new Date(now.getTime() + renewalTokenTtlMs);
    const material = { accessToken, renewalToken, accessExpiresAt, renewalExpiresAt,
      grantId: crypto.randomUUID(), accessTokenId: crypto.randomUUID(),
      renewalTokenId: crypto.randomUUID(), familyId: crypto.randomUUID() };
    const result = await withTransaction(pool, async client => {
      const pairing = (await client.query(`SELECT * FROM agent_execution_node_pairings
        WHERE id=$1 FOR UPDATE`, [pairingId])).rows[0];
      const suppliedHash = tokenHash(pairingCode);
      const matches = pairing?.pairing_code_hash && suppliedHash.length === pairing.pairing_code_hash.length
        && crypto.timingSafeEqual(suppliedHash, pairing.pairing_code_hash);
      if (!pairing || pairing.status !== 'pending' || pairing.attempts >= 5
        || new Date(pairing.expires_at) <= now || !matches) {
        if (pairing?.status === 'pending') {
          const expired = new Date(pairing.expires_at) <= now;
          const attempts = Math.min(5, Number(pairing.attempts) + (expired ? 0 : 1));
          await client.query(`UPDATE agent_execution_node_pairings SET attempts=$2,
              status=CASE WHEN $3 OR $2>=5 THEN 'revoked' ELSE status END,
              revoked_at=CASE WHEN $3 OR $2>=5 THEN $4 ELSE revoked_at END WHERE id=$1`,
          [pairingId, attempts, expired, now]);
        }
        return null;
      }
      const nodeId = crypto.randomUUID();
      const node = (await client.query(`INSERT INTO agent_execution_nodes(id,owner_user_id,node_kind,
          platform,device_key_sha256,runtime_version,status,resource_json,
          permission_ceiling_json,metadata_json,last_seen_at)
        VALUES($1,$2,$3,$4,$5,$6,'online',$7,$8,$9,$10)
        ON CONFLICT(owner_user_id,device_key_sha256)DO UPDATE SET
          runtime_version=EXCLUDED.runtime_version,status='online',resource_json=EXCLUDED.resource_json,
          permission_ceiling_json=EXCLUDED.permission_ceiling_json,
          metadata_json=EXCLUDED.metadata_json,last_seen_at=EXCLUDED.last_seen_at,updated_at=now()
        WHERE agent_execution_nodes.status<>'revoked'
          AND agent_execution_nodes.node_kind=EXCLUDED.node_kind
          AND agent_execution_nodes.platform=EXCLUDED.platform RETURNING *`, [nodeId,
        pairing.owner_user_id, pairing.node_kind, pairing.platform, input.deviceKeySha256,
        input.runtimeVersion, json(available), json(pairing.permission_ceiling_json),
        json(input.metadata), now])).rows[0];
      if (!node) fail('CAPABILITY_EXECUTION_NODE_CONFLICT');
      await client.query(`INSERT INTO agent_execution_node_grants(id,node_id,owner_user_id,
          pairing_id,scopes,authenticated_at,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7)`, [material.grantId, node.id, pairing.owner_user_id,
        pairingId, NODE_SCOPES, now, renewalExpiresAt]);
      await client.query(`INSERT INTO agent_execution_node_access_tokens(id,grant_id,token_hash,expires_at)
        VALUES($1,$2,$3,$4)`, [material.accessTokenId, material.grantId,
        tokenHash(accessToken), accessExpiresAt]);
      await client.query(`INSERT INTO agent_execution_node_renewal_tokens(id,grant_id,family_id,
          generation,token_hash,expires_at)VALUES($1,$2,$3,0,$4,$5)`,
      [material.renewalTokenId, material.grantId, material.familyId,
        tokenHash(renewalToken), renewalExpiresAt]);
      await client.query(`UPDATE agent_execution_node_pairings SET status='claimed',claimed_node_id=$2,
        claimed_at=$3 WHERE id=$1`, [pairingId, node.id, now]);
      await event(client, { ownerUserId: pairing.owner_user_id, nodeId: node.id,
        grantId: material.grantId, pairingId, eventType: 'pairing-claimed',
        payload: { runtimeVersion: input.runtimeVersion } });
      return { node };
    });
    if (!result) fail('CAPABILITY_EXECUTION_PAIRING_INVALID');
    return { schemaVersion: 'agent-execution-node-session-v1', node: publicNode(result.node),
      accessToken, accessExpiresAt: accessExpiresAt.toISOString(), renewalToken,
      renewalExpiresAt: renewalExpiresAt.toISOString(), scopes: NODE_SCOPES };
  };

  const authenticateNodeBearer = async header => {
    const match = /^Bearer ([A-Za-z0-9_-]{32,})$/u.exec(header ?? '');
    if (!match) fail('CAPABILITY_EXECUTION_NODE_AUTH_REQUIRED');
    const row = (await pool.query(`SELECT token.grant_id,g.node_id,g.owner_user_id,
        g.scopes,node.status AS node_status,u.status AS user_status,u.account_type
      FROM agent_execution_node_access_tokens token
      JOIN agent_execution_node_grants g ON g.id=token.grant_id
      JOIN agent_execution_nodes node ON node.id=g.node_id AND node.owner_user_id=g.owner_user_id
      JOIN users u ON u.id=g.owner_user_id
      WHERE token.token_hash=$1 AND token.revoked_at IS NULL AND token.expires_at>$2
        AND g.revoked_at IS NULL AND g.expires_at>$2 AND node.status<>'revoked'
        AND u.status='active' AND u.account_type='human'`, [tokenHash(match[1]), clock()])).rows[0];
    if (!row) fail('CAPABILITY_EXECUTION_NODE_TOKEN_INVALID');
    return { principalType: 'execution-node', grantId: row.grant_id, nodeId: row.node_id,
      ownerUserId: row.owner_user_id, scopes: row.scopes };
  };

  const refreshSession = async input => {
    const renewalToken = String(input?.renewalToken ?? '');
    if (!/^[A-Za-z0-9_-]{32,}$/u.test(renewalToken)) fail('CAPABILITY_EXECUTION_NODE_TOKEN_INVALID');
    const now = clock(), nextAccessToken = opaqueToken(), nextRenewalToken = opaqueToken();
    const accessExpiresAt = new Date(now.getTime() + accessTokenTtlMs);
    const ids = { access: crypto.randomUUID(), renewal: crypto.randomUUID() };
    const result = await withTransaction(pool, async client => {
      const row = (await client.query(`SELECT renewal.*,g.node_id,g.owner_user_id,
          g.scopes,g.expires_at AS grant_expires_at,g.revoked_at AS grant_revoked_at,
          node.status AS node_status
        FROM agent_execution_node_renewal_tokens renewal
        JOIN agent_execution_node_grants g ON g.id=renewal.grant_id
        JOIN agent_execution_nodes node ON node.id=g.node_id
        WHERE renewal.token_hash=$1 FOR UPDATE OF renewal,g,node`, [tokenHash(renewalToken)])).rows[0];
      if (!row) return { ok: false };
      if (row.used_at || row.revoked_at) {
        await client.query(`UPDATE agent_execution_node_renewal_tokens SET revoked_at=COALESCE(revoked_at,$2)
          WHERE family_id=$1`, [row.family_id, now]);
        await client.query(`UPDATE agent_execution_node_access_tokens SET revoked_at=COALESCE(revoked_at,$2)
          WHERE grant_id=$1`, [row.grant_id, now]);
        await client.query(`UPDATE agent_execution_node_grants SET revoked_at=COALESCE(revoked_at,$2)
          WHERE id=$1`, [row.grant_id, now]);
        await event(client, { ownerUserId: row.owner_user_id, nodeId: row.node_id,
          grantId: row.grant_id, eventType: 'session-revoked', payload: { reason: 'renewal-reuse' } });
        return { ok: false };
      }
      if (new Date(row.expires_at) <= now || new Date(row.grant_expires_at) <= now
        || row.grant_revoked_at || row.node_status === 'revoked') return { ok: false };
      const boundedAccessExpiry = new Date(Math.min(accessExpiresAt.getTime(),
        new Date(row.grant_expires_at).getTime()));
      await client.query(`UPDATE agent_execution_node_access_tokens SET revoked_at=COALESCE(revoked_at,$2)
        WHERE grant_id=$1`, [row.grant_id, now]);
      await client.query(`INSERT INTO agent_execution_node_access_tokens(id,grant_id,token_hash,expires_at)
        VALUES($1,$2,$3,$4)`, [ids.access, row.grant_id, tokenHash(nextAccessToken), boundedAccessExpiry]);
      await client.query(`INSERT INTO agent_execution_node_renewal_tokens(id,grant_id,family_id,
          generation,token_hash,expires_at)VALUES($1,$2,$3,$4,$5,$6)`, [ids.renewal,
        row.grant_id, row.family_id, Number(row.generation) + 1,
        tokenHash(nextRenewalToken), row.expires_at]);
      await client.query(`UPDATE agent_execution_node_renewal_tokens SET used_at=$2,replaced_by=$3
        WHERE id=$1`, [row.id, now, ids.renewal]);
      await event(client, { ownerUserId: row.owner_user_id, nodeId: row.node_id,
        grantId: row.grant_id, eventType: 'session-refreshed',
        payload: { generation: Number(row.generation) + 1 } });
      return { ok: true, row, accessExpiresAt: boundedAccessExpiry };
    });
    if (!result.ok) fail('CAPABILITY_EXECUTION_NODE_TOKEN_INVALID');
    return { schemaVersion: 'agent-execution-node-session-v1', nodeId: result.row.node_id,
      accessToken: nextAccessToken, accessExpiresAt: result.accessExpiresAt.toISOString(),
      renewalToken: nextRenewalToken, renewalExpiresAt: new Date(result.row.expires_at).toISOString(),
      scopes: result.row.scopes };
  };

  const heartbeat = (actor, input) => capabilityService.heartbeatPairedNode(actor, input);
  const reportPackageEvent = (actor, input) => capabilityService.reportPairedPackageEvent(actor, input);
  const nodeSnapshot = actor => capabilityService.snapshotPairedNode(actor);

  const claimStageLease = async (actor, input = {}) => {
    const principal = requireLeaseActor(actor);
    const leaseSeconds = input.leaseSeconds == null ? 120 : input.leaseSeconds;
    if (!object(input) || Object.keys(input).some(key => key !== 'leaseSeconds')
      || !Number.isSafeInteger(leaseSeconds) || leaseSeconds < 15 || leaseSeconds > 600) {
      fail('CAPABILITY_EXECUTION_STAGE_LEASE_INVALID');
    }
    const claimed = await runtimeCall(() => runtimeRepository.claimNextPlacedStage({
      ...principal, leaseSeconds,
    }));
    return claimed ? { schemaVersion: 'agent-execution-stage-lease-v1', status: 'claimed', ...claimed }
      : { schemaVersion: 'agent-execution-stage-lease-v1', status: 'idle' };
  };

  const renewStageLease = async (actor, executionLeaseId, input) => {
    const principal = requireLeaseActor(actor), leaseSeconds = input?.leaseSeconds ?? 120;
    if (!object(input) || Object.keys(input).sort().join(',') !== 'leaseSeconds,leaseToken'
      || !UUID.test(String(input.leaseToken ?? '')) || !Number.isSafeInteger(leaseSeconds)
      || leaseSeconds < 15 || leaseSeconds > 600) fail('CAPABILITY_EXECUTION_STAGE_LEASE_INVALID');
    return { schemaVersion: 'agent-execution-stage-lease-renewal-v1',
      ...(await runtimeCall(() => runtimeRepository.renewPlacedStageLease({
        executionLeaseId: id(executionLeaseId), ...principal,
        leaseToken: input.leaseToken, leaseSeconds,
      }))) };
  };

  const completeStageLease = async (actor, executionLeaseId, input) => {
    const principal = requireLeaseActor(actor);
    if (!object(input) || Object.keys(input).sort().join(',') !== 'leaseToken,result,submissionId'
      || !UUID.test(String(input.leaseToken ?? '')) || !UUID.test(String(input.submissionId ?? ''))) {
      fail('CAPABILITY_EXECUTION_RESULT_INVALID');
    }
    const resultRef = normalizeResultRef(input.result), resultSha256 = stableHash(resultRef);
    return { schemaVersion: 'agent-execution-stage-result-v1',
      ...(await runtimeCall(() => runtimeRepository.completePlacedStage({
        executionLeaseId: id(executionLeaseId), ...principal, leaseToken: input.leaseToken,
        submissionId: input.submissionId, resultRef, resultSha256,
      }))) };
  };

  const failStageLease = async (actor, executionLeaseId, input) => {
    const principal = requireLeaseActor(actor);
    if (!object(input) || Object.keys(input).sort().join(',')
      !== 'errorCode,errorMessage,leaseToken,outcome,retryable'
      || !UUID.test(String(input.leaseToken ?? ''))
      || typeof input.errorCode !== 'string' || !/^[A-Z][A-Z0-9_]{2,119}$/u.test(input.errorCode)
      || typeof input.errorMessage !== 'string' || input.errorMessage.length < 1
      || input.errorMessage.length > 500 || typeof input.retryable !== 'boolean'
      || !['safe-failure', 'uncertain'].includes(input.outcome)) {
      fail('CAPABILITY_EXECUTION_STAGE_FAILURE_INVALID');
    }
    return { schemaVersion: 'agent-execution-stage-failure-v1',
      ...(await runtimeCall(() => runtimeRepository.failPlacedStage({
        executionLeaseId: id(executionLeaseId), ...principal, leaseToken: input.leaseToken,
        errorCode: input.errorCode, errorMessage: input.errorMessage,
        retryable: input.retryable, uncertain: input.outcome === 'uncertain',
      }))) };
  };

  const revokeNode = async (actor, nodeId, reason) => {
    const ownerUserId = await requireOperator(actor), normalizedReason = String(reason ?? '').trim();
    if (normalizedReason.length < 10 || normalizedReason.length > 500) {
      fail('CAPABILITY_EXECUTION_REVOCATION_REASON_INVALID');
    }
    return withTransaction(pool, async client => {
      const node = (await client.query(`UPDATE agent_execution_nodes SET status='revoked',
          revoked_at=now(),updated_at=now() WHERE id=$1 AND owner_user_id=$2 AND status<>'revoked'
        RETURNING *`, [id(nodeId), ownerUserId])).rows[0];
      if (!node) fail('CAPABILITY_EXECUTION_NODE_NOT_FOUND');
      const grants = (await client.query(`UPDATE agent_execution_node_grants
        SET revoked_at=COALESCE(revoked_at,now()) WHERE node_id=$1 AND revoked_at IS NULL RETURNING id`,
      [node.id])).rows.map(row => row.id);
      if (grants.length) {
        await client.query(`UPDATE agent_execution_node_access_tokens SET revoked_at=COALESCE(revoked_at,now())
          WHERE grant_id=ANY($1::uuid[])`, [grants]);
        await client.query(`UPDATE agent_execution_node_renewal_tokens SET revoked_at=COALESCE(revoked_at,now())
          WHERE grant_id=ANY($1::uuid[])`, [grants]);
      }
      await event(client, { ownerUserId, nodeId: node.id, eventType: 'node-revoked',
        payload: { reason: normalizedReason, revokedGrantCount: grants.length } });
      return { nodeId: node.id, status: 'revoked', revokedGrantCount: grants.length };
    });
  };

  const snapshot = async actor => {
    const ownerUserId = await requireOperator(actor), now = clock();
    const [pairings, grants] = await Promise.all([
      pool.query(`SELECT id,device_label,node_kind,platform,status,attempts,expires_at,
          claimed_node_id,claimed_at,revoked_at,created_at
        FROM agent_execution_node_pairings WHERE owner_user_id=$1
        ORDER BY created_at DESC,id DESC LIMIT 100`, [ownerUserId]),
      pool.query(`SELECT g.id,g.node_id,g.scopes,g.authenticated_at,
          g.expires_at,g.revoked_at,node.status AS node_status
        FROM agent_execution_node_grants g JOIN agent_execution_nodes node ON node.id=g.node_id
        WHERE g.owner_user_id=$1 ORDER BY g.created_at DESC,g.id DESC LIMIT 100`, [ownerUserId]),
    ]);
    return { schemaVersion: 'agent-execution-node-access-snapshot-v1',
      pairings: pairings.rows.map(row => ({ id: row.id, deviceLabel: row.device_label,
        kind: row.node_kind, platform: row.platform,
        status: row.status === 'pending' && new Date(row.expires_at) <= now ? 'expired' : row.status,
        attempts: row.attempts, expiresAt: iso(row.expires_at), nodeId: row.claimed_node_id,
        claimedAt: iso(row.claimed_at), createdAt: iso(row.created_at) })),
      sessions: grants.rows.map(row => ({ id: row.id, nodeId: row.node_id, scopes: row.scopes,
        status: row.revoked_at ? 'revoked' : new Date(row.expires_at) <= now ? 'expired'
          : row.node_status === 'revoked' ? 'revoked' : 'active',
        authenticatedAt: iso(row.authenticated_at), expiresAt: iso(row.expires_at) })) };
  };

  return { createPairing, claimPairing, authenticateNodeBearer, refreshSession, heartbeat,
    reportPackageEvent, nodeSnapshot, claimStageLease, renewStageLease,
    completeStageLease, failStageLease, revokeNode, snapshot };
}
