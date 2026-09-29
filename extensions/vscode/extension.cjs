'use strict';
const vscode = require('vscode');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { openArcade } = require('./media/launcher.cjs');

function activate(context) {
  let view, registered = false, pending;
  const config = () => vscode.workspace.getConfiguration('lightArcade');
  const openBrowser = async () => {
    const url = new URL(config().get('browserUrl'));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('游戏平台地址必须为不含凭据的 HTTP(S) 地址。');
    }
    const commands = await vscode.commands.getCommands(true);
    for (const command of ['workbench.action.browser.open', 'simpleBrowser.show']) {
      if (!commands.includes(command)) continue;
      try {
        await vscode.commands.executeCommand(command, url.href);
        // A command acknowledgment is not a page-load acknowledgment.
        return { status: 'queued' };
      } catch { /* Try the other available embedded-browser adapter. */ }
    }
    throw new Error('此版本未提供可调用的内置浏览器。请在宿主浏览器中手动打开：' + url.href);
  };
  const launch = async preference => {
    try {
      return await openArcade({
        preference,
        sidebar: { supported: registered, open: openSidebar },
        browser: { open: openBrowser },
      });
    } catch (error) { await vscode.window.showErrorMessage(String(error.message || error)); }
  };

  try {
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('lightArcade.library', {
      resolveWebviewView(nextView) {
        view = nextView;
        view.webview.options = { enableScripts: true, localResourceRoots: [] };
        context.subscriptions.push(view.webview.onDidReceiveMessage(message => {
          if (message?.type === 'arcade:ready') pending?.finish({ ready: true });
          if (message?.type === 'arcade:browser') void launch('browser');
        }));
        context.subscriptions.push(view.onDidDispose(() => {
          if (view === nextView) view = undefined;
          pending?.finish({ ready: false });
        }));
        const nonce = randomBytes(18).toString('base64');
        const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none';">`;
        const html = readFileSync(path.join(context.extensionPath, 'media', 'index.html'), 'utf8');
        view.webview.html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">' + csp)
          .replace('<script>', `<script nonce="${nonce}">`);
      },
    }));
    registered = true;
  } catch { /* The open command still works through the browser adapter. */ }

  async function openSidebar() {
    if (pending) return pending.promise;
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    const attempt = { promise, finish(result) {
      clearTimeout(attempt.timer);
      if (pending === attempt) pending = undefined;
      resolve(result);
    } };
    pending = attempt;
    attempt.timer = setTimeout(() => attempt.finish({ ready: false }), 5000);
    // Return the bounded readiness promise even if a host command stalls.
    Promise.resolve().then(() => vscode.commands.executeCommand('lightArcade.library.focus'))
      .then(() => { if (view) return view.webview.postMessage({ type: 'arcade:probe' }); })
      .catch(() => attempt.finish({ ready: false }));
    return promise;
  }
  context.subscriptions.push({ dispose() { pending?.finish({ ready: false }); } });
  context.subscriptions.push(vscode.commands.registerCommand('lightArcade.open', () => launch(config().get('displayMode', 'auto'))));
  context.subscriptions.push(vscode.commands.registerCommand('lightArcade.openBrowser', () => launch('browser')));
}

module.exports = { activate };
