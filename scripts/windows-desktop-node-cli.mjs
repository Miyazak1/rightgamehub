#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createCapabilityPackageStore, createDesktopNodeStateStore,
  createDesktopNodeSupervisor, createExecutionNodeApiClient, exportDesktopNodeDiagnostics,
  createWindowsDpapiCredentialVault, createWindowsExecutorBootstrap,
  createWindowsRuntimeReleaseStore, createWindowsRuntimeUpdater } from
  '../apps/capability-executor/src/index.mjs';

const fail = code => { const error = new Error(code); error.code = code; throw error; };
const EXIT = Object.freeze({ ok: 0, config: 10, running: 20, localState: 30,
  trust: 40, runtime: 50, internal: 70 });
export function windowsDesktopNodeExitCode(error) {
  const code = String(error?.code ?? error?.message ?? '');
  if (code.includes('ALREADY_RUNNING') || code.includes('BUSY')) return EXIT.running;
  if (code.includes('STATE') || code.includes('CONTROL') || code.includes('DIAGNOSTICS')) {
    return EXIT.localState;
  }
  if (code.includes('SESSION') || code.includes('SIGNATURE') || code.includes('KEY')
    || code.includes('ROLLBACK') || code.includes('EQUIVOCATION') || code.includes('REVOK')) {
    return EXIT.trust;
  }
  if (code.includes('CONFIG') || code.includes('COMMAND') || code.includes('ROOT_REQUIRED')
    || code.includes('OUTPUT_REQUIRED') || code.includes('PLATFORM_UNSUPPORTED')
    || code.includes('OS_BUILD')) return EXIT.config;
  if (code.includes('RUNTIME') || code.includes('PACKAGE') || code.includes('BOOTSTRAP')
    || code.includes('UPDATE') || code.includes('DOWNLOAD')) return EXIT.runtime;
  return EXIT.internal;
}
const exactKeys = (value, required, optional = []) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return required.every(key => keys.includes(key))
    && keys.every(key => required.includes(key) || optional.includes(key));
};
const option = (args, name) => {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length) return null;
  return args[index + 1];
};
const absolute = value => typeof value === 'string' && path.isAbsolute(value) ? value : null;
const readJson = async file => {
  try { return JSON.parse(await fs.promises.readFile(file, 'utf8')); }
  catch { fail('CAPABILITY_DESKTOP_NODE_CONFIG_INVALID'); }
};
const osBuild = () => {
  const value = Number(os.release().split('.')[2]);
  if (!Number.isSafeInteger(value) || value < 1) fail('CAPABILITY_DESKTOP_NODE_OS_BUILD_INVALID');
  return value;
};

export function normalizeWindowsDesktopNodeConfig(value) {
  const required = ['schemaVersion', 'dataRoot', 'apiBaseUrl', 'runtimeId', 'catalogUrl',
    'resources', 'metadata', 'trustedRuntimeKeys', 'trustedCatalogKeys', 'trustedPackageKeys'];
  const optional = ['pollIntervalMs', 'heartbeatIntervalMs', 'updateIntervalMs', 'leaseSeconds',
    'renewalIntervalMs', 'nativeTimeoutMs', 'initialBackoffMs', 'maximumBackoffMs',
    'circuitFailureThreshold', 'circuitCooldownMs'];
  if (!exactKeys(value, required, optional)
    || value.schemaVersion !== 'capability-desktop-node-config-v1'
    || !absolute(value.dataRoot) || typeof value.apiBaseUrl !== 'string'
    || typeof value.runtimeId !== 'string' || typeof value.catalogUrl !== 'string'
    || !exactKeys(value.resources, ['cpuCores', 'memoryMiB', 'diskMiB', 'gpuMemoryMiB'])
    || Object.values(value.resources).some(item => !Number.isSafeInteger(item) || item < 0)
    || !value.metadata || typeof value.metadata !== 'object' || Array.isArray(value.metadata)
    || !Array.isArray(value.trustedRuntimeKeys) || !Array.isArray(value.trustedCatalogKeys)
    || !Array.isArray(value.trustedPackageKeys)
    || [value.trustedRuntimeKeys, value.trustedCatalogKeys, value.trustedPackageKeys]
      .some(items => items.length < 1 || items.length > 64 || items.some(item =>
        !exactKeys(item, ['keyId', 'status', 'publicKeyPem', 'notBefore', 'notAfter'])
        || typeof item.keyId !== 'string' || typeof item.publicKeyPem !== 'string'))) {
    fail('CAPABILITY_DESKTOP_NODE_CONFIG_INVALID');
  }
  for (const key of optional) {
    if (value[key] != null && (!Number.isSafeInteger(value[key]) || value[key] < 1)) {
      fail('CAPABILITY_DESKTOP_NODE_CONFIG_INVALID');
    }
  }
  return structuredClone(value);
}

export function buildWindowsDesktopNodeSupervisor(config, { fileGrantBroker = null } = {}) {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    fail('CAPABILITY_DESKTOP_NODE_PLATFORM_UNSUPPORTED');
  }
  const build = osBuild();
  const runtimeRoot = path.join(config.dataRoot, 'runtime');
  const runtimeStore = createWindowsRuntimeReleaseStore({ rootDirectory: runtimeRoot,
    trustedKeys: config.trustedRuntimeKeys, platform: 'win32-x64', osBuild: build });
  const updater = createWindowsRuntimeUpdater({ rootDirectory: runtimeRoot,
    runtimeId: config.runtimeId, runtimeStore, trustedCatalogKeys: config.trustedCatalogKeys,
    catalogUrl: config.catalogUrl, platform: 'win32', releasePlatform: 'win32-x64', osBuild: build });
  const vault = createWindowsDpapiCredentialVault({ directory: path.join(config.dataRoot, 'vault') });
  const apiClient = createExecutionNodeApiClient({ baseUrl: config.apiBaseUrl,
    credentialVault: vault });
  const packageStore = createCapabilityPackageStore({ rootDirectory: path.join(config.dataRoot, 'packages'),
    trustedKeys: config.trustedPackageKeys, platform: 'windows-x64' });
  const bootstrap = createWindowsExecutorBootstrap({ runtimeStore, runtimeId: config.runtimeId,
    dataRoot: config.dataRoot, apiClient, packageStore, credentialVault: vault,
    fileGrantBroker: fileGrantBroker ?? { async resolve({ fileScope }) {
      if (fileScope === 'none') return [];
      fail('CAPABILITY_DESKTOP_FILE_AUTHORIZATION_REQUIRED');
    } }, platform: 'win32',
    leaseSeconds: config.leaseSeconds ?? 120,
    renewalIntervalMs: config.renewalIntervalMs ?? 30_000,
    nativeTimeoutMs: config.nativeTimeoutMs ?? 15 * 60_000 });
  return createDesktopNodeSupervisor({ rootDirectory: config.dataRoot, runtimeUpdater: updater,
    bootstrap, apiClient, resources: config.resources, metadata: config.metadata,
    pollIntervalMs: config.pollIntervalMs ?? 10_000,
    heartbeatIntervalMs: config.heartbeatIntervalMs ?? 60_000,
    updateIntervalMs: config.updateIntervalMs ?? 6 * 60 * 60_000,
    initialBackoffMs: config.initialBackoffMs ?? 1000,
    maximumBackoffMs: config.maximumBackoffMs ?? 60_000,
    circuitFailureThreshold: config.circuitFailureThreshold ?? 5,
    circuitCooldownMs: config.circuitCooldownMs ?? 5 * 60_000 });
}

async function main() {
  const args = process.argv.slice(2), command = args[0];
  if (!['run', 'status', 'pause', 'resume', 'stop', 'diagnostics'].includes(command)) {
    fail('CAPABILITY_DESKTOP_NODE_COMMAND_INVALID');
  }
  const configPath = absolute(option(args, '--config'));
  const root = absolute(option(args, '--root'));
  if (command === 'run') {
    if (!configPath || args.length !== 3 || args[1] !== '--config') {
      fail('CAPABILITY_DESKTOP_NODE_CONFIG_REQUIRED');
    }
    const config = normalizeWindowsDesktopNodeConfig(await readJson(configPath));
    const supervisor = buildWindowsDesktopNodeSupervisor(config);
    const controller = new AbortController();
    const stop = () => controller.abort(Object.assign(new Error('CAPABILITY_DESKTOP_NODE_STOP_REQUESTED'),
      { code: 'CAPABILITY_DESKTOP_NODE_STOP_REQUESTED' }));
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    const result = await supervisor.run({ signal: controller.signal });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (!root || !['diagnostics'].includes(command) && (args.length !== 3 || args[1] !== '--root')) {
    fail('CAPABILITY_DESKTOP_NODE_ROOT_REQUIRED');
  }
  const store = createDesktopNodeStateStore({ rootDirectory: root });
  if (command === 'status') {
    process.stdout.write(`${JSON.stringify(await store.readStatus(), null, 2)}\n`);
    return;
  }
  if (['pause', 'resume', 'stop'].includes(command)) {
    process.stdout.write(`${JSON.stringify(await store.requestControl(command))}\n`);
    return;
  }
  const output = absolute(option(args, '--output'));
  if (!output || args.length !== 5 || args[1] !== '--root' || args[3] !== '--output') {
    fail('CAPABILITY_DESKTOP_NODE_DIAGNOSTICS_OUTPUT_REQUIRED');
  }
  const report = await exportDesktopNodeDiagnostics({ stateStore: store, destination: output });
  process.stdout.write(`${JSON.stringify({ output, events: report.events.length })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().then(() => { process.exitCode = EXIT.ok; }).catch(error => {
    const exitCode = windowsDesktopNodeExitCode(error);
    process.stderr.write(`${JSON.stringify({ ok: false,
      code: error?.code ?? 'CAPABILITY_DESKTOP_NODE_INTERNAL', exitCode })}\n`);
    process.exitCode = exitCode;
  });
}

export { EXIT as WINDOWS_DESKTOP_NODE_EXIT_CODES };
