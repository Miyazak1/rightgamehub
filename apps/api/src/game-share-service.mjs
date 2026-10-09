import crypto from 'node:crypto';

export class GameShareError extends Error {
  constructor(code, statusCode, message) { super(message); this.name = 'GameShareError'; this.code = code; this.statusCode = statusCode; this.retryable = false; }
}

const encodeCode = bytes => bytes.toString('base64url');

export function createGameShareService({ repository,catalogService,ids = () => crypto.randomUUID(),randomBytes = size => crypto.randomBytes(size) }) {
  return Object.freeze({
    async create(actor, workId, input) {
      if (!actor?.userId) throw new GameShareError('AUTH_REQUIRED', 401, 'Sign in to create a playable share link.');
      await catalogService.get(workId);
      const title = String(input?.title ?? '').trim();
      if (!title || title.length > 120) throw new GameShareError('SHARE_INVALID', 400, 'Share title is invalid.');
      if (!input?.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) throw new GameShareError('SHARE_INVALID', 400, 'Share payload must be an object.');
      const encoded = JSON.stringify(input.payload);
      const payloadBytes = Buffer.byteLength(encoded);
      if (payloadBytes < 2 || payloadBytes > 48 * 1024) throw new GameShareError('SHARE_TOO_LARGE', 413, 'Playable share content exceeds 48 KiB.');
      const payloadSha256 = crypto.createHash('sha256').update(encoded).digest('hex');
      const existing = await repository.findByDigest({ userId:actor.userId,workId,payloadSha256 });
      if (existing) return existing;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await repository.create({ id:ids(),code:encodeCode(randomBytes(9)),userId:actor.userId,workId,title,payload:input.payload,payloadSha256,payloadBytes });
        } catch (error) {
          if (error?.code !== '23505') throw error;
          const raced = await repository.findByDigest({ userId:actor.userId,workId,payloadSha256 });
          if (raced) return raced;
        }
      }
      throw new GameShareError('SHARE_CODE_COLLISION', 503, 'Could not allocate a share link.');
    },
    async get(code) {
      const share = await repository.get(code);
      if (!share) throw new GameShareError('SHARE_NOT_FOUND', 404, 'Playable share link was not found.');
      return share;
    },
  });
}
