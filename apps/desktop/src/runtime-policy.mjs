const fail = () => { throw Object.assign(new Error('DESKTOP_RUNTIME_DENIED'), { code: 'DESKTOP_RUNTIME_DENIED', status: 403 }); };
import { isolatedBusinessOrigins } from '../../../packages/contracts/src/isolated-business-origins.mjs';
import { PRODUCTION_API_ORIGIN, PRODUCTION_RUNTIME } from './production-configuration.mjs';
export function localBusinessRuntime(value, apiOrigin, environment = 'local-test') {
  if (value == null) return null;
  if (environment === 'production') {
    if (apiOrigin !== PRODUCTION_API_ORIGIN || value.scheme !== PRODUCTION_RUNTIME.scheme || value.domain !== PRODUCTION_RUNTIME.domain || value.port !== PRODUCTION_RUNTIME.port) fail();
    return PRODUCTION_RUNTIME;
  }
  let api; try { api = new URL(apiOrigin); } catch { fail(); }
  if (value.scheme === 'https') {
    try {
      const rules = isolatedBusinessOrigins(apiOrigin, `https://${value.domain}`);
      if (value.port !== 443) fail();
      return Object.freeze({ domain: rules.domain, scheme: rules.scheme, port: rules.port });
    } catch { fail(); }
  }
  if (api.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(api.hostname) || api.username || api.password ||
    value.domain !== 'localhost' || value.scheme !== 'http' || !Number.isInteger(value.port) || value.port < 1024 || value.port > 65535 ||
    value.port === Number(api.port)) fail();
  return Object.freeze({ domain: 'localhost', scheme: 'http', port: value.port });
}
export function validateDesktopLaunch(descriptor, policy, workId, releaseId) {
  if (!policy || descriptor?.apiVersion !== 1 || descriptor.workId !== workId ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(descriptor.releaseId ?? '') ||
    releaseId && descriptor.releaseId !== releaseId) fail();
  const expected = `${policy.scheme}://r-${descriptor.releaseId.replaceAll('-', '')}.${policy.domain}${policy.port === 443 && policy.scheme === 'https' ? '' : ':' + policy.port}`;
  // Check the raw input before URL parsing normalizes dot segments/backslashes.
  if (typeof descriptor.entryUrl !== 'string' || /%2f|%5c|%2e|[\\?#]|\/\.{1,2}(?:\/|$)/i.test(descriptor.entryUrl)) fail();
  if (typeof descriptor.runtimeOrigin !== 'string' || /[\\?#]/.test(descriptor.runtimeOrigin)) fail();
  let entry, runtime; try { entry = new URL(descriptor.entryUrl); runtime = new URL(descriptor.runtimeOrigin); } catch { fail(); }
  if (entry.origin !== expected || runtime.origin !== expected || runtime.pathname !== '/' || runtime.username || runtime.password ||
    runtime.search || runtime.hash || entry.username || entry.password || entry.search || entry.hash ||
    !entry.pathname.endsWith('.html') || /%2f|%5c|%2e/i.test(entry.pathname)) fail();
  return expected;
}
