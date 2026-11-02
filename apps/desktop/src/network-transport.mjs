// Main-process only. Chromium owns proxy/TLS/HTTP behavior; bearer credentials
// remain explicit and the transport never joins browser login-cookie sessions.
export function createDesktopNetworkTransport(origin, fetchImpl) {
  const canonical = new URL(origin).origin;
  return (value, options = {}) => {
    const url = new URL(value);
    if (url.origin !== canonical || url.username || url.password ||
      !(/^\/v1\//.test(url.pathname) || ['/ready','/ready-desktop-auth'].includes(url.pathname)))
      throw Object.assign(new Error('DESKTOP_ACCOUNT_ORIGIN_DENIED'), {code:'DESKTOP_ACCOUNT_ORIGIN_DENIED',status:403});
    const headers = new Headers(options.headers);
    const credentialed = headers.has('Authorization') || headers.has('Cookie');
    headers.delete('Cookie'); headers.delete('Proxy-Authorization');
    const publicImage = (options.method ?? 'GET') === 'GET' && !credentialed &&
      (/^\/v1\/works\/[a-zA-Z0-9-]+\/cover$/.test(url.pathname) || /^\/v1\/discovery\/campaigns\/[a-zA-Z0-9-]+\/share-card\.png$/.test(url.pathname));
    return fetchImpl(url.href, {...options,headers,credentials:'omit',redirect:'error',cache:publicImage?'default':'no-store'});
  };
}
