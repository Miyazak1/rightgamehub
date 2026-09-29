import http from 'node:http';
import { readFile } from 'node:fs/promises';
const host = '127.0.0.1';
const port = 43187;
const server = http.createServer(async (req, res) => {
  if (req.method !== 'GET' || !['/', '/index.html'].includes(req.url)) {
    res.writeHead(404); res.end('Not found'); return;
  }
  let html;
  try { html = await readFile(new URL('./index.html', import.meta.url)); }
  catch { res.writeHead(500); res.end('Demo unavailable'); return; }
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'self' data:; base-uri 'none'; form-action 'none'",
  });
  res.end(html);
});
server.listen(port, host, () => console.log(`Arcade browser PoC: http://${host}:${port}`));
