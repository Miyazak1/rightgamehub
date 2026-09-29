'use strict';
const vscode = require('vscode');
const { createHash, randomBytes, randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');

const TOKEN_KEY = 'gamehub.session.v1';
const allowedUrl = (value, label) => {
  const url = new URL(String(value));
  const loopback = ['127.0.0.1', 'localhost'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password) throw new Error(`${label}必须使用 HTTPS，或本机 loopback HTTP，且不能包含凭据。`);
  return url;
};
const runtimeDomain = value => {
  const domain = String(value || '').trim().toLowerCase();
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) throw new Error('GameHub 运行域名无效。');
  return domain;
};
const themeMode = () => {
  const kind = vscode.window.activeColorTheme.kind;
  if (kind === vscode.ColorThemeKind.Light) return 'light';
  if (kind === vscode.ColorThemeKind.HighContrast || kind === vscode.ColorThemeKind.HighContrastLight) return 'high-contrast';
  return 'dark';
};
const hostId = () => /cursor/i.test(vscode.env.appName) ? 'cursor' : 'vscode';
const validTokens = value => value && typeof value === 'object' && typeof value.accessToken === 'string' && value.accessToken.length >= 32 && typeof value.refreshToken === 'string' && value.refreshToken.length >= 32;
const trustedExternalUrl = value => {
  const url = new URL(String(value));
  if (url.protocol !== 'https:' || !['github.com', 'www.github.com'].includes(url.hostname)) throw new Error('只允许打开 GitHub HTTPS 授权页面。');
  return url;
};
const RELEASE_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const WORK_ID = /^(?:gamehub-[a-z0-9-]{1,100}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
const SHA256 = /^[a-f0-9]{64}$/;
const desktopRelease = value => {
  if (!value || !WORK_ID.test(String(value.workId || '').toLowerCase()) || !RELEASE_ID.test(String(value.releaseId || '').toLowerCase()) ||
      !SHA256.test(String(value.sha256 || '').toLowerCase()) || !Number.isSafeInteger(value.sizeBytes) ||
      value.sizeBytes < 64 || value.sizeBytes > 500 * 1024 ** 2 || typeof value.fileName !== 'string' ||
      !/^[^\\/:*?"<>|\x00-\x1f]{1,180}\.exe$/i.test(value.fileName)) throw new Error('Windows 版本信息无效。');
  return {
    workId: String(value.workId).toLowerCase(), releaseId: String(value.releaseId).toLowerCase(),
    fileName: value.fileName, sizeBytes: value.sizeBytes, sha256: String(value.sha256).toLowerCase(),
    record: { id: String(value.releaseId).toLowerCase(), name: value.fileName, size: value.sizeBytes, sha256: String(value.sha256).toLowerCase(), kind: 'exe' },
  };
};


const UPDATE_MANIFEST_URL = 'https://mooyu.fun/downloads/manifest.json';
const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const UPDATE_RETRY_MS = 30 * 60 * 1000;
const MAX_UPDATE_BYTES = 64 * 1024 * 1024;
const versionParts = value => String(value).split('.').map(part => Number.parseInt(part, 10) || 0);
const compareVersions = (left, right) => {
  const a = versionParts(left); const b = versionParts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const delta = (a[index] || 0) - (b[index] || 0);
    if (delta) return delta;
  }
  return 0;
};
const trustedUpdateUrl = value => {
  const url = new URL(String(value));
  if (url.protocol !== 'https:' || url.hostname !== 'mooyu.fun' || url.username || url.password) throw new Error('GameHub 更新地址不受信任。');
  return url;
};
const downloadUpdateBytes = async value => {
  const url = trustedUpdateUrl(value);
  const response = await fetch(url, { cache: 'no-store', redirect: 'error', headers: { accept: 'application/json, application/octet-stream' } });
  if (!response.ok) throw new Error(`GameHub 更新下载失败（${response.status}）。`);
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_UPDATE_BYTES) throw new Error('GameHub 更新包超过大小限制。');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_UPDATE_BYTES) throw new Error('GameHub 更新包超过大小限制。');
  return bytes;
};
async function checkForEditorUpdate(context, output) {
  const config = vscode.workspace.getConfiguration('gamehub');
  if (!config.get('autoUpdate', true)) return;
  const now = Date.now();
  if (Number(context.globalState.get('gamehub.update.nextCheckAt', 0)) > now) return;
  await context.globalState.update('gamehub.update.nextCheckAt', now + UPDATE_INTERVAL_MS);
  try {
    const manifest = JSON.parse((await downloadUpdateBytes(UPDATE_MANIFEST_URL)).toString('utf8'));
    const item = manifest.editorExtension;
    if (manifest.channel !== 'stable' || !item?.supportedHosts?.includes(hostId())) throw new Error('GameHub 稳定版更新清单无效。');
    const currentVersion = String(context.extension?.packageJSON?.version || '0.0.0');
    if (compareVersions(item.version, currentVersion) <= 0) return;
    const bytes = await downloadUpdateBytes(item.url);
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== String(item.sha256).toLowerCase()) throw new Error('GameHub VSIX SHA-256 校验失败。');
    await vscode.workspace.fs.createDirectory(context.globalStorageUri);
    const target = vscode.Uri.joinPath(context.globalStorageUri, item.filename);
    await vscode.workspace.fs.writeFile(target, bytes);
    await vscode.commands.executeCommand('workbench.extensions.installExtension', target);
    await context.globalState.update('gamehub.update.stagedVersion', item.version);
    output.appendLine(`GameHub ${item.version} 已在后台安装，将在 Cursor/VS Code 重启后生效。`);
  } catch (error) {
    await context.globalState.update('gamehub.update.nextCheckAt', Date.now() + UPDATE_RETRY_MS);
    output.appendLine(`GameHub 自动更新检查失败：${String(error.message || error)}`);
  }
}

async function activate(context) {
  let currentView;
  const updateOutput = vscode.window.createOutputChannel('GameHub');
  let desktopLauncher = null;
  try {
    const moduleUri = vscode.Uri.joinPath(context.extensionUri, 'desktop-launcher.mjs');
    const { createDesktopLauncher } = await import(pathToFileURL(moduleUri.fsPath).href);
    desktopLauncher = createDesktopLauncher({ root: vscode.Uri.joinPath(context.globalStorageUri, 'desktop-games').fsPath, enabled: process.platform === 'win32' });
  } catch (error) { updateOutput.appendLine(`GameHub 本机启动组件不可用：${String(error.message || error)}`); }
  const config = () => vscode.workspace.getConfiguration('gamehub');
  const openBrowser = async () => {
    const url = allowedUrl(config().get('browserUrl', 'http://127.0.0.1:3081/'), '浏览器地址');
    const commands = await vscode.commands.getCommands(true);
    for (const command of ['workbench.action.browser.open', 'simpleBrowser.show']) {
      if (!commands.includes(command)) continue;
      try { await vscode.commands.executeCommand(command, url.href); return; } catch {}
    }
    await vscode.env.openExternal(vscode.Uri.parse(url.href));
  };
  const provider = {
    resolveWebviewView(view) {
      currentView = view;
      const apiUrl = allowedUrl(config().get('apiUrl', 'http://127.0.0.1:3090'), 'API 地址');
      const localApi = ['127.0.0.1', 'localhost'].includes(apiUrl.hostname);
      const gameRuntimeDomain = localApi ? 'localhost' : runtimeDomain(config().get('runtimeDomain', 'runtime.mooyu.fun'));
      view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')] };
      const scriptUri = view.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'gamehub.js'));
      const nonce = randomBytes(18).toString('base64');
      const bootstrap = { host: hostId(), hostVersion: vscode.version, remoteName: vscode.env.remoteName || null, apiBaseUrl: apiUrl.origin, runtimeDomain: gameRuntimeDomain, canLaunchDesktop: desktopLauncher?.enabled === true, theme: { mode: themeMode() } };
      view.webview.html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' ${view.webview.cspSource}; style-src 'unsafe-inline'; img-src data: blob: ${apiUrl.origin}; connect-src ${apiUrl.origin}; frame-src http://*.localhost:3092 https://*.${gameRuntimeDomain};"><title>GameHub</title></head><body><div id="root"></div><script nonce="${nonce}">window.__GAMEHUB_EDITOR__=${JSON.stringify(bootstrap).replaceAll('<','\\u003c')};</script><script nonce="${nonce}" src="${scriptUri}"></script></body></html>`;
      const subscription = view.webview.onDidReceiveMessage(async message => {
        if (!message || message.type !== 'gamehub:request' || !Number.isSafeInteger(message.id)) return;
        try {
          let result = null;
          if (message.operation === 'credentials.get') result = await context.secrets.get(TOKEN_KEY).then(value => value ? JSON.parse(value) : null);
          else if (message.operation === 'credentials.set') {
            if (!validTokens(message.payload?.tokens)) throw new Error('拒绝保存无效的 GameHub 凭据。');
            await context.secrets.store(TOKEN_KEY, JSON.stringify(message.payload.tokens));
          } else if (message.operation === 'credentials.clear') await context.secrets.delete(TOKEN_KEY);
          else if (message.operation === 'external.open') result = await vscode.env.openExternal(vscode.Uri.parse(trustedExternalUrl(message.payload?.url).href));
          else if (message.operation === 'desktop.status') {
            if (!desktopLauncher?.enabled) throw new Error('Windows 本机启动能力不可用。');
            const release = desktopRelease(message.payload?.release);
            result = desktopLauncher.status(release.record);
          } else if (message.operation === 'desktop.prepare') {
            if (!desktopLauncher?.enabled) throw new Error('Windows 本机启动能力不可用。');
            const release = desktopRelease(message.payload?.release);
            const downloadUrl = new URL(`/v1/works/${encodeURIComponent(release.workId)}/releases/${encodeURIComponent(release.releaseId)}/download`, apiUrl.origin);
            result = await desktopLauncher.prepare(release.record, () => fetch(downloadUrl, { cache: 'no-store', redirect: 'error' }));
          } else if (message.operation === 'desktop.launch') {
            if (!desktopLauncher?.enabled) throw new Error('Windows 本机启动能力不可用。');
            const release = desktopRelease(message.payload?.release);
            result = await desktopLauncher.launch(release.record, randomUUID());
          } else throw new Error('不支持的宿主操作。');
          await view.webview.postMessage({ type: 'gamehub:response', id: message.id, ok: true, result });
        } catch (error) { await view.webview.postMessage({ type: 'gamehub:response', id: message.id, ok: false, error: String(error.message || error) }); }
      });
      const themeSubscription = vscode.window.onDidChangeActiveColorTheme(() => view.webview.postMessage({ type: 'gamehub:theme', theme: { mode: themeMode() } }));
      view.onDidDispose(() => { subscription.dispose(); themeSubscription.dispose(); if (currentView === view) currentView = undefined; });
    },
  };
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('gamehub.platform', provider, { webviewOptions: { retainContextWhenHidden: true } }));
  context.subscriptions.push(vscode.commands.registerCommand('gamehub.open', async () => {
    try { await vscode.commands.executeCommand('gamehub.platform.focus'); }
    catch (error) { await vscode.window.showErrorMessage(String(error.message || error)); }
  }));
  context.subscriptions.push(vscode.commands.registerCommand('gamehub.openBrowser', () => openBrowser().catch(error => vscode.window.showErrorMessage(String(error.message || error)))));
  const updateTimer = setTimeout(() => void checkForEditorUpdate(context, updateOutput), 15000);
  const updateInterval = setInterval(() => void checkForEditorUpdate(context, updateOutput), UPDATE_INTERVAL_MS);
  context.subscriptions.push(updateOutput, { dispose() { clearTimeout(updateTimer); clearInterval(updateInterval); currentView = undefined; void desktopLauncher?.close(); } });
}

module.exports = { activate };
