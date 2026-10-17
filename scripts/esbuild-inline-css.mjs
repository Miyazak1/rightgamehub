import { readFile } from 'node:fs/promises';

const assetMime = path => {
  if (/\.m?js$/u.test(path)) return 'text/javascript';
  if (/\.wasm$/u.test(path)) return 'application/wasm';
  if (/\.gz$/u.test(path)) return 'application/gzip';
  return 'application/octet-stream';
};

export const inlineComponentCss = {
  name: 'inline-component-css',
  setup(context) {
    context.onLoad({ filter: /\.css$/u }, async ({ path }) => {
      const source = await readFile(path, 'utf8');
      return {
        contents: `if(typeof document!==\"undefined\"){const style=document.createElement(\"style\");style.textContent=${JSON.stringify(source)};document.head.append(style);}`,
        loader: 'js',
      };
    });
  },
};

export const inlineImportedAssets = {
  name: 'inline-imported-assets',
  setup(context) {
    context.onResolve({ filter: /\?url$/u }, async ({ path, resolveDir, kind }) => {
      const resolved = await context.resolve(path.slice(0, -4), { resolveDir, kind });
      if (resolved.errors.length) return { errors: resolved.errors, warnings: resolved.warnings };
      return { path: resolved.path, namespace: 'inline-asset-url' };
    });
    context.onLoad({ filter: /.*/u, namespace: 'inline-asset-url' }, async ({ path }) => {
      const encoded = (await readFile(path)).toString('base64');
      const mime = assetMime(path);
      return {
        contents: `const bytes=Uint8Array.from(atob(${JSON.stringify(encoded)}),character=>character.charCodeAt(0));export default URL.createObjectURL(new Blob([bytes],{type:${JSON.stringify(mime)}}));`,
        loader: 'js',
      };
    });
  },
};
