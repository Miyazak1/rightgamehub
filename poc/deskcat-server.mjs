import http from 'node:http';
import { readFile } from 'node:fs/promises';

// Local, single-file compatibility probe. This is not a UGC upload server.
const host = '127.0.0.1';
const port = 43188;
const html = await readFile(new URL('./deskcat-fixture/index.html', import.meta.url));
const server = http.createServer((req, res) => {
  if (req.headers.host !== `${host}:${port}`) {
    res.writeHead(403); res.end('Invalid host'); return;
  }
  if (!['GET', 'HEAD'].includes(req.method) || !['/', '/index.html'].includes(req.url)) {
    res.writeHead(404); res.end('Not found'); return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': html.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src blob: data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
  });
  res.end(req.method === 'HEAD' ? undefined : html);
});
server.listen(port, host, () => console.log(`Deskcat original HTML probe: http://${host}:${port}/`));
