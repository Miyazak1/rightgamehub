import crypto from 'node:crypto';

export class UploadError extends Error {
  constructor(code, statusCode, message, retryable = false) { super(message); this.name = 'UploadError'; this.code = code; this.statusCode = statusCode; this.retryable = retryable; }
}

const token = () => crypto.randomBytes(32).toString('base64url');
const hashToken = value => crypto.createHash('sha256').update(value).digest();
const canonicalJson = value => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const requestHash = value => crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
const requireIdempotencyKey = value => {
  if (!/^[\x21-\x7e]{16,128}$/.test(value ?? '')) throw new UploadError('IDEMPOTENCY_KEY_REQUIRED', 400, 'A valid Idempotency-Key is required.');
  return value;
};

export function createUploadService({ repository, objectStore, ids = () => crypto.randomUUID() }) {
  return {
    async create(actor, workId, body, idempotencyKey) {
      if (!actor.scopes.includes('upload')) throw new UploadError('FORBIDDEN', 403, 'This device cannot upload.');
      if (body.targetKey !== 'web' || body.packageType !== 'web_zip') throw new UploadError('UNSUPPORTED_PACKAGE', 422, 'This stage accepts web ZIP uploads only.');
      const declaredBytes = Number(body.declaredBytes);
      if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 1 || declaredBytes > 100 * 1024 * 1024) throw new UploadError('UPLOAD_TOO_LARGE', 413, 'Declared upload size is invalid.');
      if (!/^[a-f0-9]{64}$/.test(body.sha256)) throw new UploadError('SCHEMA_INVALID', 400, 'SHA-256 is invalid.');
      requireIdempotencyKey(idempotencyKey);
      const uploadId = ids();
      return repository.createIdempotent({
        actor, workId, body, declaredBytes, uploadId, idempotencyKey,
        requestHash: requestHash({ workId, body }),
        objectKey: `quarantine/${uploadId}/${ids()}.zip`,
      });
    },
    async grant(actor, uploadId) {
      const plaintext = token();
      const result = await repository.createGrant({ actor, uploadId, grantId: ids(), tokenHash: hashToken(plaintext) });
      return { uploadId, token: plaintext, expiresAt: new Date(result.expiresAt).toISOString() };
    },
    async receive(uploadId, authorization, stream) {
      const match = /^Upload ([A-Za-z0-9_-]{32,})$/.exec(authorization ?? '');
      if (!match) throw new UploadError('UPLOAD_GRANT_REQUIRED', 401, 'Upload grant is required.');
      const job = await repository.beginReceive({ uploadId, tokenHash: hashToken(match[1]) });
      try {
        const actual = await objectStore.putStream(job.objectKey, stream, job.declaredBytes);
        if (actual.bytes !== job.declaredBytes || actual.sha256 !== job.declaredSha256) throw new UploadError('UPLOAD_HASH_MISMATCH', 422, 'Uploaded bytes do not match the declaration.');
        return await repository.finishReceive({ uploadId, actualBytes: actual.bytes, actualSha256: actual.sha256 });
      } catch (error) {
        await objectStore.remove(job.objectKey).catch(() => {});
        await repository.failReceive({ uploadId, errorCode: error.code ?? 'UPLOAD_FAILED' });
        if (error instanceof UploadError) throw error;
        throw new UploadError(error.code ?? 'UPLOAD_FAILED', error.code === 'UPLOAD_TOO_LARGE' ? 413 : 503, 'Upload failed.', true);
      }
    },
    complete(actor, uploadId, idempotencyKey) {
      requireIdempotencyKey(idempotencyKey);
      return repository.complete({ actor, uploadId, jobId: ids() });
    },
    get(actor, uploadId) { return repository.get({ actor, uploadId }); },
  };
}
