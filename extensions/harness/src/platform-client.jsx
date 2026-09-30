import React, { useEffect, useMemo, useState } from 'react';
import App from '@gamehub/platform-client';
import { createHarnessHostAdapter } from '@gamehub/host-contract';
import { createApiClient } from '@gamehub/platform-api-client';
import legacyClient from './client.cjs';

const ID = '@gamehub/harness-plugin';
const defaultApiBaseUrl = () => window.GAMEHUB_API_BASE_URL ?? 'https://mooyu.fun';
const UPDATE_CSS = `
.harness-update { min-height: 31px; padding: 6px 9px; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--gh-border); background: color-mix(in srgb,var(--gh-action) 7%,var(--gh-panel)); color: var(--gh-secondary); font: 500 9px ui-monospace,monospace; }
.harness-update__dot { width: 6px; height: 6px; flex: 0 0 auto; border-radius: 50%; background: var(--gh-action); }
.harness-update--busy .harness-update__dot { animation: harness-update-pulse 1.2s ease-in-out infinite; }
.harness-update--ready .harness-update__dot { background: var(--gh-success); }
.harness-update--failed .harness-update__dot { background: var(--gh-warning); }
.harness-update span:nth-child(2) { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.harness-update button { padding: 2px 5px; border: 0; background: transparent; color: var(--gh-secondary); font: inherit; cursor: pointer; }
.harness-update button:hover { color: var(--gh-primary); }
@keyframes harness-update-pulse { 50% { opacity: .3; transform: scale(.7); } }
`;

function HarnessUpdateNotice({ signal }) {
  const [status, setStatus] = useState(null);
  const [dismissed, setDismissed] = useState(() => window.localStorage.getItem('gamehub.harnessUpdate.dismissed') || '');
  useEffect(() => {
    let active = true;
    const read = async () => {
      try {
        const response = await window.fetch(new URL('api/gamehub/update-status', window.document.baseURI), {
          credentials: 'same-origin', cache: 'no-store', signal,
          headers: { 'X-GameHub-Update': '1' },
        });
        const value = await response.json();
        if (active && response.ok && value.ok) setStatus(value);
      } catch (error) { if (active && error?.name !== 'AbortError') setStatus(null); }
    };
    void read();
    const timer = window.setInterval(read, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [signal]);
  if (!status?.enabled || ['unavailable', 'current'].includes(status.phase)) return null;
  const dismissalKey = `${status.phase}:${status.version || ''}`;
  if (dismissed === dismissalKey) return null;
  const busy = ['checking', 'downloading', 'verifying', 'installing'].includes(status.phase);
  const labels = {
    checking: '正在后台检查 GameHub 更新…', downloading: `正在后台下载 GameHub${status.percent == null ? '…' : ` · ${status.percent}%`}`,
    verifying: '正在校验 GameHub 更新…', installing: '正在准备 GameHub 更新…',
    ready: `GameHub ${status.version || '新版'} 已准备好；可以继续工作，方便时再重启 Harness。`,
    failed: 'GameHub 更新暂未完成，后台稍后会自动重试。',
  };
  const dismiss = () => {
    window.localStorage.setItem('gamehub.harnessUpdate.dismissed', dismissalKey);
    setDismissed(dismissalKey);
  };
  return React.createElement('div', {
    className: `harness-update harness-update--${busy ? 'busy' : status.phase}`,
    role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true',
  }, React.createElement('span', { className: 'harness-update__dot', 'aria-hidden': 'true' }),
  React.createElement('span', null, status.message || labels[status.phase] || 'GameHub 正在更新。'),
  !busy && React.createElement('button', { type: 'button', onClick: dismiss, 'aria-label': '暂时隐藏更新提示' }, '稍后'));
}

function HarnessPlatform({ useTabInfo }) {
  const { tab } = useTabInfo();
  const host = useMemo(() => createHarnessHostAdapter({
    signal: tab.signal,
    apiBaseUrl: defaultApiBaseUrl(),
  }), [tab.signal]);
  const api = useMemo(() => createApiClient({
    baseUrl: host.apiBaseUrl,
    getAccessToken: () => host.account.getAccessToken(),
    getRefreshToken: () => host.account.getRefreshToken(),
    setTokens: tokens => host.account.setTokens(tokens),
  }), [host]);
  useEffect(() => () => host.dispose(), [host]);
  return React.createElement('div', {
    'data-gamehub-platform': 'true',
    style: { width: '100%', height: '100%', minWidth: 0, overflow: 'auto' },
  }, React.createElement('style', null, `${PLATFORM_CSS}\n${UPDATE_CSS}`), React.createElement(HarnessUpdateNotice, { signal: tab.signal }), React.createElement(App, { hostAdapter: host, apiClient: api, routing: 'memory' }));
}

export const inject = ['slots', 'sidebarRightTabs'];
export function apply(ctx) {
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: ID, kind: 'gamehub-platform', priority: 'extension', keepMounted: true,
    title: () => 'GameHub',
    guide: [{ id: 'gamehub-platform', order: 60, title: () => 'GameHub', description: () => '发现、发布与游玩 Agent 游戏' }],
  }), 'gamehub: register platform tab');
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: ID }, HarnessPlatform,
  )), 'gamehub: register platform body');
  legacyClient.apply(ctx);
}
