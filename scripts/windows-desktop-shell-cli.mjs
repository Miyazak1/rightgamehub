#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createDesktopNodeStateStore, createDesktopShellControlClient,
  createDesktopCapabilityArtifactHost, createDesktopFileGrantBroker, createDesktopShellHost,
  createDesktopShellInstallationStore,
  createDesktopShellManager, createWindowsFileSelectionAdapter,
  createWindowsCapabilityArtifactUi,
  createWindowsCurrentUserStartupRegistry, createWindowsDpapiCredentialVault,
  projectDesktopShellView } from '../apps/capability-executor/src/index.mjs';
import { buildWindowsDesktopNodeSupervisor, normalizeWindowsDesktopNodeConfig } from
  './windows-desktop-node-cli.mjs';

const fail = code => { const error = new Error(code); error.code = code; throw error; };
const EXIT = Object.freeze({ ok: 0, config: 10, running: 20, localState: 30,
  trust: 40, runtime: 50, install: 60, internal: 70 });
const SHELL_ENTRY = fileURLToPath(import.meta.url);

export function windowsDesktopShellExitCode(error) {
  const code = String(error?.code ?? error?.message ?? '');
  if (code.includes('ALREADY_RUNNING') || code.includes('BUSY')) return EXIT.running;
  if (code.includes('AUTH') || code.includes('SECRET') || code.includes('SESSION')
    || code.includes('SIGNATURE') || code.includes('KEY')) return EXIT.trust;
  if (code.includes('INSTALL') || code.includes('STARTUP') || code.includes('STOP_TIMEOUT')
    || code.includes('NOT_INSTALLED')) return EXIT.install;
  if (code.includes('IPC') || code.includes('STATE') || code.includes('CONTROL')
    || code.includes('DIAGNOSTICS') || code.includes('CONSENT')) return EXIT.localState;
  if (code.includes('CONFIG') || code.includes('COMMAND') || code.includes('ROOT')
    || code.includes('OUTPUT') || code.includes('PLATFORM')) return EXIT.config;
  if (code.includes('RUNTIME') || code.includes('PACKAGE') || code.includes('UPDATE')) {
    return EXIT.runtime;
  }
  return EXIT.internal;
}

const exactKeys = (value, required, optional = []) => value && typeof value === 'object'
  && !Array.isArray(value) && required.every(key => Object.hasOwn(value, key))
  && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const absolute = value => typeof value === 'string' && path.isAbsolute(value) ? value : null;
const option = (args, name) => {
  const index = args.indexOf(name); return index >= 0 && index + 1 < args.length ? args[index + 1] : null;
};
const strictOptions = (args, allowed) => {
  if (args.length < 3 || args.length % 2 === 0) fail('CAPABILITY_DESKTOP_SHELL_COMMAND_INVALID');
  const values = new Map();
  for (let index = 1; index < args.length; index += 2) {
    const name = args[index], value = args[index + 1];
    if (!allowed.has(name) || values.has(name) || typeof value !== 'string' || value.length < 1) {
      fail('CAPABILITY_DESKTOP_SHELL_COMMAND_INVALID');
    }
    values.set(name, value);
  }
  return values;
};
const readJson = async file => {
  try { return JSON.parse(await fs.promises.readFile(file, 'utf8')); }
  catch { fail('CAPABILITY_DESKTOP_SHELL_CONFIG_INVALID'); }
};

export function normalizeWindowsDesktopShellConfig(value) {
  if (!exactKeys(value, ['schemaVersion', 'dataRoot', 'installVersion', 'nodeConfigPath',
    'startupValueName']) || value.schemaVersion !== 'capability-desktop-shell-config-v1'
    || !absolute(value.dataRoot) || !absolute(value.nodeConfigPath)
    || typeof value.installVersion !== 'string'
    || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(value.installVersion)
    || typeof value.startupValueName !== 'string'
    || !/^[A-Za-z0-9_. -]{1,100}$/u.test(value.startupValueName)) {
    fail('CAPABILITY_DESKTOP_SHELL_CONFIG_INVALID');
  }
  return structuredClone(value);
}

async function atomicJson(file, value) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.promises.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8', mode: 0o600, flag: 'wx',
  });
  try { await fs.promises.rename(temporary, file); }
  catch (error) { await fs.promises.rm(temporary, { force: true }).catch(() => {}); throw error; }
}

function composition(config) {
  if (process.platform !== 'win32') fail('CAPABILITY_DESKTOP_SHELL_PLATFORM_UNSUPPORTED');
  const vault = createWindowsDpapiCredentialVault({ directory: path.join(config.dataRoot, 'vault') });
  const stateStore = createDesktopNodeStateStore({ rootDirectory: config.dataRoot });
  const installationStore = createDesktopShellInstallationStore({ rootDirectory: config.dataRoot });
  const startupRegistry = createWindowsCurrentUserStartupRegistry();
  const fileGrantBroker = createDesktopFileGrantBroker({ rootDirectory: config.dataRoot,
    credentialVault: vault, selectionAdapter: createWindowsFileSelectionAdapter(),
    requireTaskBinding: true });
  const capabilityArtifactHost = createDesktopCapabilityArtifactHost({
    nativeArtifactUi: createWindowsCapabilityArtifactUi() });
  const manager = createDesktopShellManager({ rootDirectory: config.dataRoot, startupRegistry,
    stateStore, credentialVault: vault, installationStore });
  return { vault, stateStore, installationStore, startupRegistry, manager, fileGrantBroker,
    capabilityArtifactHost };
}

async function loadConfig(configPath) {
  if (!absolute(configPath)) fail('CAPABILITY_DESKTOP_SHELL_CONFIG_REQUIRED');
  return normalizeWindowsDesktopShellConfig(await readJson(configPath));
}

async function invoke() {
  const args = process.argv.slice(2), command = args[0];
  const simpleConfigCommands = new Set(['install', 'repair', 'serve', 'startup-enable',
    'startup-disable', 'authorizations']);
  const configCommands = new Set([...simpleConfigCommands, 'authorize-files', 'revoke-authorization']);
  const rootCommands = new Set(['status', 'pause', 'resume', 'stop', 'diagnostics', 'uninstall',
    'file-consent-center', 'file-consent-requests', 'approve-file-consent',
    'reject-file-consent']);
  if (!configCommands.has(command) && !rootCommands.has(command)) {
    fail('CAPABILITY_DESKTOP_SHELL_COMMAND_INVALID');
  }
  if (configCommands.has(command)) {
    const configPath = absolute(option(args, '--config'));
    if (!configPath || simpleConfigCommands.has(command)
      && (args.length !== 3 || args[1] !== '--config')) {
      fail('CAPABILITY_DESKTOP_SHELL_CONFIG_REQUIRED');
    }
    const config = await loadConfig(configPath);
    const parts = composition(config);
    if (command === 'install') {
      return parts.manager.install({ installVersion: config.installVersion,
        launchCommand: [process.execPath, SHELL_ENTRY, 'serve', '--config', configPath],
        startupValueName: config.startupValueName, enableStartup: true });
    }
    if (command === 'repair') return parts.manager.repair();
    if (command === 'startup-enable') return parts.manager.setStartup(true);
    if (command === 'startup-disable') return parts.manager.setStartup(false);
    if (command === 'authorizations') return parts.fileGrantBroker.list();
    if (command === 'revoke-authorization') {
      const values = strictOptions(args, new Set(['--config', '--id']));
      const id = values.get('--id');
      if (!id || values.get('--config') !== configPath) {
        fail('CAPABILITY_DESKTOP_FILE_AUTHORIZATION_ID_REQUIRED');
      }
      return parts.fileGrantBroker.revoke(id);
    }
    if (command === 'authorize-files') {
      const values = strictOptions(args, new Set(['--config', '--capability', '--extensions',
        '--max-files']));
      const capabilityKey = values.get('--capability');
      const extensionsValue = values.get('--extensions');
      const maximumValue = values.get('--max-files');
      if (values.get('--config') !== configPath || typeof capabilityKey !== 'string') {
        fail('CAPABILITY_DESKTOP_FILE_SELECTION_REQUEST_INVALID');
      }
      const extensions = extensionsValue ? extensionsValue.split(',').filter(Boolean) : [];
      const maxFiles = maximumValue == null ? 1 : Number(maximumValue);
      return parts.fileGrantBroker.authorize({ capabilityKey, extensions, maxFiles });
    }
    const nodeConfig = normalizeWindowsDesktopNodeConfig(await readJson(config.nodeConfigPath));
    if (path.resolve(nodeConfig.dataRoot) !== path.resolve(config.dataRoot)) {
      fail('CAPABILITY_DESKTOP_SHELL_ROOT_MISMATCH');
    }
    const supervisor = buildWindowsDesktopNodeSupervisor(nodeConfig, {
      fileGrantBroker: parts.fileGrantBroker });
    return createDesktopShellHost({ rootDirectory: config.dataRoot, supervisor,
      credentialVault: parts.vault, fileGrantBroker: parts.fileGrantBroker,
      capabilityArtifactHost: parts.capabilityArtifactHost }).run();
  }
  const root = absolute(option(args, '--root'));
  if (!root) fail('CAPABILITY_DESKTOP_SHELL_ROOT_REQUIRED');
  const vault = createWindowsDpapiCredentialVault({ directory: path.join(root, 'vault') });
  const stateStore = createDesktopNodeStateStore({ rootDirectory: root });
  if (command === 'uninstall') {
    if (args.length !== 3 || args[1] !== '--root') fail('CAPABILITY_DESKTOP_SHELL_COMMAND_INVALID');
    const installationStore = createDesktopShellInstallationStore({ rootDirectory: root });
    const installation = await installationStore.read();
    if (!installation) fail('CAPABILITY_DESKTOP_SHELL_NOT_INSTALLED');
    const manager = createDesktopShellManager({ rootDirectory: root,
      startupRegistry: createWindowsCurrentUserStartupRegistry(), stateStore,
      credentialVault: vault, installationStore });
    return manager.uninstall();
  }
  const client = createDesktopShellControlClient({ rootDirectory: root, credentialVault: vault });
  if (command === 'diagnostics') {
    const values = strictOptions(args, new Set(['--root', '--output']));
    if (values.get('--root') !== root || !absolute(values.get('--output'))) {
      fail('CAPABILITY_DESKTOP_SHELL_DIAGNOSTICS_OUTPUT_REQUIRED');
    }
    const report = await client.request('diagnostics');
    await atomicJson(values.get('--output'), report);
    return { output: values.get('--output'), events: report.events.length };
  }
  if (command === 'file-consent-center' || command === 'file-consent-requests') {
    if (args.length !== 3 || args[1] !== '--root') fail('CAPABILITY_DESKTOP_SHELL_COMMAND_INVALID');
    return client.request(command);
  }
  if (command === 'approve-file-consent') {
    const values = strictOptions(args, new Set(['--root', '--request', '--extensions',
      '--max-files', '--ttl-ms', '--owner-window-handle']));
    if (values.get('--root') !== root || !values.get('--request')) {
      fail('CAPABILITY_DESKTOP_FILE_CONSENT_REQUEST_INVALID');
    }
    const payload = { requestId: values.get('--request') };
    if (values.has('--extensions')) payload.extensions = values.get('--extensions').split(',')
      .filter(Boolean);
    if (values.has('--max-files')) payload.maxFiles = Number(values.get('--max-files'));
    if (values.has('--ttl-ms')) payload.ttlMs = Number(values.get('--ttl-ms'));
    if (values.has('--owner-window-handle')) {
      payload.ownerWindowHandle = values.get('--owner-window-handle');
    }
    return client.request(command, payload);
  }
  if (command === 'reject-file-consent') {
    const values = strictOptions(args, new Set(['--root', '--request']));
    if (values.get('--root') !== root || !values.get('--request')) {
      fail('CAPABILITY_DESKTOP_FILE_CONSENT_REQUEST_INVALID');
    }
    return client.request(command, { requestId: values.get('--request') });
  }
  if (args.length !== 3 || args[1] !== '--root') fail('CAPABILITY_DESKTOP_SHELL_COMMAND_INVALID');
  if (command !== 'status') return client.request(command);
  const [nodeStatus, fileConsentCenter] = await Promise.all([
    client.request('status'), client.request('file-consent-center'),
  ]);
  const installation = await createDesktopShellInstallationStore({ rootDirectory: root }).read();
  return projectDesktopShellView({ installation, nodeStatus, fileConsentCenter,
    startupEnabled: installation?.startup.enabled === true,
    pendingFileConsentCount: fileConsentCenter.notificationCount });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(SHELL_ENTRY)) {
  invoke().then(result => { process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); })
    .catch(error => {
      const exitCode = windowsDesktopShellExitCode(error);
      process.stderr.write(`${JSON.stringify({ ok: false,
        code: error?.code ?? 'CAPABILITY_DESKTOP_SHELL_INTERNAL', exitCode })}\n`);
      process.exitCode = exitCode;
    });
}

export { EXIT as WINDOWS_DESKTOP_SHELL_EXIT_CODES };
