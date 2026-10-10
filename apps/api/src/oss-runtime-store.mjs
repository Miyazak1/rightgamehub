import crypto from 'node:crypto';
import fs from 'node:fs';
import { containedPath, validateAssetPath } from './web-package-policy.mjs';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const missing = error => error?.status === 404 || ['NoSuchKey', 'NoSuchObject'].includes(error?.code);
const stableJson = value => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const digestFile = async file => {
  const hash = crypto.createHash('sha256');
  let size = 0;
  for await (const chunk of fs.createReadStream(file)) { size += chunk.length; hash.update(chunk); }
  return { size, sha256: hash.digest('hex') };
};

export class OssRuntimeStore {
  constructor({ getClient, fallback = null }) { this.getClient = getClient; this.fallback = fallback; }

  validatePrefix(prefix) {
    if (!new RegExp(`^runtime/${UUID}/${UUID}$`).test(prefix)) throw Object.assign(new Error('Invalid runtime prefix.'), { code: 'RUNTIME_PREFIX_INVALID' });
    return prefix;
  }

  async publishAttempt({ releaseId, attemptId, sourceDirectory, report }) {
    const prefix = this.validatePrefix(`runtime/${releaseId}/${attemptId}`);
    const client = await this.getClient();
    const uploaded = [];
    const manifestAssets = {};
    try {
      for (const relative of Object.keys(report.assets).sort()) {
        validateAssetPath(relative);
        const expected = report.assets[relative];
        const source = containedPath(sourceDirectory, relative);
        const actual = await digestFile(source);
        if (actual.size !== expected.size || actual.sha256 !== expected.sha256) throw Object.assign(new Error('Validated asset changed before publication.'), { code: 'ASSET_INTEGRITY_CHANGED' });
        const objectKey = `${prefix}/assets/${relative}`;
        await client.put(objectKey, source, {
          headers: { 'Cache-Control': 'private, max-age=31536000, immutable', 'Content-Type': expected.mime },
          meta: { sha256: actual.sha256 },
        });
        uploaded.push(objectKey);
        manifestAssets[relative] = { size: actual.size, sha256: actual.sha256, mime: expected.mime };
      }
      const manifest = { policyVersion: report.policyVersion, entry: report.entry, approvedCapabilities: report.approvedCapabilities, totalBytes: report.totalBytes, fileCount: report.fileCount, assets: manifestAssets };
      const manifestBytes = Buffer.from(`${stableJson(manifest)}\n`);
      const manifestSha256 = crypto.createHash('sha256').update(manifestBytes).digest('hex');
      const manifestKey = `${prefix}/asset-manifest.json`;
      await client.put(manifestKey, manifestBytes, { headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' }, meta: { sha256: manifestSha256 } });
      uploaded.push(manifestKey);
      const completeKey = `${prefix}/complete.json`;
      await client.put(completeKey, Buffer.from(`${stableJson({ manifestSha256, completed: true })}\n`), { headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' } });
      uploaded.push(completeKey);
      return { prefix, manifest, manifestSha256 };
    } catch (error) {
      await Promise.allSettled(uploaded.reverse().map(key => client.delete(key)));
      throw error;
    }
  }

  async loadManifest(prefix, expectedSha256) {
    this.validatePrefix(prefix);
    try {
      const client = await this.getClient();
      const [manifestResult, completeResult] = await Promise.all([
        client.get(`${prefix}/asset-manifest.json`),
        client.get(`${prefix}/complete.json`),
      ]);
      const manifestBytes = manifestResult.content;
      const completeBytes = completeResult.content;
      if (!Buffer.isBuffer(manifestBytes) || !Buffer.isBuffer(completeBytes) || manifestBytes.length > 8 * 1024 * 1024 || completeBytes.length > 4096) throw Object.assign(new Error('Runtime metadata exceeds its limit.'), { code: 'RUNTIME_MANIFEST_INVALID' });
      const digest = crypto.createHash('sha256').update(manifestBytes).digest('hex');
      let complete;
      let manifest;
      try { complete = JSON.parse(completeBytes); manifest = JSON.parse(manifestBytes); } catch { throw Object.assign(new Error('Runtime metadata is invalid.'), { code: 'RUNTIME_MANIFEST_INVALID' }); }
      if (!complete.completed || complete.manifestSha256 !== digest || digest !== expectedSha256 || !manifest.assets || typeof manifest.assets !== 'object') throw Object.assign(new Error('Runtime manifest integrity check failed.'), { code: 'RUNTIME_MANIFEST_INVALID' });
      return manifest;
    } catch (error) {
      if (missing(error) && this.fallback) return this.fallback.loadManifest(prefix, expectedSha256);
      throw error;
    }
  }

  async inspectAsset(prefix, relative, expected) {
    this.validatePrefix(prefix);
    validateAssetPath(relative);
    const objectKey = `${prefix}/assets/${relative}`;
    try {
      const client = await this.getClient();
      const result = await client.head(objectKey);
      const size = Number(result.res.headers['content-length']);
      if (!Number.isSafeInteger(size) || size !== expected.size || result.meta?.sha256 !== expected.sha256) throw Object.assign(new Error('Runtime asset metadata changed.'), { code: 'RUNTIME_ASSET_INVALID' });
      return {
        size,
        open: async ({ start, end }) => (await client.getStream(objectKey, {
          headers: { Range: `bytes=${start}-${end}`, 'x-oss-range-behavior': 'standard' },
        })).stream,
      };
    } catch (error) {
      if (missing(error) && this.fallback) return this.fallback.inspectAsset(prefix, relative, expected);
      throw error;
    }
  }
}
