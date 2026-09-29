'use strict';
const vscode = require('vscode');
const { randomBytes } = require('node:crypto');

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

function activate(context) {
  let currentView;
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
      const bootstrap = { host: hostId(), hostVersion: vscode.version, remoteName: vscode.env.remoteName || null, apiBaseUrl: apiUrl.origin, runtimeDomain: gameRuntimeDomain, theme: { mode: themeMode() } };
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
          else throw new Error('不支持的宿主操作。');
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
  context.subscriptions.push({ dispose() { currentView = undefined; } });
}

module.exports = { activate };
