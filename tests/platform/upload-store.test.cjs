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

test('accepted paper bytes move from quarantine into a content-addressed private archive', async () => {
  const { LocalQuarantineStore } = await import(pathToFileURL(path.join(root, 'apps/api/src/local-object-store.mjs')));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gamehub-paper-archive-'));
  const store = new LocalQuarantineStore(directory);
  const agentUserId = '11111111-1111-4111-8111-111111111111';
  const key = 'quarantine/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.pdf';
  const body = Buffer.from('%PDF-1.4\nimmutable paper bytes\n%%EOF');
  const sha256 = require('node:crypto').createHash('sha256').update(body).digest('hex');
  try {
    await store.putStream(key, Readable.from([body]), 1024);
    const archiveKey = await store.promotePaper(key, agentUserId, sha256);
    assert.equal(archiveKey, `paper-archive/${agentUserId}/${sha256}.pdf`);
    assert.deepEqual(await fs.readFile(store.pathFor(archiveKey)), body);
    await assert.rejects(fs.stat(store.resolveKey(key)), error => error.code === 'ENOENT');
    assert.throws(() => store.resolveKey(`paper-archive/${agentUserId}/../escape.pdf`), /INVALID_OBJECT_KEY/u);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
