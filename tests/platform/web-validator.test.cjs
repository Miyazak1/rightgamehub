const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { makeZip } = require('../../scripts/zip-fixture.cjs');

const root = path.resolve(__dirname, '../..');

test('web validator extracts a strict immutable asset report and rejects unsafe paths', async () => {
  const { validateWebZip } = await import(pathToFileURL(path.join(root, 'apps/api/src/web-zip-validator.mjs')));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gamehub-validator-'));
  try {
    const archive = path.join(directory, 'game.zip');
    const output = path.join(directory, 'output');
    await fs.writeFile(archive, makeZip([
      { name: 'index.html', data: '<!doctype html><script src="assets/game.js"></script>' },
      { name: 'assets/game.js', data: 'globalThis.gameReady=true' },
      { name: 'platform.json', data: JSON.stringify({ version: 1, entry: 'index.html', capabilities: ['fullscreen'] }) },
    ]));
    const report = await validateWebZip(archive, output);
    assert.equal(report.entry, 'index.html');
    assert.deepEqual(report.approvedCapabilities, ['fullscreen']);
    assert.equal(report.fileCount, 3);
    assert.equal(await fs.readFile(path.join(output, 'assets/game.js'), 'utf8'), 'globalThis.gameReady=true');

    const unsafeArchive = path.join(directory, 'unsafe.zip');
    await fs.writeFile(unsafeArchive, makeZip([{ name: 'index.html', data: 'ok' }, { name: '../escape.js', data: 'bad' }]));
    await assert.rejects(validateWebZip(unsafeArchive, path.join(directory, 'unsafe-output')));
    await assert.rejects(fs.stat(path.join(directory, 'escape.js')), error => error.code === 'ENOENT');
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
