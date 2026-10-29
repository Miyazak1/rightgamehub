#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createWindowsDesktopUpdater, WINDOWS_DESKTOP_PRODUCT_ID } from
  '../apps/capability-executor/src/index.mjs';
import { buildWindowsDesktopProductManager } from './windows-desktop-product-cli.mjs';

const ENTRY = fileURLToPath(import.meta.url);
const EXIT = Object.freeze({ ok: 0, config: 10, busy: 20, trust: 30, network: 40,
  install: 50, health: 60, internal: 70 });
const KEYS = ['schemaVersion', 'productDirectoryName', 'dataDirectoryName',
  'bundledReleaseSource', 'shellConfigName', 'startupValueName', 'catalogUrl',
  'allowInsecureLocalhost', 'trustedReleaseKeys', 'trustedCatalogKeys'];
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const safeName = value => typeof value === 'string' && /^[A-Za-z0-9_. -]{1,100}$/u.test(value)
  && value !== '.' && value !== '..';
const fail = code => { const error = new Error(code); error.code = code; throw error; };

const validKeys = items => Array.isArray(items) && items.length >= 1 && items.length <= 64
  && items.every(item => exact(item, ['keyId', 'status', 'publicKeyPem', 'notBefore', 'notAfter'])
    && typeof item.keyId === 'string' && typeof item.publicKeyPem === 'string'
    && ['active', 'retired', 'revoked'].includes(item.status));

export function normalizeWindowsDesktopBootstrapConfig(value) {
  if (!exact(value, KEYS) || value.schemaVersion !== 'windows-desktop-bootstrap-config-v1'
    || !safeName(value.productDirectoryName) || !safeName(value.dataDirectoryName)
    || value.productDirectoryName === value.dataDirectoryName
    || typeof value.bundledReleaseSource !== 'string'
    || value.bundledReleaseSource.length < 1 || value.bundledReleaseSource.length > 500
    || path.isAbsolute(value.bundledReleaseSource)
    || value.bundledReleaseSource.split(/[\\/]/u).includes('..')
    || !safeName(value.shellConfigName) || !value.shellConfigName.endsWith('.json')
    || !safeName(value.startupValueName) || typeof value.catalogUrl !== 'string'
    || typeof value.allowInsecureLocalhost !== 'boolean'
    || !validKeys(value.trustedReleaseKeys) || !validKeys(value.trustedCatalogKeys)) {
    fail('CAPABILITY_DESKTOP_BOOTSTRAP_CONFIG_INVALID');
  }
  return structuredClone(value);
}

export function windowsDesktopBootstrapExitCode(error) {
  const code = String(error?.code ?? error?.message ?? '');
  if (code.includes('BUSY') || code.includes('ALREADY_RUNNING')) return EXIT.busy;
  if (code.includes('HEALTH')) return EXIT.health;
  if (code.includes('FETCH') || code.includes('DOWNLOAD') || code.includes('RANGE')) {
    return EXIT.network;
  }
  if (code.includes('SIGN') || code.includes('KEY') || code.includes('HASH')
    || code.includes('REVOK') || code.includes('ROLLBACK') || code.includes('EQUIVOCATION')
    || code.includes('CATALOG')) return EXIT.trust;
  if (code.includes('INSTALL') || code.includes('STARTUP') || code.includes('UNINSTALL')
    || code.includes('REPAIR') || code.includes('STATE') || code.includes('JOURNAL')
    || code.includes('MANIFEST') || code.includes('RELEASE')) return EXIT.install;
  if (code.includes('CONFIG') || code.includes('COMMAND') || code.includes('PLATFORM')
    || code.includes('USER_ROOT') || code.includes('SOURCE')) return EXIT.config;
  return EXIT.internal;
}

const inside = (root, candidate) => {
  const base = `${path.resolve(root)}${path.sep}`, target = path.resolve(candidate);
  return target.startsWith(base) && target !== path.resolve(root);
};

async function writable(directory) {
  await fs.promises.mkdir(directory, { recursive: true });
  const probe = path.join(directory, `.mooyu-write-probe-${process.pid}-${Date.now()}`);
  try { await fs.promises.writeFile(probe, 'probe', { flag: 'wx', mode: 0o600 }); }
  catch { fail('CAPABILITY_DESKTOP_BOOTSTRAP_USER_ROOT_UNWRITABLE'); }
  finally { await fs.promises.rm(probe, { force: true }).catch(() => {}); }
}

const systemBuild = () => {
  const value = Number(os.release().split('.')[2]);
  if (!Number.isSafeInteger(value) || value < 10240) {
    fail('CAPABILITY_DESKTOP_BOOTSTRAP_PLATFORM_UNSUPPORTED');
  }
  return value;
};

export async function buildWindowsDesktopBootstrap(config, { configDirectory,
  localAppData = process.env.LOCALAPPDATA, osBuildNumber = systemBuild(), startupRegistry,
  fetchImpl = globalThis.fetch, platform = process.platform } = {}) {
  config = normalizeWindowsDesktopBootstrapConfig(config);
  if (platform !== 'win32' || process.arch !== 'x64' || !path.isAbsolute(String(localAppData ?? ''))
    || !path.isAbsolute(configDirectory)) fail('CAPABILITY_DESKTOP_BOOTSTRAP_PLATFORM_UNSUPPORTED');
  const installRoot = path.resolve(localAppData, config.productDirectoryName);
  const dataRoot = path.resolve(localAppData, config.dataDirectoryName);
  if (!inside(localAppData, installRoot) || !inside(localAppData, dataRoot)) {
    fail('CAPABILITY_DESKTOP_BOOTSTRAP_USER_ROOT_INVALID');
  }
  const bundledReleaseSource = path.resolve(configDirectory, config.bundledReleaseSource);
  if (!inside(configDirectory, bundledReleaseSource)
    && bundledReleaseSource !== path.resolve(configDirectory)) {
    fail('CAPABILITY_DESKTOP_BOOTSTRAP_SOURCE_INVALID');
  }
  await writable(installRoot);
  await writable(dataRoot);
  const productConfig = { schemaVersion: 'windows-desktop-product-config-v1', installRoot,
    dataRoot, releaseSource: bundledReleaseSource,
    shellConfigPath: path.join(dataRoot, config.shellConfigName),
    startupValueName: config.startupValueName, trustedReleaseKeys: config.trustedReleaseKeys };
  const manager = buildWindowsDesktopProductManager(productConfig,
    { osBuildNumber, ...(startupRegistry ? { startupRegistry } : {}) });
  const updater = createWindowsDesktopUpdater({ rootDirectory: path.join(dataRoot,
    'desktop-product-updater'), productId: WINDOWS_DESKTOP_PRODUCT_ID, productManager: manager,
    trustedCatalogKeys: config.trustedCatalogKeys, catalogUrl: config.catalogUrl,
    fetchImpl, platform, osBuild: osBuildNumber,
    allowInsecureLocalhost: config.allowInsecureLocalhost });
  return { manager, updater, paths: { installRoot, dataRoot, bundledReleaseSource } };
}

async function invoke(argv) {
  const command = argv[0];
  if (!['install', 'update', 'status', 'recover', 'repair', 'uninstall'].includes(command)
    || argv.length !== 3 || argv[1] !== '--config' || typeof argv[2] !== 'string') {
    fail('CAPABILITY_DESKTOP_BOOTSTRAP_COMMAND_INVALID');
  }
  const configFile = path.resolve(argv[2]), configDirectory = path.dirname(configFile);
  let config;
  try { config = JSON.parse(await fs.promises.readFile(configFile, 'utf8')); }
  catch { fail('CAPABILITY_DESKTOP_BOOTSTRAP_CONFIG_INVALID'); }
  const built = await buildWindowsDesktopBootstrap(config, { configDirectory });
  if (command === 'install') {
    return built.manager.install({ sourceDirectory: built.paths.bundledReleaseSource });
  }
  if (command === 'update' || command === 'repair') return built.updater.checkAndApply();
  if (command === 'recover') {
    const updateRecovery = await built.updater.recover();
    const productRecovery = await built.manager.recover();
    return { schemaVersion: 'windows-desktop-bootstrap-recovery-v1', updateRecovery,
      productRecovery };
  }
  if (command === 'uninstall') return built.manager.uninstall();
  return { schemaVersion: 'windows-desktop-bootstrap-status-v1',
    product: await built.manager.status(), updater: await built.updater.status(),
    paths: built.paths };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(ENTRY)) {
  invoke(process.argv.slice(2)).then(result => {
    process.stdout.write(`${JSON.stringify({ ok: true, result }, null, 2)}\n`);
    process.exitCode = EXIT.ok;
  }).catch(error => {
    const exitCode = windowsDesktopBootstrapExitCode(error);
    process.stderr.write(`${JSON.stringify({ ok: false,
      code: error?.code ?? 'CAPABILITY_DESKTOP_BOOTSTRAP_INTERNAL', exitCode })}\n`);
    process.exitCode = exitCode;
  });
}

export { EXIT as WINDOWS_DESKTOP_BOOTSTRAP_EXIT_CODES };
