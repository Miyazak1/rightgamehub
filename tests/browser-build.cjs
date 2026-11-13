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
    ...options,
    loader: { '.png': 'dataurl', '.webp': 'dataurl', '.jpg': 'dataurl', '.jpeg': 'dataurl', '.svg': 'dataurl', ...options.loader },
    plugins: [inlineImportedAssets, inlineComponentCss, ...(options.plugins || [])],
  });
};

exports.servePage = (app, handler) => {
  app.get('/', handler);
  app.setNotFoundHandler((request, reply) => {
    const pathname = request.url.split('?')[0];
    if (request.method === 'GET' && request.headers.accept?.includes('text/html')
      && !/^\/(?:v1|api)(?:\/|$)/u.test(pathname)) return handler(request, reply.code(200));
    return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Fixture route not found.' } });
  });
  return app;
};
