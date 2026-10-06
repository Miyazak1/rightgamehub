const test = require('node:test');
const assert = require('node:assert/strict');

test('installed editor allows loopback only when trusted API and runtime configuration agree', async () => {
  const { playerRuntimeOptions } = await import('../../packages/platform-client/src/player-runtime-options.mjs');
  const { validateLaunchDescriptor } = await import('../../packages/player-core/src/index.mjs');
  const runtimeOrigin = 'http://r-27c4a881871a4ae18201ed0f4ecbe12a.localhost:3092';
  const descriptor = { apiVersion: 1, runtimeOrigin, entryUrl: runtimeOrigin + '/index.html' };
  const editorPage = 'editor-webview-opaque-id';
  for (const apiBaseUrl of ['http://127.0.0.1:3086', 'http://localhost:3090']) {
    const options = playerRuntimeOptions({ pageHostname: editorPage, host: { apiBaseUrl, runtimeDomain: 'localhost' } });
    assert.equal(validateLaunchDescriptor(descriptor, options).entry.pathname, '/index.html');
  }
  for (const host of [
    undefined, { runtimeDomain: 'localhost' },
    { apiBaseUrl: 'https://mooyu.fun', runtimeDomain: 'localhost' },
    { apiBaseUrl: 'http://localhost.evil.example', runtimeDomain: 'localhost' },
    { apiBaseUrl: 'http://user:secret@localhost', runtimeDomain: 'localhost' },
    { apiBaseUrl: 'file://localhost', runtimeDomain: 'localhost' },
    { apiBaseUrl: 'http://localhost:3086', runtimeDomain: 'runtime.mooyu.fun' },
  ]) {
    assert.throws(() => validateLaunchDescriptor(descriptor, playerRuntimeOptions({ pageHostname: editorPage, host })), /安全来源/);
  }
});

test('web and production editor retain their existing release trust boundaries', async () => {
  const { playerRuntimeOptions } = await import('../../packages/platform-client/src/player-runtime-options.mjs');
  const { validateLaunchDescriptor } = await import('../../packages/player-core/src/index.mjs');
  assert.deepEqual(playerRuntimeOptions({ pageHostname: '127.0.0.1' }), { runtimeDomain: 'localhost', allowLocalhost: true });
  const options = playerRuntimeOptions({ pageHostname: 'editor-webview', host: { apiBaseUrl: 'https://mooyu.fun', runtimeDomain: 'runtime.mooyu.fun' } });
  const origin = 'https://r-27c4a881871a4ae18201ed0f4ecbe12a.runtime.mooyu.fun';
  assert.equal(validateLaunchDescriptor({ apiVersion: 1, runtimeOrigin: origin, entryUrl: origin + '/index.html' }, options).runtime.origin, origin);
  assert.throws(() => validateLaunchDescriptor({ apiVersion: 1, runtimeOrigin: 'https://evil.example', entryUrl: 'https://evil.example/index.html' }, options), /受信任/);
});
