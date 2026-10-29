#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { signWindowsDesktopReleaseManifest } from
  '../apps/capability-executor/src/desktop-release-contracts.mjs';

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptRoot, '..');
const values = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  if (!process.argv[index]?.startsWith('--') || process.argv[index + 1] == null) {
    throw new Error('Usage: --output DIR --private-key FILE --key-id ID --version SEMVER [--minimum-os-build BUILD] [--node-executable FILE]');
  }
  values.set(process.argv[index].slice(2), process.argv[index + 1]);
}
for (const required of ['output', 'private-key', 'key-id', 'version']) {
  if (!values.get(required)) throw new Error(`Missing --${required}`);
}
const output = path.resolve(values.get('output'));
const privateKeyFile = path.resolve(values.get('private-key'));
const nodeExecutable = path.resolve(values.get('node-executable') ?? process.execPath);
const minimumOsBuild = Number(values.get('minimum-os-build') ?? 19041);
if (!Number.isSafeInteger(minimumOsBuild)) throw new Error('Invalid --minimum-os-build');
if (await fs.promises.stat(output).then(() => true).catch(() => false)) {
  throw new Error(`Release output already exists: ${output}`);
}

const buildRoot = path.join(repositoryRoot, '.runtime', 'windows-desktop-release-build',
  crypto.randomUUID());
const staging = `${output}.${crypto.randomUUID()}.staging`;
const normalize = value => value.split(path.sep).join('/');

async function renameWithWindowsRetry(from, to) {
  for (let attempt = 0; ; attempt += 1) {
    try { await fs.promises.rename(from, to); return; }
    catch (error) {
      if (!['EPERM', 'EACCES'].includes(error?.code) || attempt >= 7) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.min(25 * 2 ** attempt, 400)));
    }
  }
}

async function copyDirectory(source, destination) {
  const resolved = await fs.promises.realpath(source);
  const entries = await fs.promises.readdir(resolved, { withFileTypes: true });
  await fs.promises.mkdir(destination, { recursive: true });
  for (const item of entries) {
    const from = path.join(resolved, item.name), to = path.join(destination, item.name);
    if (item.isDirectory()) await copyDirectory(from, to);
    else if (item.isFile()) await fs.promises.copyFile(from, to, fs.constants.COPYFILE_EXCL);
    else throw new Error(`Unsupported release entry: ${from}`);
  }
}

async function copyPackage(packageName, resolver, destinationRoot, visited = new Set()) {
  if (visited.has(packageName)) return;
  const packageJson = resolver.resolve(`${packageName}/package.json`);
  const metadata = JSON.parse(await fs.promises.readFile(packageJson, 'utf8'));
  visited.add(packageName);
  await copyDirectory(path.dirname(packageJson), path.join(destinationRoot, ...packageName.split('/')));
  const childResolver = createRequire(packageJson);
  for (const dependency of Object.keys(metadata.dependencies ?? {}).sort()) {
    await copyPackage(dependency, childResolver, destinationRoot, visited);
  }
}

async function listFiles(root, directory = root) {
  const entries = await fs.promises.readdir(directory, { withFileTypes: true }), files = [];
  for (const item of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(directory, item.name);
    if (item.isDirectory()) files.push(...await listFiles(root, absolute));
    else if (item.isFile()) files.push(normalize(path.relative(root, absolute)));
    else throw new Error(`Unsupported staged entry: ${absolute}`);
  }
  return files;
}

async function digest(file) {
  const bytes = await fs.promises.readFile(file);
  return { sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.length };
}

try {
  await fs.promises.mkdir(buildRoot, { recursive: true });
  const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows',
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const trayBuild = path.join(buildRoot, 'tray'), sandboxBuild = path.join(buildRoot, 'sandbox');
  for (const [script, destination, extra] of [
    ['build-capability-tray-windows.ps1', trayBuild, []],
    ['build-capability-sandbox-host-windows.ps1', sandboxBuild, ['-SkipFixture']],
  ]) {
    const result = spawnSync(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(scriptRoot, script), '-OutputDirectory', destination, ...extra],
    { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || `${script} failed`);
  }
  const files = {
    'bin/node.exe': nodeExecutable,
    'bin/MooyuCapabilityTray.exe': path.join(trayBuild, 'MooyuCapabilityTray.exe'),
    'bin/MooyuCapabilitySandboxHost.exe': path.join(sandboxBuild,
      'MooyuCapabilitySandboxHost.exe'),
  };
  for (const [relative, source] of Object.entries(files)) {
    const destination = path.join(staging, ...relative.split('/'));
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    await fs.promises.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
  }
  const scripts = ['windows-desktop-product-host.mjs', 'windows-desktop-shell-cli.mjs',
    'windows-desktop-product-cli.mjs', 'windows-desktop-node-cli.mjs',
    'windows-runtime-update-cli.mjs', 'windows-desktop-bootstrap-cli.mjs'];
  for (const name of scripts) {
    const destination = path.join(staging, 'app', 'scripts', name);
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    await fs.promises.copyFile(path.join(scriptRoot, name), destination, fs.constants.COPYFILE_EXCL);
  }
  await copyDirectory(path.join(repositoryRoot, 'apps', 'capability-executor', 'src'),
    path.join(staging, 'app', 'apps', 'capability-executor', 'src'));
  await fs.promises.copyFile(path.join(repositoryRoot, 'apps', 'capability-executor', 'package.json'),
    path.join(staging, 'app', 'apps', 'capability-executor', 'package.json'),
    fs.constants.COPYFILE_EXCL);
  await copyDirectory(path.join(repositoryRoot, 'packages', 'host-contract'),
    path.join(staging, 'app', 'packages', 'host-contract'));
  await copyDirectory(path.join(repositoryRoot, 'packages', 'agent-capabilities'),
    path.join(staging, 'app', 'packages', 'agent-capabilities'));
  const packageResolver = createRequire(path.join(repositoryRoot, 'apps', 'capability-executor',
    'package.json'));
  await copyPackage('yauzl', packageResolver, path.join(staging, 'app', 'node_modules'));

  const entrypointPaths = Object.freeze({ nodeRuntime: 'bin/node.exe',
    shell: 'app/scripts/windows-desktop-product-host.mjs',
    tray: 'bin/MooyuCapabilityTray.exe',
    sandboxHost: 'bin/MooyuCapabilitySandboxHost.exe' });
  const roleByEntrypoint = new Map([
    [entrypointPaths.nodeRuntime, 'node-runtime'], [entrypointPaths.shell, 'desktop-shell'],
    [entrypointPaths.tray, 'tray'], [entrypointPaths.sandboxHost, 'sandbox-host'],
  ]);
  const releaseFiles = [];
  for (const relative of await listFiles(staging)) {
    const metadata = await digest(path.join(staging, ...relative.split('/')));
    releaseFiles.push({ path: relative, ...metadata,
      role: roleByEntrypoint.get(relative) ?? 'runtime-support' });
  }
  const entrypoints = {};
  for (const [name, entryPath] of Object.entries(entrypointPaths)) {
    entrypoints[name] = { path: entryPath,
      sha256: releaseFiles.find(file => file.path === entryPath).sha256 };
  }
  const unsigned = { schemaVersion: 'windows-desktop-release-v1',
    productId: 'mooyu.windows.capability-desktop', productVersion: values.get('version'),
    platform: 'win32-x64', minimumOsBuild, keyId: values.get('key-id'), files: releaseFiles,
    entrypoints, signature: 'pending' };
  const privateKeyPem = await fs.promises.readFile(privateKeyFile, 'utf8');
  const manifest = signWindowsDesktopReleaseManifest(unsigned, privateKeyPem);
  await fs.promises.writeFile(path.join(staging, 'desktop.json'),
    `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await fs.promises.mkdir(path.dirname(output), { recursive: true });
  await renameWithWindowsRetry(staging, output);
  process.stdout.write(`${JSON.stringify({ schemaVersion: 'windows-desktop-build-result-v1',
    output, productId: manifest.productId, productVersion: manifest.productVersion,
    fileCount: manifest.files.length, keyId: manifest.keyId })}\n`);
} finally {
  await fs.promises.rm(buildRoot, { recursive: true, force: true }).catch(() => {});
  await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => {});
}
