const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const vm = require('node:vm');

function fakeHarnessWindow() {
  const media = { matches: true, addEventListener() {}, removeEventListener() {} };
  class Observer { observe() {} disconnect() { this.disconnected = true; } }
  const root = { dataset: { theme: 'dark' }, className: 'agent-shell', style: {} };
  return {
    document: { documentElement: root, body: { className: '' } }, MutationObserver: Observer,
    matchMedia: query => ({ ...media, matches: query.includes('color-scheme') }),
    getComputedStyle: () => ({ getPropertyValue: name => ({ '--color-bg-base': '#101218', '--color-text-primary': '#f5f7ff', '--color-primary': '#7c5cff' })[name] ?? '' }),
  };
}

function fakeBrowserWindow() {
  const values = new Map();
  const media = { matches: false, addEventListener() {}, removeEventListener() {} };
  return {
    matchMedia: () => media,
    sessionStorage: {
      getItem: key => values.has(key) ? values.get(key) : null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: key => values.delete(key),
    },
  };
}

test('Browser adapter restores tab-session credentials after a GitHub redirect', async () => {
  const { createBrowserHostAdapter } = await import('../../packages/host-contract/src/index.mjs');
  const browserWindow = fakeBrowserWindow();
  const first = createBrowserHostAdapter({ window: browserWindow });
  await first.account.setTokens({ accessToken: 'access-token', refreshToken: 'refresh-token' });

  const afterRedirect = createBrowserHostAdapter({ window: browserWindow });
  assert.equal(await afterRedirect.account.getAccessToken(), 'access-token');
  assert.equal(await afterRedirect.account.getRefreshToken(), 'refresh-token');
  assert.equal((await afterRedirect.getCapabilities()).canPersistCredential, false);

  await afterRedirect.account.clearTokens();
  const afterLogout = createBrowserHostAdapter({ window: browserWindow });
  assert.equal(await afterLogout.account.getAccessToken(), null);
  assert.equal(await afterLogout.account.getRefreshToken(), null);
});

test('Harness adapter reports honest capabilities and keeps credentials in memory only', async () => {
  const { createHarnessHostAdapter } = await import('../../packages/host-contract/src/index.mjs');
  const controller = new AbortController();
  const adapter = createHarnessHostAdapter({ window: fakeHarnessWindow(), signal: controller.signal, apiBaseUrl: 'https://api.example' });
  const capabilities = await adapter.getCapabilities();
  assert.equal(capabilities.host, 'harness');
  assert.equal(capabilities.surface, 'sidebar');
  assert.equal(capabilities.canPersistCredential, false);
  assert.equal((await adapter.theme.getTheme()).mode, 'dark');
  assert.equal((await adapter.theme.getTheme()).colors.accent, '#7c5cff');
  await adapter.account.setTokens({ accessToken: 'session-only', refreshToken: 'refresh-only' });
  assert.equal(await adapter.account.getAccessToken(), 'session-only');
  assert.equal(await adapter.account.getRefreshToken(), 'refresh-only');
  assert.equal((await adapter.account.persistence()).kind, 'memory');
  controller.abort();
  assert.equal(await adapter.account.getAccessToken(), null);
});

test('Harness adapter restores and updates credentials through the host OS keychain bridge', async () => {
  const { createHarnessHostAdapter } = await import('../../packages/host-contract/src/index.mjs');
  let saved = { accessToken: 'a'.repeat(43), refreshToken: 'r'.repeat(43) };
  let writes = 0; let clears = 0;
  const credentialBridge = {
    async load() { return { ok: true, tokens: saved, persistence: { kind: 'os-keychain', description: '系统凭据库' } }; },
    async set(tokens) { saved = { ...tokens }; writes += 1; },
    async clear() { saved = null; clears += 1; },
  };
  const adapter = createHarnessHostAdapter({ window: fakeHarnessWindow(), credentialBridge });
  assert.equal((await adapter.getCapabilities()).canPersistCredential, true);
  assert.equal(await adapter.account.getAccessToken(), 'a'.repeat(43));
  await adapter.account.setTokens({ accessToken: 'b'.repeat(43), refreshToken: 's'.repeat(43) });
  assert.equal(writes, 1);
  assert.equal(saved.accessToken, 'b'.repeat(43));
  assert.equal((await adapter.account.persistence()).kind, 'os-keychain');
  await adapter.account.clearTokens();
  assert.equal(clears, 1);
  assert.equal(await adapter.account.getAccessToken(), null);
});

test('VS Code and Cursor adapter follows editor theme and stores credentials through SecretStorage', async () => {
  const { createEditorHostAdapter } = await import('../../packages/host-contract/src/index.mjs');
  const colors = {
    '--vscode-sideBar-background': '#101218', '--vscode-foreground': '#f5f7ff',
    '--vscode-descriptionForeground': '#a0a5b4', '--vscode-panel-border': '#343746',
    '--vscode-focusBorder': '#8b5cf6', '--vscode-button-background': '#7048d8',
    '--vscode-errorForeground': '#ff627d',
  };
  const hostWindow = {
    document: { documentElement: {} },
    getComputedStyle: () => ({ getPropertyValue: name => colors[name] ?? '' }),
  };
  let credentials = { accessToken: 'a'.repeat(43), refreshToken: 'r'.repeat(43) };
  let themeListener;
  const calls = [];
  const bridge = {
    async call(operation, payload) {
      calls.push([operation, payload]);
      if (operation === 'credentials.get') return credentials;
      if (operation === 'credentials.set') credentials = payload.tokens;
      if (operation === 'credentials.clear') credentials = null;
      return null;
    },
    onTheme(listener) { themeListener = listener; return () => { themeListener = null; }; },
  };
  const adapter = createEditorHostAdapter({
    window: hostWindow, bridge,
    bootstrap: { host: 'cursor', hostVersion: '1.7.0', remoteName: 'ssh-remote', theme: { mode: 'dark' } },
  });
  const capabilities = await adapter.getCapabilities();
  assert.equal(capabilities.host, 'cursor');
  assert.equal(capabilities.surface, 'sidebar');
  assert.equal(capabilities.fileDevice, 'remote-workspace');
  assert.equal(capabilities.canPersistCredential, true);
  assert.equal(capabilities.canLaunchDesktop, false);
  assert.equal((await adapter.theme.getTheme()).colors.accent, '#7048d8');
  let changed;
  adapter.theme.onThemeChanged(value => { changed = value; });
  themeListener({ mode: 'high-contrast' });
  assert.equal(changed.mode, 'high-contrast');
  assert.equal(await adapter.account.getAccessToken(), 'a'.repeat(43));
  await adapter.account.setTokens({ accessToken: 'b'.repeat(43), refreshToken: 's'.repeat(43) });
  assert.equal(credentials.accessToken, 'b'.repeat(43));
  await adapter.account.clearTokens();
  assert.equal(credentials, null);
  await adapter.navigation.openExternal('https://github.com/login/oauth/authorize');
  assert.equal((await adapter.account.persistence()).kind, 'secret-storage');
  assert.equal((await adapter.diagnostics.snapshot()).remoteName, 'ssh-remote');
  assert.deepEqual(calls.map(([operation]) => operation), ['credentials.get', 'credentials.set', 'credentials.clear', 'external.open']);
  adapter.dispose();
  assert.equal(themeListener, null);
});

test('VS Code extension uses the shared GameHub client and a trusted credential bridge', async () => {
  const manifest = JSON.parse(await readFile('extensions/vscode/package.json', 'utf8'));
  const extension = await readFile('extensions/vscode/gamehub-extension.cjs', 'utf8');
  const entry = await readFile('extensions/vscode/src/platform-client.jsx', 'utf8');
  assert.equal(manifest.main, './gamehub-extension.cjs');
  assert.equal(manifest.contributes.views.gamehub[0].id, 'gamehub.platform');
  assert.equal(manifest.contributes.configuration.properties['gamehub.apiUrl'].default, 'https://mooyu.fun');
  assert.equal(manifest.contributes.configuration.properties['gamehub.browserUrl'].default, 'https://mooyu.fun/');
  assert.match(extension, /context\.secrets\.get/);
  assert.match(extension, /context\.secrets\.store/);
  assert.match(extension, /context\.secrets\.delete/);
  assert.match(extension, /vscode\.env\.openExternal/);
  assert.match(extension, /\['github\.com', 'www\.github\.com'\]/);
  assert.match(extension, /registerWebviewViewProvider/);
  assert.match(extension, /require\('node:https'\)/);
  assert.match(extension, /ProgressLocation\.Notification/);
  assert.match(extension, /正在检查服务器版本/);
  assert.match(extension, /desktopLauncher\.restore/);
  assert.doesNotMatch(extension, /\bfetch\s*\(/);
  assert.match(extension, /spawn\(command, args, \{ shell: false, windowsHide: true/);
  assert.match(extension, /\['ENOSERVERS', 'ENOTFOUND', 'EAI_AGAIN'\]/);
  assert.doesNotMatch(extension, /workspace\.fs\.readFile|createTerminal|shell: true/);
  assert.match(entry, /createEditorHostAdapter/);
  assert.match(entry, /routing="memory"/);
});

test('API upload transport scopes the grant and reports trusted byte progress', async () => {
  const { createApiClient } = await import('../../packages/platform-api-client/src/index.mjs');
  let xhr;
  class FakeXhr {
    constructor() { xhr = this; this.upload = {}; this.headers = {}; }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(name, value) { this.headers[name] = value; }
    send(file) { this.file = file; this.upload.onprogress({ lengthComputable: true, loaded: 3, total: 4 }); this.status = 200; this.responseText = JSON.stringify({ data: { state: 'uploaded' } }); this.onload(); this.onloadend(); }
  }
  const client = createApiClient({ baseUrl: 'https://api.example', xhrFactory: () => new FakeXhr() });
  const progress = [];
  const result = await client.uploadContent('c5d257f6-5d86-4189-9b08-ef40fd758bc4', { type: 'application/zip' }, 'grant-secret', { onProgress: value => progress.push(value.percent) });
  assert.equal(xhr.method, 'PUT');
  assert.match(xhr.url, /\/v1\/creator\/uploads\/.+\/content$/);
  assert.equal(xhr.headers.Authorization, 'Upload grant-secret');
  assert.deepEqual(progress, [75]);
  assert.equal(result.data.state, 'uploaded');
});

test('official Harness bundle registers platform and local-lab entries without bundling React', async () => {
  const bundle = await readFile('extensions/harness/lib/client.js', 'utf8');
  assert.match(bundle, /gamehub-platform/);
  assert.match(bundle, /gamehub-local-lab/);
  assert.match(bundle, /GAMEHUB LOCAL LAB/);
  assert.match(bundle, /GAMEHUB ACCOUNT/);
  assert.match(bundle, /require\("react"\)/);
  assert.doesNotMatch(bundle, /react-dom/);
  assert.doesNotThrow(() => new vm.Script(bundle));
});

test('shared client scopes theme writes and responds to its sidebar container', async () => {
  const app = await readFile('packages/platform-client/src/App.jsx', 'utf8');
  const css = await readFile('packages/platform-client/src/styles.css', 'utf8');
  assert.match(app, /applyThemeTokens\(themeRoot\.current, theme\)/);
  assert.doesNotMatch(app, /applyThemeTokens\(document\.documentElement/);
  assert.match(css, /container-type:\s*inline-size/);
  assert.match(css, /@container \(max-width: 767px\)/);
  assert.match(css, /@container \(max-width: 479px\)/);
  assert.match(app, /休息一下？/);
  assert.match(app, /globalThis\.scrollTo/);
  assert.match(css, /\.mobile-nav \{ position: sticky/);
  assert.doesNotMatch(app, /PLAY SOMETHING NEW/);
  assert.match(app, /game-covers-pixel-v1-optimized\.png/);
  assert.match(css, /image-rendering:\s*pixelated/);
  assert.match(app, /data-host=\{hostIdentity\.id\}/);
  assert.match(app, /当前宿主：/);
  assert.doesNotMatch(app, /Astra|Sol|Luna|Sage/);
  assert.doesNotMatch(app, /setAccent/);
  assert.match(app, /今日摸鱼/);
  assert.match(app, /function DailyPick/);
  assert.match(app, /function SocialPage/);
  assert.match(app, /ASYNC BREAK ROOM/);
  assert.match(app, /api\.blockUser/);
  assert.match(app, /function ChallengePage/);
  assert.match(app, /api\.reactToGuessBaikeResult/);
  assert.match(app, /api\.listSocialNotifications/);
  assert.match(app, /复制成绩卡/);
  assert.match(app, /发起挑战/);
  assert.doesNotMatch(app, /私信|群聊|聊天室/);
  assert.match(css, /\.daily-grid/);
  assert.match(css, /bottom:\s*10px/);
  assert.doesNotMatch(app, /className="break-modes"/);
  assert.match(app, /不读取项目文件与宿主凭据/);
  assert.match(app, /function GitHubLogo\(\)/);
  assert.match(app, /startGitHubWeb/);
  assert.match(app, /github-web/);
  assert.match(app, /无法跳转？使用设备码/);
  assert.doesNotMatch(app, />GH<\/span>/);
  assert.match(css, /Pixel workbench/);
  assert.match(css, /\.detail-hero \{ margin-top: 12px/);
  assert.match(css, /\.detail-hero \.art__pixel \{ background-size: 200% 200%; \}/);
  assert.match(css, /\.daily-pick__body > button \{ height: 36px/);
  assert.match(app, /function InstallPage/);
  assert.match(app, /添加到你的 Agent/);
  assert.match(app, /-HostName codex/);
  assert.match(app, /-HostName claude/);
  assert.match(app, /claude plugin install gamehub@gamehub/);
  assert.doesNotMatch(app, /Miyazak1\/rightgamehub/);
  assert.match(app, /https:\/\/mooyu\.fun\/install\.ps1/);
  assert.match(app, /https:\/\/mooyu\.fun\/install\.sh/);
  assert.match(app, /不要克隆源码仓库/);
  assert.match(app, /SHA-256/);
  assert.doesNotMatch(app, /command: 'cursor --install-extension gamehub-agent\.vsix'/);
  assert.match(css, /\.agent-install-grid/);
});

test('Harness navigation remains inside the plugin surface', async () => {
  const app = await readFile('packages/platform-client/src/App.jsx', 'utf8');
  const entry = await readFile('extensions/harness/src/platform-client.jsx', 'utf8');
  assert.match(app, /function useRoute\(mode\)/);
  assert.match(app, /mode === 'hash'/);
  assert.doesNotMatch(app, /history\.back\(\)/);
  assert.match(entry, /routing: 'memory'/);
  assert.match(entry, /https:\/\/mooyu\.fun/);
  assert.match(entry, /GAMEHUB_API_BASE_URL/);
  assert.match(app, /\['created', 'receiving'\]\.includes\(data\.state\)/);
  assert.match(app, /data\.state === 'uploaded'/);
  assert.match(app, /\['127\.0\.0\.1', 'localhost'\]\.includes\(location\.hostname\)/);
});


test('portable Agent plugin manifests keep Codex and Claude Code installable', async () => {
  const portable = JSON.parse(await readFile('plugins/gamehub/plugin.json', 'utf8'));
  const codexMarketplace = JSON.parse(await readFile('.agents/plugins/marketplace.json', 'utf8'));
  const claudeManifest = JSON.parse(await readFile('plugins/gamehub/.claude-plugin/plugin.json', 'utf8'));
  const claudeMarketplace = JSON.parse(await readFile('.claude-plugin/marketplace.json', 'utf8'));
  assert.equal(portable.name, 'gamehub');
  assert.equal(codexMarketplace.plugins[0].source.path, './plugins/gamehub');
  assert.equal(codexMarketplace.plugins[0].policy.authentication, 'ON_INSTALL');
  assert.equal(claudeManifest.name, 'gamehub');
  assert.equal(claudeMarketplace.owner.name, 'GameHub');
  assert.equal(claudeMarketplace.plugins[0].source, './plugins/gamehub');
});


test('official editor installers use verified mooyu.fun artifacts without source checkout', async () => {
  const rootPackage = JSON.parse(await readFile('package.json', 'utf8'));
  const dockerfile = await readFile('deploy/Dockerfile.web', 'utf8');
  const packer = await readFile('scripts/package-vscode-extension.mjs', 'utf8');
  const downloads = await readFile('scripts/prepare-agent-downloads.mjs', 'utf8');
  const powershell = await readFile('apps/web/public/install.ps1', 'utf8');
  const shell = await readFile('apps/web/public/install.sh', 'utf8');
  assert.match(rootPackage.scripts['pack:vscode'], /package-vscode-extension\.mjs/);
  assert.match(dockerfile, /prepare-agent-downloads\.mjs/);
  assert.match(packer, /0x06054b50/);
  assert.match(downloads, /createHash\('sha256'\)/);
  assert.match(downloads, /harnessPlugin/);
  assert.match(downloads, /agentPlugin/);
  assert.match(downloads, /contentBase64/);
  assert.match(powershell, /Get-FileHash -Algorithm SHA256/);
  assert.match(powershell, /dsh plugin --profile web add/);
  assert.match(powershell, /plugin marketplace add/);
  assert.match(powershell, /claude plugin install gamehub@gamehub/);
  assert.match(powershell, /--install-extension/);
  assert.match(shell, /createHash\('sha256'\)/);
  assert.match(shell, /--install-extension/);
  assert.match(shell, /dsh plugin --profile web add/);
  assert.match(shell, /plugin marketplace add/);
  assert.match(shell, /claude plugin install gamehub@gamehub/);
  assert.doesNotMatch(powershell, /github\.com/);
  assert.doesNotMatch(shell, /github\.com/);
});

test('Cursor self-update installs the verified VSIX before reporting restart readiness', async () => {
  const extension = await readFile('extensions/vscode/gamehub-extension.cjs', 'utf8');
  const manifest = JSON.parse(await readFile('extensions/vscode/package.json', 'utf8'));
  assert.equal(manifest.version, '0.3.19');
  assert.match(extension, /path\.join\(path\.dirname\(process\.execPath\), 'resources', 'app', 'out', 'cli\.js'\)/);
  assert.match(extension, /ELECTRON_RUN_AS_NODE: '1'/);
  assert.match(extension, /runHidden\(cli\.command, \[\.\.\.cli\.args,'--install-extension',target\.fsPath,'--force'\]/);
  assert.doesNotMatch(extension, /runHidden\(process\.execPath, \['--install-extension'/);
  assert.match(extension, /windowsHide: true/);
  assert.match(extension, /extensionInstallPresent\(context, item\)/);
  assert.match(extension, /已确认安装，等待重启生效/);
  assert.match(extension, /跳过重复下载/);
  assert.match(extension, /downloadUpdateBytesWithPowerShell/);
  assert.doesNotMatch(extension, /workbench\.extensions\.installExtension/);
});

test('Cursor webview CSP permits only the configured API and its realtime socket', async () => {
  const extension = await readFile('extensions/vscode/gamehub-extension.cjs', 'utf8');
  assert.match(extension, /const realtimeSources = localApi \? 'ws:\/\/127\.0\.0\.1:3093 ws:\/\/localhost:3093' : `wss:\/\/\$\{apiUrl\.host\}`/);
  assert.match(extension, /connect-src \$\{apiUrl\.origin\} \$\{realtimeSources\}/);
  assert.doesNotMatch(extension, /connect-src \*/);
});

test('the packaged Cursor client contains the multiplayer host bridge', async () => {
  const bundle = await readFile('extensions/vscode/media/gamehub.js', 'utf8');
  assert.match(bundle, /createWebGameMultiplayerHost/);
  assert.match(bundle, /createBridge:/);
  assert.match(bundle, /gamehub\.bridge\.ready/);
  assert.match(bundle, /multiplayer\.rooms\.invite/);
  assert.match(bundle, /createMultiplayerInvite/);
});
