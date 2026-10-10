const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');

test('Orbital Order builds as a self-contained GameHub Web ZIP', async () => {
  execFileSync(process.execPath, ['scripts/build-orbital-order.mjs'], { cwd: root, stdio: 'pipe' });
  const output = path.join(root, '.runtime/orbital-order-web');
  const [html, adapter, styles, storage, game, tutorial, manifest, license, report] = await Promise.all([
    fs.readFile(path.join(output, 'index.html'), 'utf8'),
    fs.readFile(path.join(output, 'gamehub-adapter.js'), 'utf8'),
    fs.readFile(path.join(output, 'gamehub.css'), 'utf8'),
    fs.readFile(path.join(output, 'gamehub-safe-storage.js'), 'utf8'),
    fs.readFile(path.join(output, 'GameGolfed.js'), 'utf8'),
    fs.readFile(path.join(output, 'components/TutorialGolfed.js'), 'utf8'),
    fs.readFile(path.join(output, 'platform.json'), 'utf8'),
    fs.readFile(path.join(output, 'LICENSE.txt'), 'utf8'),
    fs.readFile(path.join(output, 'build-report.json'), 'utf8'),
  ]);
  assert.match(html, /Orbital Order · 轨道秩序/);
  assert.match(html, /gamehub-safe-storage\.js/);
  assert.match(html, /gamehub-adapter\.js/);
  assert.match(html, /return true;/);
  assert.match(adapter, /canvas\.width \/ rect\.width/);
  assert.match(adapter, /pointermove/);
  assert.match(adapter, /\['规则', 'Escape'\]/);
  assert.match(adapter, /pointerdown/);
  assert.match(styles, /#mobile-warning\{display:none!important\}/);
  assert.match(styles, /@media\(pointer:coarse\)/);
  assert.match(styles, /100dvh/);
  assert.match(storage, /window\.localStorage/);
  assert.match(storage, /memory/);
  assert.match(game, /getElementById/);
  assert.match(tutorial, /gamehubSafeStorage\.getItem/);
  assert.doesNotMatch(tutorial, /localStorage\./);
  assert.deepEqual(JSON.parse(manifest), { version: 1, entry: 'index.html', capabilities: [] });
  assert.match(license, /Copyright \(c\) Afton Gauntlett/);
  const parsed = JSON.parse(report);
  assert.equal(parsed.upstream.commit, '3d9fe2af2384b04404266b50805d8cd896a5dab8');
  assert.deepEqual(parsed.capabilities, []);
  assert.ok(parsed.files >= 10);
  assert.equal(parsed.doctor.errors, 0);
  assert.ok((await fs.stat(path.join(root, 'artifacts/orbital-order-gamehub-v1.zip'))).size > 1_000);
});
