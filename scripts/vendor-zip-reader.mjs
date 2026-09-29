// Reproduce the checked-in ZIP reader from the already installed official Harness
// dependencies. This tool is not needed to build or run the GameHub plugin.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const upstream = path.resolve(process.argv[2] || 'E:/DEEPSEEKHARNESS');
const pnpm = path.join(upstream, 'node_modules/.pnpm');
const yauzl = path.join(pnpm, 'yauzl@3.4.0/node_modules/yauzl');
const pend = path.join(pnpm, 'pend@1.2.0/node_modules/pend');
const esbuild = await import(pathToFileURL(path.join(pnpm, 'esbuild@0.28.1/node_modules/esbuild/lib/main.js')));
const output = new URL('../extensions/harness/vendor/', import.meta.url);
await mkdir(output, { recursive: true });
const bundle = await esbuild.build({ absWorkingDir: yauzl, entryPoints: ['index.js'], bundle: true, platform: 'node', target: 'node22', format: 'cjs', minify: true, write: false, legalComments: 'none' });
await writeFile(new URL('zip-reader.cjs', output), bundle.outputFiles[0].contents);
const sources = [];
let licenses = '';
for (const [name, version, folder, files] of [['yauzl', '3.4.0', yauzl, ['index.js', 'fd-slicer.js', 'crc32.js']], ['pend', '1.2.0', pend, ['index.js']]]) {
  licenses += `\n--- ${name}@${version} ---\n${await readFile(path.join(folder, 'LICENSE'), 'utf8')}\n`;
  for (const filename of files) sources.push({ source: `${name}@${version}/${filename}`, sha256: createHash('sha256').update(await readFile(path.join(folder, filename))).digest('hex') });
}
await writeFile(new URL('LICENSES.txt', output), licenses);
await writeFile(new URL('sources.json', output), JSON.stringify({ packages: [{ name: 'yauzl', version: '3.4.0', repository: 'https://github.com/thejoshwolfe/yauzl' }, { name: 'pend', version: '1.2.0', repository: 'https://github.com/andrewrk/node-pend' }], builder: 'esbuild@0.28.1', bundleSha256: createHash('sha256').update(bundle.outputFiles[0].contents).digest('hex'), sources }, null, 2) + '\n');
console.log('Vendored ZIP reader and MIT licenses; no runtime package installation required.');
