import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { makeZip } from './zip-fixture.cjs';
import { validateOffscreenManifest } from '../extensions/harness/src/offscreen-package.mjs';

export async function buildOwnedPackage() {
  const root = new URL('../', import.meta.url);
  const sources = {
    'gamehub.offscreen.json': 'poc/offscreen-package/gamehub.offscreen.json',
    'index.html': 'poc/offscreen-package/index.html',
    'assets/sdk.js': 'poc/offscreen-package/sdk.js',
    'assets/game.js': 'poc/offscreen-package/game.js',
    'assets/model.js': 'poc/offscreen/model.js',
    'assets/style.css': 'poc/offscreen/fixture.css',
  };
  const entries = [];
  for (const [name, source] of Object.entries(sources)) entries.push({ name, data: (await readFile(new URL(source, root), 'utf8')).replaceAll('\r\n', '\n') });
  const manifest = validateOffscreenManifest(JSON.parse(entries[0].data));
  for (const entry of entries) if (entry.name.endsWith('.js')) new vm.Script(entry.data, { filename: entry.name });
  const bytes = makeZip(entries);
  const hash = data => createHash('sha256').update(data).digest('hex');
  const approval = { id: manifest.id, version: manifest.version, sha256: hash(bytes), size: bytes.length,
    assets: Object.fromEntries(entries.map(({ name, data }) => [name, { size: Buffer.byteLength(data), sha256: hash(data) }])) };
  return { bytes, approval };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { bytes, approval } = await buildOwnedPackage();
  await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
  await writeFile(new URL('../artifacts/gamehub-owned-sidebar-1.0.0.zip', import.meta.url), bytes);
  await writeFile(new URL('../artifacts/gamehub-owned-sidebar-1.0.0.approval.json', import.meta.url), JSON.stringify(approval, null, 2) + '\n');
  console.log(`Built owned renderer package: ${bytes.length} bytes, SHA-256 ${approval.sha256}. This command does not grant execution approval.`);
}
