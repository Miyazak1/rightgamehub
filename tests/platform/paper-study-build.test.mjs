import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { sealPaperStudyBuild, resolvePaperStudyBuild } from '../../scripts/support/paper-study-build.mjs';

async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'paper-build-test-'));
  t.after(async () => {
    const resolved = path.resolve(root);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('paper-build-test-'));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  const write = async (name, value) => { const file = path.join(root, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, value); };
  const directory = path.join(root, '.runtime/desktop-auth-clean/check-new'), source = path.join(directory, 'source');
  const report = { passed: true, buildPassed: true, failed: 0, directory };
  for (const file of ['ui.jsx', 'api.mjs']) { await write(file, 'current'); await write(path.relative(root, path.join(source, file)), 'current'); }
  await write('.runtime/desktop-shell/web/index.html', 'old worktree build');
  await write('.runtime/desktop-auth-clean/check-new/source/.runtime/desktop-shell/web/index.html', 'new verified build');
  await write('.runtime/desktop-auth-clean/check-new/source/.runtime/desktop-shell/web/assets/app.js', 'new JS');
  await write('.runtime/desktop-auth-clean/check-new/report.json', JSON.stringify(report));
  await write('.runtime/paper-study/clean-latest.json', JSON.stringify(report));
  await write('electron-test.exe', 'test executable');
  await write('.runtime/desktop-shell/launch.json', JSON.stringify({ electronExecutable: path.join(root, 'electron-test.exe'), assetRoot: 'old-assets-ignored' }));
  await sealPaperStudyBuild(directory, { files: ['ui.jsx', 'api.mjs'] });
  return { root, directory, source, write };
}
test('default verification selects the sealed latest export and never worktree assets', async t => {
  const f = await setup(t), build = await resolvePaperStudyBuild({ root: f.root });
  assert.equal(build.source, f.source);
  assert.equal(await fs.readFile(path.join(build.assetRoot, 'index.html'), 'utf8'), 'new verified build');
  assert.equal((await resolvePaperStudyBuild({ root: f.root, source: f.source })).source, f.source);
});
test('changed current source or exported source is rejected instead of validating stale UI', async t => {
  const f = await setup(t);
  await f.write('ui.jsx', 'new unbuilt source');
  await assert.rejects(resolvePaperStudyBuild({ root: f.root }), /PAPER_BUILD_SOURCE_STALE/);
  await f.write('ui.jsx', 'current');
  await f.write('.runtime/desktop-auth-clean/check-new/source/api.mjs', 'changed export');
  await assert.rejects(resolvePaperStudyBuild({ root: f.root }), /PAPER_BUILD_SOURCE_STALE/);
});
test('changed asset or failed build cannot fall back to old worktree assets', async t => {
  const f = await setup(t);
  await f.write('.runtime/desktop-auth-clean/check-new/source/.runtime/desktop-shell/web/assets/app.js', 'corrupted');
  await assert.rejects(resolvePaperStudyBuild({ root: f.root }), /PAPER_BUILD_ASSET_STALE/);
  await f.write('.runtime/paper-study/clean-latest.json', JSON.stringify({ passed: false }));
  await assert.rejects(resolvePaperStudyBuild({ root: f.root }), /PAPER_BUILD_CHECK_REQUIRED/);
});
test('explicit source outside a checked export and invalid runtime config are rejected', async t => {
  const f = await setup(t);
  await assert.rejects(resolvePaperStudyBuild({ root: f.root, source: f.root }), /PAPER_BUILD_SOURCE_OUTSIDE_EXPORT/);
  await f.write('.runtime/desktop-shell/launch.json', JSON.stringify({ electronExecutable: 'relative.exe' }));
  await assert.rejects(resolvePaperStudyBuild({ root: f.root }), /PAPER_BUILD_ELECTRON_CONFIG_INVALID/);
});
test('explicit old D1 line exclusion does not hide other source drift', async t => {
  const f = await setup(t);
  await f.write('api.mjs', 'current\nold-diagnostic-line');
  await f.write('.runtime/desktop-auth-clean/check-new/source/api.mjs', 'current');
  await sealPaperStudyBuild(f.directory, { files: ['ui.jsx', 'api.mjs'], excludeLines: [{ file: 'api.mjs', lines: ['old-diagnostic-line'] }] });
  await assert.doesNotReject(resolvePaperStudyBuild({ root: f.root }));
  await f.write('api.mjs', 'changed\nold-diagnostic-line');
  await assert.rejects(resolvePaperStudyBuild({ root: f.root }), /PAPER_BUILD_SOURCE_STALE/);
});
