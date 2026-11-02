// Local Docker Desktop ingress only. Business API/DB/Redis stay on an internal
// network; only this fixed-upstream proxy joins the loopback-published bridge.
import http from 'node:http';
if (process.env.DESKTOP_BUSINESS_TEST_GATEWAY !== 'loopback-fixed-upstream') throw Error('TEST_GATEWAY_MARKER_REQUIRED');
const hop = new Set(['connection', 'proxy-connection', 'proxy-authorization', 'proxy-authenticate', 'keep-alive', 'transfer-encoding', 'upgrade', 'trailer', 'te']);
const servers = [3090, 3092].map(port => http.createServer((req, res) => {
  if (!req.url.startsWith('/') || req.url.startsWith('//')) { res.writeHead(400); res.end(); return; }
  const headers = Object.fromEntries(Object.entries(req.headers).filter(([key]) => !hop.has(key)));
  const upstream = http.request({ hostname: 'business-api', port, path: req.url, method: req.method, headers }, response => {
    res.writeHead(response.statusCode, Object.fromEntries(Object.entries(response.headers).filter(([key]) => !hop.has(key))));
    response.pipe(res);
  });
  upstream.setTimeout(20000, () => upstream.destroy());
  upstream.on('error', () => { if (!res.headersSent) { res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end('{"error":{"code":"TEST_UPSTREAM_UNAVAILABLE","message":"Local test upstream unavailable"}}'); } else res.destroy(); });
  req.on('aborted', () => upstream.destroy()); res.on('close', () => upstream.destroy());
  req.pipe(upstream);
}));
for (const [index, server] of servers.entries()) await new Promise(resolve => server.listen(index ? 3092 : 3090, '0.0.0.0', resolve));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { for (const server of servers) { server.close(); server.closeAllConnections(); } });
