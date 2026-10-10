import crypto from 'node:crypto';

const AVATAR_KEY = /^avatars\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/([0-9a-f]{64})-(animated|static)\.webp$/;
const COVER_KEY = /^covers\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/([0-9a-f]{64})\.webp$/;
const missing = error => error?.status === 404 || ['NoSuchKey', 'NoSuchObject'].includes(error?.code);

class OssMediaStore {
  constructor({ getClient, fallback, keyPattern, maximumBytes, integrityCode }) {
    this.getClient = getClient;
    this.fallback = fallback;
    this.keyPattern = keyPattern;
    this.maximumBytes = maximumBytes;
    this.integrityCode = integrityCode;
  }

  validate(key) {
    const match = this.keyPattern.exec(key);
    if (!match) throw Object.assign(new Error('Invalid media object key.'), { code: this.integrityCode });
    return { logicalKey: key, objectKey: `media/${key}`, expectedSha256: match[2] };
  }

  async putBody(key, body, expectedSha256) {
    if (!Buffer.isBuffer(body) || body.length < 1 || body.length > this.maximumBytes || crypto.createHash('sha256').update(body).digest('hex') !== expectedSha256) {
      throw Object.assign(new Error('Media object integrity check failed.'), { code: this.integrityCode });
    }
    const { objectKey } = this.validate(key);
    const client = await this.getClient();
    await client.put(objectKey, body, {
      headers: { 'Cache-Control': 'private, max-age=31536000, immutable', 'Content-Type': 'image/webp' },
      meta: { sha256: expectedSha256 },
    });
    return key;
  }

  async get(key) {
    const { objectKey, expectedSha256 } = this.validate(key);
    try {
      const result = await (await this.getClient()).get(objectKey);
      const body = result.content;
      if (!Buffer.isBuffer(body) || body.length < 1 || body.length > this.maximumBytes || crypto.createHash('sha256').update(body).digest('hex') !== expectedSha256) {
        throw Object.assign(new Error('Media object integrity check failed.'), { code: this.integrityCode });
      }
      return body;
    } catch (error) {
      if (missing(error) && this.fallback) return this.fallback.get(key);
      throw error;
    }
  }

  async remove(key) {
    const { objectKey } = this.validate(key);
    const errors = [];
    try { await (await this.getClient()).delete(objectKey); } catch (error) { if (!missing(error)) errors.push(error); }
    if (this.fallback) await this.fallback.remove(key).catch(error => errors.push(error));
    if (errors.length) throw errors[0];
  }
}

export class OssAvatarStore extends OssMediaStore {
  constructor({ getClient, fallback = null }) {
    super({ getClient, fallback, keyPattern: AVATAR_KEY, maximumBytes: 2 * 1024 * 1024, integrityCode: 'AVATAR_OBJECT_INTEGRITY' });
  }

  async put({ userId, variant, body, sha256 }) {
    const digest = Buffer.from(sha256).toString('hex');
    return this.putBody(`avatars/${userId}/${digest}-${variant}.webp`, body, digest);
  }
}

export class OssCoverStore extends OssMediaStore {
  constructor({ getClient, fallback = null }) {
    super({ getClient, fallback, keyPattern: COVER_KEY, maximumBytes: 1024 * 1024, integrityCode: 'COVER_OBJECT_INTEGRITY' });
  }

  async put({ workId, body, sha256 }) {
    return this.putBody(`covers/${workId}/${sha256}.webp`, body, sha256);
  }
}
