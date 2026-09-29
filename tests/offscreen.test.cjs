const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { validateCommand, INPUT_CHANNEL, REPORT_CHANNEL } = require('../poc/offscreen/protocol.cjs');
const { createOffscreenSession } = require('../poc/offscreen/session.cjs');
const { createLineReader, createRuntimeReader, createOutputWriter } = require('../poc/offscreen/transport.cjs');
const { createGame } = require('../poc/offscreen/model.js');
const { createControlPipe } = require('../poc/offscreen/control-pipe.cjs');
const net = require('node:net');
const { once } = require('node:events');

function setup(options = {}) {
  let win;
  const ipcMain = new EventEmitter(), messages = [], stops = [], calls = [];
  class FakeWindow extends EventEmitter {
    constructor(settings) {
      super(); win = this; this.settings = settings; this.destroyed = false;
      const wc = this.webContents = new EventEmitter();
      wc.mainFrame = {};
      wc.session = new EventEmitter();
      wc.session.webRequest = { onBeforeRequest: fn => { this.requestPolicy = fn; } };
      wc.session.setPermissionRequestHandler = fn => { this.permissionRequest = fn; };
      wc.session.setPermissionCheckHandler = fn => { this.permissionCheck = fn; };
      wc.setWindowOpenHandler = fn => { this.windowOpen = fn; };
      wc.setAudioMuted = value => { this.muted = value; };
      wc.setFrameRate = value => { this.frameRate = value; };
      wc.send = (...args) => calls.push(args);
    }
    isDestroyed() { return this.destroyed; }
    isVisible() { return options.visible || false; }
    isFocused() { return options.focused || false; }
    destroy() { this.destroyed = true; this.emit('closed'); }
    async loadFile(file) { if (options.failLoad) throw new Error('missing'); this.loaded = file; }
    // If a refactor introduces desktop focus or show, these tests must fail.
    focus() { throw new Error('Desktop focus forbidden'); }
    show() { throw new Error('Visible window forbidden'); }
  }
  const session = createOffscreenSession({ BrowserWindow: FakeWindow, ipcMain,
    entry: 'owned-fixture.html', preload: 'owned-preload.cjs', partition: 'isolated-test',
    emit: message => messages.push(message), onStop: reason => stops.push(reason),
    allowedFiles: options.allowedFiles,
  });
  const report = message => ipcMain.emit(REPORT_CHANNEL,
    { sender: win.webContents, senderFrame: win.webContents.mainFrame }, message);
  return { session, win, ipcMain, messages, stops, calls, report };
}

test('offscreen input changes the sample model and acknowledges only the intended renderer', () => {
  const f = setup(), game = createGame();
  assert.throws(() => f.session.accept({ type: 'click', seq: 1, x: 320, y: 180 }), /not ready/);
  f.ipcMain.emit(REPORT_CHANNEL, { sender: {}, senderFrame: {} }, { type: 'ready' });
  assert.equal(f.session.getState(), 'loading');
  f.ipcMain.emit(REPORT_CHANNEL, { sender: f.win.webContents, senderFrame: {} }, { type: 'ready' });
  assert.equal(f.session.getState(), 'loading', 'Subframes cannot impersonate the game');
  f.report({ type: 'ready' });
  f.session.accept({ type: 'click', seq: 1, x: 320, y: 180 });
  assert.equal(f.calls[0][0], INPUT_CHANNEL);
  const state = game.apply(f.calls[0][1]);
  assert.equal(state.score, 1);
  f.report({ type: 'applied', seq: 99, state });
  assert.equal(f.messages.filter(m => m.type === 'applied').length, 0);
  f.report({ type: 'applied', seq: 1, state });
  assert.deepEqual(f.messages.at(-1), { type: 'applied', seq: 1, state });
  f.report({ type: 'applied', seq: 1, state });
  assert.equal(f.messages.filter(m => m.type === 'applied').length, 1);
  assert.throws(() => f.session.accept({ type: 'click', seq: 1, x: 320, y: 180 }), /must increase/);
  f.session.stop();
  assert.throws(() => f.session.accept({ type: 'reset', seq: 2 }), /stopped/);
});

test('offscreen rejects commands that could escape the game API or corrupt input state', () => {
  for (const command of [
    { type: 'exec', seq: 1, value: 'cmd.exe' }, { type: 'focus', seq: 1 },
    { type: 'key', seq: 1, key: 'Alt+Tab', down: true },
    { type: 'key', seq: 1, key: 'ArrowLeft', down: 1 },
    { type: 'click', seq: 1, x: NaN, y: 10 }, { type: 'click', seq: 1, x: 640, y: 10 },
    { type: 'click', seq: 1, x: 5, y: -1 }, { type: 'reset', seq: 0 },
    { type: 'reset', seq: 1, path: 'outside.exe' }, { type: 'ping', seq: 1 },
    { type: 'text', seq: 1, value: 'a'.repeat(41) }, { type: 'text', seq: 1, value: '\n' },
  ]) assert.throws(() => validateCommand(command));
  assert.deepEqual(validateCommand({ type: 'text', seq: 7, value: '桌猫 🐱' }),
    { type: 'text', seq: 7, value: '桌猫 🐱' });
});

test('offscreen release clears held controls and text edits use game logic without OS input', () => {
  const game = createGame();
  game.apply(validateCommand({ type: 'key', seq: 1, key: 'ArrowRight', down: true }));
  assert.equal(game.step().x, 163);
  game.apply(validateCommand({ type: 'release', seq: 2 }));
  assert.equal(game.step().x, 163, 'Blur/release must stop movement');
  game.apply(validateCommand({ type: 'text', seq: 3, value: '中文 🐱' }));
  assert.equal(game.snapshot().label, '中文 🐱');
  game.apply(validateCommand({ type: 'reset', seq: 4 }));
  assert.deepEqual(game.step(), { score: 0, x: 160, y: 180, label: 'GameHub' });
});

test('offscreen rejects new windows, navigation and permission requests', () => {
  const f = setup();
  assert.equal(f.win.settings.show, false);
  assert.equal(f.win.settings.focusable, false);
  assert.equal(f.win.settings.webPreferences.offscreen, true);
  assert.equal(f.win.settings.webPreferences.backgroundThrottling, false);
  assert.equal(f.win.settings.webPreferences.sandbox, true);
  assert.equal(f.win.muted, true);
  assert.deepEqual(f.win.windowOpen({ url: 'https://example.com' }), { action: 'deny' });
  for (const name of ['will-navigate', 'will-frame-navigate', 'will-redirect', 'will-attach-webview']) {
    let prevented = false;
    f.win.webContents.emit(name, { preventDefault() { prevented = true; } });
    assert.equal(prevented, true, name);
  }
  let allowed;
  f.win.permissionRequest(f.win.webContents, 'fullscreen', value => { allowed = value; });
  assert.equal(allowed, false);
  assert.equal(f.win.permissionCheck(), false);
  f.session.stop();
});

test('offscreen visibility/focus violation or renderer crash destroys the session once', () => {
  for (const event of ['show', 'focus', 'render-process-gone', 'unresponsive']) {
    const f = setup();
    (event === 'show' || event === 'focus' ? f.win : f.win.webContents).emit(event);
    f.session.stop();
    assert.equal(f.win.destroyed, true);
    assert.equal(f.session.getState(), 'stopped');
    assert.equal(f.stops.length, 1);
    assert.equal(f.ipcMain.listenerCount(REPORT_CHANNEL), 0);
    assert.notEqual(f.stops[0], 'window-closed', 'Preserve the original failure during destroy');
  }
});

test('offscreen load failure cleans up, and a stopped session never starts loading', async () => {
  const f = setup({ failLoad: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.stops, ['fixture-load-failed']);
  const stopped = setup(); stopped.session.stop();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stopped.win.loaded, undefined);
});

test('offscreen frames come from paint, never from polling the same image as new', () => {
  const f = setup();
  const paint = () => f.win.webContents.emit('paint', {}, {}, {
    toJPEG: () => Buffer.from('fixture-image'), getSize: () => ({ width: 640, height: 360 }),
  });
  paint(); paint();
  assert.deepEqual(f.messages.map(m => m.id), [1, 2]);
  f.session.stop(); paint();
  assert.equal(f.messages.filter(m => m.type === 'frame').length, 2);
  const visible = setup({ visible: true });
  visible.win.webContents.emit('paint', {}, {}, {});
  assert.deepEqual(visible.stops, ['window-contract-violated']);
});

test('offscreen pending input is bounded if the game stops acknowledging', () => {
  const f = setup(); f.report({ type: 'ready' });
  for (let seq = 1; seq <= 64; seq++) f.session.accept({ type: 'release', seq });
  assert.throws(() => f.session.accept({ type: 'release', seq: 65 }), /unacknowledged/);
  f.report({ type: 'applied', seq: 1, state: { score: 0, x: 0, y: 0, label: 'ok' } });
  f.session.accept({ type: 'release', seq: 65 });
  f.session.stop();
});

test('author SDK acknowledgements need no game-specific score and cannot acknowledge stale commands', () => {
  const f = setup(); f.report({ type: 'ready' });
  f.session.accept({ type: 'release', seq: 1 });
  f.report({ type: 'applied', seq: 2 });
  assert.equal(f.messages.filter(item => item.type === 'applied').length, 0);
  f.report({ type: 'applied', seq: 1 });
  assert.deepEqual(f.messages.at(-1), { type: 'applied', seq: 1 });
  f.report({ type: 'applied', seq: 1 });
  assert.equal(f.messages.filter(item => item.type === 'applied').length, 1);
  f.session.stop();
});

test('package request filtering is attached to the isolated session and removed on stop', () => {
  const f = setup({ allowedFiles: [path.resolve('owned-fixture.html')] });
  let result;
  f.win.requestPolicy({ url: 'http://127.0.0.1:3083/', method: 'GET' }, value => { result = value; });
  assert.equal(result.cancel, true);
  f.session.stop(); assert.equal(f.win.requestPolicy, null);
});

test('offscreen piped commands preserve split UTF-8 and stop on oversized or malformed lines', () => {
  const commands = []; let failures = 0;
  const reader = createLineReader(c => commands.push(c), () => failures++);
  const bytes = Buffer.from(JSON.stringify({ type: 'text', seq: 1, value: '桌猫🐱' }) + '\n');
  for (const byte of bytes) reader.push(Buffer.from([byte]));
  assert.equal(commands[0].value, '桌猫🐱');
  reader.push(Buffer.from('x'.repeat(2049)));
  reader.push(Buffer.from('{"type":"ping"}\n'));
  assert.equal(failures, 1); assert.equal(commands.length, 1);
  const malformed = createLineReader(() => assert.fail(), () => failures++);
  malformed.push(Buffer.from('{not json}\n'));
  assert.equal(failures, 2);
});

test('offscreen slow consumers receive the latest image, with bounded control queue', () => {
  const stream = new EventEmitter(), received = []; let writable = false, failures = 0;
  stream.write = line => { received.push(JSON.parse(line)); return writable; };
  const writer = createOutputWriter(stream, () => failures++);
  writer.send({ type: 'frame', id: 1 });
  for (let id = 2; id <= 1000; id++) writer.send({ type: 'frame', id });
  writer.send({ type: 'ready' });
  writable = true; stream.emit('drain');
  assert.deepEqual(received, [{ type: 'frame', id: 1 }, { type: 'ready' }, { type: 'frame', id: 1000 }]);
  writable = false; writer.send({ type: 'pong' });
  for (let i = 0; i < 65; i++) writer.send({ type: 'pong' });
  assert.equal(failures, 1);
});

test('Electron startup blank lines are ignored but malformed runtime messages fail closed', () => {
  const packets = [], failures = [];
  const reader = createRuntimeReader(packet => packets.push(packet), error => failures.push(error));
  reader.push(Buffer.from('\r\n\n  \r\n{"type":"run'));
  reader.push(Buffer.from('time","electron":"44.4.5"}\r\n{"type":"ready"}\n'));
  assert.deepEqual(packets.map(p => p.type), ['runtime', 'ready']);
  assert.equal(failures.length, 0);
  reader.push(Buffer.from('bad message\n{"type":"ready"}\n'));
  assert.equal(failures.length, 1);
  assert.equal(packets.length, 2);
  const oversized = createRuntimeReader(() => assert.fail(), error => failures.push(error));
  oversized.push(Buffer.from('x'.repeat(3 * 1024 * 1024 + 1)));
  assert.equal(failures.length, 2);
});

test('offscreen entry refuses to start without explicit experiment opt-in before loading Electron', () => {
  const env = { ...process.env }; delete env.GAMEHUB_OFFSCREEN_EXPERIMENT;
  const result = spawnSync(process.execPath, [path.resolve('poc/offscreen/main.cjs')], { env, encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /requires explicit opt-in/);
  assert.doesNotMatch(result.stderr, /Cannot find module/);
});

test('Windows control pipe rejects the wrong token and accepts split authenticated messages',
  { skip: process.platform !== 'win32', timeout: 5000 }, async t => {
    const pipe = await createControlPipe(); t.after(() => pipe.close());
    assert.match(pipe.name, /^\\\\\.\\pipe\\gamehub-offscreen-[a-f0-9-]{36}$/);
    const wrong = net.connect(pipe.name); await once(wrong, 'connect');
    const rejected = once(wrong, 'close');
    wrong.write(JSON.stringify({ type: 'hello', token: '0'.repeat(64) }) + '\n');
    await rejected;
    const socket = net.connect(pipe.name); t.after(() => socket.destroy());
    await once(socket, 'connect');
    const ready = once(pipe.events, 'packet');
    const hello = JSON.stringify({ type: 'hello', token: pipe.token }) + '\n';
    socket.write(hello.slice(0, 18)); socket.write(hello.slice(18) + '{"type":"ready"}\n');
    assert.deepEqual((await ready)[0], { type: 'ready' });
    const command = once(socket, 'data');
    pipe.send({ type: 'reset', seq: 1 });
    assert.deepEqual(JSON.parse((await command)[0]), { type: 'reset', seq: 1 });
  });

test('Windows control pipe reports peer disconnect and close removes the endpoint',
  { skip: process.platform !== 'win32', timeout: 5000 }, async t => {
    const pipe = await createControlPipe(); t.after(() => pipe.close());
    const socket = net.connect(pipe.name); t.after(() => socket.destroy());
    await once(socket, 'connect');
    const connected = once(pipe.events, 'connected');
    socket.write(JSON.stringify({ type: 'hello', token: pipe.token }) + '\n');
    await connected;
    const disconnected = once(pipe.events, 'disconnected');
    socket.destroy(); await disconnected;
    await pipe.close();
    const unavailable = net.connect(pipe.name);
    await once(unavailable, 'error');
    unavailable.destroy();
  });
