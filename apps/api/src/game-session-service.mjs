import crypto from 'node:crypto';

export class GameSessionError extends Error {
  constructor(code, statusCode, message, retryable = false) {
    super(message); this.name = 'GameSessionError'; this.code = code; this.statusCode = statusCode; this.retryable = retryable;
  }
}
export const hashGameSession = token => crypto.createHash('sha256').update(token).digest();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const denied = () => { throw new GameSessionError('GAME_SESSION_INVALID', 401, 'Game session is expired, revoked or belongs to another launch.'); };
export function deriveGameSessionScope(row, { cloudSaveEnabled = true } = {}) {
  const requested = new Set(Array.isArray(row.approved_capabilities) ? row.approved_capabilities : []);
  const capabilities = ['identity'];
  for (const key of ['fileExport','shareLinks']) if (requested.has(key)) capabilities.push(key);
  if (requested.has('multiplayer')) capabilities.push('multiplayer');
  const namespaces = {};
  if (cloudSaveEnabled && row.scope_status === 'active' && requested.has('cloudSave')) {
    for (const [key, value] of Object.entries(row.namespaces ?? {})) {
      if (!/^[a-z0-9._-]{1,64}$/u.test(key) || key.startsWith('_gamehub.') || !value || typeof value !== 'object'
        || !Number.isInteger(value.readSchema?.min) || !Number.isInteger(value.readSchema?.max) || !Number.isInteger(value.writeSchema)
        || value.readSchema.min < 1 || value.readSchema.max < value.readSchema.min || value.writeSchema < value.readSchema.min || value.writeSchema > value.readSchema.max) continue;
      Object.defineProperty(namespaces, key, { value: { readSchema: { min: value.readSchema.min, max: value.readSchema.max }, writeSchema: value.writeSchema }, enumerable: true, configurable: true });
    }
    if (Object.keys(namespaces).length > 0 && Object.keys(namespaces).length <= 4) capabilities.push('cloudSave');
    else for (const key of Object.keys(namespaces)) delete namespaces[key];
  }
  const modeIds = row.scope_status === 'active' && requested.has('competition') && Array.isArray(row.mode_ids)
    ? [...new Set(row.mode_ids.filter(id => uuid.test(id)))] : [];
  if (modeIds.length) capabilities.push('competition');
  return { capabilities, namespaces, modeIds };
}
export function createGameSessionService({ repository, cloudSaveEnabled = false, clock = () => new Date(), ttlSeconds = 300, randomBytes = crypto.randomBytes }) {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 900) throw new TypeError('Game session TTL must be 30 to 900 seconds.');
  const requireActor = actor => { if (!actor?.userId || !actor.grantId) throw new GameSessionError('AUTH_REQUIRED', 401, 'Authentication is required.'); };
  return Object.freeze({
    async create(actor, input) {
      requireActor(actor);
      if (!input || Object.keys(input).some(key => !['workId','releaseId','channel','launchNonce'].includes(key))
        || !uuid.test(input.workId ?? '') || !uuid.test(input.releaseId ?? '') || !uuid.test(input.launchNonce ?? '') || !['production','preview'].includes(input.channel)) {
        throw new GameSessionError('SCHEMA_INVALID', 400, 'Invalid game session request.');
      }
      const now = clock();
      const token = randomBytes(32).toString('base64url');
      const result = await repository.create({
        ...input, userId: actor.userId, grantId: actor.grantId, tokenHash: hashGameSession(token),
        now, expiresAt: new Date(now.getTime() + ttlSeconds * 1000), deriveScope: row => deriveGameSessionScope(row, { cloudSaveEnabled }),
      });
      return { gameSessionId: token, expiresAt: new Date(result.expiresAt).toISOString(), capabilities: result.capabilities };
    },
    async resolve(actor, token, expected = {}, transaction) {
      requireActor(actor);
      if (!cloudSaveEnabled && (expected.capability === 'cloudSave' || expected.namespace !== undefined))
        throw new GameSessionError('CLOUD_SAVE_DISABLED', 503, 'Cloud saves are disabled.');
      if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(token)) denied();
      const row = await repository.resolve({ userId: actor.userId, grantId: actor.grantId, tokenHash: hashGameSession(token), now: clock() }, transaction);
      if (!row || Object.entries(expected).some(([key, value]) =>
        key === 'capability' ? !row.capabilities.includes(value)
          : key === 'namespace' ? !Object.hasOwn(row.namespaces, value)
            : key === 'modeId' ? !row.modeIds.includes(value)
              : !['workId', 'releaseId', 'channel'].includes(key) || row[key] !== value)) denied();
      return Object.freeze(cloudSaveEnabled ? row : { ...row, capabilities: row.capabilities.filter(value => value !== 'cloudSave'), namespaces: {} });
    },
    async revoke(actor, token) {
      requireActor(actor);
      if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(token)) denied();
      await repository.revoke({ userId: actor.userId, grantId: actor.grantId, tokenHash: hashGameSession(token), now: clock() });
      return { revoked: true };
    },
  });
}
