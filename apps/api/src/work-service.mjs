import crypto from 'node:crypto';
import { CoverProcessingError, processCoverImage } from './cover-processor.mjs';

export class WorkError extends Error {
  constructor(code, statusCode, message) { super(message); this.name = 'WorkError'; this.code = code; this.statusCode = statusCode; }
}

const canonicalJson = value => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const hashRequest = value => crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
export const workEtag = work => `"work-${work.id}-${work.revision}"`;
const validateDiscoveryMetadata = body => {
  const hasRepository = Boolean(body?.repositoryUrl);
  const hasLicense = Boolean(body?.licenseSpdx);
  if (hasRepository !== hasLicense) throw new WorkError('SCHEMA_INVALID', 400, 'GitHub repository and SPDX license must be provided together.');
};

export function createWorkService({ repository, ids = () => crypto.randomUUID(), coverProcessor = processCoverImage }) {
  return {
    async list(actor) {
      if (!actor.scopes.includes('works:read')) throw new WorkError('FORBIDDEN', 403, 'This device is not allowed to read works.');
      return repository.listMine(actor.userId);
    },
    async listReleases(actor, workId) {
      if (!actor.scopes.includes('works:read')) throw new WorkError('FORBIDDEN', 403, 'This device is not allowed to read works.');
      return repository.listReleases(actor.userId, workId);
    },
    async uploadCover(actor, workId, body) {
      if (!actor.scopes.includes('works:write')) throw new WorkError('FORBIDDEN', 403, 'This device is not allowed to edit works.');
      if (!Buffer.isBuffer(body) || body.length < 16 || body.length > 5 * 1024 * 1024) throw new WorkError('COVER_INVALID', 400, '封面文件无效或超过 5 MB。');
      let processed;
      try { processed = await coverProcessor(body); }
      catch (error) { if (error instanceof CoverProcessingError) throw new WorkError('COVER_INVALID', 400, error.message); throw error; }
      const sha256 = crypto.createHash('sha256').update(processed.body).digest('hex');
      const work = await repository.setCover({ actor, workId, ...processed, sha256 });
      return { work, etag: workEtag(work) };
    },
    async getCover(workId) {
      const cover = await repository.getPublicCover(workId);
      if (!cover) throw new WorkError('NOT_FOUND', 404, 'Cover not found.');
      return cover;
    },
    async create(actor, body, idempotencyKey) {
      if (!actor.profile.canPublish || !actor.scopes.includes('works:write')) throw new WorkError('PUBLISH_NOT_ENABLED', 403, 'Publishing is not enabled for this account.');
      if (!/^[\x21-\x7e]{16,128}$/.test(idempotencyKey ?? '')) throw new WorkError('IDEMPOTENCY_KEY_REQUIRED', 400, 'A valid Idempotency-Key is required.');
      validateDiscoveryMetadata(body);
      const work = await repository.createIdempotent({ actor, idempotencyKey, requestHash: hashRequest(body), workId: ids(), body });
      return { work, etag: workEtag(work) };
    },
    async update(actor, workId, body, idempotencyKey, ifMatch) {
      if (!actor.scopes.includes('works:write')) throw new WorkError('FORBIDDEN', 403, 'This device is not allowed to edit works.');
      if (!/^[\x21-\x7e]{16,128}$/.test(idempotencyKey ?? '')) throw new WorkError('IDEMPOTENCY_KEY_REQUIRED', 400, 'A valid Idempotency-Key is required.');
      if (!body || Object.keys(body).length === 0) throw new WorkError('SCHEMA_INVALID', 400, 'At least one field is required.');
      const match = new RegExp(`^"work-${workId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)"$`).exec(ifMatch ?? '');
      if (!match) throw new WorkError('PRECONDITION_REQUIRED', 428, 'A current Work ETag is required.');
      const work = await repository.updateIdempotent({ actor, workId, expectedRevision: match[1], body, idempotencyKey, requestHash: hashRequest({ workId, body, ifMatch }) });
      return { work, etag: workEtag(work) };
    },
    async withdraw(actor, workId, idempotencyKey, ifMatch) {
      if (!actor.scopes.includes('works:write')) throw new WorkError('FORBIDDEN', 403, 'This device is not allowed to withdraw works.');
      if (!/^[\x21-\x7e]{16,128}$/.test(idempotencyKey ?? '')) throw new WorkError('IDEMPOTENCY_KEY_REQUIRED', 400, 'A valid Idempotency-Key is required.');
      const match = new RegExp(`^"work-${workId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)"$`).exec(ifMatch ?? '');
      if (!match) throw new WorkError('PRECONDITION_REQUIRED', 428, 'A current Work ETag is required.');
      const work = await repository.withdrawIdempotent({ actor, workId, expectedRevision: match[1], idempotencyKey, requestHash: hashRequest({ workId, ifMatch }) });
      return { work, etag: workEtag(work) };
    },
  };
}
