export const SPREADSHEET_AUDIT_SUBMIT = 'gamehub/spreadsheet-audit.submit';
export const SPREADSHEET_AUDIT_STATUS = 'gamehub/spreadsheet-audit.status';
export const PDF_READER_CONTEXT = 'gamehub/pdf-reader.context';
export const PDF_READER_STATUS = 'gamehub/pdf-reader.status';
export const CHANGE_RADAR_CONTEXT = 'gamehub/change-radar.context';
export const CHANGE_RADAR_STATUS = 'gamehub/change-radar.status';

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

export function syncPdfReaderContext(payload, { parentWindow = globalThis.parent, currentWindow = globalThis } = {}) {
  if (!parentWindow?.postMessage || parentWindow === currentWindow) return false;
  parentWindow.postMessage({ type: PDF_READER_CONTEXT, payload }, '*');
  return true;
}

export function subscribePdfReaderStatus(handler, { parentWindow = globalThis.parent, windowImpl = globalThis } = {}) {
  if (!windowImpl?.addEventListener) return () => {};
  const onMessage = event => {
    if (event.source !== parentWindow || event.data?.type !== PDF_READER_STATUS) return;
    handler(event.data);
  };
  windowImpl.addEventListener('message', onMessage);
  return () => windowImpl.removeEventListener('message', onMessage);
}

export function syncChangeRadarContext(payload, { parentWindow = globalThis.parent, currentWindow = globalThis } = {}) {
  if (!parentWindow?.postMessage || parentWindow === currentWindow) return false;
  parentWindow.postMessage({ type: CHANGE_RADAR_CONTEXT, payload }, '*');
  return true;
}

export function subscribeChangeRadarStatus(handler, { parentWindow = globalThis.parent, windowImpl = globalThis } = {}) {
  if (!windowImpl?.addEventListener) return () => {};
  const onMessage = event => {
    if (event.source !== parentWindow || event.data?.type !== CHANGE_RADAR_STATUS) return;
    handler(event.data);
  };
  windowImpl.addEventListener('message', onMessage);
  return () => windowImpl.removeEventListener('message', onMessage);
}
