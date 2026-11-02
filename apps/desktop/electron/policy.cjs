const fs = require('node:fs/promises');
const path = require('node:path');
const UI = 'mooyu-app://client';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  '.wasm': 'application/wasm', '.gz': 'application/octet-stream', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const matches = (value, origin) => {
  try { const a = new URL(value), b = new URL(origin); return a.protocol === b.protocol && a.host === b.host && !a.username && !a.password; } catch { return false; }
};
const ui = value => matches(value, UI);
const csp = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const gameCsp = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
// Packaged official lessons run on loopback in opaque sandboxed frames.
const courseCsp = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
function allowedRequest({ url, resourceType }, fixtureOrigin = null, runtimeOrigins = new Set()) {
  if (ui(url) || fixtureOrigin && matches(url, fixtureOrigin) || [...runtimeOrigins].some(origin => matches(url, origin))) return true;
  return ['image', 'font', 'media'].includes(resourceType) && (/^data:/u.test(url) || url.startsWith('blob:' + UI + '/'));
}
async function assetResponse(request, root, origin, spa, fixtureOrigin = null, runtimeSource = null, courseware = false) {
  const frames = [fixtureOrigin, runtimeSource].filter(Boolean).join(' ');
  const headers = { 'Content-Security-Policy': spa ? (frames ? csp.replace("frame-src 'none'", 'frame-src ' + frames) : csp) : courseware ? courseCsp : gameCsp, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache', ...(courseware ? {'Access-Control-Allow-Origin':'*'} : {}) };
  if (!matches(request.url, origin)) return new Response('Origin denied', { status: 403, headers });
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method denied', { status: 405, headers });
  const url = new URL(request.url);
  if (spa && url.pathname.startsWith('/learning/')) return new Response('Use isolated courseware frame', { status: 403, headers });
  if (url.pathname.startsWith('/v1/')) return Response.json({ error: { code: 'DESKTOP_PREVIEW_OFFLINE', message: '本地界面预览未连接服务器。' } }, { status: 503, headers });
  let relative;
  try { relative = decodeURIComponent(url.pathname); } catch { return new Response('Invalid path', { status: 400, headers }); }
  if (/[\\\0:]/u.test(relative) || relative.split('/').some(s => s === '..' || s === '.')) return new Response('Path denied', { status: 403, headers });
  relative = relative.replace(/^\/+/, '') || 'index.html';
  let file = path.resolve(root, relative);
  const inside = value => { const r = path.relative(root, value); return r !== '..' && !r.startsWith('..' + path.sep) && !path.isAbsolute(r); };
  if (!inside(file)) return new Response('Path denied', { status: 403, headers });
  try {
    let stat = await fs.lstat(file).catch(() => null);
    // Only extensionless document routes get SPA fallback. Missing JS/Worker/WASM must fail.
    if (!stat && spa && !path.extname(relative) && !relative.startsWith('assets/')) { file = path.join(root, 'index.html'); stat = await fs.lstat(file); }
    if (!stat?.isFile() || stat.isSymbolicLink() || !inside(await fs.realpath(file))) return new Response('Not found', { status: 404, headers });
    headers['Content-Type'] = mime[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    return new Response(request.method === 'HEAD' ? null : await fs.readFile(file), { headers });
  } catch { return new Response('Not found', { status: 404, headers }); }
}
module.exports = { UI, matches, ui, csp, allowedRequest, assetResponse };
