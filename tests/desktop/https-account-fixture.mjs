import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { createIsolatedAccountApi } from './account-api-fixture.mjs';

export const testCertificate = await readFile(new URL('./fixtures/https/loopback-test-cert.pem', import.meta.url));
const key = await readFile(new URL('./fixtures/https/loopback-test-key.pem', import.meta.url));
// This certificate/key is public test material for 127.0.0.1 only. It is never
// installed into Windows trust stores or used by the desktop product transport.
export function fetchWithTestCA(url, options = {}) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, { method: options.method, headers: options.headers,
      ca: options.ca ?? testCertificate, rejectUnauthorized: true, signal: options.signal }, response => {
      const chunks = [];
      response.on('error', reject);
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: response.headers })));
    });
    request.on('error', reject); request.end(options.body);
  });
}

export async function createHttpsAccountFixture(options = {}) {
  const backend = await createIsolatedAccountApi(options);
  const requests = [];
  let origin, ready = true, redirect = false, identity = 'isolated-auth-only', healthy = true, offline = false;
  const server = https.createServer({ key, cert: testCertificate }, async (req, res) => {
    // Retain no bearer/OTP/body in diagnostic reports.
    requests.push({ method: req.method, path: req.url.split('?')[0], authenticated: Boolean(req.headers.authorization) });
    if (offline) { res.writeHead(503, { 'content-type': 'application/json' }); res.end('{"error":{"code":"TEST_OFFLINE"}}'); return; }
    if (req.url === '/ready-desktop-auth') {
      res.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: { status: ready ? 'ready' : 'not-ready', instance: identity,
        database: true, redis: true, migrations: { ready: true }, backgroundTasksEnabled: false } })); return;
    }
    if (redirect) { redirect = false; res.writeHead(302, { location: 'https://mooyu.fun/v1/me' }); res.end(); return; }
    try {
      let body = ''; for await (const chunk of req) body += chunk;
      const response = await fetch(backend.origin + req.url, { method: req.method,
        headers: { 'content-type': 'application/json', ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}) },
        ...(body ? { body } : {}), redirect: 'manual' });
      const payload = await response.json();
      if (req.url === '/v1/auth/github/web' && response.ok) {
        const source = new URL(payload.data.authorizeUrl);
        const external = new URL('https://github.com/login/oauth/authorize');
        external.search = source.search;
        external.searchParams.set('redirect_uri', origin + '/v1/auth/github/web/callback');
        payload.data.authorizeUrl = external.href;
      }
      res.writeHead(response.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload));
    } catch { res.writeHead(503); res.end('{"error":{"code":"TEST_OFFLINE"}}'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `https://127.0.0.1:${server.address().port}`;
  return { origin, backend, requests,
    notReady(value = true) { ready = !value; }, wrongInstance(value = true) { identity = value ? 'production' : 'isolated-auth-only'; },
    unhealthy(value = true) { healthy = !value; }, offline(value = true) { offline = value; },
    redirectNext() { redirect = true; },
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await backend.close(); },
  };
}
