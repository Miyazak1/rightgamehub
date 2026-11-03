// Local Docker Desktop ingress only. Business API/DB/Redis stay on an internal
// network; only this fixed-upstream proxy joins the loopback-published bridge.
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const hop = new Set(['connection', 'proxy-connection', 'proxy-authorization', 'proxy-authenticate', 'keep-alive', 'transfer-encoding', 'upgrade', 'trailer', 'te']);
export const createDesktopBusinessTestProxy=({port,hostname='business-api',upstreamTimeoutMs=20000})=>{
if(!Number.isSafeInteger(upstreamTimeoutMs)||upstreamTimeoutMs<1||upstreamTimeoutMs>20000)throw Error('TEST_GATEWAY_TIMEOUT_INVALID');
return http.createServer((req, res) => {
  const writeHead=(status,headers={})=>{
    // Any early error, including a locally generated 503, must retire an
    // unfinished upload connection. Completed requests may remain pooled.
    res.writeHead(status,status>=400&&!req.complete?{...headers,connection:'close'}:headers);
  };
  if (!req.url.startsWith('/') || req.url.startsWith('//')) { writeHead(400); res.end(); return; }
  const headers = Object.fromEntries(Object.entries(req.headers).filter(([key]) => !hop.has(key)));
  const failed=()=>{if(res.writableFinished||res.destroyed)return;if(!res.headersSent){writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end('{"error":{"code":"TEST_UPSTREAM_UNAVAILABLE","message":"Local test upstream unavailable"}}');}else res.destroy();};
  const upstream = http.request({ hostname, port, path: req.url, method: req.method, headers }, response => {
    const responseHeaders=Object.fromEntries(Object.entries(response.headers).filter(([key])=>!hop.has(key)));
    writeHead(response.statusCode,responseHeaders);
    response.on('error',failed);
    response.pipe(res);
  });
  upstream.setTimeout(upstreamTimeoutMs, () => {console.error(JSON.stringify({service:'isolated-loopback-gateway',code:'UPSTREAM_TIMEOUT',port}));upstream.destroy();});
  upstream.on('error',failed);
  req.on('aborted', () => upstream.destroy());
  // Normal completion may already have returned the upstream socket to its
  // keep-alive pool. Destroy only an interrupted downstream response.
  res.on('close', () => {if(!res.writableFinished)upstream.destroy();});
  req.pipe(upstream);
});
};
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
if (process.env.DESKTOP_BUSINESS_TEST_GATEWAY !== 'loopback-fixed-upstream') throw Error('TEST_GATEWAY_MARKER_REQUIRED');
const servers = [3090, 3092].map(port => createDesktopBusinessTestProxy({port}));
for (const [index, server] of servers.entries()) await new Promise(resolve => server.listen(index ? 3092 : 3090, '0.0.0.0', resolve));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { for (const server of servers) { server.close(); server.closeAllConnections(); } });
}
