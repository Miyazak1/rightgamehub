import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fail } from './errors.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256 = /^[a-f0-9]{64}$/u;
const CONTRACT_KEY = /^[a-z][a-z0-9.-]{2,119}$/u;
const MEDIA_TYPE = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/iu;
const METADATA_KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/u;
const LOCAL_PATH = /^(?:[A-Za-z]:[\\/]|\\\\|file:\/\/)/iu;
const PRIVATE_BLOB_KEYS = new Set(['raw', 'rawcontent', 'body', 'bytes', 'base64', 'sourcepath',
  'localpath', 'filepath', 'absolutepath', 'file']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));
const json = value => `${JSON.stringify(value, null, 2)}\n`;

function iso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) fail('CAPABILITY_RESULT_EGRESS_TIME_INVALID');
  return date.toISOString();
}

function normalizePolicy(value) {
  const permissions = value?.permissions, dataPolicy = value?.dataPolicy;
  if (!exact(value, ['permissions', 'resources', 'dataPolicy'])
    || !exact(value.resources, ['cpuCores', 'memoryMiB', 'diskMiB', 'gpuMemoryMiB'])
    || Object.values(value.resources).some(item => !Number.isSafeInteger(item) || item < 0)
    || !exact(permissions, ['files', 'networkDomains', 'devices'])
    || !['none', 'user-selected', 'workspace'].includes(permissions.files)
    || !Array.isArray(permissions.networkDomains)
    || permissions.networkDomains.some(item => typeof item !== 'string')
    || !Array.isArray(permissions.devices)
    || permissions.devices.some(item => typeof item !== 'string')
    || !exact(dataPolicy, ['localOnly', 'upload'])
    || typeof dataPolicy.localOnly !== 'boolean'
    || !['never', 'consent', 'allowed'].includes(dataPolicy.upload)
    || dataPolicy.localOnly && dataPolicy.upload !== 'never') {
    fail('CAPABILITY_RESULT_EGRESS_POLICY_INVALID', { safeFailure: true });
  }
  return { fileScope: permissions.files, localOnly: dataPolicy.localOnly,
    upload: dataPolicy.upload };
}

function normalizeContract(value) {
  if (!exact(value, ['key', 'version']) || !CONTRACT_KEY.test(value.key ?? '')
    || !Number.isSafeInteger(value.version) || value.version < 1) {
    fail('CAPABILITY_RESULT_EGRESS_CONTRACT_INVALID', { safeFailure: true });
  }
  return structuredClone(value);
}

function validateStructuredMetadata(value, depth = 0) {
  if (depth > 5) fail('CAPABILITY_RESULT_EGRESS_METADATA_INVALID', { safeFailure: true });
  if (value == null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('CAPABILITY_RESULT_EGRESS_METADATA_INVALID', { safeFailure: true });
    return;
  }
  if (typeof value === 'string') {
    if (value.length > 1000 || LOCAL_PATH.test(value)) {
      fail('CAPABILITY_RESULT_EGRESS_METADATA_INVALID', { safeFailure: true });
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 64) fail('CAPABILITY_RESULT_EGRESS_METADATA_INVALID', { safeFailure: true });
    value.forEach(item => validateStructuredMetadata(item, depth + 1));
    return;
  }
  if (!object(value)) fail('CAPABILITY_RESULT_EGRESS_METADATA_INVALID', { safeFailure: true });
  const entries = Object.entries(value);
  if (entries.length > 64 || entries.some(([key]) => !METADATA_KEY.test(key)
    || PRIVATE_BLOB_KEYS.has(key.toLowerCase()))) {
    fail('CAPABILITY_RESULT_EGRESS_METADATA_INVALID', { safeFailure: true });
  }
  entries.forEach(([, item]) => validateStructuredMetadata(item, depth + 1));
}

function normalizeResult(value, contract) {
  if (!exact(value, ['schemaVersion', 'artifactId', 'storage', 'sha256', 'sizeBytes',
      'mediaType', 'contract', 'metadata'])
    || value.schemaVersion !== 'capability-output-ref-v1'
    || !UUID.test(value.artifactId ?? '') || value.storage !== 'node-local'
    || !SHA256.test(value.sha256 ?? '')
    || !Number.isSafeInteger(value.sizeBytes) || value.sizeBytes < 0
    || typeof value.mediaType !== 'string' || value.mediaType.length > 160
    || !MEDIA_TYPE.test(value.mediaType)
    || !exact(value.contract, ['key', 'version'])
    || value.contract.key !== contract.key || value.contract.version !== contract.version
    || !object(value.metadata)
    || Buffer.byteLength(JSON.stringify(value.metadata), 'utf8') > 8192
    || !exact(value.metadata.executor,
      ['schemaVersion', 'localArtifactKey'])
    || value.metadata.executor.schemaVersion !== 'capability-local-artifact-pointer-v1'
    || value.metadata.executor.localArtifactKey !== value.sha256) {
    fail('CAPABILITY_RESULT_EGRESS_REF_INVALID', { safeFailure: true });
  }
  const publicMetadata = structuredClone(value.metadata);
  delete publicMetadata.executor;
  validateStructuredMetadata(publicMetadata);
  return structuredClone(value);
}

async function createImmutableJson(file, value) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  try {
    await fs.promises.writeFile(file, json(value), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    let existing;
    try { existing = JSON.parse(await fs.promises.readFile(file, 'utf8')); }
    catch { fail('CAPABILITY_RESULT_EGRESS_LEDGER_INVALID'); }
    const withoutTimestamp = receipt => {
      const clone = structuredClone(receipt);
      delete clone.preparedAt;
      delete clone.submittedAt;
      return clone;
    };
    if (JSON.stringify(withoutTimestamp(existing)) !== JSON.stringify(withoutTimestamp(value))) {
      fail('CAPABILITY_RESULT_EGRESS_IDEMPOTENCY_CONFLICT');
    }
    return existing;
  }
  return value;
}

async function readJson(file) {
  try { return JSON.parse(await fs.promises.readFile(file, 'utf8')); }
  catch (error) {
    if (error?.code === 'ENOENT') return null;
    fail('CAPABILITY_RESULT_EGRESS_LEDGER_INVALID');
  }
}

export function createCapabilityResultEgressGate({ rootDirectory,
  now = () => new Date() } = {}) {
  if (!path.isAbsolute(rootDirectory) || typeof now !== 'function') {
    fail('CAPABILITY_RESULT_EGRESS_CONFIG_INVALID');
  }
  const receiptDirectory = submissionId => path.join(rootDirectory, submissionId);

  const prepare = async ({ submissionId, executionLeaseId, contract,
    executionPolicy, result } = {}) => {
    if (!UUID.test(submissionId ?? '') || !UUID.test(executionLeaseId ?? '')) {
      fail('CAPABILITY_RESULT_EGRESS_IDENTITY_INVALID', { safeFailure: true });
    }
    contract = normalizeContract(contract);
    const policy = normalizePolicy(executionPolicy);
    result = normalizeResult(result, contract);
    const receipt = {
      schemaVersion: 'capability-result-egress-prepared-v1',
      submissionId,
      executionLeaseId,
      contract,
      policy,
      result: { artifactId: result.artifactId, storage: result.storage,
        sha256: result.sha256, sizeBytes: result.sizeBytes, mediaType: result.mediaType },
      transfer: { kind: 'structured-reference-only', rawArtifactUploaded: false,
        localPathUploaded: false, metadataBytes: Buffer.byteLength(JSON.stringify(result.metadata), 'utf8') },
      preparedAt: iso(now()),
    };
    const stored = await createImmutableJson(
      path.join(receiptDirectory(submissionId), 'prepared.json'), receipt);
    return { result, receipt: structuredClone(stored) };
  };

  const confirm = async ({ submissionId, remoteReceipt } = {}) => {
    if (!UUID.test(submissionId ?? '') || !object(remoteReceipt)) {
      fail('CAPABILITY_RESULT_EGRESS_CONFIRMATION_INVALID');
    }
    const directory = receiptDirectory(submissionId);
    const prepared = await readJson(path.join(directory, 'prepared.json'));
    if (!prepared || prepared.submissionId !== submissionId) {
      fail('CAPABILITY_RESULT_EGRESS_PREPARED_REQUIRED');
    }
    const preparedSha256 = crypto.createHash('sha256')
      .update(JSON.stringify(prepared)).digest('hex');
    const existing = await readJson(path.join(directory, 'submitted.json'));
    if (existing) {
      if (existing.schemaVersion !== 'capability-result-egress-submitted-v1'
        || existing.submissionId !== submissionId || existing.preparedSha256 !== preparedSha256) {
        fail('CAPABILITY_RESULT_EGRESS_LEDGER_INVALID');
      }
      return structuredClone(existing);
    }
    let remoteJson;
    try { remoteJson = JSON.stringify(remoteReceipt); }
    catch { fail('CAPABILITY_RESULT_EGRESS_CONFIRMATION_INVALID'); }
    if (Buffer.byteLength(remoteJson, 'utf8') > 64 * 1024) {
      fail('CAPABILITY_RESULT_EGRESS_CONFIRMATION_INVALID');
    }
    const receipt = {
      schemaVersion: 'capability-result-egress-submitted-v1',
      submissionId,
      preparedSha256,
      remoteReceiptSha256: crypto.createHash('sha256')
        .update(remoteJson).digest('hex'),
      submittedAt: iso(now()),
    };
    return structuredClone(await createImmutableJson(
      path.join(directory, 'submitted.json'), receipt));
  };

  const inspect = async submissionId => {
    if (!UUID.test(submissionId ?? '')) fail('CAPABILITY_RESULT_EGRESS_IDENTITY_INVALID');
    return {
      prepared: await readJson(path.join(receiptDirectory(submissionId), 'prepared.json')),
      submitted: await readJson(path.join(receiptDirectory(submissionId), 'submitted.json')),
    };
  };

  return { prepare, confirm, inspect };
}
