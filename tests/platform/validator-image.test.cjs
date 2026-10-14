const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { makeZip } = require('../../scripts/zip-fixture.cjs');

const root = path.resolve(__dirname, '../..');

test('validator runtime image starts and validates uploads with only its declared COPY files', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'validator-image-'));
  try {
    const dockerfile = await fs.readFile(path.join(root, 'deploy/Dockerfile.validator'), 'utf8');
    const runtime = dockerfile.split(' AS runtime')[1];
    // Reproduce the image filesystem without allowing imports to fall back to the repository.
    for (const line of runtime.split(/\r?\n/).filter(line => line.startsWith('COPY --chown=node:node '))) {
      const parts = line.slice('COPY --chown=node:node '.length).trim().split(/\s+/);
      const target = parts.pop();
      for (const source of parts) {
        const destination = path.join(directory, target, ...(target.endsWith('/') ? [path.basename(source)] : []));
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.cp(path.join(root, source), destination, { recursive: true });
      }
    }
    // This is the external package layer copied from the dependencies stage.
    const modules = path.join(directory, 'apps/api/node_modules');
    await fs.mkdir(modules, { recursive: true });
    await fs.symlink(await fs.realpath(path.join(root, 'apps/api/node_modules/yauzl')), path.join(modules, 'yauzl'), 'junction');
    const zip = path.join(directory, 'game.zip');
    await fs.writeFile(zip, makeZip([
      { name: 'index.html', data: '<!doctype html><p>English practice</p>' },
      { name: 'platform.json', data: JSON.stringify({ version: 1, capabilities: ['localSave'] }) },
    ]));
    const child = spawnSync(process.execPath, [path.join(directory, 'apps/api/src/web-zip-validator-cli.mjs'), zip, path.join(directory, 'output')], { encoding: 'utf8', windowsHide: true });
    assert.equal(child.status, 0, child.stderr || child.stdout);
    const response = JSON.parse(child.stdout);
    assert.equal(response.ok, true);
    assert.deepEqual(response.report.approvedCapabilities, ['localSave']);

    const invalid = path.join(directory, 'courseware.zip');
    await fs.writeFile(invalid, makeZip([
      { name: 'index.html', data: '<!doctype html><p>Courseware</p>' },
      { name: 'mooyu-courseware.json', data: '{}' },
    ]));
    const rejected = spawnSync(process.execPath, [path.join(directory, 'apps/api/src/web-zip-validator-cli.mjs'), invalid, path.join(directory, 'invalid-output')], { encoding: 'utf8', windowsHide: true });
    assert.equal(rejected.status, 1);
    const failure = JSON.parse(rejected.stdout);
    assert.equal(failure.ok, false);
    assert.match(failure.error.code, /^COURSEWARE_/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
