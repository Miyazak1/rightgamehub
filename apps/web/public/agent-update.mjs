#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [host, rootArg, quietArg] = process.argv.slice(2);
const supported = new Set(['cursor', 'code', 'harness', 'codex', 'claude']);
if (!supported.has(host)) throw new Error('Usage: agent-update.mjs <cursor|code|harness|codex|claude> [data-root] [--quiet]');
const quiet = quietArg === '--quiet';
const dataRoot = rootArg || path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'gamehub');
const stateRoot = path.join(dataRoot, 'updates');
const stateFile = path.join(stateRoot, `${host}.json`);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const log = value => { if (!quiet) console.log(value); };
await mkdir(stateRoot, { recursive: true });

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Request failed (${response.status}): ${url}`);
  return response.json();
}
async function verifiedArtifact(item) {
  const response = await fetch(item.url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Unable to download ${item.filename}.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (hash(bytes) !== String(item.sha256).toLowerCase()) throw new Error(`SHA-256 verification failed for ${item.filename}.`);
  const output = path.join(stateRoot, item.filename);
  const partial = output + '.part';
  await writeFile(partial, bytes);
  await rename(partial, output);
  return { output, bytes };
}
function run(command, args) {
  const result = spawnSync(command, args, { stdio: quiet ? 'ignore' : 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} rejected the GameHub update.`);
}
async function installPortable(item) {
  const { bytes } = await verifiedArtifact(item);
  const bundle = JSON.parse(bytes.toString('utf8'));
  const marketplaceRoot = path.join(dataRoot, 'agent-marketplace');
  for (const file of bundle.files) {
    const parts = String(file.path).split('/');
    if (path.isAbsolute(file.path) || parts.includes('..')) throw new Error(`Unsafe plugin path: ${file.path}`);
    const contents = Buffer.from(file.contentBase64, 'base64');
    if (hash(contents) !== String(file.sha256).toLowerCase()) throw new Error(`Plugin file verification failed: ${file.path}`);
    const output = path.join(marketplaceRoot, ...parts);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, contents);
  }
  return marketplaceRoot;
}

const manifest = await fetchJson('https://mooyu.fun/downloads/manifest.json');
const updater = manifest.updater?.portable;
if (updater) {
  const currentPath = fileURLToPath(import.meta.url);
  const currentBytes = await readFile(currentPath);
  if (hash(currentBytes) !== String(updater.sha256).toLowerCase()) {
    const response = await fetch(updater.url, { cache: 'no-store' });
    if (!response.ok) throw new Error('Unable to refresh the GameHub updater.');
    const nextBytes = Buffer.from(await response.arrayBuffer());
    if (hash(nextBytes) !== String(updater.sha256).toLowerCase()) throw new Error('GameHub updater self-update verification failed.');
    const nextPath = currentPath + '.next';
    await writeFile(nextPath, nextBytes, { mode: 0o700 });
    await rename(nextPath, currentPath);
    log('GameHub updater refreshed; the new updater will be used on the next check.');
  }
}
if (manifest.channel !== 'stable') throw new Error('GameHub updater only accepts the stable channel.');
let previous = null;
try { previous = JSON.parse(await readFile(stateFile, 'utf8')); } catch {}
let item;
if (host === 'cursor' || host === 'code') item = manifest.editorExtension;
else if (host === 'harness') item = manifest.harnessPlugin;
else item = manifest.agentPlugin;
if (previous?.version === item.version && previous?.sha256 === item.sha256) process.exit(0);

if (host === 'cursor' || host === 'code') {
  const { output } = await verifiedArtifact(item);
  run(host, ['--install-extension', output, '--force']);
} else if (host === 'harness') {
  const { output } = await verifiedArtifact(item);
  run('dsh', ['plugin', '--profile', 'web', 'add', output]);
} else {
  await installPortable(item);
  if (host === 'codex') run('codex', ['plugin', 'marketplace', 'upgrade', 'gamehub']);
  else log(`GameHub ${item.version} is staged for Claude Code. Restart Claude Code and refresh the GameHub marketplace.`);
}
await writeFile(stateFile, JSON.stringify({ host, channel: 'stable', version: item.version, sha256: item.sha256, stagedAt: new Date().toISOString(), restartRequired: true }, null, 2) + '\n');
log(`GameHub ${item.version} is installed or staged for ${host}. Restart the host to activate it.`);
