import { spawn } from 'node:child_process';
import { fail } from './errors.mjs';

const DEFAULT_KEY = String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`;
const VALUE_NAME = /^[A-Za-z0-9_. -]{1,100}$/u;

const quoteWindowsArgument = value => {
  if (!/[\s"]/u.test(value)) return value;
  let output = '"', slashes = 0;
  for (const character of value) {
    if (character === '\\') { slashes += 1; continue; }
    if (character === '"') output += `${'\\'.repeat(slashes * 2 + 1)}"`;
    else output += `${'\\'.repeat(slashes)}${character}`;
    slashes = 0;
  }
  return `${output}${'\\'.repeat(slashes * 2)}"`;
};

export const renderWindowsCommandLine = command => {
  if (!Array.isArray(command) || command.length < 1 || command.length > 32
    || command.some(item => typeof item !== 'string' || item.length < 1 || item.length > 4096
      || item.includes('\0'))) fail('CAPABILITY_DESKTOP_SHELL_LAUNCH_COMMAND_INVALID');
  return command.map(quoteWindowsArgument).join(' ');
};

function defaultRun(file, args, spawnImpl = spawn) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(file, args, { windowsHide: true, shell: false,
      stdio: ['ignore', 'pipe', 'pipe'] });
    const output = [], errors = [];
    child.stdout.on('data', chunk => output.push(chunk));
    child.stderr.on('data', chunk => errors.push(chunk));
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout: Buffer.concat(output).toString('utf8'),
      stderr: Buffer.concat(errors).toString('utf8') }));
  });
}

export function createWindowsCurrentUserStartupRegistry({ registryKey = DEFAULT_KEY,
  platform = process.platform, run = null, spawnImpl = spawn } = {}) {
  if (platform !== 'win32' || typeof registryKey !== 'string'
    || !/^HKCU\\[A-Za-z0-9_. \\-]{1,240}$/u.test(registryKey)) {
    fail('CAPABILITY_DESKTOP_SHELL_STARTUP_CONFIG_INVALID');
  }
  const invoke = run ?? ((file, args) => defaultRun(file, args, spawnImpl));
  const validateName = valueName => {
    if (!VALUE_NAME.test(valueName)) fail('CAPABILITY_DESKTOP_SHELL_STARTUP_NAME_INVALID');
  };
  const query = async valueName => {
    validateName(valueName);
    const result = await invoke('reg.exe', ['QUERY', registryKey, '/v', valueName]);
    if (result.code === 1) return { enabled: false, commandLine: null };
    if (result.code !== 0) fail('CAPABILITY_DESKTOP_SHELL_STARTUP_QUERY_FAILED');
    const line = result.stdout.split(/\r?\n/u).find(item => /\sREG_SZ\s/u.test(item));
    if (!line) fail('CAPABILITY_DESKTOP_SHELL_STARTUP_QUERY_INVALID');
    return { enabled: true, commandLine: line.replace(/^.*?\sREG_SZ\s+/u, '') };
  };
  const enable = async ({ valueName, command }) => {
    validateName(valueName);
    const commandLine = renderWindowsCommandLine(command);
    const result = await invoke('reg.exe', ['ADD', registryKey, '/v', valueName, '/t', 'REG_SZ',
      '/d', commandLine, '/f']);
    if (result.code !== 0) fail('CAPABILITY_DESKTOP_SHELL_STARTUP_ENABLE_FAILED');
    const observed = await query(valueName);
    if (!observed.enabled || observed.commandLine !== commandLine) {
      fail('CAPABILITY_DESKTOP_SHELL_STARTUP_VERIFY_FAILED');
    }
    return observed;
  };
  const disable = async valueName => {
    validateName(valueName);
    const before = await query(valueName);
    if (!before.enabled) return { enabled: false, commandLine: null };
    const result = await invoke('reg.exe', ['DELETE', registryKey, '/v', valueName, '/f']);
    if (result.code !== 0) {
      fail('CAPABILITY_DESKTOP_SHELL_STARTUP_DISABLE_FAILED');
    }
    if ((await query(valueName)).enabled) fail('CAPABILITY_DESKTOP_SHELL_STARTUP_VERIFY_FAILED');
    return { enabled: false, commandLine: null };
  };
  return { registryKey, query, enable, disable };
}
