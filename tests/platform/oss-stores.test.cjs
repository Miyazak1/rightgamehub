const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const sha256 = body => crypto.createHash('sha256').update(body).digest('hex');

class MemoryOssClient {
  constructor() { this.objects = new Map(); }

  async put(key, input, options = {}) {
    const body = Buffer.isBuffer(input) ? Buffer.from(input) : await fs.readFile(input);
    this.objects.set(key, { body, headers: options.headers ?? {}, meta: options.meta ?? {} });
    return { name: key };
  }

  async get(key) {
    const object = this.require(key);
    return { content: Buffer.from(object.body), meta: object.meta, res: { headers: object.headers } };
  }

  async head(key) {
    const object = this.require(key);
    return { meta: object.meta, res: { headers: { ...object.headers, 'content-length': String(object.body.length) } } };
  }

  async getStream(key, options = {}) {
    const object = this.require(key);
    const match = /^bytes=(\d+)-(\d+)$/.exec(options.headers?.Range ?? '');
    const body = match ? object.body.subarray(Number(match[1]), Number(match[2]) + 1) : object.body;
    return { stream: Readable.from(body) };
  }

  async delete(key) { this.objects.delete(key); }

  require(key) {
    const object = this.objects.get(key);
    if (!object) throw Object.assign(new Error(`Missing ${key}`), { status: 404, code: 'NoSuchKey' });
    return object;
  }
}

const readStream = async stream => {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
};

test('OSS media stores write new objects and retain local fallback reads', async () => {
  const { OssAvatarStore, OssCoverStore } = await import(pathToFileURL(path.join(root, 'apps/api/src/oss-media-store.mjs')));
  const client = new MemoryOssClient();
  const fallbackBody = Buffer.from('old-local-cover');
  const fallback = { get: async () => fallbackBody, remove: async () => {} };
  const getClient = async () => client;
  const userId = '11111111-1111-4111-8111-111111111111';
  const workId = '22222222-2222-4222-8222-222222222222';
  const avatarBody = Buffer.from('avatar-webp');
  const coverBody = Buffer.from('cover-webp');
  const avatarDigest = sha256(avatarBody);
  const coverDigest = sha256(coverBody);
  const avatarStore = new OssAvatarStore({ getClient, fallback });
  const coverStore = new OssCoverStore({ getClient, fallback });

  const avatarKey = await avatarStore.put({ userId, variant: 'static', body: avatarBody, sha256: Buffer.from(avatarDigest, 'hex') });
  const coverKey = await coverStore.put({ workId, body: coverBody, sha256: coverDigest });
  assert.deepEqual(await avatarStore.get(avatarKey), avatarBody);
  assert.deepEqual(await coverStore.get(coverKey), coverBody);
  assert.ok(client.objects.has(`media/${avatarKey}`));
  assert.ok(client.objects.has(`media/${coverKey}`));

  const oldKey = `covers/${workId}/${sha256(fallbackBody)}.webp`;
  assert.deepEqual(await coverStore.get(oldKey), fallbackBody);
});

test('OSS runtime store publishes verified assets and serves byte ranges', async t => {
  const { OssRuntimeStore } = await import(pathToFileURL(path.join(root, 'apps/api/src/oss-runtime-store.mjs')));
  const { createRuntimeEdgeApp } = await import(pathToFileURL(path.join(root, 'apps/api/src/runtime-edge-app.mjs')));
  const sourceDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'gamehub-oss-runtime-'));
  t.after(() => fs.rm(sourceDirectory, { recursive: true, force: true }));
  const body = Buffer.from('<!doctype html><title>OSS runtime</title>');
  await fs.writeFile(path.join(sourceDirectory, 'index.html'), body);
  const client = new MemoryOssClient();
  const store = new OssRuntimeStore({ getClient: async () => client });
  const releaseId = '33333333-3333-4333-8333-333333333333';
  const attemptId = '44444444-4444-4444-8444-444444444444';
  const report = {
    policyVersion: 1,
    entry: 'index.html',
    approvedCapabilities: [],
    totalBytes: body.length,
    fileCount: 1,
    assets: { 'index.html': { size: body.length, sha256: sha256(body), mime: 'text/html; charset=utf-8' } },
  };

  const published = await store.publishAttempt({ releaseId, attemptId, sourceDirectory, report });
  assert.equal(published.prefix, `runtime/${releaseId}/${attemptId}`);
  assert.deepEqual(await store.loadManifest(published.prefix, published.manifestSha256), published.manifest);
  const asset = await store.inspectAsset(published.prefix, 'index.html', report.assets['index.html']);
  assert.equal(asset.size, body.length);
  assert.deepEqual(await readStream(await asset.open({ start: 2, end: 11 })), body.subarray(2, 12));

  const edge = createRuntimeEdgeApp({
    runtimeDomain: 'runtime.test',
    repository: { resolveRelease: async id => id === releaseId ? {
      asset_prefix: published.prefix,
      asset_manifest_sha256: published.manifestSha256,
      asset_count: report.fileCount,
      expanded_bytes: report.totalBytes,
      entry_path: report.entry,
    } : null },
    objectStore: store,
  });
  t.after(() => edge.close());
  const response = await edge.inject({
    url: '/index.html',
    headers: { host: `r-${releaseId.replaceAll('-', '')}.runtime.test`, range: 'bytes=2-11' },
  });
  assert.equal(response.statusCode, 206);
  assert.deepEqual(response.rawPayload, body.subarray(2, 12));
});
