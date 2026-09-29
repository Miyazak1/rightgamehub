const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');

test('quarantine store enforces the streamed byte limit and leaves no committed or partial object', async () => {
  const { LocalQuarantineStore } = await import(pathToFileURL(path.join(root, 'apps/api/src/local-object-store.mjs')));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gamehub-quarantine-'));
  const store = new LocalQuarantineStore(directory);
  const key = 'quarantine/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.zip';
  try {
    await assert.rejects(store.putStream(key, Readable.from([Buffer.from('five!')]), 4), error => error.code === 'UPLOAD_TOO_LARGE');
    await assert.rejects(fs.stat(store.resolveKey(key)), error => error.code === 'ENOENT');
    await assert.rejects(fs.stat(`${store.resolveKey(key)}.partial`), error => error.code === 'ENOENT');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
