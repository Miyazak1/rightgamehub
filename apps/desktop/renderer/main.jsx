import React from 'react';
import { createRoot } from 'react-dom/client';
import App, { createBrowserHostAdapter } from '../../../packages/platform-client/src/App.jsx';
import '../../../packages/platform-client/src/styles.css';
import { createPreviewApi } from './preview-api.mjs';
import './preview.css';
import { DesktopLeading, DesktopActions } from './DesktopChrome.jsx';
import { createDesktopAccountAdapter } from './account-adapter.mjs';
import { createDesktopBusinessApi } from './business-api.mjs';
import { createDesktopMultiplayerFactory } from './realtime-adapter.mjs';
import { createDesktopFileExporter } from './file-adapter.mjs';

const browser = createBrowserHostAdapter({ host: 'desktop-app', surface: 'desktop-window' });
let env;
try { env = await globalThis.mooyuDesktop.environment(); }
catch (error) {
  const message = document.querySelector('[data-startup-message]');
  if (message) { message.textContent = '客户端启动未完成，请关闭后重新打开。'; message.setAttribute('role', 'alert'); }
  throw error;
}
const baseApi = env.accountConfigured ? createDesktopBusinessApi(globalThis.mooyuDesktop.account, env.accountApiOrigin)
  : createPreviewApi({ fixtureOrigin: env.fixtureOrigin });
const session = env.accountConfigured ? createDesktopAccountAdapter(globalThis.mooyuDesktop.account) : null;
const api = session ? new Proxy(baseApi, { get(target, key) { return Object.hasOwn(session.api, key) ? session.api[key] : target[key]; } }) : baseApi;
const Actions = props => <DesktopActions {...props} environment={env}/>;
const host = { ...browser, files: createDesktopFileExporter(globalThis.mooyuDesktop.files), multiplayerSessionFactory: createDesktopMultiplayerFactory(globalThis.mooyuDesktop.realtime, env.accountApiOrigin || env.fixtureOrigin), saveOrigin: env.accountApiOrigin || env.fixtureOrigin, learningRuntimeOrigin: env.fixtureOrigin, ...(session ? { account: session.account, navigation: session.navigation } : {}), chrome: { Leading: DesktopLeading, Actions }, apiBaseUrl: env.accountApiOrigin || env.fixtureOrigin, runtimeDomain: env.businessRuntime?.domain || 'localhost', async getCapabilities() {
  const capabilities = await browser.getCapabilities();
  if (session) delete capabilities.unavailableReasons.canPersistCredential;
  return { ...capabilities, host: env.host, hostVersion: env.version, uiDevice: 'desktop', surface: 'desktop-window',
    canPersistCredential: !!session };
} };
createRoot(document.getElementById('root')).render(<React.StrictMode>
  <App hostAdapter={host} apiClient={api} routing="history" demo={false}/>
</React.StrictMode>);
