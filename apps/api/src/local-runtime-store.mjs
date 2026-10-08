import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { containedPath, validateAssetPath } from './web-package-policy.mjs';

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const stableJson = value => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};

export class LocalRuntimeStore {
  constructor(root) { this.root = path.resolve(root); }

  resolvePrefix(prefix) {
    if (!new RegExp(`^runtime/${uuid}/${uuid}$`).test(prefix)) throw Object.assign(new Error('Invalid runtime prefix.'), { code: 'RUNTIME_PREFIX_INVALID' });
    const target = path.resolve(this.root, ...prefix.split('/'));
    if (!target.startsWith(`${this.root}${path.sep}`)) throw Object.assign(new Error('Invalid runtime prefix.'), { code: 'RUNTIME_PREFIX_INVALID' });
    return target;
  }

  async publishAttempt({ releaseId, attemptId, sourceDirectory, report }) {
    const prefix = `runtime/${releaseId}/${attemptId}`;
    const target = this.resolvePrefix(prefix);
    await fsp.mkdir(path.join(target, 'assets'), { recursive: true });
    const manifestAssets = {};
    try {
      for (const relative of Object.keys(report.assets).sort()) {
        validateAssetPath(relative);
        const expected = report.assets[relative];
        const source = containedPath(sourceDirectory, relative);
        const destination = containedPath(path.join(target, 'assets'), relative);
        await fsp.mkdir(path.dirname(destination), { recursive: true });
        const hash = crypto.createHash('sha256');
        let size = 0;
        const verifier = new Transform({ transform(chunk, _encoding, callback) { size += chunk.length; hash.update(chunk); callback(null, chunk); } });
        await pipeline(fs.createReadStream(source), verifier, fs.createWriteStream(destination, { flags: 'wx' }));
        const digest = hash.digest('hex');
        if (size !== expected.size || digest !== expected.sha256) throw Object.assign(new Error('Validated asset changed before publication.'), { code: 'ASSET_INTEGRITY_CHANGED' });
        manifestAssets[relative] = { size, sha256: digest, mime: expected.mime };
      }
      const manifest = { policyVersion: report.policyVersion, entry: report.entry, approvedCapabilities: report.approvedCapabilities, ...(report.competition?{competition:report.competition}:{}), totalBytes: report.totalBytes, fileCount: report.fileCount, assets: manifestAssets };
      const manifestBytes = Buffer.from(`${stableJson(manifest)}\n`);
      const manifestSha256 = crypto.createHash('sha256').update(manifestBytes).digest('hex');
      await fsp.writeFile(path.join(target, 'asset-manifest.json'), manifestBytes, { flag: 'wx' });
      await fsp.writeFile(path.join(target, 'complete.json'), `${stableJson({ manifestSha256, completed: true })}\n`, { flag: 'wx' });
      return { prefix, manifest, manifestSha256 };
    } catch (error) {
      await fsp.rm(target, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  async loadManifest(prefix, expectedSha256) {
    const target = this.resolvePrefix(prefix);
    const [manifestBytes, completeBytes] = await Promise.all([
      fsp.readFile(path.join(target, 'asset-manifest.json')),
      fsp.readFile(path.join(target, 'complete.json')),
    ]);
    if (manifestBytes.length > 8 * 1024 * 1024 || completeBytes.length > 4096) throw Object.assign(new Error('Runtime metadata exceeds its limit.'), { code: 'RUNTIME_MANIFEST_INVALID' });
    const digest = crypto.createHash('sha256').update(manifestBytes).digest('hex');
    let complete;
    let manifest;
    try { complete = JSON.parse(completeBytes); manifest = JSON.parse(manifestBytes); } catch { throw Object.assign(new Error('Runtime metadata is invalid.'), { code: 'RUNTIME_MANIFEST_INVALID' }); }
    if (!complete.completed || complete.manifestSha256 !== digest || digest !== expectedSha256 || !manifest.assets || typeof manifest.assets !== 'object') throw Object.assign(new Error('Runtime manifest integrity check failed.'), { code: 'RUNTIME_MANIFEST_INVALID' });
    return manifest;
  }

  async inspectAsset(prefix, relative, expected) {
    const target = containedPath(path.join(this.resolvePrefix(prefix), 'assets'), relative);
    const info = await fsp.lstat(target);
    if (!info.isFile() || info.size !== expected.size) throw Object.assign(new Error('Runtime asset size changed.'), { code: 'RUNTIME_ASSET_INVALID' });
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(target)) hash.update(chunk);
    if (hash.digest('hex') !== expected.sha256) throw Object.assign(new Error('Runtime asset hash changed.'), { code: 'RUNTIME_ASSET_INVALID' });
    return { path: target, size: info.size };
  }
}
