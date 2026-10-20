export const SPREADSHEET_AUDIT_SUBMIT = 'gamehub/spreadsheet-audit.submit';
export const SPREADSHEET_AUDIT_STATUS = 'gamehub/spreadsheet-audit.status';

export function isEmbeddedAgentTool(locationImpl = globalThis.location) {
  if (!locationImpl) return false;
  const query = new URLSearchParams(locationImpl.search || '');
  return locationImpl.pathname === '/mcp-app' && query.get('gh_host') === 'mcp-app';
}

export function submitSpreadsheetAudit(payload, { parentWindow = globalThis.parent, currentWindow = globalThis, cryptoImpl = globalThis.crypto } = {}) {
  if (!parentWindow?.postMessage || parentWindow === currentWindow) return null;
  const requestId = cryptoImpl?.randomUUID?.() || `audit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  parentWindow.postMessage({ type: SPREADSHEET_AUDIT_SUBMIT, requestId, payload }, '*');
  return requestId;
}

export function subscribeSpreadsheetAuditStatus(handler, { parentWindow = globalThis.parent, windowImpl = globalThis } = {}) {
  if (!windowImpl?.addEventListener) return () => {};
  const onMessage = event => {
    if (event.source !== parentWindow || event.data?.type !== SPREADSHEET_AUDIT_STATUS) return;
    handler(event.data);
  };
  windowImpl.addEventListener('message', onMessage);
  return () => windowImpl.removeEventListener('message', onMessage);
}
