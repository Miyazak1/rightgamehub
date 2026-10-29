#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWindowsRuntimeReleaseStore } from '../apps/capability-executor/src/runtime-release-store.mjs';
import { createWindowsRuntimeUpdater } from '../apps/capability-executor/src/windows-runtime-updater.mjs';

const EXIT = Object.freeze({ ok: 0, config: 10, trust: 20, download: 30,
  install: 40, health: 50, busy: 60, internal: 70 });
const CONFIG_KEYS = ['schemaVersion', 'rootDirectory', 'runtimeId', 'catalogUrl',
  'runtimeReleaseKeys', 'catalogKeys', 'allowInsecureLocalhost'];

export function windowsRuntimeUpdaterExitCode(error) {
  const code = String(error?.code ?? error?.message ?? '');
  if (code.includes('BUSY')) return EXIT.busy;
  if (code.includes('HEALTH')) return EXIT.health;
  if (code.includes('DOWNLOAD') || code.includes('FETCH')) return EXIT.download;
  if (code.includes('SIGN') || code.includes('KEY') || code.includes('CATALOG')
    || code.includes('REVOK') || code.includes('ROLLBACK') || code.includes('EQUIVOCATION')) return EXIT.trust;
  if (code.includes('CONFIG') || code.includes('INPUT') || code.includes('URL_INVALID')) return EXIT.config;
  if (code.includes('INSTALL') || code.includes('ARCHIVE') || code.includes('MANIFEST')
    || code.includes('RELEASE') || code.includes('STATE') || code.includes('JOURNAL')) return EXIT.install;
  return EXIT.internal;
}

function exact(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

async function loadKeys(items, base) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 64) throw Object.assign(
    new Error('CAPABILITY_RUNTIME_UPDATER_CLI_CONFIG_INVALID'),
    { code: 'CAPABILITY_RUNTIME_UPDATER_CLI_CONFIG_INVALID' });
  return Promise.all(items.map(async item => {
    if (!exact(item, ['keyId', 'status', 'publicKeyFile', 'notBefore', 'notAfter'])
      || typeof item.publicKeyFile !== 'string') throw Object.assign(
      new Error('CAPABILITY_RUNTIME_UPDATER_CLI_CONFIG_INVALID'),
      { code: 'CAPABILITY_RUNTIME_UPDATER_CLI_CONFIG_INVALID' });
    const publicKeyPem = await fs.promises.readFile(path.resolve(base, item.publicKeyFile), 'utf8');
    return { keyId: item.keyId, status: item.status, publicKeyPem,
      notBefore: item.notBefore, notAfter: item.notAfter };
  }));
}

async function main(argv) {
  const command = argv[0], configFlag = argv[1], configValue = argv[2];
  if (!['apply', 'status', 'recover'].includes(command) || configFlag !== '--config'
    || typeof configValue !== 'string' || argv.length !== 3) {
    throw Object.assign(new Error('usage: windows-runtime-update-cli.mjs <apply|status|recover> --config FILE'),
      { code: 'CAPABILITY_RUNTIME_UPDATER_CLI_CONFIG_INVALID' });
  }
  const configFile = path.resolve(configValue), base = path.dirname(configFile);
  const config = JSON.parse(await fs.promises.readFile(configFile, 'utf8'));
  if (!exact(config, CONFIG_KEYS) || config.schemaVersion !== 'windows-runtime-updater-cli-v1'
    || !path.isAbsolute(config.rootDirectory) || typeof config.runtimeId !== 'string'
    || typeof config.catalogUrl !== 'string' || typeof config.allowInsecureLocalhost !== 'boolean') {
    throw Object.assign(new Error('CAPABILITY_RUNTIME_UPDATER_CLI_CONFIG_INVALID'),
      { code: 'CAPABILITY_RUNTIME_UPDATER_CLI_CONFIG_INVALID' });
  }
  const runtimeReleaseKeys = await loadKeys(config.runtimeReleaseKeys, base);
  const catalogKeys = await loadKeys(config.catalogKeys, base);
  const release = os.release().split('.');
  const osBuild = Number(release[2]);
  if (process.platform !== 'win32' || !Number.isSafeInteger(osBuild)) throw Object.assign(
    new Error('CAPABILITY_RUNTIME_UPDATER_CLI_PLATFORM_UNSUPPORTED'),
    { code: 'CAPABILITY_RUNTIME_UPDATER_CLI_CONFIG_INVALID' });
  const store = createWindowsRuntimeReleaseStore({ rootDirectory: path.join(config.rootDirectory, 'runtime'),
    trustedKeys: runtimeReleaseKeys, osBuild });
  const updater = createWindowsRuntimeUpdater({ rootDirectory: path.join(config.rootDirectory, 'updater'),
    runtimeId: config.runtimeId, runtimeStore: store, trustedCatalogKeys: catalogKeys,
    catalogUrl: config.catalogUrl, osBuild, allowInsecureLocalhost: config.allowInsecureLocalhost });
  if (command === 'apply') return updater.checkAndApply();
  if (command === 'recover') return updater.recover();
  return updater.status();
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).then(result => {
    process.stdout.write(`${JSON.stringify({ ok: true, result })}\n`);
    process.exitCode = EXIT.ok;
  }).catch(error => {
    const exitCode = windowsRuntimeUpdaterExitCode(error);
    process.stderr.write(`${JSON.stringify({ ok: false, code: error?.code ?? 'CAPABILITY_RUNTIME_UPDATE_INTERNAL', exitCode })}\n`);
    process.exitCode = exitCode;
  });
}

export { EXIT as WINDOWS_RUNTIME_UPDATER_EXIT_CODES };
