const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { app, BrowserWindow, session, protocol, ipcMain, screen, dialog, shell: systemShell } = require('electron');
const policy = require('./policy.cjs');
const { accountOrigin, prepareDesktopAccountProfileSync } = require('../src/account-configuration.mjs');
const { localBusinessRuntime } = require('../src/runtime-policy.mjs');
const { restoredWindowState, createWindowStateStore, titleBarPalette, validateAction, windowShortcut } = require('./window-state.cjs');
const { attachGameIoNavigation } = require('./game-io-navigation.cjs');
protocol.registerSchemesAsPrivileged(['mooyu-app'].map(scheme => ({ scheme,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } })));

async function createShell(config) {
  if (!path.isAbsolute(config.assetRoot ?? '') || !path.isAbsolute(config.profileRoot ?? '')) throw Error('DESKTOP_CONFIG_INVALID');
  const accountEnvironment = config.accountEnvironment ?? 'local-test';
  const accountApiOrigin = accountOrigin(config.accountApiOrigin, accountEnvironment);
  const businessRuntime = localBusinessRuntime(config.businessRuntime, accountApiOrigin, accountEnvironment);
  if (accountEnvironment === 'production' && !businessRuntime) throw Error('DESKTOP_RUNTIME_NOT_CONFIGURED');
  const runtimeOrigins = new Set();
  prepareDesktopAccountProfileSync(config.profileRoot, accountApiOrigin, accountEnvironment);
  fsSync.accessSync(path.join(config.assetRoot, 'index.html'));
  const assetRoot = fsSync.realpathSync(config.assetRoot);
  fsSync.mkdirSync(config.profileRoot, { recursive: true });
  fsSync.mkdirSync(path.join(config.profileRoot, 'session-data'), { recursive: true });
  app.setName(accountEnvironment === 'production' ? '墨鱼工坊' : '墨鱼工坊开发预览');
  if (process.platform === 'win32') app.setAppUserModelId('fun.mooyu.desktop');
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
      const lesson = req.url.startsWith('/learning/courseware/');
      if (accountEnvironment === 'production' && !lesson) { res.writeHead(404); res.end(); return; }
      const response = await policy.assetResponse({ url: fixtureOrigin + (lesson ? req.url.slice('/learning/courseware'.length) : req.url), method: req.method }, lesson ? path.join(assetRoot, 'learning/courseware') : path.resolve(__dirname, '../fixtures/game'), fixtureOrigin, false, null, null, lesson);
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
    } catch { res.writeHead(500); res.end(); }
  });
  await new Promise((resolve, reject) => { fixture.once('error', reject); fixture.listen(0, '127.0.0.1', resolve); });
  fixtureOrigin = 'http://127.0.0.1:' + fixture.address().port;
  trace('fixture-ready');
  app.once('will-quit', () => { fixture.close(); fixture.closeAllConnections?.(); });
  const blocked = [];
  ses.webRequest.onBeforeRequest((details, done) => {
    const allowed = policy.allowedRequest(details, fixtureOrigin, runtimeOrigins);
    if (!allowed && blocked.length < 100) blocked.push({ scheme: String(details.url).split(':')[0], resourceType: details.resourceType });
    done({ cancel: !allowed });
  });
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on('will-download', event => event.preventDefault());
  ses.protocol.handle('mooyu-app', async request => {
    if (new URL(request.url).pathname === '/__desktop-media') {
      if (!policy.ui(request.url) || !['GET', 'HEAD'].includes(request.method) || !accountSession) return new Response('Denied', { status: 403 });
      try {
        const response = await accountSession.media(new URL(request.url).searchParams.get('path'), {signal:request.signal});
        if (request.method === 'HEAD') { await response.body?.cancel(); return new Response(null, {headers:response.headers}); }
        return response;
      } catch { return new Response('Image unavailable', { status: 404 }); }
    }
    try { return await policy.assetResponse(request, assetRoot, policy.UI, true, fixtureOrigin,
      businessRuntime ? `${businessRuntime.scheme}://*.${businessRuntime.domain}:${businessRuntime.port}` : null); }
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
  let realtimeBridge = null, fileExports = null;
  const retireGameIO = () => { realtimeBridge?.closeAll(); fileExports?.cancelAll(); };
  app.once('will-quit', retireGameIO);
  const { createDesktopUpdater } = await import('../src/update-service.mjs');
  const updates = await createDesktopUpdater({configuration: ['production','local-test'].includes(accountEnvironment) ? config.updateTrust : null,
    localTest: accountEnvironment === 'local-test', app, appRoot: app.getAppPath(), profileRoot: config.profileRoot,
    engineFactory: options => require('../src/update-engine.cjs').createUpdateEngine(options),
    prepareInstall: async (installer,payload) => (await import('../src/update-handoff.mjs')).prepareUpdateHandoff({app,profileRoot:config.profileRoot,installer,payload}),
    fetchImpl: (...args) => session.fromPartition('mooyu-update-downloads', {cache:false}).fetch(...args),
    onState: value => { if (window && !window.isDestroyed()) window.webContents.send('mooyu:update-state', value); },
    isBusy: () => /^\/(play|s|challenge|learn)\//.test(new URL(window?.webContents.getURL() || policy.UI).pathname),
    confirmInstall: async () => accountEnvironment === 'local-test' && typeof config.confirmUpdateInstall === 'function' ? config.confirmUpdateInstall() : (await dialog.showMessageBox(window, {type:'question',buttons:['稍后','重启并更新'],defaultId:0,cancelId:0,message:'现在重启并安装已验证的更新？',detail:'请先保存当前工作。账号会话、本地存档和设置会保留。'})).response === 1 });
  app.once('will-quit', () => updates.dispose());
  // The trusted installed entry is the only source of update configuration.
  // Development previews have no feed and never contact the public server.
  if (config.updateTrust) { const timer = setTimeout(() => updates.run('check').then(value => value.status === 'available' ? updates.run('download') : null).catch(() => {}), 15000); timer.unref(); }
  if (accountApiOrigin) {
    const { createDesktopAccountSession } = await import('../src/account-session.mjs');
    const { createDesktopNetworkTransport } = await import('../src/network-transport.mjs');
    const { createWindowsDpapiCredentialVault } = await import('../../capability-executor/src/credential-vault.mjs');
    const network = session.fromPartition('persist:mooyu-network-' + require('node:crypto').createHash('sha256').update(accountApiOrigin).digest('hex').slice(0,24));
    network.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
    network.setPermissionCheckHandler(()=>false);
    accountSession = await createDesktopAccountSession({ apiOrigin: accountApiOrigin, environment: accountEnvironment,
      fetchImpl: createDesktopNetworkTransport(accountApiOrigin,network.fetch.bind(network)),
      businessRuntime, onRuntimeOrigin: origin => runtimeOrigins.add(origin),
      openExternal: url => systemShell.openExternal(url, {activate:true}),
      vault: createWindowsDpapiCredentialVault({ directory: path.join(config.profileRoot, 'account-vault') }),
      onChanged: value => { retireGameIO(); if (window && !window.isDestroyed()) window.webContents.send('mooyu:account-state', value); } });
    const { createDesktopRealtime } = await import('../src/realtime-bridge.mjs');
    const { createDesktopProxyResolver } = await import('../src/websocket-proxy.mjs');
    const { createDesktopFileExports } = await import('../src/file-exports.mjs');
    const WebSocket = require('ws');
    realtimeBridge = createDesktopRealtime({ account: accountSession, origin: accountApiOrigin, WebSocketImpl: WebSocket,
      getProxyRoute: createDesktopProxyResolver(network.resolveProxy.bind(network)),
      onEvent: value => { if (window && !window.isDestroyed()) window.webContents.send('mooyu:realtime-event', value); } });
    fileExports = createDesktopFileExports({
      context: descriptor => accountSession.gameContext(descriptor.workId, 'fileExport', descriptor),
      verify: async descriptor => {
        await accountSession.call('business', [{ method: 'getLaunch', args: [descriptor.workId, descriptor.releaseId] }]);
        accountSession.gameContext(descriptor.workId, 'fileExport', descriptor);
      },
      choosePath: async file => {
        const result = await dialog.showSaveDialog(window, { title: '保存游戏文件', defaultPath: file.filename,
          filters: [{ name: file.mimeType === 'image/png' ? 'PNG 图片' : 'JSON 数据', extensions: [file.mimeType === 'image/png' ? 'png' : 'json'] }] });
        return result.canceled ? null : result.filePath;
      },
    });
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
      icon: path.join(assetRoot, 'desktop-icons/mooyu-256.png'),
      title: accountEnvironment === 'production' ? '墨鱼工坊' : '墨鱼工坊 · 本地开发预览', backgroundColor: '#0c0b11', show: config.visible !== false,
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
    window.on('closed', retireGameIO);
    attachGameIoNavigation(window.webContents, retireGameIO);
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
      if (choice === 1) event.preventDefault(); else updates.cancelInstall();
    });
    window.setMenuBarVisibility(false);
    window.setMenu(null);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.webContents.on('will-navigate', event => { if (!policy.ui(event.url)) event.preventDefault(); });
    window.webContents.on('will-frame-navigate', event => {
      if (event.isMainFrame ? !policy.ui(event.url) : !policy.matches(event.url, fixtureOrigin) && ![...runtimeOrigins].some(origin => policy.matches(event.url, origin))) event.preventDefault();
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
    return { host: 'desktop-app', surface: 'desktop-window', mode: accountEnvironment === 'production' ? 'production' : 'local-preview', connected: !!accountSession,
      accountConfigured: !!accountSession, accountApiOrigin, accountEnvironment, businessRuntime,
      version: app.isPackaged ? app.getVersion() : '0.2.0-dev', fixtureOrigin };
  });
  ipcMain.handle('mooyu:account-call', async (event, method, args) => {
    trusted(event);
    try {
      if (!accountSession) throw Object.assign(new Error(), { code: 'DESKTOP_ACCOUNT_NOT_CONFIGURED', status: 503 });
      return { ok: true, value: await accountSession.call(method, args) };
    } catch (error) {
      const code = /^[A-Z][A-Z0-9_]{2,100}$/.test(error.code ?? '') ? error.code : 'DESKTOP_ACCOUNT_FAILED';
      const message = code === 'DESKTOP_BUSINESS_ACCOUNT_ONLY' ? '当前测试服务器仅开放账号接口，尚未开放业务内容；不是网络故障。'
        : code === 'DESKTOP_RUNTIME_NOT_CONFIGURED' ? '当前桌面测试会话尚未配置游戏运行服务。'
        : code === 'DESKTOP_RUNTIME_DENIED' ? '游戏运行地址未通过当前测试环境的校验。'
        : `请求未完成（${code}）。`;
      return { ok: false, error: { code, status: Number.isInteger(error.status) ? error.status : 503, message } };
    }
  });
  ipcMain.handle('mooyu:chrome-state-get', event => { trusted(event); return state(); });
  ipcMain.handle('mooyu:update-call', (event, action) => {
    trusted(event);
    if (!['state','check','download','cancel','install'].includes(action)) throw Error('DESKTOP_UPDATE_ACTION_DENIED');
    return action === 'state' ? updates.state() : updates.run(action);
  });
  const gameResult = async task => {
    try { return { ok: true, value: await task() }; }
    catch (error) { const code = /^[A-Z][A-Z0-9_]{2,100}$/.test(error.code ?? '') ? error.code : 'DESKTOP_GAME_IO_FAILED'; return { ok: false, error: { code, message: `操作未完成（${code}）。` } }; }
  };
  ipcMain.handle('mooyu:realtime-call', (event, method, input) => { trusted(event); return gameResult(() => { if (!realtimeBridge) throw Error('unconfigured'); return realtimeBridge.call(method, input); }); });
  ipcMain.handle('mooyu:file-save', (event, input) => { trusted(event); return gameResult(() => { if (!fileExports) throw Error('unconfigured'); return fileExports.save(input); }); });
  ipcMain.handle('mooyu:file-cancel', (event, id) => { trusted(event); if (typeof id === 'string' && /^[a-f0-9-]{36}$/i.test(id)) fileExports?.cancel(id); return { cancelled: true }; });
  ipcMain.handle('mooyu:chrome-action', (event, action) => { trusted(event); perform(action); return { accepted: true }; });
  ipcMain.handle('mooyu:chrome-theme', (event, mode) => { trusted(event); window.setTitleBarOverlay(titleBarPalette(mode)); currentTheme = mode; publish(); return { applied: mode }; });
  return { createWindow, session: ses, blockedRequests: blocked, windowStateStore: stateStore, updates };
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
