#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeWindowsDesktopReleaseManifest,
  verifyWindowsDesktopReleaseManifest } from
  '../apps/capability-executor/src/desktop-release-contracts.mjs';
import { normalizeWindowsDesktopBootstrapConfig } from './windows-desktop-bootstrap-cli.mjs';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  if (!['--release', '--output', '--config'].includes(process.argv[index])
    || process.argv[index + 1] == null || args.has(process.argv[index])) {
    throw new Error('Usage: build-windows-desktop-bootstrap-package.mjs --release DIR --output DIR --config FILE');
  }
  args.set(process.argv[index], process.argv[index + 1]);
}
if (args.size !== 3) throw new Error('Missing required argument');
const releaseDirectory = path.resolve(args.get('--release'));
const output = path.resolve(args.get('--output'));
const configFile = path.resolve(args.get('--config'));
const staging = `${output}.${crypto.randomUUID()}.staging`;

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
  const entries = await fs.promises.readdir(source, { withFileTypes: true });
  await fs.promises.mkdir(destination, { recursive: true });
  for (const entry of entries) {
    const from = path.join(source, entry.name), to = path.join(destination, entry.name);
    if (entry.isDirectory()) await copyDirectory(from, to);
    else if (entry.isFile()) await fs.promises.copyFile(from, to, fs.constants.COPYFILE_EXCL);
    else throw new Error(`Unsupported release entry: ${from}`);
  }
}

async function listFiles(root, directory = root) {
  const entries = await fs.promises.readdir(directory, { withFileTypes: true }), files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(root, absolute));
    else if (entry.isFile()) files.push(path.relative(root, absolute).split(path.sep).join('/'));
    else throw new Error(`Unsupported release entry: ${absolute}`);
  }
  return files;
}

async function digest(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

try {
  if (await fs.promises.stat(output).then(() => true).catch(() => false)) {
    throw new Error(`Bootstrap output already exists: ${output}`);
  }
  const rawConfig = JSON.parse(await fs.promises.readFile(configFile, 'utf8'));
  const config = normalizeWindowsDesktopBootstrapConfig({ ...rawConfig,
    bundledReleaseSource: 'release' });
  const manifestFile = path.join(releaseDirectory, 'desktop.json');
  const manifest = normalizeWindowsDesktopReleaseManifest(JSON.parse(
    await fs.promises.readFile(manifestFile, 'utf8')));
  verifyWindowsDesktopReleaseManifest({ manifest, trustedKeys: config.trustedReleaseKeys,
    platform: 'win32-x64', osBuild: manifest.minimumOsBuild });
  const actual = (await listFiles(releaseDirectory)).sort();
  const expected = ['desktop.json', ...manifest.files.map(file => file.path)].sort();
  if (actual.length !== expected.length
    || actual.some((value, index) => value !== expected[index])) {
    throw new Error('Release directory file set does not match desktop manifest');
  }
  for (const file of manifest.files) {
    const absolute = path.join(releaseDirectory, ...file.path.split('/'));
    const stats = await fs.promises.stat(absolute);
    if (!stats.isFile() || stats.size !== file.sizeBytes || await digest(absolute) !== file.sha256) {
      throw new Error(`Release file does not match desktop manifest: ${file.path}`);
    }
  }
  const bootstrapCli = path.join(releaseDirectory, 'app', 'scripts',
    'windows-desktop-bootstrap-cli.mjs');
  if (!await fs.promises.stat(bootstrapCli).then(stats => stats.isFile()).catch(() => false)) {
    throw new Error('Release does not contain the bootstrap CLI');
  }
  await copyDirectory(releaseDirectory, path.join(staging, 'release'));
  await fs.promises.writeFile(path.join(staging, 'bootstrap.json'),
    `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  const command = commandName => [
    '@echo off',
    'setlocal',
    'cd /d "%~dp0"',
    `"%~dp0release\\bin\\node.exe" "%~dp0release\\app\\scripts\\windows-desktop-bootstrap-cli.mjs" ${commandName} --config "%~dp0bootstrap.json"`,
    'exit /b %ERRORLEVEL%',
    '',
  ].join('\r\n');
  for (const [name, operation] of [['install-user.cmd', 'install'], ['update-user.cmd', 'update'],
    ['repair-user.cmd', 'repair'], ['uninstall-user.cmd', 'uninstall']]) {
    await fs.promises.writeFile(path.join(staging, name), command(operation),
      { encoding: 'utf8', mode: 0o700, flag: 'wx' });
  }
  await fs.promises.writeFile(path.join(staging, 'README.txt'),
    '墨鱼工坊普通用户桌面安装包\r\n双击 install-user.cmd 安装。无需管理员权限。\r\n用户数据默认不会在卸载时删除。\r\n',
    { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await fs.promises.mkdir(path.dirname(output), { recursive: true });
  await renameWithWindowsRetry(staging, output);
  process.stdout.write(`${JSON.stringify({ schemaVersion:
    'windows-desktop-bootstrap-build-result-v1', output, productVersion:
    manifest.productVersion })}\n`);
} finally {
  await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => {});
}
