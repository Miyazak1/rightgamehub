import { readFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { copiedImportedAssets, inlineComponentCss } from './esbuild-inline-css.mjs';

const root = new URL('../', import.meta.url);
const extensionRoot = new URL('extensions/vscode/', root);
const out = new URL('media/', extensionRoot);
await mkdir(out, { recursive: true });
for (const entry of await readdir(out, { withFileTypes: true })) {
  if (entry.isFile() && /^[a-zA-Z0-9._-]+\.[0-9a-f]{16}\.(?:gz|js|mjs)$/u.test(entry.name)) {
    await unlink(new URL(entry.name, out));
  }
}
const css = await readFile(new URL('packages/platform-client/src/styles.css', root), 'utf8');
const workspaceModules = [
  fileURLToPath(new URL('extensions/harness/node_modules/', root)),
  fileURLToPath(new URL('packages/platform-client/node_modules/', root)),
];
const requireFromHarness = createRequire(new URL('extensions/harness/package.json', root));
const { build } = await import(pathToFileURL(requireFromHarness.resolve('esbuild')).href);
await build({
  entryPoints: [fileURLToPath(new URL('src/platform-client.jsx', extensionRoot))],
  outfile: fileURLToPath(new URL('gamehub.js', out)),
  bundle: true, format: 'iife', platform: 'browser', target: ['chrome110'], sourcemap: true, sourcesContent: false, minifySyntax: true, minifyWhitespace: true,
  plugins: [copiedImportedAssets({ outputDirectory: fileURLToPath(out) }), inlineComponentCss],
  nodePaths: workspaceModules,
  loader: { '.png': 'dataurl', '.webp': 'dataurl' },
  define: {
    'import.meta.env.VITE_RUNTIME_DOMAIN': JSON.stringify(process.env.VITE_RUNTIME_DOMAIN || 'runtime.mooyu.fun'),
    'import.meta.env.DEV': 'false',
  },
  banner: { js: `const PLATFORM_CSS=${JSON.stringify(css)};` },
  logLevel: 'silent',
});
console.log('Built the shared MOOYU.FUN client for VS Code/Cursor WebviewView.');

await build({entryPoints:[fileURLToPath(new URL('src/file-export.mjs',extensionRoot))],outfile:fileURLToPath(new URL('file-export.cjs',out)),bundle:true,format:'cjs',platform:'node',target:['node20'],logLevel:'silent'});
await mkdir(new URL('bin/',extensionRoot),{ recursive:true });
await build({entryPoints:[fileURLToPath(new URL('src/courseware-bridge.mjs',extensionRoot))],outfile:fileURLToPath(new URL('bin/courseware-bridge.mjs',extensionRoot)),bundle:true,format:'esm',platform:'node',target:['node20'],logLevel:'silent'});
