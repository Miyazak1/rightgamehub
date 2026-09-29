const MODES = new Set(['light', 'dark', 'high-contrast']);
const HEX = /^#[0-9a-f]{6}$/i;

export function normalizeTheme(input = {}) {
  const mode = MODES.has(input.mode) ? input.mode : 'dark';
  const colors = Object.fromEntries(Object.entries(input.colors ?? {}).filter(([, value]) => HEX.test(value)));
  return { mode, colors };
}

export function createBrowserHostAdapter({ window: browserWindow = globalThis.window } = {}) {
  const listeners = new Set();
  const media = browserWindow?.matchMedia?.('(prefers-color-scheme: dark)');
  let override = 'system';
  let accent = '#8b5cf6';
  let credentials = null;
  const current = () => normalizeTheme({
    mode: override === 'system' ? (media?.matches ? 'dark' : 'light') : override,
    colors: { accent },
  });
  const emit = () => listeners.forEach(listener => listener(current()));
  const mediaChanged = () => override === 'system' && emit();
  media?.addEventListener?.('change', mediaChanged);
  return {
    async getCapabilities() {
      return {
        protocolVersion: 1, host: 'browser', hostVersion: '1', surface: 'embedded-browser',
        uiDevice: 'browser', fileDevice: 'browser-managed', runDevice: 'none',
        canSelectFile: true, canManageDownloads: false, canRevealDownload: false,
        canPersistCredential: false, canPlayWeb: true, canLaunchDesktop: false,
        canPlayNativeInPanel: false,
        unavailableReasons: { canLaunchDesktop: '桌面游戏需在受信任的宿主中启动。' },
      };
    },
    theme: {
      async getTheme() { return current(); },
      onThemeChanged(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      setPreference(value) { override = ['system', 'light', 'dark', 'high-contrast'].includes(value) ? value : 'system'; emit(); },
      setAccent(value) { if (HEX.test(value)) { accent = value; emit(); } },
      dispose() { media?.removeEventListener?.('change', mediaChanged); listeners.clear(); },
    },
    account: {
      async getAccessToken() { return credentials?.accessToken ?? null; },
      async getRefreshToken() { return credentials?.refreshToken ?? null; },
      async getTokens() { return credentials ? { ...credentials } : null; },
      async setTokens(tokens) { credentials = tokens ? { ...tokens } : null; },
      async clearTokens() { credentials = null; },
    },
  };
}

const firstCssColor = (styles, names) => {
  for (const name of names) {
    const value = styles.getPropertyValue(name).trim();
    if (HEX.test(value)) return value;
  }
  return undefined;
};

const harnessCredentialBridge = hostWindow => {
  if (!hostWindow?.fetch || !hostWindow.document?.baseURI) return null;
  const url = new URL('api/gamehub/credentials', hostWindow.document.baseURI).href;
  const call = async (method, tokens) => {
    const response = await hostWindow.fetch(url, {
      method, credentials: 'same-origin', cache: 'no-store',
      headers: { 'X-GameHub-Credentials': '1', ...(tokens ? { 'Content-Type': 'application/json' } : {}) },
      ...(tokens ? { body: JSON.stringify({ tokens }) } : {}),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Harness credential store is unavailable.');
    return result;
  };
  return { load: () => call('GET'), set: tokens => call('PUT', tokens), clear: () => call('DELETE') };
};

export function createHarnessHostAdapter({ window: hostWindow = globalThis.window, signal, apiBaseUrl = '', credentialBridge } = {}) {
  if (!hostWindow?.document) throw new Error('Harness adapter requires a window.');
  const listeners = new Set();
  let credentials = null;
  let credentialsLoaded = false;
  let loadPromise = null;
  let credentialPersistence = { kind: 'memory', description: '凭据仅保留到 Harness 本次运行结束。' };
  const bridge = credentialBridge === undefined ? harnessCredentialBridge(hostWindow) : credentialBridge;
  const ensureCredentials = async () => {
    if (credentialsLoaded) return;
    if (!loadPromise) loadPromise = (async () => {
      try {
        if (bridge) {
          const result = await bridge.load();
          credentials = result.tokens ? { ...result.tokens } : null;
          if (result.persistence?.kind === 'os-keychain') credentialPersistence = result.persistence;
        }
      } catch { credentialPersistence = { kind: 'memory', description: '系统凭据库不可用，凭据仅保留到 Harness 本次运行结束。' }; }
      credentialsLoaded = true;
    })();
    await loadPromise;
  };
  const root = hostWindow.document.documentElement;
  const darkMedia = hostWindow.matchMedia?.('(prefers-color-scheme: dark)');
  const contrastMedia = hostWindow.matchMedia?.('(prefers-contrast: more)');
  const readTheme = () => {
    const marker = `${root.dataset.theme ?? ''} ${root.className ?? ''} ${hostWindow.document.body?.className ?? ''}`.toLowerCase();
    const mode = marker.includes('high-contrast') || contrastMedia?.matches ? 'high-contrast' : marker.includes('light') ? 'light' : marker.includes('dark') || darkMedia?.matches ? 'dark' : 'light';
    const styles = hostWindow.getComputedStyle(root);
    return normalizeTheme({ mode, colors: {
      background: firstCssColor(styles, ['--color-bg-base', '--background-color', '--vscode-sideBar-background']),
      foreground: firstCssColor(styles, ['--color-text-primary', '--text-color', '--vscode-foreground']),
      mutedForeground: firstCssColor(styles, ['--color-text-secondary', '--vscode-descriptionForeground']),
      border: firstCssColor(styles, ['--color-border', '--vscode-panel-border']),
      focusRing: firstCssColor(styles, ['--color-primary', '--vscode-focusBorder']),
      accent: firstCssColor(styles, ['--color-primary', '--accent-color', '--vscode-button-background']),
      danger: firstCssColor(styles, ['--color-danger', '--vscode-errorForeground']),
    } });
  };
  const emit = () => { const theme = readTheme(); listeners.forEach(listener => listener(theme)); };
  const observer = new hostWindow.MutationObserver(emit);
  observer.observe(root, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
  if (hostWindow.document.body) observer.observe(hostWindow.document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
  darkMedia?.addEventListener?.('change', emit); contrastMedia?.addEventListener?.('change', emit);
  const dispose = () => { observer.disconnect(); darkMedia?.removeEventListener?.('change', emit); contrastMedia?.removeEventListener?.('change', emit); listeners.clear(); credentials = null; };
  const desktopRequest = async (action, release) => {
    const url = new URL(`api/gamehub/platform-desktop-${action}`, hostWindow.document.baseURI).href;
    const response = await hostWindow.fetch(url, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', signal,
      headers: { 'Content-Type': 'application/json', 'X-GameHub-Client': '1', 'X-GameHub-Launch': 'independent-window-v1' },
      body: JSON.stringify(release),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error || (action === 'run' ? 'Windows 游戏未能启动。' : 'Windows 游戏未能下载。'));
    return result;
  };
  const getDesktopReleaseStatus = release => desktopRequest('status', release);
  const prepareDesktopRelease = async (release, { onProgress } = {}) => {
    let finished = false;
    const poll = (async () => {
      while (!finished) {
        await new Promise(resolve => hostWindow.setTimeout(resolve, 250));
        if (finished) break;
        try { onProgress?.((await getDesktopReleaseStatus(release)).download); } catch {}
      }
    })();
    try {
      const result = await desktopRequest('prepare', release);
      onProgress?.(result.progress || { state: 'ready', receivedBytes: release.sizeBytes, totalBytes: release.sizeBytes, percent: 100, error: null });
      return result;
    } finally { finished = true; await poll; }
  };
  const launchDesktopRelease = release => desktopRequest('run', release);
  signal?.addEventListener?.('abort', dispose, { once: true });
  return {
    apiBaseUrl,
    async getCapabilities() {
      await ensureCredentials();
      return {
        protocolVersion: 1, host: 'harness', hostVersion: '0.1.7-alpha.1', surface: 'sidebar',
        uiDevice: 'harness-ui', fileDevice: 'host-device', runDevice: 'host-device',
        canSelectFile: true, canManageDownloads: true, canRevealDownload: false,
        canPersistCredential: credentialPersistence.kind === 'os-keychain', canPlayWeb: true, canLaunchDesktop: true,
        canPlayNativeInPanel: false,
        unavailableReasons: { ...(credentialPersistence.kind === 'os-keychain' ? {} : { canPersistCredential: credentialPersistence.description }), canPlayNativeInPanel: '普通 EXE 在独立窗口启动。' },
      };
    },
    theme: {
      async getTheme() { return readTheme(); },
      onThemeChanged(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    },
    desktop: { getReleaseStatus: getDesktopReleaseStatus, prepareRelease: prepareDesktopRelease, launchRelease: launchDesktopRelease },
    account: {
      async getAccessToken() { await ensureCredentials(); return credentials?.accessToken ?? null; },
      async getRefreshToken() { await ensureCredentials(); return credentials?.refreshToken ?? null; },
      async getTokens() { await ensureCredentials(); return credentials ? { ...credentials } : null; },
      async setTokens(tokens) {
        await ensureCredentials(); credentials = tokens ? { ...tokens } : null;
        if (tokens && bridge && credentialPersistence.kind === 'os-keychain') {
          try { await bridge.set(tokens); }
          catch { credentialPersistence = { kind: 'memory', description: '系统凭据库写入失败，凭据仅保留到 Harness 本次运行结束。' }; }
        }
      },
      async clearTokens() {
        await ensureCredentials(); credentials = null;
        if (bridge && credentialPersistence.kind === 'os-keychain') {
          try { await bridge.clear(); }
          catch { credentialPersistence = { kind: 'memory', description: '系统凭据库清理失败；服务端会话已退出。' }; }
        }
      },
      async persistence() { await ensureCredentials(); return { ...credentialPersistence }; },
    },
    diagnostics: { async snapshot() { await ensureCredentials(); return { host: 'harness', surface: 'sidebar', theme: readTheme().mode, credentialPersistence: credentialPersistence.kind }; } },
    dispose,
  };
}

export function createEditorHostAdapter({ window: hostWindow = globalThis.window, bridge, bootstrap = {}, signal, apiBaseUrl = 'http://127.0.0.1:3090' } = {}) {
  if (!hostWindow?.document || !bridge?.call) throw new Error('Editor adapter requires a webview window and a trusted message bridge.');
  const host = bootstrap.host === 'cursor' ? 'cursor' : 'vscode';
  const listeners = new Set();
  let mode = MODES.has(bootstrap.theme?.mode) ? bootstrap.theme.mode : 'dark';
  const root = hostWindow.document.documentElement;
  const readTheme = () => {
    const styles = hostWindow.getComputedStyle(root);
    return normalizeTheme({ mode, colors: {
      background: firstCssColor(styles, ['--vscode-sideBar-background','--vscode-editor-background']),
      foreground: firstCssColor(styles, ['--vscode-foreground']),
      mutedForeground: firstCssColor(styles, ['--vscode-descriptionForeground']),
      border: firstCssColor(styles, ['--vscode-panel-border','--vscode-widget-border']),
      focusRing: firstCssColor(styles, ['--vscode-focusBorder']),
      accent: firstCssColor(styles, ['--vscode-button-background','--vscode-textLink-foreground']),
      danger: firstCssColor(styles, ['--vscode-errorForeground']),
    } });
  };
  const offTheme = bridge.onTheme?.(theme => {
    mode = MODES.has(theme?.mode) ? theme.mode : mode;
    const current = readTheme(); listeners.forEach(listener => listener(current));
  }) ?? (() => {});
  const dispose = () => { offTheme(); listeners.clear(); };
  signal?.addEventListener?.('abort', dispose, { once: true });
  return {
    apiBaseUrl,
    async getCapabilities() {
      return {
        protocolVersion: 1, host, hostVersion: String(bootstrap.hostVersion || 'unknown'), surface: 'sidebar',
        uiDevice: 'editor-ui', fileDevice: bootstrap.remoteName ? 'remote-workspace' : 'ui-device', runDevice: 'ui-device',
        canSelectFile: true, canManageDownloads: false, canRevealDownload: false,
        canPersistCredential: true, canPlayWeb: true, canLaunchDesktop: false, canPlayNativeInPanel: false,
        unavailableReasons: {
          canManageDownloads: '下载管理尚未接入编辑器文件系统。',
          canLaunchDesktop: '编辑器适配器当前仅运行隔离的 Web 作品。',
          canPlayNativeInPanel: '原生程序不能在 Webview 中运行。',
        },
      };
    },
    theme: { async getTheme() { return readTheme(); }, onThemeChanged(listener) { listeners.add(listener); return () => listeners.delete(listener); } },
    account: {
      async getAccessToken() { return (await bridge.call('credentials.get'))?.accessToken ?? null; },
      async getRefreshToken() { return (await bridge.call('credentials.get'))?.refreshToken ?? null; },
      async getTokens() { const value = await bridge.call('credentials.get'); return value ? { ...value } : null; },
      async setTokens(tokens) { await bridge.call('credentials.set', { tokens }); },
      async clearTokens() { await bridge.call('credentials.clear'); },
      async persistence() { return { kind: 'secret-storage', description: `${host === 'cursor' ? 'Cursor' : 'VS Code'} SecretStorage` }; },
    },
    navigation: { async openExternal(url) { return bridge.call('external.open', { url }); } },
    diagnostics: { async snapshot() { return { host, hostVersion: String(bootstrap.hostVersion || 'unknown'), surface: 'sidebar', theme: readTheme().mode, credentialPersistence: 'secret-storage', remoteName: bootstrap.remoteName || null }; } },
    dispose,
  };
}

export function themeToTokens(theme) {
  const safe = normalizeTheme(theme);
  const defaults = safe.mode === 'light' ? {
    canvas: '#f4f4f7', panel: '#ffffff', raised: '#fafafd', primary: '#17151f', secondary: '#625f6d', border: '#dedce5', action: '#6d36d8', hover: '#5925bd', success: '#16794a', warning: '#9a5a00', danger: '#c6334f', focus: '#6d36d8', glow: '#8b5cf6', onAction: '#ffffff',
  } : safe.mode === 'high-contrast' ? {
    canvas: '#000000', panel: '#000000', raised: '#101010', primary: '#ffffff', secondary: '#ffffff', border: '#ffffff', action: '#ffff00', hover: '#ffffff', success: '#00ff83', warning: '#ffff00', danger: '#ff5370', focus: '#00ffff', glow: '#ffff00', onAction: '#000000',
  } : {
    canvas: '#0c0b11', panel: '#15131d', raised: '#1d1a28', primary: '#f7f4ff', secondary: '#aaa4b9', border: '#343040', action: '#9b6cff', hover: '#ae8aff', success: '#4fd49a', warning: '#ffbd5b', danger: '#ff6f87', focus: '#c5a8ff', glow: '#8b5cf6', onAction: '#130d1e',
  };
  const c = safe.colors;
  const rgb = value => value.match(/[0-9a-f]{2}/gi).map(part => Number.parseInt(part, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  const luminance = value => { const [r, g, b] = rgb(value); return .2126 * r + .7152 * g + .0722 * b; };
  const contrast = (a, b) => { const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (light + .05) / (dark + .05); };
  const canvas = c.background ?? defaults.canvas;
  const requestedAccent = c.accent;
  const action = safe.mode !== 'high-contrast' && requestedAccent && contrast(requestedAccent, canvas) >= 3 ? requestedAccent : defaults.action;
  const onAction = contrast(action, '#ffffff') >= 4.5 ? '#ffffff' : '#000000';
  return {
    ...defaults,
    canvas,
    primary: c.foreground ?? defaults.primary,
    secondary: c.mutedForeground ?? defaults.secondary,
    border: c.border ?? defaults.border,
    action,
    focus: c.focusRing ?? c.accent ?? defaults.focus,
    glow: requestedAccent ?? defaults.glow,
    danger: c.danger ?? defaults.danger,
    onAction,
  };
}

export function applyThemeTokens(root, theme) {
  const tokens = themeToTokens(theme);
  root.dataset.theme = normalizeTheme(theme).mode;
  for (const [key, value] of Object.entries(tokens)) root.style.setProperty(`--gh-${key}`, value);
  root.style.colorScheme = theme.mode === 'light' ? 'light' : 'dark';
  return tokens;
}
