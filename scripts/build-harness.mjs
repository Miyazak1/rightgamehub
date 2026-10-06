import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const pluginRoot = new URL('extensions/harness/', root);
const manifest = JSON.parse(await readFile(new URL('package.json', pluginRoot), 'utf8'));
const documents = {};
for (const name of ['canvas', 'webgl']) documents[name] = await readFile(new URL(`poc/m0/${name}.html`, root), 'utf8');
const platformCss = await readFile(new URL('packages/platform-client/src/styles.css', root), 'utf8');
const requireFromHarness = createRequire(new URL('package.json', pluginRoot));
const { build } = await import(pathToFileURL(requireFromHarness.resolve('esbuild')).href);
const result = await build({
  entryPoints: [fileURLToPath(new URL('src/platform-client.jsx', pluginRoot))],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['chrome110'],
  loader: { '.png': 'dataurl' },
  external: ['react'],
  write: false,
  logLevel: 'silent',
});
const source = result.outputFiles[0].text;
const bundle = `window.__ModuleLoader__.load({\n  id: ${JSON.stringify(manifest.name)},\n  factory: (require) => {\n    const module = { exports: {} };\n    const exports = module.exports;\n    const GAME_DOCUMENTS = ${JSON.stringify(documents)};\n    const PLATFORM_CSS = ${JSON.stringify(platformCss)};\n${source}\n    return module.exports;\n  }\n});\n`;
new vm.Script(bundle, { filename: 'harness-client.js' });
await mkdir(new URL('lib/', pluginRoot), { recursive: true });
await mkdir(new URL('artifacts/', root), { recursive: true });
await writeFile(new URL('lib/client.js', pluginRoot), bundle);
await copyFile(new URL('src/index.js', pluginRoot), new URL('lib/index.js', pluginRoot));
await copyFile(new URL('src/transfer-service.mjs', pluginRoot), new URL('lib/transfer-service.mjs', pluginRoot));
for (const name of ['web-policy.mjs', 'zip-worker.mjs', 'prepare-web-game.mjs', 'game-runtime.mjs', 'native-probe-adapter.mjs', 'offscreen-adapter.mjs', 'offscreen-player.html', 'offscreen-package.mjs', 'offscreen-install.mjs', 'offscreen-approved.json', 'desktop-launcher.mjs', 'credential-store.mjs']) await copyFile(new URL(`src/${name}`, pluginRoot), new URL(`lib/${name}`, pluginRoot));
await mkdir(new URL('lib/save-cache/',pluginRoot),{recursive:true});
for(const name of ['store-contract.mjs','store-rpc.mjs','sqlite-store.mjs'])await copyFile(new URL('packages/save-cache/src/'+name,root),new URL('lib/save-cache/'+name,pluginRoot));
const offscreenPlayer = await readFile(new URL('src/offscreen-player.html', pluginRoot), 'utf8');
new vm.Script(offscreenPlayer.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1].replace('__ROUTES__', '{}'), { filename: 'offscreen-player.js' });
console.log(`Built ${manifest.name}@${manifest.version}: shared platform + local lab closure bundle. React is supplied by the host.`);
