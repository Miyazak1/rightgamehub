import crypto from 'node:crypto';
import {
  selectCapabilityExecution,
  validateCapabilityExecutionManifestV1,
} from '@gamehub/agent-capabilities';
import { withTransaction } from './database.mjs';
import { stableHash } from './researcher-qa-protocol/stable-json.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256 = /^[a-f0-9]{64}$/u;
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;
const NODE_KINDS = new Set(['browser', 'desktop', 'cloud']);
const PLATFORMS = new Set(['web', 'windows-x64', 'windows-arm64', 'macos-x64', 'macos-arm64',
  'linux-x64', 'linux-arm64', 'server-linux-x64', 'server-linux-arm64']);
const PACKAGE_EVENTS = new Set(['download-started', 'download-completed', 'signature-verified',
  'install-ready', 'install-failed', 'removed']);

export class AgentCapabilityExecutionError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AgentCapabilityExecutionError';
    this.code = code;
    this.retryable = false;
    this.statusCode = code.includes('_TOKEN_') || code.includes('_AUTH_') || code.includes('_PAIRING_INVALID')
      ? 401 : code.endsWith('_NOT_FOUND') ? 404
        : code.endsWith('_REQUIRED') ? 403
          : code.endsWith('_CONFLICT') || code.endsWith('_LEASE_LOST') ? 409 : 400;
  }
}

const fail = code => { throw new AgentCapabilityExecutionError(code); };
const id = value => typeof value === 'string' && UUID.test(value) ? value : fail('CAPABILITY_EXECUTION_INPUT_INVALID');
const hash = value => typeof value === 'string' && SHA256.test(value) ? value : fail('CAPABILITY_EXECUTION_INPUT_INVALID');
const iso = value => value?.toISOString?.() ?? value ?? null;
const json = value => JSON.stringify(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key))
  && keys.every(key => Object.hasOwn(value, key));

function resources(value) {
  if (!exact(value, ['cpuCores', 'memoryMiB', 'diskMiB', 'gpuMemoryMiB'])
    || Object.values(value).some(item => !Number.isSafeInteger(item) || item < 0)) {
    fail('CAPABILITY_EXECUTION_RESOURCES_INVALID');
  }
  return structuredClone(value);
}

function permissions(value) {
  if (!exact(value, ['files', 'networkDomains', 'devices'])
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

function nodeView(row) {
  return row ? {
    id: row.id, ownerUserId: row.owner_user_id, kind: row.node_kind, platform: row.platform,
    runtimeVersion: row.runtime_version, status: row.status, resources: row.resource_json,
    permissions: row.permission_ceiling_json, metadata: row.metadata_json,
    lastSeenAt: iso(row.last_seen_at), revokedAt: iso(row.revoked_at),
  } : null;
}

function manifestPackages(manifest) {
  return new Set(manifest.placements.filter(item => item.package).map(item => item.package.sha256));
}

export function createAgentCapabilityExecutionService({ pool, authorizeOperator, authorizeNodeOwner,
  nodeStaleAfterMs = 300000 } = {}) {
  if (!pool || typeof authorizeOperator !== 'function' || typeof authorizeNodeOwner !== 'function') {
    fail('CAPABILITY_EXECUTION_DEPENDENCY_REQUIRED');
  }
  const actorId = actor => id(actor?.userId);
  const requireOperator = async actor => {
    const userId = actorId(actor);
    if (await authorizeOperator(structuredClone(actor)) !== true) fail('CAPABILITY_EXECUTION_OPERATOR_REQUIRED');
    return userId;
  };
  const requireOwner = async actor => {
    const userId = actorId(actor);
    if (await authorizeNodeOwner(structuredClone(actor)) !== true) fail('CAPABILITY_EXECUTION_OWNER_REQUIRED');
    return userId;
  };
  const requireNodePrincipal = (actor, scope) => {
    if (actor?.principalType !== 'execution-node' || !UUID.test(String(actor.nodeId ?? ''))
      || !UUID.test(String(actor.ownerUserId ?? '')) || !Array.isArray(actor.scopes)
      || !actor.scopes.includes(scope)) fail('CAPABILITY_EXECUTION_NODE_AUTH_REQUIRED');
    return { nodeId: actor.nodeId, ownerUserId: actor.ownerUserId };
  };

  const registerManifest = async (actor, input) => {
    const userId = await requireOperator(actor);
    const manifest = validateCapabilityExecutionManifestV1(structuredClone(input));
    const digest = stableHash(manifest);
    const inserted = (await pool.query(`INSERT INTO agent_capability_execution_manifests(
        capability_id,capability_version,contract_key,contract_version,schema_version,
        manifest_json,manifest_sha256,status,created_by_user_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,'draft',$8)
      ON CONFLICT(capability_id,capability_version)DO NOTHING RETURNING *`, [manifest.capabilityId,
      manifest.capabilityVersion, manifest.contract.key, manifest.contract.version, manifest.schemaVersion,
      json(manifest), digest, userId])).rows[0];
    if (inserted) return { capabilityId: inserted.capability_id, capabilityVersion: inserted.capability_version,
      manifestSha256: inserted.manifest_sha256, status: inserted.status, existing: false };
    const existing = (await pool.query(`SELECT * FROM agent_capability_execution_manifests
      WHERE capability_id=$1 AND capability_version=$2`, [manifest.capabilityId, manifest.capabilityVersion])).rows[0];
    if (!existing || existing.manifest_sha256 !== digest) fail('CAPABILITY_EXECUTION_MANIFEST_CONFLICT');
    return { capabilityId: existing.capability_id, capabilityVersion: existing.capability_version,
      manifestSha256: existing.manifest_sha256, status: existing.status, existing: true };
  };

  const activateManifest = async (actor, capabilityId, capabilityVersion) => {
    await requireOperator(actor);
    const row = (await pool.query(`UPDATE agent_capability_execution_manifests
      SET status='active',activated_at=now() WHERE capability_id=$1 AND capability_version=$2
        AND status='draft' RETURNING *`, [capabilityId, capabilityVersion])).rows[0];
    if (!row) fail('CAPABILITY_EXECUTION_MANIFEST_NOT_ACTIVATABLE');
    return { capabilityId: row.capability_id, capabilityVersion: row.capability_version, status: row.status };
  };

  const registerNodeForOwner = async (ownerUserId, input) => {
    ownerUserId = id(ownerUserId);
    input = structuredClone(input);
    const nodeId = input.id == null ? crypto.randomUUID() : id(input.id);
    if (!NODE_KINDS.has(input.kind) || !PLATFORMS.has(input.platform)
      || input.kind === 'browser' !== (input.platform === 'web')
      || typeof input.runtimeVersion !== 'string' || !SEMVER.test(input.runtimeVersion)
      || !object(input.metadata) || Buffer.byteLength(json(input.metadata)) > 16384) {
      fail('CAPABILITY_EXECUTION_NODE_INVALID');
    }
    const row = (await pool.query(`INSERT INTO agent_execution_nodes(id,owner_user_id,node_kind,platform,
        device_key_sha256,runtime_version,status,resource_json,permission_ceiling_json,metadata_json)
      VALUES($1,$2,$3,$4,$5,$6,'online',$7,$8,$9)
      ON CONFLICT(owner_user_id,device_key_sha256)DO UPDATE SET runtime_version=EXCLUDED.runtime_version,
        status='online',resource_json=EXCLUDED.resource_json,
        permission_ceiling_json=EXCLUDED.permission_ceiling_json,metadata_json=EXCLUDED.metadata_json,
        last_seen_at=now(),updated_at=now() RETURNING *`, [nodeId, ownerUserId, input.kind, input.platform,
      hash(input.deviceKeySha256), input.runtimeVersion, json(resources(input.resources)),
      json(permissions(input.permissions)), json(input.metadata)])).rows[0];
    return nodeView(row);
  };
  const registerNode = async (actor, input) => registerNodeForOwner(await requireOwner(actor), input);

  const heartbeatNodeForOwner = async (ownerUserId, nodeId, input) => {
    ownerUserId = id(ownerUserId);
    input = structuredClone(input);
    if (!object(input.metadata) || Buffer.byteLength(json(input.metadata)) > 16384) {
      fail('CAPABILITY_EXECUTION_NODE_INVALID');
    }
    const row = (await pool.query(`UPDATE agent_execution_nodes SET status='online',resource_json=$3,
        metadata_json=$4,last_seen_at=now(),updated_at=now()
      WHERE id=$1 AND owner_user_id=$2 AND status<>'revoked' RETURNING *`, [id(nodeId), ownerUserId,
      json(resources(input.resources)), json(input.metadata)])).rows[0];
    if (!row) fail('CAPABILITY_EXECUTION_NODE_NOT_FOUND');
    return nodeView(row);
  };
  const heartbeatNode = async (actor, nodeId, input) => heartbeatNodeForOwner(
    await requireOwner(actor), nodeId, input);
  const heartbeatPairedNode = async (actor, input) => {
    const principal = requireNodePrincipal(actor, 'node:heartbeat');
    return heartbeatNodeForOwner(principal.ownerUserId, principal.nodeId, input);
  };

  const reportPackageEventForOwner = async (ownerUserId, nodeId, input) => {
    ownerUserId = id(ownerUserId);
    input = structuredClone(input);
    nodeId = id(nodeId);
    if (!PACKAGE_EVENTS.has(input.eventType) || typeof input.capabilityId !== 'string'
      || typeof input.capabilityVersion !== 'string' || !SEMVER.test(input.capabilityVersion)
      || !object(input.payload) || Buffer.byteLength(json(input.payload)) > 32768) {
      fail('CAPABILITY_EXECUTION_PACKAGE_EVENT_INVALID');
    }
    const packageSha256 = hash(input.packageSha256);
    return withTransaction(pool, async client => {
      const node = (await client.query(`SELECT * FROM agent_execution_nodes
        WHERE id=$1 AND owner_user_id=$2 AND status<>'revoked' FOR UPDATE`, [nodeId, ownerUserId])).rows[0];
      if (!node) fail('CAPABILITY_EXECUTION_NODE_NOT_FOUND');
      const manifestRow = (await client.query(`SELECT * FROM agent_capability_execution_manifests
        WHERE capability_id=$1 AND capability_version=$2 AND status='active' FOR SHARE`,
      [input.capabilityId, input.capabilityVersion])).rows[0];
      if (!manifestRow) fail('CAPABILITY_EXECUTION_MANIFEST_NOT_FOUND');
      if (!manifestPackages(validateCapabilityExecutionManifestV1(manifestRow.manifest_json)).has(packageSha256)) {
        fail('CAPABILITY_EXECUTION_PACKAGE_MISMATCH');
      }
      const nextStatus = ({ 'download-started': 'downloading', 'download-completed': 'downloading',
        'signature-verified': 'installed', 'install-ready': 'ready', 'install-failed': 'failed',
        removed: 'removed' })[input.eventType];
      const existing = (await client.query(`SELECT * FROM agent_execution_node_capabilities
        WHERE node_id=$1 AND capability_id=$2 AND capability_version=$3 FOR UPDATE`,
      [nodeId, input.capabilityId, input.capabilityVersion])).rows[0];
      if (!existing && input.eventType !== 'download-started') fail('CAPABILITY_EXECUTION_PACKAGE_SEQUENCE_INVALID');
      const transitions = { 'download-started': ['failed', 'removed'],
        'download-completed': ['downloading'], 'signature-verified': ['downloading'],
        'install-ready': ['installed'], 'install-failed': ['downloading', 'installed', 'ready'],
        removed: ['downloading', 'installed', 'ready', 'failed'] };
      if (existing && input.eventType === 'download-started' && existing.status === 'downloading') {
        // A repeated start event is an idempotent progress receipt.
      } else if (existing && !transitions[input.eventType].includes(existing.status)) {
        fail('CAPABILITY_EXECUTION_PACKAGE_SEQUENCE_INVALID');
      }
      if (!existing) {
        await client.query(`INSERT INTO agent_execution_node_capabilities(node_id,capability_id,
          capability_version,package_sha256,status)VALUES($1,$2,$3,$4,'downloading')`,
        [nodeId, input.capabilityId, input.capabilityVersion, packageSha256]);
      } else if (input.eventType !== 'download-completed') {
        await client.query(`UPDATE agent_execution_node_capabilities SET package_sha256=$4,status=$5,
            last_error_code=$6,installed_at=CASE WHEN $5 IN('installed','ready')
              THEN COALESCE(installed_at,now()) ELSE installed_at END,updated_at=now()
          WHERE node_id=$1 AND capability_id=$2 AND capability_version=$3`, [nodeId,
          input.capabilityId, input.capabilityVersion, packageSha256, nextStatus,
          input.eventType === 'install-failed' ? String(input.payload.errorCode ?? 'CAPABILITY_INSTALL_FAILED').slice(0, 160) : null]);
      }
      const receiptId = crypto.randomUUID();
      await client.query(`INSERT INTO agent_capability_package_receipts(id,node_id,capability_id,
        capability_version,package_sha256,event_type,payload_json)VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [receiptId, nodeId, input.capabilityId, input.capabilityVersion, packageSha256,
        input.eventType, json(input.payload)]);
      return { receiptId, status: nextStatus };
    });
  };
  const reportPackageEvent = async (actor, nodeId, input) => reportPackageEventForOwner(
    await requireOwner(actor), nodeId, input);
  const reportPairedPackageEvent = async (actor, input) => {
    const principal = requireNodePrincipal(actor, 'packages:write');
    return reportPackageEventForOwner(principal.ownerUserId, principal.nodeId, input);
  };

  const selectPlacement = async (actor, input) => {
    const operatorUserId = await requireOperator(actor);
    input = structuredClone(input);
    const stageId = id(input.stageId);
    if (typeof input.capabilityId !== 'string' || typeof input.capabilityVersion !== 'string'
      || !SEMVER.test(input.capabilityVersion) || typeof input.cloudConsent !== 'boolean'
      || typeof input.userPresent !== 'boolean') fail('CAPABILITY_EXECUTION_INPUT_INVALID');
    return withTransaction(pool, async client => {
      const stage = (await client.query(`SELECT stage.id,stage.attempt,run.agent_user_id
        FROM agent_run_stages stage JOIN agent_runs run ON run.id=stage.run_id
        JOIN agent_accounts account ON account.user_id=run.agent_user_id
        WHERE stage.id=$1 AND account.operator_user_id=$2 FOR SHARE OF stage,run,account`,
      [stageId, operatorUserId])).rows[0];
      if (!stage) fail('CAPABILITY_EXECUTION_STAGE_NOT_FOUND');
      const prior = (await client.query(`SELECT * FROM agent_stage_placement_decisions
        WHERE stage_id=$1 AND stage_attempt=$2`, [stageId, stage.attempt])).rows[0];
      if (prior) return { ...prior.decision_json, decisionId: prior.id, existing: true };
      const manifestRow = (await client.query(`SELECT * FROM agent_capability_execution_manifests
        WHERE capability_id=$1 AND capability_version=$2 AND status='active' FOR SHARE`,
      [input.capabilityId, input.capabilityVersion])).rows[0];
      if (!manifestRow) fail('CAPABILITY_EXECUTION_MANIFEST_NOT_FOUND');
      const rows = (await client.query(`SELECT node.*,coalesce(jsonb_agg(jsonb_build_object(
          'capabilityId',installed.capability_id,'capabilityVersion',installed.capability_version,
          'packageSha256',installed.package_sha256))FILTER(WHERE installed.status='ready'),'[]'::jsonb) AS installed
        FROM agent_execution_nodes node LEFT JOIN agent_execution_node_capabilities installed
          ON installed.node_id=node.id
        WHERE node.owner_user_id=$1 AND node.status<>'revoked'
        GROUP BY node.id ORDER BY node.id`, [operatorUserId])).rows;
      const now = Date.now();
      const nodes = rows.map(row => ({ nodeId: row.id, target: row.node_kind, platform: row.platform,
        online: row.status === 'online' && now - new Date(row.last_seen_at).getTime() <= nodeStaleAfterMs,
        userPresent: row.node_kind === 'cloud' || row.metadata_json?.userPresent === true,
        available: row.resource_json, permissions: row.permission_ceiling_json, installed: row.installed }));
      const decision = selectCapabilityExecution(manifestRow.manifest_json,
        { nodes, cloudConsent: input.cloudConsent, userPresent: input.userPresent });
      const decisionId = crypto.randomUUID(), decisionSha256 = stableHash(decision);
      await client.query(`INSERT INTO agent_stage_placement_decisions(id,stage_id,stage_attempt,
          capability_id,capability_version,node_id,target,decision_status,decision_json,decision_sha256)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [decisionId, stageId, stage.attempt,
        input.capabilityId, input.capabilityVersion, decision.nodeId, decision.target,
        decision.status, json(decision), decisionSha256]);
      return { ...decision, decisionId, existing: false };
    });
  };

  const snapshot = async actor => {
    const ownerUserId = await requireOwner(actor);
    const [manifestRows, nodeRows, installationRows] = await Promise.all([
      pool.query(`SELECT capability_id,capability_version,contract_key,contract_version,
        manifest_sha256,status,created_at,activated_at,retired_at
        FROM agent_capability_execution_manifests WHERE status<>'retired'
        ORDER BY capability_id,capability_version`),
      pool.query(`SELECT * FROM agent_execution_nodes WHERE owner_user_id=$1 ORDER BY created_at,id`, [ownerUserId]),
      pool.query(`SELECT installed.* FROM agent_execution_node_capabilities installed
        JOIN agent_execution_nodes node ON node.id=installed.node_id
        WHERE node.owner_user_id=$1 ORDER BY installed.capability_id,installed.capability_version`, [ownerUserId]),
    ]);
    return { schemaVersion: 'agent-capability-execution-snapshot-v1',
      manifests: manifestRows.rows.map(row => ({ capabilityId: row.capability_id,
        capabilityVersion: row.capability_version, contract: { key: row.contract_key, version: row.contract_version },
        manifestSha256: row.manifest_sha256, status: row.status, activatedAt: iso(row.activated_at) })),
      nodes: nodeRows.rows.map(nodeView), installations: installationRows.rows.map(row => ({ nodeId: row.node_id,
        capabilityId: row.capability_id, capabilityVersion: row.capability_version,
        packageSha256: row.package_sha256, status: row.status, installedAt: iso(row.installed_at),
        lastErrorCode: row.last_error_code })) };
  };

  const snapshotPairedNode = async actor => {
    const principal = requireNodePrincipal(actor, 'node:snapshot');
    const [nodeRow, installations, manifests] = await Promise.all([
      pool.query(`SELECT * FROM agent_execution_nodes WHERE id=$1 AND owner_user_id=$2
        AND status<>'revoked'`, [principal.nodeId, principal.ownerUserId]),
      pool.query(`SELECT capability_id,capability_version,package_sha256,status,installed_at,
          last_error_code,updated_at FROM agent_execution_node_capabilities WHERE node_id=$1
        ORDER BY capability_id,capability_version`, [principal.nodeId]),
      pool.query(`SELECT capability_id,capability_version,manifest_sha256,manifest_json,activated_at
        FROM agent_capability_execution_manifests WHERE status='active'
        ORDER BY capability_id,capability_version`),
    ]);
    const node = nodeRow.rows[0];
    if (!node) fail('CAPABILITY_EXECUTION_NODE_NOT_FOUND');
    return { schemaVersion: 'agent-execution-node-snapshot-v1', node: nodeView(node),
      installations: installations.rows.map(row => ({ capabilityId: row.capability_id,
        capabilityVersion: row.capability_version, packageSha256: row.package_sha256,
        status: row.status, installedAt: iso(row.installed_at), lastErrorCode: row.last_error_code,
        updatedAt: iso(row.updated_at) })),
      manifests: manifests.rows.map(row => ({ capabilityId: row.capability_id,
        capabilityVersion: row.capability_version, manifestSha256: row.manifest_sha256,
        manifest: row.manifest_json, activatedAt: iso(row.activated_at) })) };
  };

  return { registerManifest, activateManifest, registerNode, heartbeatNode,
    reportPackageEvent, selectPlacement, snapshot,
    heartbeatPairedNode, reportPairedPackageEvent,
    snapshotPairedNode };
}
