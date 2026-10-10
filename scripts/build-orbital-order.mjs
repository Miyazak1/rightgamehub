import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createZipBuffer } from '../apps/api/src/zip-buffer-writer.mjs';
import { validateWebZip } from '../apps/api/src/web-zip-validator.mjs';
import { inspectStaticWebProject } from '../packages/creator-tools/src/index.mjs';

const root = path.resolve(import.meta.dirname, '..');
const sample = path.join(root, 'samples/orbital-order');
const upstream = path.join(sample, 'upstream/src');
const output = path.join(root, '.runtime/orbital-order-web');
const artifact = path.join(root, 'artifacts/orbital-order-gamehub-v1.zip');
const expectedCommit = '3d9fe2af2384b04404266b50805d8cd896a5dab8';

await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(output, { recursive: true });

const files = [];
async function collect(directory, prefix = '') {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await collect(path.join(directory, entry.name), relative);
    else {
      let data = await fs.readFile(path.join(directory, entry.name));
      if (/\.js$/u.test(relative)) {
        const source = data.toString('utf8').replaceAll('localStorage.getItem', 'gamehubSafeStorage.getItem').replaceAll('localStorage.setItem', 'gamehubSafeStorage.setItem');
        data = Buffer.from(source);
      }
      files.push({ name: relative, data });
    }
  }
}
await collect(upstream);

const index = files.find(file => file.name === 'index.html');
let html = index.data.toString('utf8');
html = html
  .replace('<title>Atomic Puzzle Game - js13k Demo</title>', '<title>Orbital Order · 轨道秩序</title><meta name="description" content="用吸引与排斥引导电子，按照构造原理填满原子轨道。">')
  .replace('</head>', '<link rel="stylesheet" href="gamehub.css"></head>')
  .replace('<!-- Component Scripts -->', '<script src="gamehub-safe-storage.js"></script>\n    <!-- Component Scripts -->')
  .replace('return window.innerWidth >= 600 && window.innerHeight >= 450;', 'return true;')
  .replace('</body>', '<div class="gamehub-credit">Original game: Afton Gauntlett · MIT</div><script src="gamehub-adapter.js"></script></body>');
index.data = Buffer.from(html);

for (const name of ['gamehub.css','gamehub-safe-storage.js','gamehub-adapter.js','platform.json','LICENSE.txt']) {
  files.push({ name, data: await fs.readFile(path.join(sample, name)) });
}
for (const file of files) {
  const destination = path.join(output, ...file.name.split('/'));
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, file.data);
}

const doctor = await inspectStaticWebProject(output);
if (!doctor.ok) throw new Error(`Local Doctor failed:\n${JSON.stringify(doctor.findings, null, 2)}`);
await fs.mkdir(path.dirname(artifact), { recursive: true });
const archive = createZipBuffer(files);
await fs.writeFile(artifact, archive);
const validationRoot = await fs.mkdtemp(path.join(root, '.runtime/orbital-order-validation-'));
let validation;
try {
  validation = await validateWebZip(artifact, path.join(validationRoot, 'expanded'));
} finally {
  await fs.rm(validationRoot, { recursive: true, force: true });
}
const report = {
  artifact,
  sha256: crypto.createHash('sha256').update(archive).digest('hex'),
  bytes: archive.length,
  files: validation.fileCount,
  entry: validation.entry,
  capabilities: validation.approvedCapabilities,
  upstream: { repository: 'https://github.com/aftongauntlett/js13k-demo', commit: expectedCommit, license: 'MIT', author: 'Afton Gauntlett' },
  doctor: doctor.summary,
};
await fs.writeFile(path.join(output, 'build-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
