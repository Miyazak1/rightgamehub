const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const adapter = require('../../rules/mizhen/duel-1.0.0.cjs');

const red = '00000000-0000-4000-8000-000000000101';
const black = '00000000-0000-4000-8000-000000000102';
const input = seed => ({ seed,players: [{ userId: red,seat: 0 },{ userId: black,seat: 1 }],settings: { turnSeconds: 75 } });
const canonicalJson = value => Array.isArray(value) ? `[${value.map(canonicalJson).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}` : JSON.stringify(value);

test('迷阵 creates a deterministic server-seeded board and valid state hash', () => {
  const first = adapter.createInitialState(input('server-seed-one'));
  const second = adapter.createInitialState(input('server-seed-one'));
  const different = adapter.createInitialState(input('server-seed-two'));
  assert.deepEqual(first,second);
  assert.notDeepEqual(first.pieces,different.pieces);
  assert.equal(first.pieces.length,32);
  assert.equal(first.turn,'red');
  assert.equal(first.turnSeconds,75);
  assert.equal(adapter.hashState(first),crypto.createHash('sha256').update(canonicalJson(first)).digest('hex'));
});

test('迷阵 player views never expose unknown identities and scouting is private', () => {
  const state = adapter.createInitialState(input('private-scout-seed'));
  const target = state.pieces[0];
  state.intel.red = 2;
  const before = adapter.getPlayerView(state,red);
  assert.deepEqual(Object.keys(before.pieces.find(piece => piece.id === target.id)).sort(),['id','pos','prep','revealed','revealedPly']);
  const output = adapter.applyCommand({ state,actorUserId: red,command: { type: 'scout',pieceId: target.id } });
  assert.equal(output.event.type,'mizhen.piece.scouted');
  assert.equal(output.event.pieceId,target.id);
  assert.equal(output.event.color,undefined);
  assert.equal(output.event.pieceType,undefined);
  const redView = adapter.getPlayerView(output.state,red).pieces.find(piece => piece.id === target.id);
  const blackView = adapter.getPlayerView(output.state,black).pieces.find(piece => piece.id === target.id);
  assert.equal(redView.color,target.color);
  assert.equal(redView.type,target.type);
  assert.equal(blackView.color,undefined);
  assert.equal(blackView.type,undefined);
});

test('迷阵 validates turn ownership and reveals through an authoritative transition', () => {
  const state = adapter.createInitialState(input('reveal-seed'));
  const target = state.pieces[0];
  const rejected = adapter.validateCommand({ state,actorUserId: black,command: { type: 'reveal',pieceId: target.id } });
  assert.equal(rejected.valid,false);
  assert.equal(rejected.code,'NOT_YOUR_TURN');
  const output = adapter.applyCommand({ state,actorUserId: red,command: { type: 'reveal',pieceId: target.id } });
  const revealed = output.state.pieces.find(piece => piece.id === target.id);
  assert.equal(revealed.revealed,true);
  assert.equal(output.state.turn,'black');
  assert.equal(output.event.type,'mizhen.piece.revealed');
  assert.deepEqual(output.event.piece,{ id: target.id,pos: target.pos,color: target.color,type: target.type });
});

test('迷阵 captures the general and emits stable player results', () => {
  const state = adapter.createInitialState(input('capture-seed'));
  state.pieces = [
    { id: 1,pos: 11,color: 'red',type: 'general',revealed: true,prep: 0,revealedPly: 0 },
    { id: 2,pos: 12,color: 'black',type: 'general',revealed: true,prep: 0,revealedPly: 0 },
  ];
  const output = adapter.applyCommand({ state,actorUserId: red,command: { type: 'move',pieceId: 1,to: 12 } });
  assert.equal(output.completed,true);
  assert.equal(output.result.winner,'red');
  assert.equal(output.result.reason,'general_captured');
  assert.deepEqual(output.playerResults,[{ userId: red,result: 'win' },{ userId: black,result: 'loss' }]);
});

test('迷阵 treats three timeouts by one player as a loss', () => {
  let state = adapter.createInitialState(input('timeout-seed'));
  for (let turn = 0; turn < 5; turn++) {
    const userId = state.players[state.turn];
    const output = adapter.handleTimeout({ state,turnUserId: userId });
    state = output.state;
    if (turn < 4) assert.equal(output.completed,false);
    else {
      assert.equal(output.completed,true);
      assert.equal(output.result.reason,'three_timeouts');
      assert.equal(output.result.winner,'black');
      assert.equal(output.terminationReason,'timeout');
    }
  }
});

test('迷阵 production bundle loads through a signed trusted manifest', async t => {
  const { digestRulesBundle,loadRulesRegistry,signRulesManifest } = await import('../../packages/rules-sdk/src/index.mjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'mizhen-rules-'));
  t.after(() => fs.rmSync(directory,{ recursive: true,force: true }));
  const bundleRoot = path.resolve(__dirname,'../../rules/mizhen');
  const source = fs.readFileSync(path.join(bundleRoot,'duel-1.0.0.cjs'));
  const { privateKey,publicKey } = crypto.generateKeyPairSync('ed25519');
  const manifest = signRulesManifest({
    protocol: 'gamehub.rules-manifest.v1',createdAt: '2026-09-30T00:00:00.000Z',keyId: 'mizhen-test',
    entries: [{ workId: adapter.workId,modeKey: adapter.modeKey,rulesetVersion: adapter.rulesetVersion,bundle: 'duel-1.0.0.cjs',sha256: digestRulesBundle(source) }],
  },privateKey);
  const manifestPath = path.join(directory,'manifest.json');
  fs.writeFileSync(manifestPath,JSON.stringify(manifest));
  const trustedKeys = { 'mizhen-test': publicKey.export({ format: 'der',type: 'spki' }).toString('base64') };
  const loaded = loadRulesRegistry({ manifestPath,bundleRoot,trustedKeys }).get(adapter);
  assert.ok(loaded);
  const state = loaded.createInitialState(input('vm-seed'));
  assert.match(loaded.hashState(state),/^[a-f0-9]{64}$/);
});

test('multiplayer mode registration CLI fails closed without an explicit identity', () => {
  const result = spawnSync(process.execPath,[path.resolve(__dirname,'../../apps/api/src/register-multiplayer-mode-cli.mjs')],{
    encoding: 'utf8',env: {},windowsHide: true,
  });
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/MULTIPLAYER_WORK_ID is required/);
});
