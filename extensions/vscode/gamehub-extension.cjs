'use strict';
const vscode = require('vscode');
const { createHash, randomBytes, randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const http = require('node:http');
const https = require('node:https');
const { PassThrough, Readable } = require('node:stream');
const { readFile, readdir, stat, unlink } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const escapeHtml = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');

const TOKEN_KEY = 'gamehub.session.v1';
const allowedUrl = (value, label) => {
  const url = new URL(String(value));
  const loopback = ['127.0.0.1', 'localhost'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password) throw new Error(`${label}必须使用 HTTPS，或本机 loopback HTTP，且不能包含凭据。`);
  return url;
};
const runtimeDomain = value => {
  const domain = String(value || '').trim().toLowerCase();
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) throw new Error('墨鱼工坊运行域名无效。');
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
  if (url.protocol !== 'https:' || url.hostname !== 'mooyu.fun' || url.username || url.password) throw new Error('墨鱼工坊更新地址不受信任。');
  return url;
};
const runHidden = (command, args, { env = process.env, timeoutMs = 120000 } = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env });
  let stdout = ''; let stderr = ''; let settled = false;
  const finish = error => {
    if (settled) return;
    settled = true; clearTimeout(timer);
    if (error) reject(error); else resolve({ stdout,stderr });
  };
  const timer = setTimeout(() => { child.kill(); finish(new Error('墨鱼工坊更新安装超时。')); }, timeoutMs);
  child.stdout?.on('data', chunk => { if (stdout.length < 8192) stdout += chunk.toString('utf8'); });
  child.stderr?.on('data', chunk => { if (stderr.length < 8192) stderr += chunk.toString('utf8'); });
  child.once('error', finish);
  child.once('close', code => finish(code === 0 ? null : new Error(`墨鱼工坊后台更新进程失败（${code}）：${stderr.trim() || stdout.trim() || '未知错误'}`)));
});
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
  request.once('timeout', () => request.destroy(new Error('墨鱼工坊下载连接超时。')));
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
    else stream.destroy(new Error(`墨鱼工坊系统下载失败（curl ${code}）：${stderr.trim() || '未知错误'}`));
  });
});
const requestStream = async (value, headers = {}, expectedLength = 0) => {
  const url = new URL(String(value));
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('墨鱼工坊下载协议不受支持。');
  try { return await requestWithNode(url, headers); }
  catch (error) {
    const code = String(error.code || ''); const message = String(error.message || error);
    if (!['ENOSERVERS', 'ENOTFOUND', 'EAI_AGAIN'].includes(code) && !/no servers/i.test(message)) throw error;
    return requestWithSystemCurl(url, headers, expectedLength);
  }
};
const readUpdateResponse = async (response, onProgress) => {
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`墨鱼工坊更新下载失败（${response.status}）。`);
  }
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_UPDATE_BYTES) throw new Error('墨鱼工坊更新包超过大小限制。');
  const reader = response.body?.getReader(); const chunks = []; let received = 0;
  if (!reader) throw new Error('墨鱼工坊更新响应不可读取。');
  try {
    while (true) {
      const { value: chunk, done } = await reader.read();
      if (done) break;
      received += chunk.byteLength;
      if (received > MAX_UPDATE_BYTES || (declared && received > declared)) throw new Error('墨鱼工坊更新包超过声明大小。');
      chunks.push(Buffer.from(chunk));
      onProgress?.({ received, total: declared, percent: declared ? Math.min(100, Math.floor(received * 100 / declared)) : null });
    }
  } finally { reader.releaseLock(); }
  if (declared && received !== declared) throw new Error('墨鱼工坊更新下载不完整。');
  return Buffer.concat(chunks, received);
};
const downloadUpdateBytesWithPowerShell = async url => {
  if (process.platform !== 'win32') throw new Error('墨鱼工坊系统下载不可用。');
  const target = path.join(os.tmpdir(), `gamehub-update-${randomUUID()}.part`);
  const script = "$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';Invoke-WebRequest -UseBasicParsing -Uri $env:GAMEHUB_UPDATE_URL -OutFile $env:GAMEHUB_UPDATE_TARGET";
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  try {
    await runHidden('powershell.exe', ['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',encoded], {
      env: { ...process.env,GAMEHUB_UPDATE_URL: url.href,GAMEHUB_UPDATE_TARGET: target },
      timeoutMs: 30 * 60 * 1000,
    });
    const details = await stat(target);
    if (details.size > MAX_UPDATE_BYTES) throw new Error('墨鱼工坊更新包超过大小限制。');
    return readFile(target);
  } finally { await unlink(target).catch(() => {}); }
};
const downloadUpdateBytes = async (value, onProgress) => {
  const url = trustedUpdateUrl(value);
  const headers = { accept: 'application/json, application/octet-stream','cache-control': 'no-cache' };
  try { return await readUpdateResponse(await requestWithNode(url, headers), onProgress); }
  catch (error) {
    const code = String(error.code || ''); const message = String(error.message || error);
    if (!['ENOSERVERS','ENOTFOUND','EAI_AGAIN'].includes(code) && !/no servers/i.test(message)) throw error;
    try { return await readUpdateResponse(await requestWithSystemCurl(url, headers), onProgress); }
    catch (curlError) {
      if (process.platform !== 'win32') throw curlError;
      return downloadUpdateBytesWithPowerShell(url);
    }
  }
};
const extensionInstallPresent = async (context, item) => {
  const expected = `${String(item.extensionId).toLowerCase()}-${String(item.version).toLowerCase()}`;
  const entries = await readdir(path.dirname(context.extensionPath), { withFileTypes: true });
  return entries.some(entry => entry.isDirectory() && (entry.name.toLowerCase() === expected || entry.name.toLowerCase().startsWith(`${expected}-`)));
};
const editorCliInvocation = async () => {
  const cliScript = path.join(path.dirname(process.execPath), 'resources', 'app', 'out', 'cli.js');
  const details = await stat(cliScript).catch(() => null);
  if (!details?.isFile()) throw new Error(`未找到编辑器命令行安装器：${cliScript}`);
  return {
    command: process.execPath,
    args: [cliScript],
    env: { ...process.env,ELECTRON_RUN_AS_NODE: '1',VSCODE_DEV: '' },
  };
};
const installEditorVsix = async (context, item, target, output) => {
  output.appendLine(`墨鱼工坊 ${item.version} 已校验，正在通过隐藏的编辑器安装进程安装。`);
  const cli = await editorCliInvocation();
  await runHidden(cli.command, [...cli.args,'--install-extension',target.fsPath,'--force'], { env: cli.env,timeoutMs: 5 * 60 * 1000 });
  if (!await extensionInstallPresent(context, item)) throw new Error(`Cursor 未确认墨鱼工坊 ${item.version} 已安装；更新将在稍后重试。`);
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
      title: '墨鱼工坊更新',
      cancellable: false,
    }, async progress => {
      progress.report({ message: '正在检查服务器版本…' });
      await performEditorUpdate(context, output, progress, true);
    });
    else await performEditorUpdate(context, output);
  } catch (error) {
    await context.globalState.update('gamehub.update.nextCheckAt', Date.now() + UPDATE_RETRY_MS);
    const message = `墨鱼工坊自动更新检查失败：${String(error.message || error)}`;
    output.appendLine(message);
    if (userInitiated) await vscode.window.showErrorMessage(`${message} 可在“输出 → 墨鱼工坊”查看详情。`);
    else if (!context.globalState.get('gamehub.update.failureNotified', false)) {
      await context.globalState.update('gamehub.update.failureNotified', true);
      const choice = await vscode.window.showWarningMessage('墨鱼工坊自动更新检查失败，可点击侧栏右上角的 ↻ 重试。', '打开日志');
      if (choice === '打开日志') output.show(true);
    }
  }
}
async function performEditorUpdate(context, output, progress, userInitiated = false) {
    const manifest = JSON.parse((await downloadUpdateBytes(UPDATE_MANIFEST_URL)).toString('utf8'));
    const item = manifest.editorExtension;
    if (manifest.channel !== 'stable' || !item?.supportedHosts?.includes(hostId())) throw new Error('墨鱼工坊稳定版更新清单无效。');
    const currentVersion = String(context.extension?.packageJSON?.version || '0.0.0');
    if (compareVersions(item.version, currentVersion) <= 0) {
      await context.globalState.update('gamehub.update.stagedVersion', undefined);
      if (userInitiated) await vscode.window.showInformationMessage(`墨鱼工坊 已是最新版本（${currentVersion}）。`);
      return;
    }
    const currentPermissions = new Set(Array.isArray(context.extension?.packageJSON?.gamehub?.permissions) ? context.extension.packageJSON.gamehub.permissions : []);
    const nextPermissions = Array.isArray(item.permissions) ? item.permissions.filter(value => typeof value === 'string') : [];
    const addedPermissions = nextPermissions.filter(value => !currentPermissions.has(value));
    if (addedPermissions.length) {
      const approval = await vscode.window.showWarningMessage(
        `墨鱼工坊 ${item.version} 需要新增权限：${addedPermissions.join('、')}。在你确认前不会下载或安装。`,
        { modal: true, detail: '权限增加不会通过后台自动更新静默激活。' },
        '确认并更新',
      );
      if (approval !== '确认并更新') {
        output.appendLine(`墨鱼工坊 ${item.version} 因新增权限等待用户确认：${addedPermissions.join(', ')}`);
        await context.globalState.update('gamehub.update.pendingPermissions', { version:item.version,permissions:addedPermissions });
        return;
      }
      await context.globalState.update('gamehub.update.pendingPermissions', undefined);
    }
    const install = async updateProgress => {
      await vscode.workspace.fs.createDirectory(context.globalStorageUri);
      const target = vscode.Uri.joinPath(context.globalStorageUri, item.filename);
      let bytes = null;
      try {
        const cached = await readFile(target.fsPath);
        if (cached.length <= MAX_UPDATE_BYTES && createHash('sha256').update(cached).digest('hex') === String(item.sha256).toLowerCase()) bytes = cached;
      } catch {}
      if (bytes) updateProgress.report({ message: `已验证本地 ${item.version} 更新包，跳过重复下载。` });
      else {
        updateProgress.report({ message: `发现 ${item.version}，正在下载…` });
        let lastPercent = 0;
        bytes = await downloadUpdateBytes(item.url, state => {
          const message = state.percent == null
            ? `已下载 ${(state.received / 1024 / 1024).toFixed(1)} MB`
            : `已下载 ${state.percent}%`;
          const increment = state.percent == null ? 0 : Math.max(0, state.percent - lastPercent);
          if (state.percent != null) lastPercent = state.percent;
          updateProgress.report({ message,increment });
        });
        updateProgress.report({ message: '正在校验更新…' });
        const actual = createHash('sha256').update(bytes).digest('hex');
        if (actual !== String(item.sha256).toLowerCase()) throw new Error('墨鱼工坊 VSIX SHA-256 校验失败。');
        await vscode.workspace.fs.writeFile(target, bytes);
      }
      updateProgress.report({ message: '正在后台安装，完成后可重启…' });
      await installEditorVsix(context, item, target, output);
    };
    if (progress) await install(progress);
    else await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `墨鱼工坊 ${item.version} 更新`,
      cancellable: false,
    }, install);
    await context.globalState.update('gamehub.update.stagedVersion', item.version);
    await context.globalState.update('gamehub.update.failureNotified', false);
    output.appendLine(`墨鱼工坊 ${item.version} 已确认安装，等待重启生效。`);
    const choice = await vscode.window.showInformationMessage(
      `墨鱼工坊 ${item.version} 已更新完成，重启 ${hostId() === 'cursor' ? 'Cursor' : 'VS Code'} 后生效。`,
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
  const updateOutput = vscode.window.createOutputChannel('墨鱼工坊');
  const coursewareOutput = vscode.window.createOutputChannel('墨鱼工坊课件');
  let coursewarePreview = null;
  let desktopLauncher = null;
  try {
    const moduleUri = vscode.Uri.joinPath(context.extensionUri, 'desktop-launcher.mjs');
    const { createDesktopLauncher } = await import(pathToFileURL(moduleUri.fsPath).href);
    desktopLauncher = createDesktopLauncher({ root: vscode.Uri.joinPath(context.globalStorageUri, 'desktop-games').fsPath, enabled: process.platform === 'win32' });
  } catch (error) { updateOutput.appendLine(`墨鱼工坊本机启动组件不可用：${String(error.message || error)}`); }
  let saveStore=null,runSaveStoreRequest;
  try {
    const {createSqliteSaveStore}=await import(pathToFileURL(path.join(context.extensionPath,'save-cache','sqlite-store.mjs')).href);
    ({runSaveStoreRequest}=await import(pathToFileURL(path.join(context.extensionPath,'save-cache','store-rpc.mjs')).href));
    saveStore=await createSqliteSaveStore({root:path.join(context.globalStorageUri.fsPath,'game-saves')});
  } catch(error) { updateOutput.appendLine('墨鱼工坊本机存档不可用：'+String(error.message||error)); }
  const config = () => vscode.workspace.getConfiguration('gamehub');
  const loadCoursewareTools = () => import(pathToFileURL(path.join(context.extensionPath,'bin','courseware-bridge.mjs')).href);
  const hasCoursewareManifest = async root => {
    try { return (await stat(path.join(root,'mooyu-courseware.json'))).isFile(); } catch { return false; }
  };
  const chooseCoursewareRoot = async () => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const activeFolder = vscode.window.activeTextEditor ? vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri) : null;
    if (activeFolder && await hasCoursewareManifest(activeFolder.uri.fsPath)) return activeFolder.uri.fsPath;
    const candidates = [];
    for (const folder of folders) if (await hasCoursewareManifest(folder.uri.fsPath)) candidates.push(folder);
    if (candidates.length === 1) return candidates[0].uri.fsPath;
    if (candidates.length > 1) {
      const selected = await vscode.window.showQuickPick(candidates.map(folder => ({ label:folder.name,description:folder.uri.fsPath,folder })),{ placeHolder:'选择交互课件目录' });
      return selected?.folder.uri.fsPath ?? null;
    }
    const selected = await vscode.window.showOpenDialog({ canSelectFiles:false,canSelectFolders:true,canSelectMany:false,openLabel:'选择包含 mooyu-courseware.json 的目录' });
    return selected?.[0]?.fsPath ?? null;
  };
  const showCoursewareReport = (title,value) => {
    const report = value.report ?? value; const findings = Array.isArray(report.findings) ? report.findings : [];
    const panel = vscode.window.createWebviewPanel('gamehub.coursewareReport',title,vscode.ViewColumn.Beside,{ enableScripts:false });
    const rows = findings.map(item => `<tr><td><b class="${escapeHtml(item.severity)}">${escapeHtml(item.severity)}</b></td><td><code>${escapeHtml(item.code)}</code></td><td>${escapeHtml(item.message)}${item.path ? `<small>${escapeHtml(item.path)}${escapeHtml(item.pointer || '')}</small>` : ''}</td></tr>`).join('');
    const counts = value.counts ? `<div class="metrics"><span>${value.counts.objectives} 目标</span><span>${value.counts.scenes} 场景</span><span>${value.counts.checkpoints} 检查点</span><span>${value.counts.sources} 来源</span><span>${value.counts.journeys} 路径</span></div>` : '';
    panel.webview.html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:13px/1.6 var(--vscode-font-family);color:var(--vscode-foreground);padding:22px}h1{font-size:22px}.status{padding:12px;border-left:4px solid ${report.ok ? 'var(--vscode-testing-iconPassed)' : 'var(--vscode-testing-iconFailed)'};background:var(--vscode-editor-inactiveSelectionBackground)}.metrics{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}.metrics span{border:1px solid var(--vscode-panel-border);padding:5px 8px}table{width:100%;border-collapse:collapse;margin-top:18px}td{padding:9px;border-top:1px solid var(--vscode-panel-border);vertical-align:top}td:first-child{width:70px}td:nth-child(2){width:220px}.error{color:var(--vscode-testing-iconFailed)}.warning{color:var(--vscode-editorWarning-foreground)}.info{color:var(--vscode-testing-iconPassed)}small{display:block;color:var(--vscode-descriptionForeground);margin-top:3px}code{font-family:var(--vscode-editor-font-family)}</style></head><body><h1>${escapeHtml(title)}</h1><p class="status"><strong>${report.ok ? 'PASS' : 'FAIL'}</strong>${report.summary ? ` · ${report.summary.errors} error · ${report.summary.warnings} warning · ${report.summary.info} info` : ''}</p>${counts}<p><code>${escapeHtml(value.projectDigest || report.projectDigest || '')}</code></p>${rows ? `<table><tbody>${rows}</tbody></table>` : '<p>没有发现问题。</p>'}</body></html>`;
  };
  const createCoursewareFromTemplate = async () => {
    const selectedTemplate = await vscode.window.showQuickPick([
      { label:'概念探索',description:'参数驱动的可视化解释',key:'concept-explorer' },
      { label:'因果模拟',description:'控制变量实验',key:'causal-simulation' },
      { label:'算法步进',description:'可暂停、可追踪的步骤演示',key:'algorithm-stepper' },
    ],{ placeHolder:'选择最接近的课件模板' });
    if (!selectedTemplate) return;
    const parent = await vscode.window.showOpenDialog({ canSelectFiles:false,canSelectFolders:true,canSelectMany:false,openLabel:'选择新课件的父目录' });
    if (!parent?.[0]) return;
    const name = await vscode.window.showInputBox({ title:'新课件目录名',prompt:'只创建新目录，不会覆盖现有内容。',validateInput:value => /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value) ? null : '使用 1—64 位字母、数字、点、下划线或连字符。' });
    if (!name) return;
    const tools = await loadCoursewareTools(); const target = path.join(parent[0].fsPath,name); const templateRoot = path.join(context.extensionPath,'templates','courseware',selectedTemplate.key);
    const result = await tools.initializeCoursewareProject({ templateRoot,targetRoot:target }); coursewareOutput.appendLine(`Created ${result.id}: ${result.target}`);
    const action = await vscode.window.showInformationMessage(`已创建交互课件“${result.id}”。`,'打开目录');
    if (action === '打开目录') await vscode.commands.executeCommand('vscode.openFolder',vscode.Uri.file(target),{ forceNewWindow:false });
  };
  const runCoursewareInspect = async () => {
    const root = await chooseCoursewareRoot(); if (!root) return; const tools = await loadCoursewareTools(); const result = await tools.describeCoursewareProject(root); showCoursewareReport('墨鱼工坊课件概览',result);
  };
  const runCoursewareDoctor = async () => {
    const root = await chooseCoursewareRoot(); if (!root) return; const tools = await loadCoursewareTools(); const report = await tools.inspectCoursewareProject(root); showCoursewareReport('墨鱼工坊课件检查',report); if (!report.ok) await vscode.window.showErrorMessage(`课件检查未通过：${report.summary.errors} 个错误。`);
  };
  const runCoursewarePreview = async () => {
    const root = await chooseCoursewareRoot(); if (!root) return; const tools = await loadCoursewareTools(); if (coursewarePreview) await coursewarePreview.close(); coursewarePreview = await tools.createCoursewarePreviewServer(root,{ port:0 });
    coursewareOutput.appendLine(`Preview: ${coursewarePreview.url}`); const commands = await vscode.commands.getCommands(true);
    if (commands.includes('simpleBrowser.show')) await vscode.commands.executeCommand('simpleBrowser.show',coursewarePreview.url); else await vscode.env.openExternal(vscode.Uri.parse(coursewarePreview.url));
  };
  const runCoursewareTest = async () => {
    const root = await chooseCoursewareRoot(); if (!root) return; const browserModule = String(config().get('coursewarePlaywrightModule','')).trim();
    if (!browserModule) { const action=await vscode.window.showWarningMessage('真实学习路径测试需要现有 Playwright。墨鱼工坊不会静默安装。','打开设置'); if(action==='打开设置')await vscode.commands.executeCommand('workbench.action.openSettings','gamehub.coursewarePlaywrightModule'); return; }
    const tools = await loadCoursewareTools(); const result = await vscode.window.withProgress({ location:vscode.ProgressLocation.Notification,title:'墨鱼工坊：正在执行课件学习路径…',cancellable:false },() => tools.testCoursewareProject(root,{ browserModule }));
    showCoursewareReport('墨鱼工坊课件学习路径',{ ...result,summary:{ errors:0,warnings:0,info:result.journeys.length },findings:result.journeys.map(item => ({ severity:'info',code:'JOURNEY_PASS',message:`${item.id}：${item.steps} steps` })) });
  };
  const runCoursewareBuild = async () => {
    const root = await chooseCoursewareRoot(); if (!root) return; const tools = await loadCoursewareTools(); const result = await tools.buildCoursewareProject(root); coursewareOutput.appendLine(`Build ${result.projectDigest}: ${result.output}`); await vscode.window.showInformationMessage(`课件构建完成：${result.files.length} 个文件。`);
  };
  const runCoursewarePackage = async () => {
    const root = await chooseCoursewareRoot(); if (!root) return; const tools = await loadCoursewareTools(); const result = await tools.packageCoursewareProject(root); coursewareOutput.appendLine(`Package ${result.artifactSha256}: ${result.path}`); const action=await vscode.window.showInformationMessage(`课件包已生成：${result.artifactBytes} 字节。`,'在文件管理器中显示'); if(action==='在文件管理器中显示')await vscode.commands.executeCommand('revealFileInOS',vscode.Uri.file(result.path));
  };
  const openBrowser = async () => {
    const url = allowedUrl(config().get('browserUrl', 'http://127.0.0.1:3081/'), '浏览器地址');
    const commands = await vscode.commands.getCommands(true);
    for (const command of ['workbench.action.browser.open', 'simpleBrowser.show']) {
      if (!commands.includes(command)) continue;
      try { await vscode.commands.executeCommand(command, url.href); return; } catch {}
    }
    await vscode.env.openExternal(vscode.Uri.parse(url.href));
  };
  const chooseCreatorPackageRoot = async () => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const activeFolder = vscode.window.activeTextEditor
      ? vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)
      : null;
    if (activeFolder) return activeFolder.uri.fsPath;
    if (folders.length === 1) return folders[0].uri.fsPath;
    if (folders.length > 1) {
      const selected = await vscode.window.showQuickPick(
        folders.map(folder => ({ label: folder.name,description: folder.uri.fsPath,folder })),
        { placeHolder: '选择包含 creator-manifest.json 的创作包目录' },
      );
      return selected?.folder.uri.fsPath ?? null;
    }
    const selected = await vscode.window.showOpenDialog({ canSelectFiles: false,canSelectFolders: true,canSelectMany: false,openLabel: '选择创作包目录' });
    return selected?.[0]?.fsPath ?? null;
  };
  const submitCreatorPackageFromWorkspace = async () => {
    const root = await chooseCreatorPackageRoot();
    if (!root) return;
    let tokens = null;
    try { tokens = JSON.parse(await context.secrets.get(TOKEN_KEY) || 'null'); } catch {}
    if (!validTokens(tokens)) {
      const action = await vscode.window.showWarningMessage('请先在墨鱼工坊侧栏登录，再提交创作包。', '打开墨鱼工坊');
      if (action === '打开墨鱼工坊') await vscode.commands.executeCommand('gamehub.open');
      return;
    }
    const apiUrl = allowedUrl(config().get('apiUrl', 'http://127.0.0.1:3090'), 'API 地址');
    const siteUrl = allowedUrl(config().get('browserUrl', apiUrl.origin), '浏览器地址');
    const creatorModuleUri = vscode.Uri.joinPath(context.extensionUri, 'creator-package.mjs');
    const apiModuleUri = vscode.Uri.joinPath(context.extensionUri, 'platform-api-client.mjs');
    try {
      const submitted = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification,title: '墨鱼工坊：正在校验并提交创作包…',cancellable: false }, async () => {
        const [{ submitCreatorPackage },{ createApiClient }] = await Promise.all([
          import(pathToFileURL(creatorModuleUri.fsPath).href),
          import(pathToFileURL(apiModuleUri.fsPath).href),
        ]);
        const readTokens = async () => {
          try { return JSON.parse(await context.secrets.get(TOKEN_KEY) || 'null'); } catch { return null; }
        };
        const apiClient = createApiClient({
          baseUrl: apiUrl.origin,
          getAccessToken: async () => (await readTokens())?.accessToken ?? null,
          getRefreshToken: async () => (await readTokens())?.refreshToken ?? null,
          setTokens: async value => {
            if (!validTokens(value)) throw new Error('平台返回了无效的登录凭据。');
            await context.secrets.store(TOKEN_KEY, JSON.stringify(value));
          },
        });
        return submitCreatorPackage({ root,apiClient,platformOrigin:apiUrl.origin });
      });
      siteUrl.hash = `/creator/drafts/${submitted.draft.id}`;
      const status = submitted.action === 'updated' ? '已更新待发布草稿' : submitted.action === 'unchanged' ? '内容未变化' : '已创建待发布草稿';
      const action = await vscode.window.showInformationMessage(`“${submitted.draft.title}”${status}。`, '打开草稿', '复制地址');
      if (action === '打开草稿') await vscode.env.openExternal(vscode.Uri.parse(siteUrl.href));
      if (action === '复制地址') await vscode.env.clipboard.writeText(siteUrl.href);
    } catch (error) {
      const findings = error?.report?.findings?.filter(finding => finding.severity === 'error').slice(0,3).map(finding => finding.message).join('；');
      await vscode.window.showErrorMessage(findings || String(error.message || error));
    }
  };
  const provider = {
    resolveWebviewView(view) {
      currentView = view;
      const apiUrl = allowedUrl(config().get('apiUrl', 'http://127.0.0.1:3090'), 'API 地址');
      const localApi = ['127.0.0.1', 'localhost'].includes(apiUrl.hostname);
      const gameRuntimeDomain = localApi ? 'localhost' : runtimeDomain(config().get('runtimeDomain', 'runtime.mooyu.fun'));
      const realtimeSources = localApi ? 'ws://127.0.0.1:3093 ws://localhost:3093' : `wss://${apiUrl.host}`;
      view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')] };
      const scriptUri = view.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'gamehub.js'));
      const nonce = randomBytes(18).toString('base64');
      const bootstrap = { host: hostId(), hostVersion: vscode.version, remoteName: vscode.env.remoteName || null, apiBaseUrl: apiUrl.origin, runtimeDomain: gameRuntimeDomain, canLaunchDesktop: desktopLauncher?.enabled === true, theme: { mode: themeMode() } };
      view.webview.html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' ${view.webview.cspSource}; style-src 'unsafe-inline'; img-src data: blob: ${apiUrl.origin}; connect-src ${apiUrl.origin} ${realtimeSources}; frame-src http://*.localhost:3092 https://*.${gameRuntimeDomain};"><title>墨鱼工坊</title></head><body><div id="root"></div><script nonce="${nonce}">window.__GAMEHUB_EDITOR__=${JSON.stringify(bootstrap).replaceAll('<','\\u003c')};</script><script nonce="${nonce}" src="${scriptUri}"></script></body></html>`;
      const exportRequests=new Map();
      const subscription = view.webview.onDidReceiveMessage(async message => {
        if (!message || message.type !== 'gamehub:request' || !Number.isSafeInteger(message.id)) return;
        try {
          let result = null;
          if (message.operation === 'credentials.get') result = await context.secrets.get(TOKEN_KEY).then(value => value ? JSON.parse(value) : null);
          else if (message.operation === 'credentials.set') {
            if (!validTokens(message.payload?.tokens)) throw new Error('拒绝保存无效的墨鱼工坊凭据。');
            await context.secrets.store(TOKEN_KEY, JSON.stringify(message.payload.tokens));
          } else if (message.operation === 'credentials.clear') await context.secrets.delete(TOKEN_KEY);
          else if (message.operation.startsWith('saveCache.')) {
            if(!runSaveStoreRequest)throw Object.assign(new Error('本机存档组件不可用。'),{code:'SAVE_LOCAL_STORAGE_UNAVAILABLE'});
            result=await runSaveStoreRequest({store:saveStore,operation:message.operation.slice(10),payload:message.payload,origin:apiUrl.origin,getTokens:async()=>{const value=await context.secrets.get(TOKEN_KEY);return value?JSON.parse(value):null;}});
          }
          else if (message.operation === 'files.cancel') { exportRequests.get(message.payload?.operationId)?.abort(); }
          else if (message.operation === 'files.download') {
            const operationId=message.payload?.operationId;
            if(typeof operationId!=='string'||operationId.length!==36||exportRequests.size)throw Object.assign(new Error('已有导出正在处理中。'),{code:'FILE_EXPORT_BUSY',retryable:true});
            const controller=new AbortController();exportRequests.set(operationId,controller);
            const timer=setTimeout(()=>controller.abort(),120000);
            try { result=await require('./media/file-export.cjs').exportNativeFile(message.payload,{vscode,apiOrigin:apiUrl.origin,signal:controller.signal,remote:Boolean(vscode.env.remoteName)}); }
            finally {clearTimeout(timer);exportRequests.delete(operationId);}
          }
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
        } catch (error) { await view.webview.postMessage({ type: 'gamehub:response', id: message.id, ok: false, error: String(error.message || error), errorCode: error.code, retryable: error.retryable===true }); }
      });
      const themeSubscription = vscode.window.onDidChangeActiveColorTheme(() => view.webview.postMessage({ type: 'gamehub:theme', theme: { mode: themeMode() } }));
      view.onDidDispose(() => { for(const controller of exportRequests.values())controller.abort(); exportRequests.clear(); subscription.dispose(); themeSubscription.dispose(); if (currentView === view) currentView = undefined; });
    },
  };
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('gamehub.platform', provider, { webviewOptions: { retainContextWhenHidden: true } }));
  context.subscriptions.push(vscode.commands.registerCommand('gamehub.open', async () => {
    try { await vscode.commands.executeCommand('gamehub.platform.focus'); }
    catch (error) { await vscode.window.showErrorMessage(String(error.message || error)); }
  }));
  context.subscriptions.push(vscode.commands.registerCommand('gamehub.openBrowser', () => openBrowser().catch(error => vscode.window.showErrorMessage(String(error.message || error)))));
  context.subscriptions.push(vscode.commands.registerCommand('gamehub.submitCreatorPackage', submitCreatorPackageFromWorkspace));
  const registerCoursewareCommand = (command, handler) => {
    context.subscriptions.push(vscode.commands.registerCommand(command, () => Promise.resolve()
      .then(handler)
      .catch(error => {
        coursewareOutput.appendLine(`${command}: ${String(error?.stack || error?.message || error)}`);
        coursewareOutput.show(true);
        return vscode.window.showErrorMessage(String(error?.message || error));
      })));
  };
  registerCoursewareCommand('gamehub.coursewareInit', createCoursewareFromTemplate);
  registerCoursewareCommand('gamehub.coursewareInspect', runCoursewareInspect);
  registerCoursewareCommand('gamehub.coursewareDoctor', runCoursewareDoctor);
  registerCoursewareCommand('gamehub.coursewarePreview', runCoursewarePreview);
  registerCoursewareCommand('gamehub.coursewareTest', runCoursewareTest);
  registerCoursewareCommand('gamehub.coursewareBuild', runCoursewareBuild);
  registerCoursewareCommand('gamehub.coursewarePackage', runCoursewarePackage);
  context.subscriptions.push(vscode.commands.registerCommand('gamehub.checkForUpdates', () => runEditorUpdateCheck(context, updateOutput, { force: true, userInitiated: true })));
  const updateTimer = setTimeout(() => void runEditorUpdateCheck(context, updateOutput, { force: true }), 15000);
  const updateInterval = setInterval(() => void runEditorUpdateCheck(context, updateOutput), UPDATE_INTERVAL_MS);
  context.subscriptions.push(updateOutput, coursewareOutput, { dispose() { clearTimeout(updateTimer); clearInterval(updateInterval); currentView = undefined; void coursewarePreview?.close(); void desktopLauncher?.close(); void saveStore?.close(); } });
}

module.exports = { activate };
