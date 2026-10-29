#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createDesktopNodeStateStore, createDesktopShellInstallationStore,
  createDesktopShellManager, createWindowsCurrentUserStartupRegistry,
  createWindowsDesktopProductManager, createWindowsDesktopReleaseStore,
  createWindowsDpapiCredentialVault } from '../apps/capability-executor/src/index.mjs';

const fail = code => { const error = new Error(code); error.code = code; throw error; };
const ENTRY = fileURLToPath(import.meta.url);
const EXIT = Object.freeze({ ok: 0, config: 10, busy: 20, localState: 30, trust: 40,
  repair: 50, install: 60, internal: 70 });
const exact = (value, required) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === required.length && required.every(key => Object.hasOwn(value, key));
const absolute = value => typeof value === 'string' && path.isAbsolute(value) ? value : null;

export function windowsDesktopProductExitCode(error) {
  const code = String(error?.code ?? error?.message ?? '');
  if (code.includes('BUSY') || code.includes('ALREADY_RUNNING')) return EXIT.busy;
  if (code.includes('SIGNATURE') || code.includes('KEY') || code.includes('HASH')
    || code.includes('FILE_SET') || code.includes('UNTRUSTED')) return EXIT.trust;
  if (code.includes('REPAIR') || code.includes('ROLLBACK')) return EXIT.repair;
  if (code.includes('INSTALL') || code.includes('STARTUP') || code.includes('UNINSTALL')
    || code.includes('PRODUCT_NOT_INSTALLED') || code.includes('STILL_ACTIVE')) return EXIT.install;
  if (code.includes('STATE') || code.includes('CONTROL') || code.includes('STOP_TIMEOUT')) {
    return EXIT.localState;
  }
  if (code.includes('CONFIG') || code.includes('COMMAND') || code.includes('PLATFORM')
    || code.includes('OS_UNSUPPORTED') || code.includes('SOURCE')) return EXIT.config;
  return EXIT.internal;
}

export function normalizeWindowsDesktopProductConfig(value) {
  const keys = ['schemaVersion', 'installRoot', 'dataRoot', 'releaseSource', 'shellConfigPath',
    'startupValueName', 'trustedReleaseKeys'];
  if (!exact(value, keys) || value.schemaVersion !== 'windows-desktop-product-config-v1'
    || !absolute(value.installRoot) || !absolute(value.dataRoot)
    || path.resolve(value.installRoot) === path.resolve(value.dataRoot)
    || !absolute(value.releaseSource) || !absolute(value.shellConfigPath)
    || typeof value.startupValueName !== 'string'
    || !/^[A-Za-z0-9_. -]{1,100}$/u.test(value.startupValueName)
    || !Array.isArray(value.trustedReleaseKeys) || value.trustedReleaseKeys.length < 1
    || value.trustedReleaseKeys.length > 64 || value.trustedReleaseKeys.some(key =>
      !exact(key, ['keyId', 'status', 'publicKeyPem', 'notBefore', 'notAfter'])
      || typeof key.keyId !== 'string' || typeof key.publicKeyPem !== 'string')) {
    fail('CAPABILITY_DESKTOP_PRODUCT_CONFIG_INVALID');
  }
  return structuredClone(value);
}

const osBuild = () => {
  const value = Number(os.release().split('.')[2]);
  if (!Number.isSafeInteger(value) || value < 10240) fail('CAPABILITY_DESKTOP_RELEASE_OS_UNSUPPORTED');
  return value;
};

async function readConfig(file) {
  if (!absolute(file)) fail('CAPABILITY_DESKTOP_PRODUCT_CONFIG_REQUIRED');
  try { return normalizeWindowsDesktopProductConfig(JSON.parse(await fs.promises.readFile(file,
    'utf8'))); }
  catch (error) {
    if (error?.code) throw error;
    fail('CAPABILITY_DESKTOP_PRODUCT_CONFIG_INVALID');
  }
}

export function buildWindowsDesktopProductManager(config, { osBuildNumber = osBuild(),
  startupRegistry = createWindowsCurrentUserStartupRegistry() } = {}) {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    fail('CAPABILITY_DESKTOP_PRODUCT_PLATFORM_UNSUPPORTED');
  }
  const vault = createWindowsDpapiCredentialVault({ directory: path.join(config.dataRoot, 'vault') });
  const installationStore = createDesktopShellInstallationStore({ rootDirectory: config.dataRoot });
  const shellManager = createDesktopShellManager({ rootDirectory: config.dataRoot,
    startupRegistry, stateStore: createDesktopNodeStateStore({ rootDirectory: config.dataRoot }),
    credentialVault: vault, installationStore });
  const productStore = createWindowsDesktopReleaseStore({ installRoot: config.installRoot,
    trustedKeys: config.trustedReleaseKeys, osBuild: osBuildNumber });
  return createWindowsDesktopProductManager({ productStore, shellManager,
    dataRoot: config.dataRoot, configurationPath: config.shellConfigPath,
    startupValueName: config.startupValueName });
}

async function invoke() {
  const args = process.argv.slice(2), command = args[0];
  if (!['install', 'repair', 'recover', 'uninstall', 'status'].includes(command)
    || args.length !== 3 || args[1] !== '--config') {
    fail('CAPABILITY_DESKTOP_PRODUCT_COMMAND_INVALID');
  }
  const config = await readConfig(args[2]);
  const manager = buildWindowsDesktopProductManager(config);
  if (command === 'install') return manager.install({ sourceDirectory: config.releaseSource });
  if (command === 'repair') return manager.repair({ sourceDirectory: config.releaseSource });
  if (command === 'recover') return manager.recover();
  if (command === 'uninstall') return manager.uninstall();
  return manager.status();
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(ENTRY)) {
  invoke().then(result => { process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); })
    .catch(error => {
      const exitCode = windowsDesktopProductExitCode(error);
      process.stderr.write(`${JSON.stringify({ ok: false,
        code: error?.code ?? 'CAPABILITY_DESKTOP_PRODUCT_INTERNAL', exitCode })}\n`);
      process.exitCode = exitCode;
    });
}

export { EXIT as WINDOWS_DESKTOP_PRODUCT_EXIT_CODES };
