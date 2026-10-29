import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index < 0 ? null : args[index + 1]; };
const output = option('--output');
const version = option('--version') ?? '1.0.0';
if (!output || !path.isAbsolute(output) || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(version)) {
  throw new Error('PAPER_LAYOUT_PACKAGE_BUILD_ARGUMENTS_INVALID');
}
if (await fs.promises.lstat(output).catch(() => null)) throw new Error('PAPER_LAYOUT_PACKAGE_OUTPUT_EXISTS');

const files = [
  { path: 'bin/node.exe', source: process.execPath, executable: true },
  { path: 'app/worker.mjs', source: path.join(root, 'scripts', 'paper-layout-capability-worker.mjs'), executable: false },
  { path: 'lib/paper-layout.mjs', source: path.join(root, 'packages', 'agent-capabilities', 'src', 'paper-layout.mjs'), executable: false },
  { path: 'lib/execution.mjs', source: path.join(root, 'packages', 'agent-capabilities', 'src', 'execution.mjs'), executable: false },
];
const digest = async file => {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
};

await fs.promises.mkdir(output, { recursive: false });
try {
  const manifestFiles = [];
  for (const item of files) {
    const destination = path.join(output, ...item.path.split('/'));
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    await fs.promises.copyFile(item.source, destination, fs.constants.COPYFILE_EXCL);
    const stats = await fs.promises.stat(destination);
    manifestFiles.push({ path: item.path, sha256: await digest(destination),
      sizeBytes: stats.size, executable: item.executable });
  }
  const manifest = { schemaVersion: 'capability-package-v1',
    capabilityId: 'mooyu.research.paper.layout', capabilityVersion: version,
    contract: { key: 'research.paper.layout', version: 1 },
    entrypoint: { kind: 'native-executable', path: 'bin/node.exe',
      arguments: ['{{PACKAGE_ROOT}}/app/worker.mjs'] },
    files: manifestFiles };
  await fs.promises.writeFile(path.join(output, 'capability.json'), JSON.stringify(manifest, null, 2),
    { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ schemaVersion: 'paper-layout-package-build-v1',
    output, capabilityVersion: version, fileCount: manifestFiles.length })}\n`);
} catch (error) {
  await fs.promises.rm(output, { recursive: true, force: true }).catch(() => {});
  throw error;
}
