import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const root = new URL('../../', import.meta.url);
const scope = JSON.parse(await fs.readFile(new URL('scripts/desktop-auth-scope.json', root), 'utf8'));

test('shipping scope excludes old diagnostic and paper implementation dependencies', () => {
  assert.equal(new Set(scope.files).size, scope.files.length);
  for (const file of scope.deferred) assert.equal(scope.files.includes(file), false, file);
  for (const file of scope.files) assert.doesNotMatch(file, /(?:^\.runtime\/|agent-paper-|paper-thematic|desktop-workbench|desktop-d1|MooyuWorkbench)/);
  assert.equal(scope.files.includes('apps/api/src/desktop-auth-readiness.mjs'), true);
  assert.equal(scope.files.includes('scripts/verify-desktop-clean.mjs'), true);
});

test('package entrypoints and shipped documentation do not advertise deferred diagnostic commands', async () => {
  const pkg = JSON.parse(await fs.readFile(new URL('apps/desktop/package.json', root), 'utf8'));
  assert.deepEqual(Object.keys(pkg.scripts).sort(), ['build', 'start']);
  for (const file of ['apps/desktop/README.zh-CN.md', 'docs/mooyu-desktop-electron-preview.zh-CN.md']) {
    assert.doesNotMatch(await fs.readFile(new URL(file, root), 'utf8'), /start-mooyu-desktop-d1|start-desktop-d1|desktop-workbench\.test|build-desktop-d1/);
  }
});
