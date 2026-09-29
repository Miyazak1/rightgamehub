import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '@gamehub/platform-client';
import { createEditorHostAdapter } from '@gamehub/host-contract';
import { createApiClient } from '@gamehub/platform-api-client';

const vscode = acquireVsCodeApi();
const bootstrap = window.__GAMEHUB_EDITOR__ || {};
let sequence = 0;
const pending = new Map();
const themeListeners = new Set();
const bridge = {
  call(operation, payload) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timeoutMs = operation === 'desktop.prepare' ? 31 * 60 * 1000 : operation === 'desktop.launch' ? 30000 : 10000;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('宿主操作超时。')); }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      vscode.postMessage({ type: 'gamehub:request', id, operation, payload });
    });
  },
  onTheme(listener) { themeListeners.add(listener); return () => themeListeners.delete(listener); },
};
window.addEventListener('message', event => {
  const message = event.data;
  if (message?.type === 'gamehub:theme') { themeListeners.forEach(listener => listener(message.theme)); return; }
  if (message?.type !== 'gamehub:response' || !Number.isSafeInteger(message.id)) return;
  const task = pending.get(message.id); if (!task) return;
  pending.delete(message.id); clearTimeout(task.timer);
  if (message.ok) task.resolve(message.result); else task.reject(new Error(message.error || '宿主操作失败。'));
});

const host = createEditorHostAdapter({ bridge, bootstrap, apiBaseUrl: bootstrap.apiBaseUrl });
const api = createApiClient({
  baseUrl: host.apiBaseUrl,
  getAccessToken: () => host.account.getAccessToken(),
  getRefreshToken: () => host.account.getRefreshToken(),
  setTokens: tokens => host.account.setTokens(tokens),
});
const root = document.getElementById('root');
root.style.minHeight = '100vh';
createRoot(root).render(<React.StrictMode><style>{PLATFORM_CSS}</style><App hostAdapter={host} apiClient={api} routing="memory"/></React.StrictMode>);
window.addEventListener('unload', () => host.dispose(), { once: true });
