import React from 'react';
import { createRoot } from 'react-dom/client';
import App, { createBrowserHostAdapter } from '@gamehub/platform-client';
import '@gamehub/platform-client/styles.css';

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
