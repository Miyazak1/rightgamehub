import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
const extensionRoot = new URL('extensions/vscode/', root);
const out = new URL('media/', extensionRoot);
await mkdir(out, { recursive: true });
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
  bundle: true, format: 'iife', platform: 'browser', target: ['chrome110'], sourcemap: true,
  nodePaths: workspaceModules,
  loader: { '.png': 'dataurl' },
  banner: { js: `const PLATFORM_CSS=${JSON.stringify(css)};` },
  logLevel: 'silent',
});
console.log('Built the shared GameHub client for VS Code/Cursor WebviewView.');
