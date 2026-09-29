const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const storeUrl = pathToFileURL(path.resolve(__dirname, '../../apps/api/src/local-avatar-store.mjs'));

test('local avatar store uses constrained content-addressed keys and verifies reads', async () => {
  const { LocalAvatarStore } = await import(storeUrl);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamehub-avatar-'));
  try {
    const store = new LocalAvatarStore(root);
    const body = Buffer.from('RIFF-safe-webp-placeholder');
    const sha256 = crypto.createHash('sha256').update(body).digest();
    const key = await store.put({ userId: '00000000-0000-4000-8000-000000000019', variant: 'animated', body, sha256 });
    assert.match(key, /^avatars\/.+-animated\.webp$/);
    assert.deepEqual(await store.get(key), body);
    await store.remove(key);
    await assert.rejects(store.get(key), error => error.code === 'ENOENT');
    await assert.rejects(store.get('../escape.webp'), error => error.code === 'AVATAR_OBJECT_KEY_INVALID');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
