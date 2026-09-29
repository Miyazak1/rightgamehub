const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const source = file => pathToFileURL(path.resolve(__dirname, '../../apps/api/src', file));

test('cover processor emits a fixed metadata-free 16:9 WebP and rejects invalid bytes', async () => {
  const { processCoverImage, CoverProcessingError } = await import(source('cover-processor.mjs'));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWOosLnzHwAFUAKQJastWQAAAABJRU5ErkJggg==', 'base64');
  const output = await processCoverImage(png);
  assert.equal(output.mediaType, 'image/webp');
  assert.equal(output.width, 960);
  assert.equal(output.height, 540);
  assert.equal(output.body.subarray(0, 4).toString('ascii'), 'RIFF');
  await assert.rejects(processCoverImage(Buffer.from('not-an-image')), error => error instanceof CoverProcessingError);
});

test('local cover store constrains keys and verifies content hashes', async () => {
  const { LocalCoverStore } = await import(source('local-cover-store.mjs'));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamehub-cover-'));
  try {
    const store = new LocalCoverStore(root);
    const body = Buffer.from('RIFF-safe-cover-webp');
    const sha256 = crypto.createHash('sha256').update(body).digest('hex');
    const key = await store.put({ workId: '00000000-0000-4000-8000-000000000019', body, sha256 });
    assert.match(key, /^covers\/.+\.webp$/);
    assert.deepEqual(await store.get(key), body);
    await store.remove(key);
    await assert.rejects(store.get('../escape.webp'), error => error.code === 'COVER_OBJECT_KEY_INVALID');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
