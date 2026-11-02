// Explicit test namespaces only. Never infer runtime trust from an API response.
export function isolatedBusinessOrigins(apiValue, runtimeValue) {
  const fail = () => { throw Error('DESKTOP_TEST_ORIGINS_INVALID'); };
  let api, runtime;
  try { api = new URL(apiValue); runtime = new URL(runtimeValue); } catch { fail(); }
  const root = url => url.protocol === 'https:' && !url.port && !url.username && !url.password &&
    url.pathname === '/' && !url.search && !url.hash;
  const suffix = /^desktop-test\.((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})$/.exec(api.hostname)?.[1];
  if (!root(api) || !root(runtime) || !suffix || api.hostname.length > 253 ||
    runtime.hostname !== `desktop-runtime-test.${suffix}` || runtime.hostname.length > 210) fail();
  return Object.freeze({ apiOrigin: api.origin, runtimeOrigin: runtime.origin, domain: runtime.hostname, scheme: 'https', port: 443 });
}
