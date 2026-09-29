import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const KEY = /^covers\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/([0-9a-f]{64})\.webp$/;

export class LocalCoverStore {
  constructor(root) { this.root = path.resolve(root); }

  resolveKey(key) {
    const match = KEY.exec(key);
    if (!match) throw Object.assign(new Error('Invalid cover object key.'), { code: 'COVER_OBJECT_KEY_INVALID' });
    const target = path.resolve(this.root, ...key.split('/'));
    if (!target.startsWith(`${this.root}${path.sep}`)) throw Object.assign(new Error('Invalid cover object key.'), { code: 'COVER_OBJECT_KEY_INVALID' });
    return { target, expectedSha256: match[2] };
  }

  async put({ workId, body, sha256 }) {
    if (!Buffer.isBuffer(body) || !/^[0-9a-f]{64}$/.test(sha256) || crypto.createHash('sha256').update(body).digest('hex') !== sha256) throw Object.assign(new Error('Cover object integrity check failed.'), { code: 'COVER_OBJECT_INTEGRITY' });
    const key = `covers/${workId}/${sha256}.webp`;
    const { target } = this.resolveKey(key);
    const temporary = `${target}.partial`;
    await fs.mkdir(path.dirname(target), { recursive: true });
    try {
      await fs.writeFile(temporary, body, { flag: 'wx', mode: 0o600 });
      try { await fs.rename(temporary, target); }
      catch (error) {
        if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
        if (!(await fs.readFile(target)).equals(body)) throw Object.assign(new Error('Cover object collision.'), { code: 'COVER_OBJECT_INTEGRITY' });
      }
      return key;
    } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
  }

  async get(key) {
    const { target, expectedSha256 } = this.resolveKey(key);
    const body = await fs.readFile(target);
    if (body.length < 1 || body.length > 1024 * 1024 || crypto.createHash('sha256').update(body).digest('hex') !== expectedSha256) throw Object.assign(new Error('Cover object integrity check failed.'), { code: 'COVER_OBJECT_INTEGRITY' });
    return body;
  }

  async remove(key) { const { target } = this.resolveKey(key); await fs.rm(target, { force: true }); }
}
