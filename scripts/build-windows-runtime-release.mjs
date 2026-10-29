import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { signWindowsRuntimeManifest } from '../apps/capability-executor/src/runtime-release-contracts.mjs';

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptRoot, '..');
const values = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  if (!process.argv[index]?.startsWith('--') || process.argv[index + 1] == null) {
    throw new Error('Usage: --output DIR --private-key FILE --key-id ID --version SEMVER [--minimum-os-build BUILD]');
  }
  values.set(process.argv[index].slice(2), process.argv[index + 1]);
}
for (const required of ['output', 'private-key', 'key-id', 'version']) {
  if (!values.get(required)) throw new Error(`Missing --${required}`);
}
const output = path.resolve(values.get('output'));
const privateKeyFile = path.resolve(values.get('private-key'));
const minimumOsBuild = Number(values.get('minimum-os-build') ?? 19041);
if (!Number.isSafeInteger(minimumOsBuild)) throw new Error('Invalid --minimum-os-build');
if (await fs.promises.stat(output).then(() => true).catch(() => false)) {
  throw new Error(`Release output already exists: ${output}`);
}
const buildRoot = path.join(repositoryRoot, '.runtime', 'windows-runtime-release-build', crypto.randomUUID());
const staging = `${output}.${crypto.randomUUID()}.staging`;
try {
  await fs.promises.mkdir(buildRoot, { recursive: true });
  const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows',
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const build = spawnSync(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(scriptRoot, 'build-capability-sandbox-host-windows.ps1'), '-OutputDirectory', buildRoot,
    '-SkipFixture'],
  { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true });
  if (build.status !== 0) throw new Error(build.stderr || build.stdout || 'Native helper build failed.');
  const source = path.join(buildRoot, 'MooyuCapabilitySandboxHost.exe');
  const bytes = await fs.promises.readFile(source);
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  const unsigned = { schemaVersion: 'windows-runtime-release-v1',
    runtimeId: 'mooyu.windows.capability-runtime', runtimeVersion: values.get('version'),
    platform: 'win32-x64', minimumOsBuild, keyId: values.get('key-id'),
    files: [{ path: 'bin/MooyuCapabilitySandboxHost.exe', sha256: digest,
      sizeBytes: bytes.length, role: 'sandbox-host' }],
    helper: { path: 'bin/MooyuCapabilitySandboxHost.exe', sha256: digest }, signature: 'pending' };
  const privateKeyPem = await fs.promises.readFile(privateKeyFile, 'utf8');
  const manifest = signWindowsRuntimeManifest(unsigned, privateKeyPem);
  await fs.promises.mkdir(path.join(staging, 'bin'), { recursive: true });
  await fs.promises.copyFile(source, path.join(staging, 'bin', 'MooyuCapabilitySandboxHost.exe'),
    fs.constants.COPYFILE_EXCL);
  await fs.promises.writeFile(path.join(staging, 'runtime.json'),
    `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await fs.promises.mkdir(path.dirname(output), { recursive: true });
  await fs.promises.rename(staging, output);
  process.stdout.write(`${JSON.stringify({ schemaVersion: 'windows-runtime-build-result-v1',
    output, runtimeId: manifest.runtimeId, runtimeVersion: manifest.runtimeVersion,
    helperSha256: digest, keyId: manifest.keyId })}\n`);
} finally {
  await fs.promises.rm(buildRoot, { recursive: true, force: true }).catch(() => {});
  await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => {});
}
