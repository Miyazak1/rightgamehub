import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const extensionPackage = JSON.parse(await readFile(new URL('extensions/vscode/package.json', root), 'utf8'));
const filename = `${extensionPackage.name}-${extensionPackage.version}.vsix`;
const artifact = new URL(`artifacts/${filename}`, root);
const publicRoot = new URL('apps/web/public/downloads/', root);
const content = await readFile(artifact);
const sha256 = createHash('sha256').update(content).digest('hex');

await mkdir(publicRoot, { recursive: true });
await copyFile(artifact, new URL(filename, publicRoot));
await copyFile(artifact, new URL('gamehub-agent-latest.vsix', publicRoot));
await writeFile(new URL('manifest.json', publicRoot), JSON.stringify({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  editorExtension: {
    version: extensionPackage.version,
    extensionId: `${extensionPackage.publisher}.${extensionPackage.name}`,
    filename,
    url: `https://mooyu.fun/downloads/${filename}`,
    sha256,
    supportedHosts: ['cursor', 'code'],
  },
}, null, 2) + '\n');
console.log(`Prepared GameHub editor download ${filename} (${sha256})`);
