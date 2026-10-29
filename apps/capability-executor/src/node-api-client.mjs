import { fail } from './errors.mjs';

const jsonHeaders = { accept: 'application/json', 'content-type': 'application/json' };

export function createExecutionNodeApiClient({ baseUrl, credentialVault,
  fetchImpl = globalThis.fetch, sessionKey = 'execution-node-session-v1' } = {}) {
  const refreshIntentKey = `${sessionKey}-refresh-intent-v1`;
  let origin;
  try { origin = new URL(baseUrl); } catch { fail('CAPABILITY_NODE_API_URL_INVALID'); }
  if (origin.protocol !== 'https:' || origin.pathname !== '/' || typeof fetchImpl !== 'function'
    || !credentialVault || typeof credentialVault.load !== 'function') {
    fail('CAPABILITY_NODE_API_CONFIG_INVALID');
  }
  const endpoint = path => new URL(path, origin).toString();
  const parse = async response => {
    let body;
    try { body = await response.json(); } catch { body = null; }
    if (!response.ok) {
      const error = new Error(body?.error?.code ?? `CAPABILITY_NODE_API_HTTP_${response.status}`);
      error.code = body?.error?.code ?? `CAPABILITY_NODE_API_HTTP_${response.status}`;
      error.statusCode = response.status;
      throw error;
    }
    return body?.data ?? body;
  };
  const session = async () => {
    if (await credentialVault.load(refreshIntentKey)) {
      fail('CAPABILITY_NODE_SESSION_REFRESH_UNCERTAIN');
    }
    const stored = await credentialVault.load(sessionKey);
    if (!stored) fail('CAPABILITY_NODE_SESSION_REQUIRED');
    try { return JSON.parse(stored); } catch { fail('CAPABILITY_NODE_SESSION_INVALID'); }
  };
  const saveSession = value => credentialVault.store(sessionKey, JSON.stringify(value));
  const pair = async input => {
    const response = await fetchImpl(endpoint('/v1/capability-execution/pair'), {
      method: 'POST', headers: jsonHeaders, body: JSON.stringify(input) });
    const value = await parse(response);
    await saveSession(value);
    await credentialVault.remove(refreshIntentKey);
    return value;
  };
  const refresh = async current => {
    await credentialVault.store(refreshIntentKey, JSON.stringify({
      schemaVersion: 'execution-node-refresh-intent-v1',
      startedAt: new Date().toISOString(),
    }));
    const response = await fetchImpl(endpoint('/v1/capability-execution/session/refresh'), {
      method: 'POST', headers: jsonHeaders, body: JSON.stringify({ renewalToken: current.renewalToken }) });
    const value = await parse(response);
    await saveSession(value);
    await credentialVault.remove(refreshIntentKey);
    return value;
  };
  const request = async (path, body = undefined, allowRefresh = true) => {
    let current = await session();
    let response = await fetchImpl(endpoint(path), { method: body === undefined ? 'GET' : 'POST',
      headers: { ...jsonHeaders, authorization: `Bearer ${current.accessToken}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (response.status === 401 && allowRefresh) {
      current = await refresh(current);
      response = await fetchImpl(endpoint(path), { method: body === undefined ? 'GET' : 'POST',
        headers: { ...jsonHeaders, authorization: `Bearer ${current.accessToken}` },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    }
    return parse(response);
  };
  return {
    pair,
    heartbeat: input => request('/v1/capability-execution/node/heartbeat', input),
    snapshot: () => request('/v1/capability-execution/node'),
    packageEvent: input => request('/v1/capability-execution/node/package-events', input),
    claim: (leaseSeconds = 120) => request('/v1/capability-execution/node/stage-leases/claim', { leaseSeconds }),
    renew: (leaseId, leaseToken, leaseSeconds = 120) => request(
      `/v1/capability-execution/node/stage-leases/${encodeURIComponent(leaseId)}/renew`,
      { leaseToken, leaseSeconds }),
    complete: (leaseId, input) => request(
      `/v1/capability-execution/node/stage-leases/${encodeURIComponent(leaseId)}/complete`, input),
    fail: (leaseId, input) => request(
      `/v1/capability-execution/node/stage-leases/${encodeURIComponent(leaseId)}/fail`, input),
    clearSession: async () => {
      await credentialVault.remove(sessionKey);
      await credentialVault.remove(refreshIntentKey);
    },
  };
}
