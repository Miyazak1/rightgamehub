export const COURSEWARE_EMBED_PROTOCOL = 'mooyu.courseware.embed.v1';
export const COURSEWARE_EMBED_VERSION = 1;
export const COURSEWARE_EMBED_MAX_BYTES = 32 * 1024;
export const COURSEWARE_EMBED_MAX_MESSAGES_PER_SECOND = 20;

export const COURSEWARE_EMBED_EVENTS = Object.freeze([
  'courseware.ready', 'courseware.started', 'scene.entered', 'checkpoint.attempted',
  'objective.completed', 'courseware.completed', 'courseware.resized', 'courseware.error',
]);
export const COURSEWARE_EMBED_COMMANDS = Object.freeze([
  'host.setLocale', 'host.setTheme', 'host.setMotion', 'host.pause', 'host.resume',
  'host.restoreProgress', 'host.exportProgress',
]);
export const COURSEWARE_EMBED_ERRORS = Object.freeze([
  'EMBED_MESSAGE_INVALID', 'EMBED_ORIGIN_DENIED', 'EMBED_RELEASE_UNAVAILABLE',
  'EMBED_RATE_LIMITED', 'EMBED_COMMAND_UNSUPPORTED', 'EMBED_PROGRESS_INVALID',
]);

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const noncePattern = /^[A-Za-z0-9_-]{16,128}$/u;
const identifierPattern = /^[a-z][a-z0-9._-]{0,63}$/u;
const localePattern = /^[a-z]{2,3}(?:-[A-Z]{2})?$/u;
const errorPattern = /^[A-Z][A-Z0-9_]{2,63}$/u;
const isObject = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const exactKeys = (value, keys) => Object.keys(value).every(key => keys.includes(key)) && keys.every(key => key in value);
const exactPayload = (payload, keys) => isObject(payload) && exactKeys(payload, keys);
const ids = value => Array.isArray(value) && value.length <= 100 && new Set(value).size === value.length && value.every(item => identifierPattern.test(item));

function validProgress(payload) {
  return exactPayload(payload, ['schemaVersion','workId','releaseId','completedSceneIds','completedCheckpointIds','completedObjectiveIds'])
    && payload.schemaVersion === 1 && uuidPattern.test(payload.workId) && uuidPattern.test(payload.releaseId)
    && ids(payload.completedSceneIds) && ids(payload.completedCheckpointIds) && ids(payload.completedObjectiveIds);
}

function validPayload(message) {
  const { type, name, payload } = message;
  if (type === 'connect') return name === 'host.connect' && exactPayload(payload,['nonce']) && noncePattern.test(payload.nonce);
  if (type === 'connected') return name === 'courseware.connected' && exactPayload(payload,['connectionId','nonce']) && uuidPattern.test(payload.connectionId) && noncePattern.test(payload.nonce);
  if (type === 'error') return COURSEWARE_EMBED_ERRORS.includes(name) && exactPayload(payload,['recoverable']) && typeof payload.recoverable === 'boolean';
  if (type === 'response') return name === 'host.exportProgress' && validProgress(payload);
  if (type === 'event') {
    if (!COURSEWARE_EMBED_EVENTS.includes(name)) return false;
    if (name === 'courseware.ready') return exactPayload(payload,['workId','releaseId','locale','capabilities']) && uuidPattern.test(payload.workId) && uuidPattern.test(payload.releaseId) && localePattern.test(payload.locale) && Array.isArray(payload.capabilities) && payload.capabilities.length <= 8 && new Set(payload.capabilities).size === payload.capabilities.length && payload.capabilities.every(item => ['learningProgress','learningEvents','assessmentResult','fullscreen','fileExport'].includes(item));
    if (name === 'courseware.started') return exactPayload(payload,['startedAt']) && !Number.isNaN(Date.parse(payload.startedAt));
    if (name === 'scene.entered') return exactPayload(payload,['sceneId']) && identifierPattern.test(payload.sceneId);
    if (name === 'checkpoint.attempted') return exactPayload(payload,['checkpointId','attempt','outcome']) && identifierPattern.test(payload.checkpointId) && Number.isInteger(payload.attempt) && payload.attempt >= 1 && payload.attempt <= 10000 && ['correct','incorrect','skipped'].includes(payload.outcome);
    if (name === 'objective.completed') return exactPayload(payload,['objectiveId','completedAt']) && identifierPattern.test(payload.objectiveId) && !Number.isNaN(Date.parse(payload.completedAt));
    if (name === 'courseware.completed') return exactPayload(payload,['objectiveIds','checkpointSummary','durationBucket']) && ids(payload.objectiveIds) && exactPayload(payload.checkpointSummary,['attempted','correct']) && Number.isInteger(payload.checkpointSummary.attempted) && payload.checkpointSummary.attempted >= 0 && Number.isInteger(payload.checkpointSummary.correct) && payload.checkpointSummary.correct >= 0 && ['under-1m','1-5m','5-15m','15-30m','over-30m','unknown'].includes(payload.durationBucket);
    if (name === 'courseware.resized') return exactPayload(payload,['height','aspectRatio']) && Number.isInteger(payload.height) && payload.height >= 200 && payload.height <= 10000 && /^[1-9][0-9]{0,3}\/[1-9][0-9]{0,3}$/u.test(payload.aspectRatio);
    return name === 'courseware.error' && exactPayload(payload,['code','recoverable']) && errorPattern.test(payload.code) && typeof payload.recoverable === 'boolean';
  }
  if (type !== 'command' || !COURSEWARE_EMBED_COMMANDS.includes(name)) return false;
  if (name === 'host.setLocale') return exactPayload(payload,['locale']) && localePattern.test(payload.locale);
  if (name === 'host.setTheme') return exactPayload(payload,['theme']) && ['light','dark','system'].includes(payload.theme);
  if (name === 'host.setMotion') return exactPayload(payload,['motion']) && ['full','reduced','system'].includes(payload.motion);
  if (name === 'host.pause' || name === 'host.resume' || name === 'host.exportProgress') return exactPayload(payload,[]);
  return name === 'host.restoreProgress' && validProgress(payload);
}

export function parseEmbedEnvelope(value, { types } = {}) {
  if (!isObject(value) || bytes(value) > COURSEWARE_EMBED_MAX_BYTES) throw Object.assign(new Error('Embed message is invalid or too large.'), { code:'EMBED_MESSAGE_INVALID' });
  if (!exactKeys(value,['protocol','version','type','id','name','payload']) || value.protocol !== COURSEWARE_EMBED_PROTOCOL || value.version !== COURSEWARE_EMBED_VERSION || !uuidPattern.test(value.id ?? '') || !isObject(value.payload)) throw Object.assign(new Error('Embed envelope is invalid.'), { code:'EMBED_MESSAGE_INVALID' });
  if (types && !types.includes(value.type)) throw Object.assign(new Error('Embed message direction is invalid.'), { code:'EMBED_MESSAGE_INVALID' });
  if (!validPayload(value)) throw Object.assign(new Error('Embed payload is invalid.'), { code:'EMBED_MESSAGE_INVALID' });
  return value;
}

export function createEmbedEnvelope(type, name, payload = {}, id = globalThis.crypto?.randomUUID?.()) {
  const value = { protocol:COURSEWARE_EMBED_PROTOCOL,version:COURSEWARE_EMBED_VERSION,type,id,name,payload };
  return parseEmbedEnvelope(value);
}

export function isAllowedParentOrigin(origin, { allowLoopback = false, allowlist = null } = {}) {
  let parsed;
  try { parsed = new URL(origin); } catch { return false; }
  if (parsed.origin !== origin) return false;
  if (allowLoopback && parsed.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(parsed.hostname)) return true;
  if (parsed.protocol !== 'https:') return false;
  return !allowlist || allowlist.includes(parsed.origin);
}
