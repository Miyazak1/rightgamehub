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
      { name: 'audio/music.flac', data: Buffer.from('fLaCfixture') },
      { name: 'platform.json', data: JSON.stringify({ version: 1, entry: 'index.html', capabilities: ['fullscreen','multiplayer'] }) },
    ]));
    const report = await validateWebZip(archive, output);
    assert.equal(report.entry, 'index.html');
    assert.deepEqual(report.approvedCapabilities, ['fullscreen','multiplayer']);
    assert.equal(report.fileCount, 4);
    assert.equal(report.assets['audio/music.flac'].mime, 'audio/flac');
    assert.equal(await fs.readFile(path.join(output, 'assets/game.js'), 'utf8'), 'globalThis.gameReady=true');

    const unsafeArchive = path.join(directory, 'unsafe.zip');
    await fs.writeFile(unsafeArchive, makeZip([{ name: 'index.html', data: 'ok' }, { name: '../escape.js', data: 'bad' }]));
    await assert.rejects(validateWebZip(unsafeArchive, path.join(directory, 'unsafe-output')));
    await assert.rejects(fs.stat(path.join(directory, 'escape.js')), error => error.code === 'ENOENT');
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('web validator automatically uses the only HTML file as the entry', async () => {
  const { validateWebZip } = await import(pathToFileURL(path.join(root, 'apps/api/src/web-zip-validator.mjs')));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gamehub-single-html-'));
  try {
    const archive = path.join(directory, 'single-html.zip');
    const output = path.join(directory, 'output');
    await fs.writeFile(archive, makeZip([{ name: 'game/桌捕.html', data: '<!doctype html><title>桌捕</title>' }]));
    const report = await validateWebZip(archive, output);
    assert.equal(report.entry, 'game/桌捕.html');
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('web validator still requires an explicit index when several HTML files exist', async () => {
  const { validateWebZip } = await import(pathToFileURL(path.join(root, 'apps/api/src/web-zip-validator.mjs')));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gamehub-multiple-html-'));
  try {
    const archive = path.join(directory, 'multiple-html.zip');
    await fs.writeFile(archive, makeZip([
      { name: 'one.html', data: '<!doctype html><title>One</title>' },
      { name: 'two.html', data: '<!doctype html><title>Two</title>' },
    ]));
    await assert.rejects(validateWebZip(archive, path.join(directory, 'output')), error => error.code === 'ENTRY_MISSING');
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('Bingo fileExport/shareLinks manifest validates while unknown capabilities remain rejected',async()=>{
 const {validateWebZip}=await import('../../apps/api/src/web-zip-validator.mjs');const directory=await fs.mkdtemp(path.join(os.tmpdir(),'gamehub-sharing-validator-'));
 try{for(const capabilities of [['fileExport','shareLinks'],['fileExport','shellExec']]){const key=capabilities[1],archive=path.join(directory,key+'.zip');await fs.writeFile(archive,makeZip([{name:'index.html',data:'<!doctype html><title>Bingo</title>'},{name:'platform.json',data:JSON.stringify({version:1,entry:'index.html',capabilities})}]));if(key==='shareLinks'){assert.deepEqual((await validateWebZip(archive,path.join(directory,key))).approvedCapabilities,capabilities);}else await assert.rejects(validateWebZip(archive,path.join(directory,key)),{code:'CAPABILITY_UNSUPPORTED'});}}
 finally{assert.equal(path.dirname(directory),os.tmpdir());await fs.rm(directory,{recursive:true,force:true});}
});

test('web validator accepts common root documentation and up to eight competition boards', async () => {
  const { validateWebZip } = await import('../../apps/api/src/web-zip-validator.mjs');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gamehub-compatible-docs-'));
  try {
    const boards = [4, 6, 8, 10].map(size => ({
      key: `logic-${size}-fastest`,
      modeKey: `size-${size}`,
      title: `${size}×${size} 最速解题榜`,
      rulesetVersion: 1,
      period: 'all-time',
      verification: 'client_reported',
      metrics: [{ key: 'duration-ms', label: '完成用时', unit: '毫秒', min: 1, max: 86400000 }],
      ranking: [{ metric: 'duration-ms', direction: 'asc' }],
    }));
    const archive = path.join(directory, 'logic-game.zip');
    await fs.writeFile(archive, makeZip([
      { name: 'index.html', data: '<!doctype html><title>Logic game</title>' },
      { name: 'LICENSE', data: 'MIT License' },
      { name: 'README.md', data: '# Logic game' },
      { name: 'platform.json', data: JSON.stringify({ version: 1, entry: 'index.html', capabilities: ['competition'], competition: { version: 1, boards } }) },
    ]));
    const report = await validateWebZip(archive, path.join(directory, 'output'));
    assert.equal(report.assets.LICENSE.mime, 'text/plain; charset=utf-8');
    assert.equal(report.assets['README.md'].mime, 'text/markdown; charset=utf-8');
    assert.equal(report.competition.boards.length, 4);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
