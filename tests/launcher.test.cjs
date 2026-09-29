const test = require('node:test');
const assert = require('node:assert/strict');
const { openArcade } = require('../shared/launcher.cjs');

test('unsupported sidebar goes directly to the embedded browser', async () => {
  const result = await openArcade({
    sidebar: { supported: false, open() { assert.fail('Must not probe unsupported host'); } },
    browser: { async open() { return { status: 'opened' }; } },
  });
  assert.deepEqual(result, { mode: 'browser', status: 'opened', reason: 'sidebar-unavailable' });
});
test('ready sidebar does not open a duplicate browser', async () => {
  assert.deepEqual(await openArcade({
    sidebar: { supported: true, async open() { return { ready: true }; } },
    browser: { open() { assert.fail('Must not open a second surface'); } },
  }), { mode: 'sidebar' });
});
test('sidebar permission or registration error falls back to the browser', async () => {
  const result = await openArcade({
    sidebar: { supported: true, async open() { throw new Error('Panel denied'); } },
    browser: { async open() { return { status: 'queued' }; } },
  });
  assert.equal(result.mode, 'browser');
  assert.equal(result.status, 'queued');
  assert.equal(result.reason, 'sidebar-open-failed');
});
test('unready sidebar falls back instead of claiming successful launch', async () => {
  const result = await openArcade({
    sidebar: { supported: true, async open() { return { ready: false }; } },
    browser: { async open() { return { status: 'opened' }; } },
  });
  assert.equal(result.reason, 'sidebar-not-ready');
});
test('explicit browser preference is honored on a sidebar-capable host', async () => {
  const result = await openArcade({ preference: 'browser',
    sidebar: { supported: true, open() { assert.fail('Browser preference ignored'); } },
    browser: { async open() { return { status: 'queued' }; } },
  });
  assert.equal(result.reason, 'user-selected-browser');
});
test('missing or unsuccessful browser adapter is reported as failure', async () => {
  await assert.rejects(openArcade({}), /内置浏览器/);
  await assert.rejects(openArcade({ browser: { async open() { return undefined; } } }), /未能打开/);
});
