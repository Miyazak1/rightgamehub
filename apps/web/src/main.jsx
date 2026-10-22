import React from 'react';
import { createRoot } from 'react-dom/client';
import App, { createBrowserHostAdapter } from '@gamehub/platform-client';
import '@gamehub/platform-client/styles.css';

const staleAssetRecoveryKey = 'gamehub:stale-asset-recovery';
const renderStaleAssetFailure = () => {
  const root = globalThis.document?.getElementById('root');
  if (!root) return;
  root.innerHTML = '<main style="min-height:100vh;display:grid;place-items:center;padding:24px;background:#0c0b11;color:#f7f4ff;font-family:system-ui,sans-serif"><section style="max-width:520px;border:1px solid #3b3448;padding:28px;background:#15121d"><h1 style="margin:0 0 12px;font-size:24px">页面版本已经更新</h1><p style="margin:0 0 20px;line-height:1.7;color:#c8bfd5">旧页面资源已经失效，请刷新后继续。你的账号数据和监控任务不会受到影响。</p><button id="gamehub-stale-asset-reload" type="button" style="border:0;padding:10px 16px;background:#8457f6;color:#fff;font-weight:700;cursor:pointer">重新加载</button></section></main>';
  globalThis.document.getElementById('gamehub-stale-asset-reload')?.addEventListener('click', () => globalThis.location.reload());
};
globalThis.addEventListener?.('vite:preloadError', event => {
  event.preventDefault();
  let recovered = false;
  try {
    recovered = globalThis.sessionStorage?.getItem(staleAssetRecoveryKey) === '1';
    if (!recovered) globalThis.sessionStorage?.setItem(staleAssetRecoveryKey, '1');
  } catch {}
  if (!recovered) {
    globalThis.location.reload();
    return;
  }
  renderStaleAssetFailure();
});
globalThis.setTimeout?.(() => {
  try { globalThis.sessionStorage?.removeItem(staleAssetRecoveryKey); } catch {}
}, 300000);

const query = new URLSearchParams(globalThis.location.search);
const isMcpApp = globalThis.location.pathname === '/mcp-app' && query.get('gh_host') === 'mcp-app';
const openMcpExternal = async href => {
  const url = new URL(href);
  if (url.protocol !== 'https:' || !['github.com', 'www.github.com'].includes(url.hostname)) throw new Error('External URL is not allowed.');
  globalThis.parent.postMessage({ type: 'gamehub/navigation.openExternal', href: url.href }, '*');
};
const hostAdapter = isMcpApp
  ? createBrowserHostAdapter({ host: 'mcp-app', surface: 'mcp-app', openExternal: openMcpExternal })
  : undefined;

createRoot(document.getElementById('root')).render(
  <React.StrictMode><App hostAdapter={hostAdapter} routing={isMcpApp ? 'embedded' : 'history'} /></React.StrictMode>,
);
