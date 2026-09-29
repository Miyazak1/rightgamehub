import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { WEB_POLICY, containedPath } from './web-policy.mjs';

export function createGameRuntime({ root, leaseMs = 2 * 60 * 60 * 1000 }) {
  const sessions = new Map();
  let origin;
  let listening;
  let closed = false;
  const server = createServer(async (request, response) => {
    const deny = (status, text) => { response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.end(text); };
    try {
      if (request.headers.host !== new URL(origin).host) { deny(403, 'Invalid runtime host'); return; }
      if (!['GET', 'HEAD'].includes(request.method)) { deny(405, 'Read-only game assets'); return; }
      if (request.headers.origin && !['null', origin].includes(request.headers.origin)) { deny(403, 'Invalid runtime origin'); return; }
      const rawPath = request.url.split('?')[0];
      const match = /^\/play\/([A-Za-z0-9_-]{43})\/(.*)$/.exec(rawPath);
      const session = match && sessions.get(match[1]);
      if (!session || session.expiresAt <= Date.now()) { deny(404, 'Game session ended'); return; }
      if (/%2f|%5c/i.test(match[2])) { deny(400, 'Invalid asset path'); return; }
      const name = decodeURIComponent(match[2] || 'index.html');
      const file = containedPath(path.join(root, 'web', session.record.id), name);
      const asset = Object.hasOwn(session.record.web.assets, name) && session.record.web.assets[name];
      if (!asset) { deny(404, 'Asset not found'); return; }
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size !== asset.size) { deny(409, 'Game assets changed; upload again'); return; }
      const source = `${origin}/play/${match[1]}/`;
      const csp = `default-src 'none'; script-src ${source} 'unsafe-inline' 'wasm-unsafe-eval'; style-src ${source} 'unsafe-inline'; img-src ${source} data: blob:; media-src ${source} blob:; font-src ${source} data:; connect-src ${source}; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts`;
      const headers = {
        'Content-Type': asset.mime, 'Content-Length': String(asset.size), 'Content-Security-Policy': csp,
        'Cache-Control': 'no-store, no-transform', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), usb=(), serial=(), hid=(), payment=(), display-capture=(), clipboard-read=(), clipboard-write=(), fullscreen=*',
        // Opaque sandbox origins need CORS for module scripts, fetch, WASM and fonts.
        // This origin has no account cookies, mutation endpoints or workspace access.
        'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin', 'Accept-Ranges': 'bytes',
      };
      let start = 0;
      let end = asset.size - 1;
      let status = 200;
      if (request.headers.range) {
        const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
        if (!range || (!range[1] && !range[2])) { deny(416, 'Invalid range'); return; }
        start = range[1] ? Number(range[1]) : Math.max(0, asset.size - Number(range[2]));
        end = range[1] && range[2] ? Math.min(Number(range[2]), end) : end;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= asset.size) { response.setHeader('Content-Range', `bytes */${asset.size}`); deny(416, 'Invalid range'); return; }
        status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${asset.size}`; headers['Content-Length'] = String(end - start + 1);
      }
      response.writeHead(status, headers);
      if (request.method === 'HEAD' || asset.size === 0) { response.end(); return; }
      await pipeline(createReadStream(file, { start, end }), response);
    } catch (error) {
      if (response.headersSent) response.destroy();
      else deny(error.code === 'ENOENT' ? 404 : 400, 'Game asset unavailable');
    }
  });
  const expire = () => { for (const [token, session] of sessions) if (session.expiresAt <= Date.now()) sessions.delete(token); };
  const timer = setInterval(expire, 60000);
  timer.unref();
  async function ensureListening() {
    if (closed) throw new Error('游戏资源服务已关闭。');
    if (!listening) listening = new Promise((resolve, reject) => {
      server.once('error', reject);
      // A different loopback host also separates Harness's host-only cookies;
      // merely using another port on 127.0.0.1 would not separate cookies.
      server.listen(0, '127.0.0.2', () => { origin = `http://127.0.0.2:${server.address().port}`; resolve(); });
    });
    await listening;
  }
  return {
    async launch(record) {
      if (record.web?.state !== 'ready' || record.web.policy !== WEB_POLICY) throw new Error('该文件尚不能作为网页游戏运行。');
      expire();
      await ensureListening();
      if (sessions.size >= 16) throw new Error('正在运行的游戏过多，请先结束其他游戏。');
      const token = randomBytes(32).toString('base64url');
      const session = { id: randomUUID(), record, expiresAt: Date.now() + leaseMs };
      sessions.set(token, session);
      return { launchId: session.id, url: `${origin}/play/${token}/index.html`, expiresAt: session.expiresAt };
    },
    stop(id) { for (const [token, session] of sessions) if (session.id === id) sessions.delete(token); },
    async close() { closed = true; clearInterval(timer); sessions.clear(); if (listening) { await listening.catch(() => {}); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } },
  };
}
