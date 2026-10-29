const test = require('node:test');
const assert = require('node:assert/strict');

test('shared task panel maps every supported shell to one control-plane profile', async () => {
  const { createCapabilityTaskHostProfile } = await import('../../packages/platform-client/src/capability-task-panel.mjs');
  const cases = [
    ['mcp-app', 'mcp-app'], ['codex', 'sidebar'], ['harness', 'sidebar'],
    ['cursor', 'sidebar'], ['vscode', 'sidebar'], ['desktop-app', 'desktop-window'],
  ];
  for (const [host, surface] of cases) {
    const profile = createCapabilityTaskHostProfile({ id: host, version: '2.3.4' });
    assert.equal(profile.host, host);
    assert.equal(profile.hostVersion, '2.3.4');
    assert.equal(profile.surface, surface);
    assert.equal(profile.connection, 'control-plane');
    assert.equal(profile.features.background, true);
    assert.equal(profile.features.artifacts, false);
  }
  assert.equal(createCapabilityTaskHostProfile({ id: 'browser' }), null);
});

test('artifact actions stay disabled until the host provides a trusted opener', async () => {
  const { createCapabilityTaskHostProfile } = await import('../../packages/platform-client/src/capability-task-panel.mjs');
  assert.equal(createCapabilityTaskHostProfile({ id: 'cursor' }, { artifactOpener: true }).features.artifacts, true);
});
