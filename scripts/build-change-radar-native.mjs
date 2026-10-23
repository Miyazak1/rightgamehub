import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { build } = (() => {
  try { return require('esbuild'); }
  catch { return createRequire(path.join(root, 'extensions', 'harness', 'package.json'))('esbuild'); }
})();
const output = path.join(root, 'artifacts', 'change-radar-native');
const staging = path.join(output, 'staging');
const worker = path.join(staging, 'worker.mjs');
const executable = path.join(output, 'MOOYU-Change-Radar.exe');
const compiler = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
if (process.platform !== 'win32') throw new Error('The Change Radar native package can only be built on Windows.');
if (!existsSync(compiler)) throw new Error('.NET Framework x64 C# compiler is required.');

await mkdir(staging, { recursive: true });
await build({
  entryPoints: [path.join(root, 'apps', 'api', 'src', 'researcher-worker-cli.mjs')],
  outfile: worker,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
});

const args = [
  '/nologo', '/optimize+', '/target:winexe', '/platform:x64',
  '/r:System.dll', '/r:System.Core.dll', '/r:System.Drawing.dll', '/r:System.Security.dll', '/r:System.Web.Extensions.dll', '/r:System.Windows.Forms.dll',
  `/win32manifest:${path.join(root, 'native', 'change-radar', 'app.manifest')}`,
  `/resource:${process.execPath},Mooyu.ChangeRadar.node.exe`,
  `/resource:${worker},Mooyu.ChangeRadar.worker.mjs`,
  `/out:${executable}`,
  path.join(root, 'native', 'change-radar', 'ChangeRadarNode.cs'),
];
const compiled = spawnSync(compiler, args, { cwd: root, encoding: 'utf8', windowsHide: true });
if (compiled.status !== 0) throw new Error([compiled.stdout, compiled.stderr].filter(Boolean).join('\n') || 'Native compilation failed.');

const bytes = await readFile(executable);
const details = await stat(executable);
const report = {
  schemaVersion: 1,
  builtAt: new Date().toISOString(),
  fileName: path.basename(executable),
  packageType: 'windows_standalone_exe',
  targetKey: 'windows-x64',
  sizeBytes: details.size,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  requiresAdmin: false,
  opensInboundPort: false,
  bundledRuntime: `node-${process.versions.node}`,
  distributionStatus: 'developer-preview',
  authenticodeSigned: false,
  publicationBlockers: ['authenticode-code-signing', 'malware-scan', 'bundled-runtime-license-notices'],
};
await writeFile(path.join(output, 'build-report.json'), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
