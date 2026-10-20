const test = require('node:test');
const assert = require('node:assert/strict');

test('PDF OCR caches local models under language-code keys before worker initialization', async () => {
  const { OCR_CACHE_PATH, prepareOcrLanguages } = await import('../../packages/platform-client/src/pdf-reader-ocr.mjs');
  const writes = [];
  const languages = await prepareOcrLanguages([
    { code: 'eng', url: '/eng.gz' },
    { code: 'chi_sim', url: '/chi.gz' },
  ], {
    fetchImpl: async url => ({ ok: true, arrayBuffer: async () => Uint8Array.from([url.length, 31, 139]).buffer }),
    writeCache: async entries => writes.push(...entries),
  });

  assert.deepEqual(languages, [{ code: 'eng', data: 'eng' }, { code: 'chi_sim', data: 'chi_sim' }]);
  assert.deepEqual(writes.map(([key]) => key), [
    `${OCR_CACHE_PATH}/eng.traineddata`,
    `${OCR_CACHE_PATH}/chi_sim.traineddata`,
  ]);
  assert.ok(writes.every(([, value]) => value instanceof Uint8Array));
});

test('PDF OCR timeout rejects a worker job that never settles', async () => {
  const { withOcrTimeout } = await import('../../packages/platform-client/src/pdf-reader-ocr.mjs');
  await assert.rejects(withOcrTimeout(new Promise(() => {}), 5, 'stalled'), /stalled/u);
});
