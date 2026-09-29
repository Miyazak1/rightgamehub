'use strict';
const vscode = require('vscode');
const { createHash, randomBytes, randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const http = require('node:http');
const https = require('node:https');
const { PassThrough, Readable } = require('node:stream');

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
const UPDATE_INTERVAL_MS = 30 * 60 * 1000;
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
const requestWithNode = (url, headers) => new Promise((resolve, reject) => {
  const transport = url.protocol === 'https:' ? https : http;
  const request = transport.get(url, {
    agent: false,
    headers: { 'user-agent': `GameHub-Agent/${String(vscode.extensions.getExtension('gamehub-local.gamehub-agent')?.packageJSON?.version || 'unknown')}`, ...headers },
    timeout: 30000,
  }, response => {
    const header = name => {
      const value = response.headers[String(name).toLowerCase()];
      return Array.isArray(value) ? value.join(', ') : value == null ? null : String(value);
    };
    resolve({ status: response.statusCode || 0, headers: { get: header }, body: Readable.toWeb(response) });
  });
  request.once('timeout', () => request.destroy(new Error('GameHub 下载连接超时。')));
  request.once('error', reject);
});
const requestWithSystemCurl = (url, headers, expectedLength) => new Promise((resolve, reject) => {
  const command = process.platform === 'win32' ? 'curl.exe' : 'curl';
  const protocol = url.protocol === 'https:' ? '=https' : '=http';
  const args = ['--fail', '--silent', '--show-error', '--no-progress-meter', '--proto', protocol, '--max-time', '1800'];
  for (const [name, value] of Object.entries(headers)) args.push('--header', `${name}: ${value}`);
  args.push('--', url.href);
  const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const stream = new PassThrough(); let stderr = ''; let settled = false;
  child.stdout.on('data', chunk => stream.write(chunk));
  child.stderr.on('data', chunk => { if (stderr.length < 4096) stderr += chunk.toString('utf8'); });
  child.once('error', error => { stream.destroy(error); if (!settled) { settled = true; reject(error); } });
  child.once('spawn', () => {
    settled = true;
    resolve({ status: 200, headers: { get: name => String(name).toLowerCase() === 'content-length' && expectedLength ? String(expectedLength) : null }, body: Readable.toWeb(stream) });
  });
  child.once('close', code => {
    if (code === 0) stream.end();
    else stream.destroy(new Error(`GameHub 系统下载失败（curl ${code}）：${stderr.trim() || '未知错误'}`));
  });
});
const requestStream = async (value, headers = {}, expectedLength = 0) => {
  const url = new URL(String(value));
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('GameHub 下载协议不受支持。');
  try { return await requestWithNode(url, headers); }
  catch (error) {
    const code = String(error.code || ''); const message = String(error.message || error);
    if (!['ENOSERVERS', 'ENOTFOUND', 'EAI_AGAIN'].includes(code) && !/no servers/i.test(message)) throw error;
    return requestWithSystemCurl(url, headers, expectedLength);
  }
};
const downloadUpdateBytes = async (value, onProgress) => {
  const url = trustedUpdateUrl(value);
  const response = await requestStream(url, { accept: 'application/json, application/octet-stream', 'cache-control': 'no-cache' });
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`GameHub 更新下载失败（${response.status}）。`);
  }
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_UPDATE_BYTES) throw new Error('GameHub 更新包超过大小限制。');
  const reader = response.body?.getReader(); const chunks = []; let received = 0;
  if (!reader) throw new Error('GameHub 更新响应不可读取。');
  try {
    while (true) {
      const { value: chunk, done } = await reader.read();
      if (done) break;
      received += chunk.byteLength;
      if (received > MAX_UPDATE_BYTES || (declared && received > declared)) throw new Error('GameHub 更新包超过声明大小。');
      chunks.push(Buffer.from(chunk));
      onProgress?.({ received, total: declared, percent: declared ? Math.min(100, Math.floor(received * 100 / declared)) : null });
    }
  } finally { reader.releaseLock(); }
  if (declared && received !== declared) throw new Error('GameHub 更新下载不完整。');
  return Buffer.concat(chunks, received);
};
async function checkForEditorUpdate(context, output, { force = false, userInitiated = false } = {}) {
  const config = vscode.workspace.getConfiguration('gamehub');
  if (!config.get('autoUpdate', true) && !userInitiated) return;
  const now = Date.now();
  if (!force && Number(context.globalState.get('gamehub.update.nextCheckAt', 0)) > now) return;
  await context.globalState.update('gamehub.update.nextCheckAt', now + UPDATE_INTERVAL_MS);
  try {
    if (userInitiated) await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'GameHub 更新',
      cancellable: false,
    }, async progress => {
      progress.report({ message: '正在检查服务器版本…' });
      await performEditorUpdate(context, output, progress, true);
    });
    else await performEditorUpdate(context, output);
  } catch (error) {
    await context.globalState.update('gamehub.update.nextCheckAt', Date.now() + UPDATE_RETRY_MS);
    const message = `GameHub 自动更新检查失败：${String(error.message || error)}`;
    output.appendLine(message);
    if (userInitiated) await vscode.window.showErrorMessage(`${message} 可在“输出 → GameHub”查看详情。`);
    else if (!context.globalState.get('gamehub.update.failureNotified', false)) {
      await context.globalState.update('gamehub.update.failureNotified', true);
      const choice = await vscode.window.showWarningMessage('GameHub 自动更新检查失败，可点击侧栏右上角的 ↻ 重试。', '打开日志');
      if (choice === '打开日志') output.show(true);
    }
  }
}
async function performEditorUpdate(context, output, progress, userInitiated = false) {
    const manifest = JSON.parse((await downloadUpdateBytes(UPDATE_MANIFEST_URL)).toString('utf8'));
    const item = manifest.editorExtension;
    if (manifest.channel !== 'stable' || !item?.supportedHosts?.includes(hostId())) throw new Error('GameHub 稳定版更新清单无效。');
    const currentVersion = String(context.extension?.packageJSON?.version || '0.0.0');
    if (compareVersions(item.version, currentVersion) <= 0) {
      if (userInitiated) await vscode.window.showInformationMessage(`GameHub 已是最新版本（${currentVersion}）。`);
      return;
    }
    const install = async updateProgress => {
      updateProgress.report({ message: `发现 ${item.version}，正在下载…` });
      let lastPercent = 0;
      const bytes = await downloadUpdateBytes(item.url, state => {
        const message = state.percent == null
          ? `已下载 ${(state.received / 1024 / 1024).toFixed(1)} MB`
          : `已下载 ${state.percent}%`;
        const increment = state.percent == null ? 0 : Math.max(0, state.percent - lastPercent);
        if (state.percent != null) lastPercent = state.percent;
        updateProgress.report({ message, increment });
      });
      updateProgress.report({ message: '正在校验更新…' });
      const actual = createHash('sha256').update(bytes).digest('hex');
      if (actual !== String(item.sha256).toLowerCase()) throw new Error('GameHub VSIX SHA-256 校验失败。');
      await vscode.workspace.fs.createDirectory(context.globalStorageUri);
      const target = vscode.Uri.joinPath(context.globalStorageUri, item.filename);
      await vscode.workspace.fs.writeFile(target, bytes);
      updateProgress.report({ message: '正在安装，重启后生效…' });
      await vscode.commands.executeCommand('workbench.extensions.installExtension', target);
    };
    if (progress) await install(progress);
    else await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `GameHub ${item.version} 更新`,
      cancellable: false,
    }, install);
    await context.globalState.update('gamehub.update.stagedVersion', item.version);
    await context.globalState.update('gamehub.update.failureNotified', false);
    output.appendLine(`GameHub ${item.version} 已下载并安装，等待重启生效。`);
    const choice = await vscode.window.showInformationMessage(
      `GameHub ${item.version} 已更新完成，重启 ${hostId() === 'cursor' ? 'Cursor' : 'VS Code'} 后生效。`,
      '立即重启', '稍后'
    );
    if (choice === '立即重启') await vscode.commands.executeCommand('workbench.action.reloadWindow');
}
let editorUpdateCheck = null;
const runEditorUpdateCheck = (context, output, options) => {
  if (editorUpdateCheck) return editorUpdateCheck;
  editorUpdateCheck = checkForEditorUpdate(context, output, options).finally(() => { editorUpdateCheck = null; });
  return editorUpdateCheck;
};

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
            result = await desktopLauncher.restore(release.record);
          } else if (message.operation === 'desktop.prepare') {
            if (!desktopLauncher?.enabled) throw new Error('Windows 本机启动能力不可用。');
            const release = desktopRelease(message.payload?.release);
            const downloadUrl = new URL(`/v1/works/${encodeURIComponent(release.workId)}/releases/${encodeURIComponent(release.releaseId)}/download`, apiUrl.origin);
            result = await desktopLauncher.prepare(release.record, () => requestStream(downloadUrl, { accept: 'application/octet-stream', 'cache-control': 'no-cache' }, release.sizeBytes));
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
  context.subscriptions.push(vscode.commands.registerCommand('gamehub.checkForUpdates', () => runEditorUpdateCheck(context, updateOutput, { force: true, userInitiated: true })));
  const updateTimer = setTimeout(() => void runEditorUpdateCheck(context, updateOutput, { force: true }), 15000);
  const updateInterval = setInterval(() => void runEditorUpdateCheck(context, updateOutput), UPDATE_INTERVAL_MS);
  context.subscriptions.push(updateOutput, { dispose() { clearTimeout(updateTimer); clearInterval(updateInterval); currentView = undefined; void desktopLauncher?.close(); } });
}

module.exports = { activate };
