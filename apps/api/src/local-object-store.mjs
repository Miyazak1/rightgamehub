import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

async function sha256File(filename) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

export class LocalQuarantineStore {
  constructor(root) { this.root = path.resolve(root); }

  resolveKey(key) {
    if (!/^(?:quarantine\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:zip|bin|pdf)|paper-archive\/[0-9a-f-]{36}\/[0-9a-f]{64}\.pdf)$/.test(key)) throw new Error('INVALID_OBJECT_KEY');
    const target = path.resolve(this.root, ...key.split('/'));
    if (!target.startsWith(`${this.root}${path.sep}`)) throw new Error('INVALID_OBJECT_KEY');
    return target;
  }

  async promotePaper(key, agentUserId, sha256) {
    if (!/^[0-9a-f-]{36}$/.test(agentUserId) || !/^[0-9a-f]{64}$/.test(sha256)) {
      throw new Error('INVALID_PAPER_ARCHIVE_KEY');
    }
    const source = this.resolveKey(key);
    if (!key.endsWith('.pdf') || !key.startsWith('quarantine/')) throw new Error('INVALID_PAPER_ARCHIVE_SOURCE');
    if (await sha256File(source) !== sha256) throw new Error('PAPER_ARCHIVE_SOURCE_HASH_MISMATCH');
    const archiveKey = `paper-archive/${agentUserId}/${sha256}.pdf`;
    const target = this.resolveKey(archiveKey);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    try {
      await fsp.link(source, target);
    } catch (error) {
      if (error?.code === 'EPERM' && process.platform === 'win32') {
        try { await fsp.copyFile(source, target, fs.constants.COPYFILE_EXCL); }
        catch (copyError) {
          if (copyError?.code !== 'EEXIST') throw copyError;
          if (await sha256File(target) !== sha256) throw new Error('PAPER_ARCHIVE_HASH_MISMATCH');
        }
      } else if (error?.code === 'EEXIST') {
        if (await sha256File(target) !== sha256) throw new Error('PAPER_ARCHIVE_HASH_MISMATCH');
      } else throw error;
    }
    if (process.platform !== 'win32') await fsp.chmod(target, 0o440);
    await fsp.rm(source, { force: true });
    return archiveKey;
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
      try { await fsp.rename(temporary, target); }
      catch (error) {
        if (error?.code !== 'EPERM' || process.platform !== 'win32') throw error;
        await fsp.copyFile(temporary, target, fs.constants.COPYFILE_EXCL);
        await fsp.rm(temporary, { force: true });
      }
      return { bytes, sha256: hash.digest('hex') };
    } catch (error) {
      await fsp.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }

  pathFor(key) { return this.resolveKey(key); }
  async remove(key) { await fsp.rm(this.resolveKey(key), { force: true }); }
}
