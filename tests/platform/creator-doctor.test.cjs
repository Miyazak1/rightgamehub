const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname,'../..');
const template = path.join(root,'templates/multiplayer-turn-based');
async function fixture() { const directory=await fs.mkdtemp(path.join(os.tmpdir(),'gamehub-doctor-')); await fs.cp(template,directory,{recursive:true}); return directory; }

test('Creator Doctor accepts the official multiplayer starter', async t => {
  const { inspectMultiplayerProject } = await import(pathToFileURL(path.join(root,'packages/creator-tools/src/index.mjs')));
  const directory=await fixture(); t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const report=await inspectMultiplayerProject(directory);
  assert.equal(report.ok,true,JSON.stringify(report.findings,null,2));
  assert.equal(report.summary.errors,0);
  assert.ok(report.findings.some(item=>item.code==='PRIVATE_VIEW_SCOPED'));
  assert.ok(report.findings.some(item=>item.code==='OUT_OF_TURN_REJECTED'));
});

test('Creator Doctor rejects missing capability, identity mismatch and private leaks', async t => {
  const { inspectMultiplayerProject } = await import(pathToFileURL(path.join(root,'packages/creator-tools/src/index.mjs')));
  const missing=await fixture(),mismatch=await fixture(),leak=await fixture();
  t.after(()=>Promise.all([missing,mismatch,leak].map(directory=>fs.rm(directory,{recursive:true,force:true}))));
  await fs.writeFile(path.join(missing,'platform.json'),JSON.stringify({version:1,entry:'index.html',capabilities:[]}));
  const mismatchedSource=(await fs.readFile(path.join(mismatch,'rules/adapter.cjs'),'utf8')).replace("workId:'sample-work'","workId:'different-work'");
  await fs.writeFile(path.join(mismatch,'rules/adapter.cjs'),mismatchedSource);
  const leakedSource=(await fs.readFile(path.join(leak,'rules/adapter.cjs'),'utf8'))
    .replace("getSpectatorView(state) { return { round:state.round,turnUserId:state.turnUserId,scores:clone(state.scores) }; }","getSpectatorView(state) { return { secrets:clone(state.secrets) }; }")
    .replaceAll('event:{actorSeat:','event:{secret:command.value,actorSeat:');
  await fs.writeFile(path.join(leak,'rules/adapter.cjs'),leakedSource);
  assert.ok((await inspectMultiplayerProject(missing)).findings.some(item=>item.code==='MULTIPLAYER_CAPABILITY_MISSING'));
  assert.ok((await inspectMultiplayerProject(mismatch)).findings.some(item=>item.code==='RULES_IDENTITY_MISMATCH'));
  const leakReport=await inspectMultiplayerProject(leak);
  assert.ok(leakReport.findings.some(item=>item.code==='PRIVATE_VIEW_LEAK'));
  assert.ok(leakReport.findings.some(item=>item.code==='PUBLIC_EVENT_LEAK'));
});

test('developer center exposes the real protocol, template downloads and safe release boundary', async () => {
  const source=await fs.readFile(path.join(root,'packages/platform-client/src/MultiplayerDeveloperCenter.jsx'),'utf8');
  const webDockerfile=await fs.readFile(path.join(root,'deploy/Dockerfile.web'),'utf8');
  assert.match(source,/WEB_GAME_BRIDGE_PROTOCOL/);
  assert.match(source,/gamehub-multiplayer-starter-source\.zip/);
  assert.match(source,/私钥绝不交给作者/);
  assert.match(source,/现有单机作品无需添加 multiplayer capability/);
  assert.match(webDockerfile,/COPY packages\/rules-sdk\/package\.json packages\/rules-sdk\/package\.json/);
  assert.match(webDockerfile,/COPY packages\/rules-sdk packages\/rules-sdk/);
  assert.match(webDockerfile,/COPY templates\/multiplayer-turn-based templates\/multiplayer-turn-based/);
  assert.match(webDockerfile,/COPY scripts\/build-multiplayer-templates\.mjs scripts\/build-multiplayer-templates\.mjs/);
  assert.match(webDockerfile,/COPY scripts\/zip-fixture\.cjs scripts\/zip-fixture\.cjs/);
});

test('downloaded multiplayer starters include the complete SDK graph and executable bundled JavaScript',async()=>{
  const {execFileSync}=require('node:child_process');
  const {inflateRawSync}=require('node:zlib');
  const vm=require('node:vm');
  execFileSync(process.execPath,['scripts/build-multiplayer-templates.mjs'],{cwd:root,stdio:'pipe'});
  // Read only the deterministic, self-owned archive emitted by the fixture writer.
  const readEntries=buffer=>{
    const entries=new Map();let offset=0;
    while(buffer.readUInt32LE(offset)===0x04034b50) {
      const method=buffer.readUInt16LE(offset+8),size=buffer.readUInt32LE(offset+18),nameLength=buffer.readUInt16LE(offset+26),extraLength=buffer.readUInt16LE(offset+28);
      const name=buffer.subarray(offset+30,offset+30+nameLength).toString('utf8'),start=offset+30+nameLength+extraLength;
      const packed=buffer.subarray(start,start+size);entries.set(name,(method===8?inflateRawSync(packed):packed).toString('utf8'));offset=start+size;
    }
    return entries;
  };
  const web=readEntries(await fs.readFile(path.join(root,'artifacts/gamehub-multiplayer-starter-web.zip')));
  new vm.Script('(async()=>{\n'+web.get('game.js')+'\n})()');
  assert.doesNotMatch(web.get('game.js'),/^\s*import\s/gmu);
  assert.match(web.get('game.js'),/createCloudSaveClient/);
  const source=readEntries(await fs.readFile(path.join(root,'artifacts/gamehub-multiplayer-starter-source.zip')));
  for(const [name,text]of source) {
    if(!/\.(?:m?js)$/u.test(name))continue;
    for(const match of text.matchAll(/(?:from|import)\s*['"](\.[^'"]+)['"]/gu)) {
      const referenced=path.posix.normalize(path.posix.join(path.posix.dirname(name),match[1]));
      assert.ok(source.has(referenced),'Missing vendored module '+referenced);
    }
  }
  assert.ok(source.has('vendor/cloud-save.mjs'));
  assert.ok(source.has('vendor/cloud-save-protocol.mjs'));
  assert.ok(source.has('vendor/transfer.mjs'));
});
