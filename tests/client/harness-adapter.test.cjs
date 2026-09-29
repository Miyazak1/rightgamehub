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
  assert.doesNotMatch(extension, /child_process|workspace\.fs\.readFile|createTerminal/);
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
  assert.match(app, /codex plugin marketplace add Miyazak1\/rightgamehub/);
  assert.match(app, /claude plugin install gamehub@gamehub/);
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
