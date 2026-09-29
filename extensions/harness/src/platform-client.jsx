import React, { useEffect, useMemo } from 'react';
import App from '@gamehub/platform-client';
import { createHarnessHostAdapter } from '@gamehub/host-contract';
import { createApiClient } from '@gamehub/platform-api-client';
import legacyClient from './client.cjs';

const ID = '@gamehub/harness-plugin';
const localApiBaseUrl = () => ['127.0.0.1', 'localhost'].includes(window.location.hostname) ? 'http://127.0.0.1:3090' : '';

function HarnessPlatform({ useTabInfo }) {
  const { tab } = useTabInfo();
  const host = useMemo(() => createHarnessHostAdapter({
    signal: tab.signal,
    apiBaseUrl: window.GAMEHUB_API_BASE_URL ?? localApiBaseUrl(),
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
  }, React.createElement('style', null, PLATFORM_CSS), React.createElement(App, { hostAdapter: host, apiClient: api, routing: 'memory' }));
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
