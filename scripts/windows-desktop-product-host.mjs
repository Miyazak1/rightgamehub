#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const fail = code => { const error = new Error(code); error.code = code; throw error; };
const entry = fileURLToPath(import.meta.url);
const directory = path.dirname(entry);
const option = (args, name) => {
  const index = args.indexOf(name); return index >= 0 && index + 1 < args.length ? args[index + 1] : null;
};

export function resolveWindowsDesktopProductComposition({ entryFile = entry } = {}) {
  const scripts = path.dirname(entryFile);
  const appRoot = path.resolve(scripts, '..', '..');
  return { node: process.execPath,
    shell: path.join(scripts, 'windows-desktop-shell-cli.mjs'),
    tray: path.join(appRoot, 'bin', 'MooyuCapabilityTray.exe') };
}

async function run() {
  const args = process.argv.slice(2);
  if (args[0] !== 'serve' || args.length !== 5 || args[1] !== '--config'
    || args[3] !== '--root' || !path.isAbsolute(args[2]) || !path.isAbsolute(args[4])) {
    fail('CAPABILITY_DESKTOP_PRODUCT_HOST_COMMAND_INVALID');
  }
  const paths = resolveWindowsDesktopProductComposition();
  const tray = spawn(paths.tray, ['--root', args[4]], { windowsHide: true, stdio: 'ignore' });
  tray.on('error', () => {});
  const shell = spawn(paths.node, [paths.shell, 'serve', '--config', args[2]], {
    windowsHide: true, stdio: 'inherit' });
  const stop = () => { if (!shell.killed) shell.kill(); if (!tray.killed) tray.kill(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const code = await new Promise((resolve, reject) => {
    shell.once('error', reject); shell.once('exit', value => resolve(value ?? 70));
  });
  if (!tray.killed) tray.kill();
  process.exitCode = code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(entry)) {
  run().catch(error => {
    process.stderr.write(`${JSON.stringify({ ok: false,
      code: error?.code ?? 'CAPABILITY_DESKTOP_PRODUCT_HOST_INTERNAL' })}\n`);
    process.exitCode = 70;
  });
}
