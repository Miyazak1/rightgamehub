const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname,'../..');

test('official Bingo creator package passes the Agent-side validator', async () => {
  const { inspectCreatorPackage,loadCreatorPackage } = await import(pathToFileURL(path.join(root,'packages/creator-tools/src/index.mjs')));
  const report = await inspectCreatorPackage(path.join(root,'templates/creator-bingo'));
  assert.equal(report.ok,true,JSON.stringify(report.findings));
  assert.ok(report.findings.some(finding => finding.code === 'CREATOR_PACKAGE_READY'));
  const loaded = await loadCreatorPackage(path.join(root,'templates/creator-bingo'));
  assert.equal(loaded.draft.studio,'bingo');
  assert.equal(loaded.draft.schemaVersion,1);
  assert.equal(loaded.draft.title,loaded.manifest.title);
  assert.deepEqual(loaded.draft.content,loaded.content);
});

test('Agent submission validates locally before creating a private draft', async t => {
  const { submitCreatorPackage } = await import(pathToFileURL(path.join(root,'packages/creator-tools/src/creator-package.mjs')));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'gamehub-creator-submit-'));
  t.after(() => fs.rm(directory,{ recursive:true,force:true }));
  await fs.cp(path.join(root,'templates/creator-bingo'),directory,{ recursive:true });
  const calls = []; let remote = null;
  const apiClient = {
    createCreatorDraft: async (body,options) => {
      calls.push(['create',body,options]);
      remote = { id:'80b81975-811c-470d-ac05-e81342e34a67',revision:'1',...body };
      return { data: remote };
    },
    getCreatorDraft: async id => ({ data: id === remote.id ? remote : null }),
    updateCreatorDraft: async (id,body,revision,options) => {
      calls.push(['update',id,body,revision,options]);
      remote = { ...remote,...body,revision:String(Number(revision)+1) };
      return { data:remote };
    },
  };
  const created = await submitCreatorPackage({ root:directory,apiClient,platformOrigin:'https://mooyu.fun' });
  assert.equal(created.action,'created');
  assert.equal(calls[0][1].studio,'bingo');
  assert.match(calls[0][2].headers['Idempotency-Key'],/^creator-package-create:[a-f0-9]{64}$/u);
  const state = JSON.parse(await fs.readFile(path.join(directory,'.gamehub/draft.json'),'utf8'));
  assert.equal(state.draftId,created.draft.id);
  assert.equal(state.platformOrigin,'https://mooyu.fun');
  assert.doesNotMatch(JSON.stringify(state),/token|secret/iu);

  const unchanged = await submitCreatorPackage({ root:directory,apiClient,platformOrigin:'https://mooyu.fun/' });
  assert.equal(unchanged.action,'unchanged');
  assert.equal(calls.length,1);

  const sourcePath = path.join(directory,'source/bingo.json');
  const source = JSON.parse(await fs.readFile(sourcePath,'utf8'));
  source.subtitle = '由 Agent 更新';
  await fs.writeFile(sourcePath,JSON.stringify(source));
  const updated = await submitCreatorPackage({ root:directory,apiClient,platformOrigin:'https://mooyu.fun' });
  assert.equal(updated.action,'updated');
  assert.equal(updated.draft.revision,'2');
  assert.equal(calls.length,2);
  assert.match(calls[1][4].headers['Idempotency-Key'],/^creator-package-update:[a-f0-9]{64}$/u);

  remote = { ...remote,revision:'3' };
  await assert.rejects(
    submitCreatorPackage({ root:directory,apiClient,platformOrigin:'https://mooyu.fun' }),
    error => error.code === 'CREATOR_DRAFT_CONFLICT',
  );
});

test('creator package rejects traversal and malformed Bingo cells', async t => {
  const { inspectCreatorPackage } = await import(pathToFileURL(path.join(root,'packages/creator-tools/src/index.mjs')));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'gamehub-creator-package-'));
  t.after(() => fs.rm(directory,{ recursive:true,force:true }));
  await fs.writeFile(path.join(directory,'creator-manifest.json'),JSON.stringify({ format:'gamehub.creator-package',version:1,studio:'bingo',schemaVersion:1,title:'测试',source:'../secret.json' }));
  const traversal = await inspectCreatorPackage(directory);
  assert.equal(traversal.ok,false);
  assert.ok(traversal.findings.some(finding => finding.code === 'CREATOR_SOURCE_PATH_INVALID'));

  await fs.mkdir(path.join(directory,'source'));
  await fs.writeFile(path.join(directory,'creator-manifest.json'),JSON.stringify({ format:'gamehub.creator-package',version:1,studio:'bingo',schemaVersion:1,title:'测试',source:'source/bingo.json' }));
  await fs.writeFile(path.join(directory,'source/bingo.json'),JSON.stringify({ tableTitle:'测试',columnHeaders:['分类','A'],rowHeaders:['年代'],cells:{ '9:1':'越界' } }));
  const malformed = await inspectCreatorPackage(directory);
  assert.equal(malformed.ok,false);
  assert.ok(malformed.findings.some(finding => finding.code === 'BINGO_CELL_INVALID'));
});
