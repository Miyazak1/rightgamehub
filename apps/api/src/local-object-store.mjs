import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export class LocalQuarantineStore {
  constructor(root) { this.root = path.resolve(root); }

  resolveKey(key) {
    if (!/^quarantine\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(zip|bin)$/.test(key)) throw new Error('INVALID_OBJECT_KEY');
    const target = path.resolve(this.root, ...key.split('/'));
    if (!target.startsWith(`${this.root}${path.sep}`)) throw new Error('INVALID_OBJECT_KEY');
    return target;
  }

  async putStream(key, stream, maxBytes) {
    const target = this.resolveKey(key);
    const temporary = `${target}.partial`;
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const hash = crypto.createHash('sha256');
    let bytes = 0;
    const counter = new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > maxBytes) return callback(Object.assign(new Error('UPLOAD_TOO_LARGE'), { code: 'UPLOAD_TOO_LARGE' }));
        hash.update(chunk); callback(null, chunk);
      },
    });
    try {
      await pipeline(stream, counter, fs.createWriteStream(temporary, { flags: 'wx' }));
      await fsp.rename(temporary, target);
      return { bytes, sha256: hash.digest('hex') };
    } catch (error) {
      await fsp.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }

  pathFor(key) { return this.resolveKey(key); }
  async remove(key) { await fsp.rm(this.resolveKey(key), { force: true }); }
}
