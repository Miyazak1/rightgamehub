import React from 'react';
import { createRoot } from 'react-dom/client';
import App, { createBrowserHostAdapter } from '../../../packages/platform-client/src/App.jsx';
import '../../../packages/platform-client/src/styles.css';
import { createPreviewApi } from './preview-api.mjs';
import './preview.css';
import { DesktopLeading, DesktopActions } from './DesktopChrome.jsx';
import { createDesktopAccountAdapter } from './account-adapter.mjs';

const browser = createBrowserHostAdapter({ host: 'desktop-app', surface: 'desktop-window' });
const env = await globalThis.mooyuDesktop.environment();
const previewApi = createPreviewApi({ fixtureOrigin: env.fixtureOrigin });
const session = env.accountConfigured ? createDesktopAccountAdapter(globalThis.mooyuDesktop.account) : null;
const api = session ? new Proxy(previewApi, { get(target, key) { return Object.hasOwn(session.api, key) ? session.api[key] : target[key]; } }) : previewApi;
const Actions = props => <DesktopActions {...props} environment={env}/>;
const host = { ...browser, ...(session ? { account: session.account, navigation: session.navigation } : {}), chrome: { Leading: DesktopLeading, Actions }, apiBaseUrl: env.fixtureOrigin, runtimeDomain: 'localhost', async getCapabilities() {
  const capabilities = await browser.getCapabilities();
  if (session) delete capabilities.unavailableReasons.canPersistCredential;
  return { ...capabilities, host: env.host, hostVersion: env.version, uiDevice: 'desktop', surface: 'desktop-window',
    canPersistCredential: !!session };
} };
createRoot(document.getElementById('root')).render(<React.StrictMode>
  <App hostAdapter={host} apiClient={api} routing="history" demo={false}/>
</React.StrictMode>);
