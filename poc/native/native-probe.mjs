import http from 'node:http';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomBytes, createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DESKCAT_SHA = '4967f9e183a311193f8b2f0fd33f5a40b8b2a1ff7a575c2d412b2e4640c69912';
const project = fileURLToPath(new URL('../../', import.meta.url));

// A local engineering probe, deliberately separate from normal UGC launch.
export async function startNativeProbe({ downloadedFile, outputDir = path.join(project, '.runtime/native-probe'), launch = true } = {}) {
  if (process.platform !== 'win32') throw new Error('Windows required');
  const bytes = await readFile(downloadedFile);
  if (createHash('sha256').update(bytes).digest('hex') !== DESKCAT_SHA) throw new Error('Only the authorized Deskcat download is accepted');
  await mkdir(outputDir, { recursive: true });
  const html = await readFile(new URL('player.html', import.meta.url), 'utf8');
  const token = randomBytes(32).toString('hex');
  const prefix = `/play/${token}`;
  let child, frame, error, origin, stopping, lastSeen = Date.now(), readyAt, attached = false, frameAt;
  const events = [], captures = [];
  const start = () => {
    if (child) return;
    child = spawn(path.join(project, 'artifacts/native/WindowBridge.exe'), [path.resolve(downloadedFile), path.join(outputDir, 'profile')], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    child.stdin.on('error', () => {});
    child.on('error', e => { error = e.message; });
    child.on('exit', code => { error ||= `Native bridge exited (${code})`; events.push({ type: 'exit', code, at: new Date().toISOString() }); });
    child.stderr.on('data', chunk => { events.push({ type: 'stderr', message: String(chunk).slice(0, 1000) }); });
    createInterface({ input: child.stdout }).on('line', line => {
      let item; try { item = JSON.parse(line); } catch { return; }
      if (item.type === 'frame') {
        frame = { ...item, jpeg: Buffer.from(item.jpeg, 'base64') }; frameAt = Date.now(); readyAt ||= Date.now();
        captures.push({ id: item.id, ms: item.ms, input: item.input, foregroundIsGame: item.foregroundIsGame, minimized: item.minimized, received: Date.now() });
        if (captures.length > 18000) captures.shift();
      } else { events.push({ ...item, at: new Date().toISOString() }); console.log('Native probe:', JSON.stringify(item)); if (item.type === 'error') error = item.message; }
    });
  };
  const stop = () => stopping ||= (async () => {
    clearInterval(watchdog);
    if (child && child.exitCode === null) {
      child.stdin.end(JSON.stringify({ type: 'stop' }) + '\n');
      await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 4000))]);
      if (child.exitCode === null) {
        const exited = new Promise(resolve => child.once('exit', resolve));
        child.kill();
        await exited;
      }
    }
    try { await writeFile(path.join(outputDir, 'report.json'), JSON.stringify({ sha256: DESKCAT_SHA, readyAt, events, captures }, null, 2)); }
    finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  })();
  const reply = (res, code, body, headers = {}) => { res.writeHead(code, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...headers }); res.end(body); };
  const server = http.createServer(async (req, res) => {
    try {
      if (req.headers.host !== new URL(origin).host) return reply(res, 403, 'Host denied');
      const requestOrigin = req.headers.origin;
      if (requestOrigin && requestOrigin !== 'null' && requestOrigin !== origin) return reply(res, 403, 'Origin denied');
      // Opaque trusted iframe uses CORS. A token and non-simple header are both required for writes.
      const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'X-Width, X-Height, X-Frame, X-Foreground, X-Capture-Ms, X-Frame-Age, X-Minimized' };
      const pathname = new URL(req.url, origin).pathname;
      if (!pathname.startsWith(prefix + '/') && pathname !== prefix) return reply(res, 404, 'Unknown session');
      if (req.method === 'OPTIONS') return reply(res, 204, null, { ...headers, 'Access-Control-Allow-Methods': 'POST, GET', 'Access-Control-Allow-Headers': 'Content-Type, X-GameHub-Input' });
      lastSeen = Date.now(); attached = true;
      if (req.method === 'GET' && (pathname === prefix || pathname === prefix + '/')) {
        const nonce = randomBytes(18).toString('base64');
        return reply(res, 200, html.replaceAll('__NONCE__', nonce).replace('__ROUTES__','null'), { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src blob:; connect-src ${origin}; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts` });
      }
      if (req.method === 'GET' && pathname === prefix + '/frame') {
        if (error) return reply(res, 410, error, headers);
        if (!frame) return reply(res, 202, 'Starting', headers);
        return reply(res, 200, frame.jpeg, { ...headers, 'Content-Type': 'image/jpeg', 'X-Width': frame.width, 'X-Height': frame.height, 'X-Frame': frame.id, 'X-Foreground': frame.foregroundIsGame, 'X-Capture-Ms': frame.ms, 'X-Frame-Age': Date.now() - frameAt, 'X-Minimized': frame.minimized });
      }
      if (req.method !== 'POST' || req.headers['x-gamehub-input'] !== '1') return reply(res, 403, 'Action denied', headers);
      if (pathname === prefix + '/stop') { reply(res, 200, 'Stopped', headers); void stop(); return; }
      if (pathname !== prefix + '/input' || error) return reply(res, 404, 'Unavailable', headers);
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 2048) { reply(res, 413, 'Too large', headers); return; } }
      const input = JSON.parse(body);
      if (!['mouse', 'key', 'text', 'release','window'].includes(input?.type)) return reply(res, 400, 'Invalid input', headers);
      if (input.type === 'window' && !['minimize','restore'].includes(input.action)) return reply(res, 400, 'Invalid window action', headers);
      if (input.type === 'mouse' && (!['down','up','move'].includes(input.action) || !Number.isSafeInteger(input.x) || !Number.isSafeInteger(input.y))) return reply(res, 400, 'Invalid mouse', headers);
      if (input.type === 'key' && (!Number.isSafeInteger(input.vk) || typeof input.down !== 'boolean')) return reply(res, 400, 'Invalid key', headers);
      if (input.type === 'text' && (typeof input.text !== 'string' || input.text.length > 32)) return reply(res, 400, 'Invalid text', headers);
      if (child?.stdin.writableLength > 32768) return reply(res, 429, 'Input overloaded', headers);
      child?.stdin.write(JSON.stringify(input) + '\n');
      return reply(res, 200, 'Queued (not proof of game input)', headers);
    } catch { if (!res.headersSent) reply(res, 400, 'Invalid request'); else res.destroy(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.2', resolve); });
  origin = `http://127.0.0.2:${server.address().port}`;
  const watchdog = setInterval(() => { if (Date.now() - lastSeen > (attached ? 20000 : 120000)) void stop(); }, 2000);
  if (launch) start();
  return { url: origin + prefix + '/', stop, start, getState: () => ({ frame: frame && { ...frame, jpeg: undefined }, error, events }) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const probe = await startNativeProbe({ downloadedFile: process.argv[2] || path.join(project, '.runtime/m0/download-check-1790224988286.exe') });
  console.log(`Native test player: ${probe.url}`);
  process.on('SIGINT', () => { void probe.stop(); });
  process.on('SIGTERM', () => { void probe.stop(); });
}
