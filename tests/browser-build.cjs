const path = require('node:path');
const { pathToFileURL } = require('node:url');
const esbuild = require('../extensions/harness/node_modules/esbuild');

// Keep browser fixtures aligned with the production handling of component CSS,
// local images, PDF/OCR workers and font assets. No application modules are stubbed.
exports.build = async options => {
  const { inlineComponentCss, inlineImportedAssets } = await import(
    pathToFileURL(path.resolve(__dirname, '../scripts/esbuild-inline-css.mjs')).href
  );
  return esbuild.build({
    // Reduce full-App parse work without changing NODE_ENV or disabling the
    // development StrictMode checks explicitly exercised by browser fixtures.
    minifySyntax: true,
    minifyWhitespace: true,
    ...options,
    loader: { '.png': 'dataurl', '.webp': 'dataurl', '.jpg': 'dataurl', '.jpeg': 'dataurl', '.svg': 'dataurl', ...options.loader },
    plugins: [inlineImportedAssets, inlineComponentCss, ...(options.plugins || [])],
  });
};

exports.servePage = (app, handler) => {
  // Fixture auth is intentionally mocked, but still uses the current HTTP
  // session-bootstrap protocol. Its profile comes from each fixture's /me.
  app.addHook('onRequest', async (request, reply) => {
    if (request.method !== 'POST' || request.url.split('?')[0] !== '/v1/auth/session'
      || request.headers['x-mooyu-fixture-session'] !== '1') return;
    const profile = await app.inject({ method: 'GET', url: '/v1/me', headers: {
      ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}),
    } });
    const data = profile.statusCode === 200 ? profile.json().data : null;
    return reply.send({ data: { authenticated: Boolean(data?.id), profile: data?.id ? data : null } });
  });
  app.get('/', handler);
  app.setNotFoundHandler((request, reply) => {
    const pathname = request.url.split('?')[0];
    if (request.method === 'GET' && request.headers.accept?.includes('text/html')
      && !/^\/(?:v1|api)(?:\/|$)/u.test(pathname)) return handler(request, reply.code(200));
    return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Fixture route not found.' } });
  });
  return app;
};
