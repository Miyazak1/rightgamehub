'use strict';

const { INPUT_CHANNEL, REPORT_CHANNEL, WIDTH, HEIGHT, validateCommand } = require('./protocol.cjs');
const { createResourcePolicy } = require('./resource-policy.cjs');

// Only the bundled fixture or a digest-approved renderer package is permitted.
// Dependency injection lets Node tests exercise cleanup without launching Electron.
function createOffscreenSession({ BrowserWindow, ipcMain, entry, preload, partition, emit, onStop, allowedFiles }) {
  let state = 'loading', lastSeq = 0, frameId = 0;
  const pending = new Set();
  const win = new BrowserWindow({
    width: WIDTH, height: HEIGHT, useContentSize: true,
    show: false, focusable: false, skipTaskbar: true, frame: false,
    fullscreen: false, fullscreenable: false, resizable: false,
    minimizable: false, maximizable: false, backgroundColor: '#101827',
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload, partition, offscreen: true, backgroundThrottling: false,
      focusOnNavigation: false,
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      webviewTag: false, devTools: false, disableDialogs: true,
    },
  });
  const wc = win.webContents;
  function stop(reason = 'requested') {
    if (state === 'stopped') return;
    state = 'stopped';
    pending.clear();
    ipcMain.removeListener(REPORT_CHANNEL, report);
    if (allowedFiles) wc.session.webRequest.onBeforeRequest(null);
    if (!win.isDestroyed()) win.destroy();
    emit({ type: 'stopped', reason });
    onStop(reason);
  }
  const fail = reason => stop(reason);
  const denyNavigation = event => event.preventDefault();
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  for (const event of ['will-navigate', 'will-frame-navigate', 'will-redirect', 'will-attach-webview']) {
    wc.on(event, denyNavigation);
  }
  wc.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  wc.session.setPermissionCheckHandler(() => false);
  wc.session.on('will-download', denyNavigation);
  if (allowedFiles) {
    const allow = createResourcePolicy(allowedFiles);
    wc.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !allow(details) }));
  }
  wc.setAudioMuted(true); // Audio transport is deliberately absent from this probe.
  wc.setFrameRate(30);
  // A guard catches a violation; it cannot retroactively prove that no flash occurred.
  win.on('show', () => fail('unexpected-visible-window'));
  win.on('focus', () => fail('unexpected-window-focus'));
  win.on('closed', () => stop('window-closed'));
  wc.on('render-process-gone', () => fail('renderer-exited'));
  wc.on('unresponsive', () => fail('renderer-unresponsive'));
  wc.on('paint', (_event, _dirty, image) => {
    if (state === 'stopped') return;
    if (win.isVisible() || win.isFocused()) return fail('window-contract-violated');
    try {
      const jpeg = image.toJPEG(70);
      if (jpeg.length > 2 * 1024 * 1024) return fail('frame-too-large');
      emit({ type: 'frame', id: ++frameId, ...image.getSize(),
        windowState: { visible: false, focused: false }, jpeg: jpeg.toString('base64') });
    } catch { fail('frame-encoding-failed'); }
  });
  function report(event, message) {
    if (state === 'stopped' || event.sender !== wc || event.senderFrame !== wc.mainFrame) return;
    if (message?.type === 'ready' && state === 'loading') {
      state = 'ready';
      emit({ type: 'ready', width: WIDTH, height: HEIGHT, input: 'author-api-v1', audio: false });
    } else if (message?.type === 'applied' && state === 'ready' && pending.has(message.seq)) {
      const snapshot = message.state;
      // Package SDK acknowledges delivery without requiring sample-specific state.
      if (snapshot === undefined) {
        pending.delete(message.seq); emit({ type: 'applied', seq: message.seq }); return;
      }
      if (!snapshot || !Number.isSafeInteger(snapshot.score) || snapshot.score < 0 ||
          !Number.isFinite(snapshot.x) || !Number.isFinite(snapshot.y) ||
          snapshot.x < 0 || snapshot.x >= WIDTH || snapshot.y < 0 || snapshot.y >= HEIGHT ||
          typeof snapshot.label !== 'string' || snapshot.label.length > 40) return;
      pending.delete(message.seq);
      emit({ type: 'applied', seq: message.seq,
        state: { score: snapshot.score, x: snapshot.x, y: snapshot.y, label: snapshot.label } });
    }
  }
  ipcMain.on(REPORT_CHANNEL, report);
  Promise.resolve().then(() => {
    if (state !== 'stopped') return win.loadFile(entry);
  }).catch(() => fail('fixture-load-failed'));

  return {
    stop,
    getState: () => state,
    accept(value) {
      const command = validateCommand(value);
      if (state === 'stopped') throw new Error('Session stopped');
      if (command.type === 'stop') return stop();
      if (command.type === 'ping') return emit({ type: 'pong' });
      if (state !== 'ready') throw new Error('Game not ready');
      if (command.seq <= lastSeq) throw new Error('Input sequence must increase');
      if (pending.size >= 64) throw new Error('Too many unacknowledged inputs');
      lastSeq = command.seq;
      pending.add(command.seq);
      // No win.focus(), sendInputEvent(), PostMessage or global input injection.
      try { wc.send(INPUT_CHANNEL, command); }
      catch { fail('input-transport-failed'); }
    },
  };
}

module.exports = { createOffscreenSession };
