const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { app, BrowserWindow, session, protocol, ipcMain, screen, dialog, shell: systemShell } = require('electron');
const policy = require('./policy.cjs');
const { accountOrigin, prepareDesktopAccountProfileSync } = require('../src/account-configuration.mjs');
const { restoredWindowState, createWindowStateStore, titleBarPalette, validateAction, windowShortcut } = require('./window-state.cjs');
protocol.registerSchemesAsPrivileged(['mooyu-app'].map(scheme => ({ scheme,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } })));

async function createShell(config) {
  if (!path.isAbsolute(config.assetRoot ?? '') || !path.isAbsolute(config.profileRoot ?? '')) throw Error('DESKTOP_CONFIG_INVALID');
  const accountEnvironment = config.accountEnvironment ?? 'local-test';
  const accountApiOrigin = accountOrigin(config.accountApiOrigin, accountEnvironment);
  prepareDesktopAccountProfileSync(config.profileRoot, accountApiOrigin, accountEnvironment);
  fsSync.accessSync(path.join(config.assetRoot, 'index.html'));
  const assetRoot = fsSync.realpathSync(config.assetRoot);
  fsSync.mkdirSync(config.profileRoot, { recursive: true });
  fsSync.mkdirSync(path.join(config.profileRoot, 'session-data'), { recursive: true });
  app.setName('墨鱼工坊开发预览');
  app.setPath('userData', config.profileRoot);
  app.setPath('sessionData', path.join(config.profileRoot, 'session-data'));
  app.commandLine.appendSwitch('disk-cache-dir', path.join(config.profileRoot, 'cache'));
  const trace = event => fsSync.appendFileSync(path.join(config.profileRoot, 'startup.ndjson'), JSON.stringify({ event }) + '\n');
  trace('profile-prepared');
  if (!app.requestSingleInstanceLock()) { trace('existing-instance'); app.exit(0); return null; }
  trace('instance-acquired');
  await app.whenReady();
  trace('app-ready');
  const ses = session.fromPartition('persist:mooyu-desktop-preview');
  let fixtureOrigin;
  const fixture = http.createServer(async (req, res) => {
    try {
      const response = await policy.assetResponse({ url: fixtureOrigin + req.url, method: req.method }, path.resolve(__dirname, '../fixtures/game'), fixtureOrigin, false);
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
    } catch { res.writeHead(500); res.end(); }
  });
  await new Promise((resolve, reject) => { fixture.once('error', reject); fixture.listen(0, '127.0.0.1', resolve); });
  fixtureOrigin = 'http://127.0.0.1:' + fixture.address().port;
  trace('fixture-ready');
  app.once('before-quit', () => { fixture.close(); fixture.closeAllConnections?.(); });
  const blocked = [];
  ses.webRequest.onBeforeRequest((details, done) => {
    const allowed = policy.allowedRequest(details, fixtureOrigin);
    if (!allowed && blocked.length < 100) blocked.push({ scheme: String(details.url).split(':')[0], resourceType: details.resourceType });
    done({ cancel: !allowed });
  });
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on('will-download', event => event.preventDefault());
  ses.protocol.handle('mooyu-app', async request => {
    try { return await policy.assetResponse(request, assetRoot, policy.UI, true, fixtureOrigin); }
    catch (error) { process.stderr.write('DESKTOP_PROTOCOL_FAILED ' + error.name + ': ' + error.message + '\n'); return new Response('Protocol failed', { status: 500 }); }
  });
  let window;
  let currentTheme = 'dark';
  const stateStore = createWindowStateStore(config.profileRoot);
  const state = () => ({ canGoBack: Boolean(window?.webContents.navigationHistory.canGoBack()),
    canGoForward: Boolean(window?.webContents.navigationHistory.canGoForward()),
    maximized: window?.isMaximized() ?? false, fullScreen: window?.isFullScreen() ?? false,
    closeBehavior: 'quit-preview', backgroundTasksSupported: false, theme: currentTheme });
  const publish = () => { setImmediate(() => { if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('mooyu:chrome-state', state()); }); };
  let accountSession = null;
  if (accountApiOrigin) {
    const { createDesktopAccountSession } = await import('../src/account-session.mjs');
    const { createWindowsDpapiCredentialVault } = await import('../../capability-executor/src/credential-vault.mjs');
    accountSession = await createDesktopAccountSession({ apiOrigin: accountApiOrigin, environment: accountEnvironment,
      openExternal: url => systemShell.openExternal(url, {activate:true}),
      vault: createWindowsDpapiCredentialVault({ directory: path.join(config.profileRoot, 'account-vault') }),
      onChanged: value => { if (window && !window.isDestroyed()) window.webContents.send('mooyu:account-state', value); } });
  }
  const perform = action => {
    validateAction(action);
    if (action === 'back' && window.webContents.navigationHistory.canGoBack()) window.webContents.navigationHistory.goBack();
    if (action === 'forward' && window.webContents.navigationHistory.canGoForward()) window.webContents.navigationHistory.goForward();
    if (action === 'reload') window.webContents.reload();
    if (action === 'toggle-fullscreen') window.setFullScreen(!window.isFullScreen());
    if (action === 'quit') app.quit();
  };
  app.on('window-all-closed', () => app.quit());
  app.on('second-instance', () => { if (window && !window.isDestroyed()) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  const createWindow = async (route = '/discover') => {
    if (typeof route !== 'string' || !route.startsWith('/') || route.startsWith('//') || route.length > 1000) throw Error('DESKTOP_ROUTE_INVALID');
    const restore = restoredWindowState(stateStore.read(), screen.getAllDisplays().map(display => display.workArea));
    window = new BrowserWindow({ ...restore.bounds, minWidth: restore.minWidth, minHeight: restore.minHeight,
      title: '墨鱼工坊 · 本地开发预览', backgroundColor: '#0c0b11', show: config.visible !== false,
      titleBarStyle: 'hidden', titleBarOverlay: titleBarPalette('dark'),
      webPreferences: { session: ses, preload: path.join(__dirname, 'preload.cjs'), sandbox: true,
        contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: false, webviewTag: false,
        webSecurity: true, allowRunningInsecureContent: false, spellcheck: false } });
    trace(config.visible === false ? 'hidden-window-created' : 'visible-window-created');
    if (restore.maximized) window.maximize();
    const saveWindow = () => { if (!window.isDestroyed()) stateStore.write({ schemaVersion: 1, bounds: window.getNormalBounds(), maximized: window.isMaximized() }); };
    let saveTimer;
    for (const event of ['resize', 'move']) window.on(event, () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveWindow, 200); });
    window.on('close', () => { clearTimeout(saveTimer); saveWindow(); });
    window.on('closed', () => clearTimeout(saveTimer));
    for (const event of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'focus', 'blur']) window.on(event, publish);
    for (const event of ['did-navigate', 'did-navigate-in-page', 'did-finish-load']) window.webContents.on(event, publish);
    window.webContents.on('before-input-event', (event, input) => {
      const action = windowShortcut(input);
      if (action) { event.preventDefault(); perform(action); }
      else if (input.type === 'keyDown' && input.key === 'Escape' && window.isFullScreen()) { event.preventDefault(); window.setFullScreen(false); }
    });
    window.webContents.on('will-prevent-unload', event => {
      const choice = dialog.showMessageBoxSync(window, { type: 'question', buttons: ['继续编辑', '退出'], defaultId: 0, cancelId: 0,
        message: '页面有尚未完成的操作，仍要退出吗？', detail: '退出可能丢失尚未保存的内容。' });
      if (choice === 1) event.preventDefault();
    });
    window.setMenuBarVisibility(false);
    window.setMenu(null);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.webContents.on('will-navigate', event => { if (!policy.ui(event.url)) event.preventDefault(); });
    window.webContents.on('will-frame-navigate', event => {
      if (event.isMainFrame ? !policy.ui(event.url) : !policy.matches(event.url, fixtureOrigin)) event.preventDefault();
    });
    await window.loadURL(policy.UI + route);
    trace('window-loaded');
    return window;
  };
  const trusted = event => {
    if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !policy.ui(event.senderFrame.url)) throw Error('DESKTOP_SENDER_DENIED');
  };
  ipcMain.handle('mooyu:preview-environment', event => {
    trusted(event);
    return { host: 'desktop-app', surface: 'desktop-window', mode: 'local-preview', connected: !!accountSession,
      accountConfigured: !!accountSession, accountApiOrigin, accountEnvironment,
      version: '0.2.0-dev', fixtureOrigin };
  });
  ipcMain.handle('mooyu:account-call', async (event, method, args) => {
    trusted(event);
    try {
      if (!accountSession) throw Object.assign(new Error(), { code: 'DESKTOP_ACCOUNT_NOT_CONFIGURED', status: 503 });
      return { ok: true, value: await accountSession.call(method, args) };
    } catch (error) {
      const code = /^[A-Z][A-Z0-9_]{2,100}$/.test(error.code ?? '') ? error.code : 'DESKTOP_ACCOUNT_FAILED';
      return { ok: false, error: { code, status: Number.isInteger(error.status) ? error.status : 503, message: `账号请求未完成（${code}）。` } };
    }
  });
  ipcMain.handle('mooyu:chrome-state-get', event => { trusted(event); return state(); });
  ipcMain.handle('mooyu:chrome-action', (event, action) => { trusted(event); perform(action); return { accepted: true }; });
  ipcMain.handle('mooyu:chrome-theme', (event, mode) => { trusted(event); window.setTitleBarOverlay(titleBarPalette(mode)); currentTheme = mode; publish(); return { applied: mode }; });
  return { createWindow, session: ses, blockedRequests: blocked, windowStateStore: stateStore };
}

async function main() {
  if (process.argv.length !== 4 || process.argv[2] !== '--config' || !path.isAbsolute(process.argv[3])) throw Error('DESKTOP_CONFIG_REQUIRED');
  const config = JSON.parse(fsSync.readFileSync(process.argv[3], 'utf8'));
  const shell = await createShell(config);
  if (!shell) return;
  await shell.createWindow(config.initialRoute ?? '/discover');
}
// Electron's default-app loader need not set require.main to the supplied CJS entry.
if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === __filename.toLowerCase())
  main().catch(() => { process.stderr.write('DESKTOP_SHELL_START_FAILED\n'); app.exit(70); });
module.exports = { createShell };
