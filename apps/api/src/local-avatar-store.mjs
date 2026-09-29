import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const KEY = /^avatars\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/([0-9a-f]{64})-(animated|static)\.webp$/;

export class LocalAvatarStore {
  constructor(root) { this.root = path.resolve(root); }

  resolveKey(key) {
    const match = KEY.exec(key);
    if (!match) throw Object.assign(new Error('Invalid avatar object key.'), { code: 'AVATAR_OBJECT_KEY_INVALID' });
    const target = path.resolve(this.root, ...key.split('/'));
    if (!target.startsWith(`${this.root}${path.sep}`)) throw Object.assign(new Error('Invalid avatar object key.'), { code: 'AVATAR_OBJECT_KEY_INVALID' });
    return { target, expectedSha256: match[2] };
  }

  async put({ userId, variant, body, sha256 }) {
    const digest = Buffer.from(sha256).toString('hex');
    if (!Buffer.isBuffer(body) || !/^[0-9a-f]{64}$/.test(digest) || crypto.createHash('sha256').update(body).digest('hex') !== digest) {
      throw Object.assign(new Error('Avatar object integrity check failed.'), { code: 'AVATAR_OBJECT_INTEGRITY' });
    }
    const key = `avatars/${userId}/${digest}-${variant}.webp`;
    const { target } = this.resolveKey(key);
    const temporary = `${target}.partial`;
    await fs.mkdir(path.dirname(target), { recursive: true });
    try {
      await fs.writeFile(temporary, body, { flag: 'wx', mode: 0o600 });
      try { await fs.rename(temporary, target); }
      catch (error) {
        if (error.code !== 'EEXIST' && error.code !== 'EPERM') throw error;
        const existing = await fs.readFile(target);
        if (!existing.equals(body)) throw Object.assign(new Error('Avatar object collision.'), { code: 'AVATAR_OBJECT_INTEGRITY' });
      }
      return key;
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => {});
    }
  }

  async get(key) {
    const { target, expectedSha256 } = this.resolveKey(key);
    const body = await fs.readFile(target);
    if (body.length < 1 || body.length > 2 * 1024 * 1024 || crypto.createHash('sha256').update(body).digest('hex') !== expectedSha256) {
      throw Object.assign(new Error('Avatar object integrity check failed.'), { code: 'AVATAR_OBJECT_INTEGRITY' });
    }
    return body;
  }

  async remove(key) {
    const { target } = this.resolveKey(key);
    await fs.rm(target, { force: true });
  }
}
