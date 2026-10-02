import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

export const RULES_MANIFEST_PROTOCOL = 'gamehub.rules-manifest.v1';
export const RULES_MANIFEST_MAX_BYTES = 64 * 1024;
export const RULES_BUNDLE_MAX_BYTES = 1024 * 1024;

export const canonicalJson = value => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError('Rules state must be JSON serializable.');
  return encoded;
};

export const hashRulesState = state => crypto.createHash('sha256').update(canonicalJson(state)).digest('hex');

const adapterKey = ({ workId,modeKey,rulesetVersion }) => `${workId}:${modeKey}:${rulesetVersion}`;
const requiredFunctions = ['createInitialState','getTurn','getPlayerView','getSpectatorView','serializeState','deserializeState','hashState','validateCommand','applyCommand','handleResign','handleTimeout'];
const identityPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const modePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const versionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const digestPattern = /^[a-f0-9]{64}$/u;
const keyIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

export class RulesManifestError extends Error {
  constructor(code, message) { super(message); this.name = 'RulesManifestError'; this.code = code; }
}

const manifestError = (code, message) => { throw new RulesManifestError(code, message); };
const exactKeys = (value, allowed, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) manifestError('RULES_MANIFEST_INVALID', `${label} must be an object.`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) manifestError('RULES_MANIFEST_INVALID', `${label} contains an unknown field: ${key}`);
};

const normalizeEntry = (entry, index) => {
  exactKeys(entry, ['workId','modeKey','rulesetVersion','bundle','sha256'], `entries[${index}]`);
  if (!identityPattern.test(entry.workId ?? '')) manifestError('RULES_MANIFEST_INVALID', `entries[${index}].workId is invalid.`);
  if (!modePattern.test(entry.modeKey ?? '')) manifestError('RULES_MANIFEST_INVALID', `entries[${index}].modeKey is invalid.`);
  if (!versionPattern.test(entry.rulesetVersion ?? '')) manifestError('RULES_MANIFEST_INVALID', `entries[${index}].rulesetVersion is invalid.`);
  if (typeof entry.bundle !== 'string' || !entry.bundle.endsWith('.cjs') || entry.bundle.includes('\\') || path.posix.isAbsolute(entry.bundle) || entry.bundle.split('/').some(part => !part || part === '.' || part === '..')) manifestError('RULES_MANIFEST_INVALID', `entries[${index}].bundle must be a relative .cjs path.`);
  if (!digestPattern.test(entry.sha256 ?? '')) manifestError('RULES_MANIFEST_INVALID', `entries[${index}].sha256 is invalid.`);
  return Object.freeze({ workId: entry.workId,modeKey: entry.modeKey,rulesetVersion: entry.rulesetVersion,bundle: entry.bundle,sha256: entry.sha256 });
};

const normalizeManifest = (manifest, { allowUnsigned = false } = {}) => {
  exactKeys(manifest, ['protocol','createdAt','keyId','entries','signature'], 'manifest');
  if (manifest.protocol !== RULES_MANIFEST_PROTOCOL) manifestError('RULES_MANIFEST_PROTOCOL_UNSUPPORTED', 'Rules manifest protocol is unsupported.');
  if (!Number.isFinite(Date.parse(manifest.createdAt ?? ''))) manifestError('RULES_MANIFEST_INVALID', 'Rules manifest createdAt must be an ISO timestamp.');
  if (!Array.isArray(manifest.entries) || manifest.entries.length > 256) manifestError('RULES_MANIFEST_INVALID', 'Rules manifest entries must contain at most 256 adapters.');
  const entries = manifest.entries.map(normalizeEntry);
  const identities = new Set(); const bundles = new Set();
  for (const entry of entries) {
    const identity = adapterKey(entry);
    if (identities.has(identity)) manifestError('RULES_MANIFEST_DUPLICATE', `Duplicate rules identity: ${identity}`);
    if (bundles.has(entry.bundle)) manifestError('RULES_MANIFEST_DUPLICATE', `Rules bundle is reused: ${entry.bundle}`);
    identities.add(identity); bundles.add(entry.bundle);
  }
  if (!allowUnsigned || manifest.keyId !== undefined || manifest.signature !== undefined) {
    if (!keyIdPattern.test(manifest.keyId ?? '')) manifestError('RULES_MANIFEST_SIGNATURE_INVALID', 'Rules manifest keyId is invalid.');
    if (typeof manifest.signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/u.test(manifest.signature) || Buffer.from(manifest.signature, 'base64url').byteLength !== 64) manifestError('RULES_MANIFEST_SIGNATURE_INVALID', 'Rules manifest signature is invalid.');
  }
  return Object.freeze({ protocol: manifest.protocol,createdAt: new Date(manifest.createdAt).toISOString(),...(manifest.keyId ? { keyId: manifest.keyId } : {}),entries,...(manifest.signature ? { signature: manifest.signature } : {}) });
};

const signingPayload = manifest => ({ protocol: manifest.protocol,createdAt: manifest.createdAt,keyId: manifest.keyId,entries: manifest.entries });
const publicKeyFrom = value => {
  try {
    const key = value.includes('BEGIN PUBLIC KEY') ? crypto.createPublicKey(value) : crypto.createPublicKey({ key: Buffer.from(value, 'base64'),format: 'der',type: 'spki' });
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('wrong key type');
    return key;
  } catch { manifestError('RULES_TRUST_KEY_INVALID', 'A trusted rules public key is invalid.'); }
};

export const digestRulesBundle = source => crypto.createHash('sha256').update(source).digest('hex');

const emptyReleaseDescription = Object.freeze({
  installed: false,
  protocol: RULES_MANIFEST_PROTOCOL,
  manifestSha256: null,
  keyId: null,
  createdAt: null,
  adapterCount: 0,
});

export function inspectRulesBundle(source, { filename = 'rules-adapter.cjs' } = {}) {
  const bytes = Buffer.isBuffer(source) ? source : Buffer.from(source ?? '');
  if (bytes.length < 1 || bytes.length > RULES_BUNDLE_MAX_BYTES) manifestError('RULES_BUNDLE_INVALID', 'Rules bundle has an invalid size.');
  const adapter = loadVerifiedBundle(bytes, filename);
  validateRulesAdapter(adapter);
  return Object.freeze({
    workId: adapter.workId,
    modeKey: adapter.modeKey,
    rulesetVersion: adapter.rulesetVersion,
    sha256: digestRulesBundle(bytes),
    bytes: bytes.length,
  });
}

export function parseTrustedRulesKeys(value) {
  if (value == null || value === '') return Object.freeze({});
  let parsed = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { manifestError('RULES_TRUST_KEYS_INVALID', 'RULES_TRUSTED_KEYS_JSON must be valid JSON.'); }
  }
  exactKeys(parsed, Object.keys(parsed ?? {}), 'trusted rules keys');
  const output = {};
  for (const [keyId,key] of Object.entries(parsed)) {
    if (!keyIdPattern.test(keyId) || typeof key !== 'string' || key.length < 32 || key.length > 8192) manifestError('RULES_TRUST_KEYS_INVALID', 'Trusted rules key entries are invalid.');
    publicKeyFrom(key); output[keyId] = key;
  }
  return Object.freeze(output);
}

export function signRulesManifest(manifest, privateKey) {
  const normalized = normalizeManifest({ ...manifest,signature: manifest.signature ?? 'A'.repeat(86) });
  let signature;
  try {
    const key = privateKey?.type === 'private' && privateKey?.asymmetricKeyType ? privateKey : crypto.createPrivateKey(privateKey);
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('wrong key type');
    signature = crypto.sign(null, Buffer.from(canonicalJson(signingPayload(normalized))), key).toString('base64url');
  }
  catch { manifestError('RULES_SIGNING_KEY_INVALID', 'Rules manifest private key is invalid.'); }
  return Object.freeze({ ...signingPayload(normalized),signature });
}

export function validateRulesAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') throw new TypeError('Rules adapter must be an object.');
  for (const field of ['workId','modeKey','rulesetVersion']) if (typeof adapter[field] !== 'string' || !adapter[field]) throw new TypeError(`Rules adapter ${field} is required.`);
  for (const method of requiredFunctions) if (typeof adapter[method] !== 'function') throw new TypeError(`Rules adapter ${method}() is required.`);
  return adapter;
}

export function createRulesRegistry(adapters = [], releaseDescription = emptyReleaseDescription) {
  const entries = new Map();
  for (const adapter of adapters) {
    validateRulesAdapter(adapter);
    const key = adapterKey(adapter);
    if (entries.has(key)) throw new TypeError(`Duplicate rules adapter: ${key}`);
    entries.set(key, Object.freeze(adapter));
  }
  return Object.freeze({
    get(identity) { return entries.get(adapterKey(identity)) ?? null; },
    list() { return [...entries.values()]; },
    describe() { return releaseDescription; },
  });
}

const readBoundedFile = (filePath, limit, code, label) => {
  let stat;
  try { stat = fs.statSync(filePath); } catch { manifestError(code, `${label} does not exist.`); }
  if (!stat.isFile() || stat.size < 1 || stat.size > limit) manifestError(code, `${label} has an invalid size.`);
  return fs.readFileSync(filePath);
};

const loadVerifiedBundle = (source, filename) => {
  const module = { exports: {} };
  const sandbox = Object.create(null);
  sandbox.module = module; sandbox.exports = module.exports;
  let code;
  try { code = new TextDecoder('utf-8', { fatal: true }).decode(source); }
  catch { manifestError('RULES_BUNDLE_LOAD_FAILED', 'Rules bundle must be valid UTF-8.'); }
  try { new vm.Script(`'use strict';\n${code}`, { filename }).runInNewContext(sandbox, { timeout: 1_000 }); }
  catch (error) { manifestError('RULES_BUNDLE_LOAD_FAILED', `Rules bundle failed to load: ${error.message}`); }
  const exported = module.exports?.rulesAdapter ?? module.exports?.default ?? module.exports;
  return exported;
};

export function loadRulesRegistry({ manifestPath = null, trustedKeys = {}, allowUnsigned = false, bundleRoot = null } = {}) {
  if (!manifestPath) return createRulesRegistry();
  const manifestFile = path.resolve(manifestPath);
  const manifestBytes = readBoundedFile(manifestFile, RULES_MANIFEST_MAX_BYTES, 'RULES_MANIFEST_UNAVAILABLE', 'Rules manifest');
  let raw;
  try { raw = JSON.parse(manifestBytes.toString('utf8')); } catch { manifestError('RULES_MANIFEST_INVALID', 'Rules manifest must be valid JSON.'); }
  const manifest = normalizeManifest(raw, { allowUnsigned });
  const keys = parseTrustedRulesKeys(trustedKeys);
  if (manifest.signature) {
    const key = Object.hasOwn(keys, manifest.keyId) ? keys[manifest.keyId] : null;
    if (!key) manifestError('RULES_MANIFEST_KEY_UNTRUSTED', `Rules signing key is not trusted: ${manifest.keyId}`);
    const valid = crypto.verify(null, Buffer.from(canonicalJson(signingPayload(manifest))), publicKeyFrom(key), Buffer.from(manifest.signature, 'base64url'));
    if (!valid) manifestError('RULES_MANIFEST_SIGNATURE_INVALID', 'Rules manifest signature verification failed.');
  } else if (!allowUnsigned) manifestError('RULES_MANIFEST_SIGNATURE_INVALID', 'Rules manifest must be signed.');

  const configuredRoot = path.resolve(bundleRoot ?? path.dirname(manifestFile));
  let realRoot;
  try { realRoot = fs.realpathSync(configuredRoot); } catch { manifestError('RULES_BUNDLE_ROOT_INVALID', 'Rules bundle root does not exist.'); }
  const adapters = manifest.entries.map(entry => {
    const candidate = path.resolve(realRoot, ...entry.bundle.split('/'));
    let realBundle;
    try { realBundle = fs.realpathSync(candidate); } catch { manifestError('RULES_BUNDLE_UNAVAILABLE', `Rules bundle does not exist: ${entry.bundle}`); }
    const relative = path.relative(realRoot, realBundle);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) manifestError('RULES_BUNDLE_PATH_INVALID', `Rules bundle escapes the trusted root: ${entry.bundle}`);
    const bytes = readBoundedFile(realBundle, RULES_BUNDLE_MAX_BYTES, 'RULES_BUNDLE_INVALID', `Rules bundle ${entry.bundle}`);
    if (digestRulesBundle(bytes) !== entry.sha256) manifestError('RULES_BUNDLE_DIGEST_MISMATCH', `Rules bundle digest does not match: ${entry.bundle}`);
    const adapter = loadVerifiedBundle(bytes, realBundle);
    validateRulesAdapter(adapter);
    for (const field of ['workId','modeKey','rulesetVersion']) if (adapter[field] !== entry[field]) manifestError('RULES_BUNDLE_IDENTITY_MISMATCH', `Rules bundle identity does not match its manifest: ${entry.bundle}`);
    return adapter;
  });
  return createRulesRegistry(adapters,Object.freeze({
    installed: true,
    protocol: manifest.protocol,
    manifestSha256: digestRulesBundle(manifestBytes),
    keyId: manifest.keyId ?? null,
    createdAt: manifest.createdAt,
    adapterCount: adapters.length,
  }));
}
