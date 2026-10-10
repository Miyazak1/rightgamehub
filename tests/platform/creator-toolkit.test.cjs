const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { pathToFileURL } = require('node:url');

const exec = promisify(execFile);
const root = path.resolve(__dirname, '../..');
async function project(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gamehub-web-doctor-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('local Web Doctor accepts a self-contained static project', async t => {
  const { inspectStaticWebProject } = await import(pathToFileURL(path.join(root, 'packages/creator-tools/src/index.mjs')));
  const directory = await project(t);
  await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><meta charset="utf-8"><script src="game.js"></script>');
  await fs.writeFile(path.join(directory, 'game.js'), 'document.body.append("ready")');
  const report = await inspectStaticWebProject(directory);
  assert.equal(report.ok, true, JSON.stringify(report.findings, null, 2));
  assert.equal(report.summary.errors, 0);
  assert.ok(report.findings.some(item => item.code === 'WEB_PROJECT_READY'));
  assert.ok(report.findings.some(item => item.code === 'LOCAL_DOCTOR_LIMIT'));
});

test('local Web Doctor warns about remote runtime dependencies', async t => {
  const { inspectStaticWebProject } = await import(pathToFileURL(path.join(root, 'packages/creator-tools/src/index.mjs')));
  const directory = await project(t);
  await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><script src="https://cdn.example/game.js"></script>');
  const report = await inspectStaticWebProject(directory);
  assert.equal(report.ok, true);
  assert.ok(report.findings.some(item => item.code === 'WEB_REMOTE_RUNTIME'));
});

test('local Web Doctor rejects missing entry, credentials and executables', async t => {
  const { inspectStaticWebProject } = await import(pathToFileURL(path.join(root, 'packages/creator-tools/src/index.mjs')));
  const missing = await project(t);
  await fs.writeFile(path.join(missing, 'game.js'), 'console.log("no entry")');
  assert.ok((await inspectStaticWebProject(missing)).findings.some(item => item.code === 'WEB_ENTRY_MISSING'));

  const unsafe = await project(t);
  await fs.writeFile(path.join(unsafe, 'index.html'), '<!doctype html><title>unsafe project</title>');
  await fs.writeFile(path.join(unsafe, '.env'), 'API_KEY="abcdefghijklmnop"');
  await fs.writeFile(path.join(unsafe, 'helper.exe'), 'not executable, still forbidden');
  const report = await inspectStaticWebProject(unsafe);
  assert.equal(report.ok, false);
  assert.ok(report.findings.some(item => item.code === 'WEB_SECRET_FILE'));
  assert.ok(report.findings.some(item => item.code === 'WEB_EXECUTABLE_FORBIDDEN'));
});

test('creator toolkit CLI exposes the versioned local catalog and Doctor', async t => {
  const directory = await project(t);
  await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><title>local work</title>');
  const cli = path.join(root, 'scripts/creator-toolkit-cli.mjs');
  const listed = await exec(process.execPath, [cli, 'list', '--json'], { cwd: root });
  const catalog = JSON.parse(listed.stdout);
  assert.equal(catalog.execution.workspace, 'user-local');
  assert.equal(catalog.execution.remoteExecution, false);
  const shown = await exec(process.execPath, [cli, 'show', 'twine', '--json'], { cwd: root });
  assert.equal(JSON.parse(shown.stdout).sourceFormat, 'twee3');
  const checked = await exec(process.execPath, [cli, 'doctor', directory, '--json'], { cwd: root });
  assert.equal(JSON.parse(checked.stdout).ok, true);
});
