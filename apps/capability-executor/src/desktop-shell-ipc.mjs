import crypto from 'node:crypto';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fail } from './errors.mjs';
import { readDesktopNodeDiagnostics, redactDesktopNodeStatus } from './desktop-node-state.mjs';

const SECRET_KEY = 'desktop-shell-control-hmac-v1';
const COMMANDS = new Set(['status', 'pause', 'resume', 'stop', 'diagnostics',
  'file-consent-center', 'file-consent-requests', 'approve-file-consent',
  'reject-file-consent']);
const MAX_WIRE_BYTES = 32 * 1024;

const exactKeys = (value, required, optional = []) => value && typeof value === 'object' && !Array.isArray(value)
  && required.every(key => Object.hasOwn(value, key))
  && Object.keys(value).every(key => required.includes(key) || optional.includes(key));

export const desktopShellPipeName = ({ rootDirectory, username = os.userInfo().username } = {}) => {
  if (!path.isAbsolute(rootDirectory) || typeof username !== 'string' || username.length < 1) {
    fail('CAPABILITY_DESKTOP_SHELL_IPC_CONFIG_INVALID');
  }
  const identity = crypto.createHash('sha256').update(`${username}\n${path.resolve(rootDirectory).toLowerCase()}`)
    .digest('hex').slice(0, 32);
  return String.raw`\\.\pipe\mooyu-capability-node-${identity}`;
};

async function controlSecret(vault, { create = false } = {}) {
  if (!vault || typeof vault.load !== 'function' || typeof vault.store !== 'function') {
    fail('CAPABILITY_DESKTOP_SHELL_IPC_CONFIG_INVALID');
  }
  let secret = await vault.load(SECRET_KEY);
  if (secret == null && create) {
    secret = crypto.randomBytes(32).toString('base64url');
    await vault.store(SECRET_KEY, secret);
  }
  if (typeof secret !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(secret)) {
    fail('CAPABILITY_DESKTOP_SHELL_CONTROL_SECRET_UNAVAILABLE');
  }
  return secret;
}

const canonicalJson = value => {
  if (value === null || typeof value === 'boolean' || typeof value === 'string'
    || typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  fail('CAPABILITY_DESKTOP_SHELL_CONTROL_PAYLOAD_INVALID');
};

const signature = ({ secret, challenge, requestId, command, payload }) => crypto
  .createHmac('sha256', Buffer.from(secret, 'base64url'))
  .update(`capability-desktop-shell-control-v2\n${challenge}\n${requestId}\n${command}\n${canonicalJson(payload)}`)
  .digest('base64url');

function validatePayload(command, payload) {
  if (['status', 'pause', 'resume', 'stop', 'diagnostics', 'file-consent-center',
    'file-consent-requests'].includes(command)) {
    if (payload !== null) fail('CAPABILITY_DESKTOP_SHELL_CONTROL_PAYLOAD_INVALID');
    return;
  }
  if (command === 'reject-file-consent') {
    if (!exactKeys(payload, ['requestId']) || typeof payload.requestId !== 'string') {
      fail('CAPABILITY_DESKTOP_SHELL_CONTROL_PAYLOAD_INVALID');
    }
    return;
  }
  if (!exactKeys(payload, ['requestId'], ['extensions', 'maxFiles', 'ttlMs',
    'ownerWindowHandle'])
    || typeof payload.requestId !== 'string' || payload.extensions != null
      && (!Array.isArray(payload.extensions) || payload.extensions.some(item => typeof item !== 'string'))
    || payload.maxFiles != null && !Number.isSafeInteger(payload.maxFiles)
    || payload.ttlMs != null && !Number.isSafeInteger(payload.ttlMs)
    || payload.ownerWindowHandle != null
      && !/^[1-9][0-9]{0,19}$/u.test(payload.ownerWindowHandle)) {
    fail('CAPABILITY_DESKTOP_SHELL_CONTROL_PAYLOAD_INVALID');
  }
}

function send(socket, value) {
  if (socket.destroyed || socket.writableEnded || !socket.writable) return false;
  socket.write(`${JSON.stringify(value)}\n`, () => {});
  return true;
}

function receiveLine(socket, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    let bytes = 0, text = '';
    const finish = (error, value) => {
      clearTimeout(timer); socket.off('data', onData); socket.off('error', onError);
      socket.off('end', onEnd); error ? reject(error) : resolve(value);
    };
    const onError = error => finish(error);
    const onEnd = () => finish(Object.assign(new Error('CAPABILITY_DESKTOP_SHELL_IPC_CLOSED'),
      { code: 'CAPABILITY_DESKTOP_SHELL_IPC_CLOSED' }));
    const onData = chunk => {
      bytes += chunk.length;
      if (bytes > MAX_WIRE_BYTES) return finish(Object.assign(new Error('CAPABILITY_DESKTOP_SHELL_IPC_TOO_LARGE'),
        { code: 'CAPABILITY_DESKTOP_SHELL_IPC_TOO_LARGE' }));
      text += chunk.toString('utf8');
      const newline = text.indexOf('\n');
      if (newline < 0) return;
      try { finish(null, JSON.parse(text.slice(0, newline))); }
      catch { finish(Object.assign(new Error('CAPABILITY_DESKTOP_SHELL_IPC_MESSAGE_INVALID'),
        { code: 'CAPABILITY_DESKTOP_SHELL_IPC_MESSAGE_INVALID' })); }
    };
    socket.on('data', onData); socket.once('error', onError); socket.once('end', onEnd);
    const timer = setTimeout(() => finish(Object.assign(new Error('CAPABILITY_DESKTOP_SHELL_IPC_TIMEOUT'),
      { code: 'CAPABILITY_DESKTOP_SHELL_IPC_TIMEOUT' })), timeoutMs);
    timer.unref?.();
  });
}

export function createDesktopShellControlServer({ rootDirectory, credentialVault, stateStore,
  fileGrantBroker = null, pipeName = null, challengeTtlMs = 10_000,
  now = () => new Date() } = {}) {
  if (!path.isAbsolute(rootDirectory) || !stateStore || typeof stateStore.readStatus !== 'function'
    || typeof stateStore.requestControl !== 'function' || !Number.isSafeInteger(challengeTtlMs)
    || challengeTtlMs < 1000 || challengeTtlMs > 60_000) {
    fail('CAPABILITY_DESKTOP_SHELL_IPC_CONFIG_INVALID');
  }
  pipeName ??= desktopShellPipeName({ rootDirectory });
  let server = null;
  const start = async () => {
    if (server) fail('CAPABILITY_DESKTOP_SHELL_IPC_ALREADY_RUNNING');
    const secret = await controlSecret(credentialVault, { create: true });
    server = net.createServer(socket => {
      // A tray may disappear between a challenge and a response. Keep disconnects local to this
      // connection so a late error reply cannot become an uncaught process-level EPIPE.
      socket.on('error', () => {});
      socket.setNoDelay(true);
      const challenge = crypto.randomBytes(32).toString('base64url');
      const expiresAt = now().getTime() + challengeTtlMs;
      send(socket, { schemaVersion: 'capability-desktop-shell-challenge-v1', challenge,
        expiresAt: new Date(expiresAt).toISOString() });
      receiveLine(socket, { timeoutMs: challengeTtlMs }).then(async request => {
        if (!exactKeys(request, ['schemaVersion', 'requestId', 'command', 'payload',
          'challenge', 'signature']) || request.schemaVersion !== 'capability-desktop-shell-control-v2'
          || typeof request.requestId !== 'string' || request.requestId.length > 100
          || !COMMANDS.has(request.command) || request.challenge !== challenge
          || now().getTime() > expiresAt) fail('CAPABILITY_DESKTOP_SHELL_CONTROL_AUTH_FAILED');
        validatePayload(request.command, request.payload);
        const expected = signature({ secret, challenge, requestId: request.requestId,
          command: request.command, payload: request.payload });
        const supplied = Buffer.from(String(request.signature), 'utf8');
        const trusted = Buffer.from(expected, 'utf8');
        if (supplied.length !== trusted.length || !crypto.timingSafeEqual(supplied, trusted)) {
          fail('CAPABILITY_DESKTOP_SHELL_CONTROL_AUTH_FAILED');
        }
        let result;
        if (request.command === 'status') result = redactDesktopNodeStatus(await stateStore.readStatus());
        else if (request.command === 'diagnostics') {
          result = await readDesktopNodeDiagnostics({ stateStore, now });
        } else if (request.command === 'file-consent-center') {
          if (typeof fileGrantBroker?.getConsentCenter !== 'function') {
            fail('CAPABILITY_DESKTOP_FILE_CONSENT_UNAVAILABLE');
          }
          result = await fileGrantBroker.getConsentCenter();
        } else if (request.command === 'file-consent-requests') {
          if (typeof fileGrantBroker?.listConsentRequests !== 'function') {
            fail('CAPABILITY_DESKTOP_FILE_CONSENT_UNAVAILABLE');
          }
          result = await fileGrantBroker.listConsentRequests();
        } else if (request.command === 'approve-file-consent') {
          if (typeof fileGrantBroker?.approveConsentRequest !== 'function') {
            fail('CAPABILITY_DESKTOP_FILE_CONSENT_UNAVAILABLE');
          }
          result = await fileGrantBroker.approveConsentRequest(request.payload);
        } else if (request.command === 'reject-file-consent') {
          if (typeof fileGrantBroker?.rejectConsentRequest !== 'function') {
            fail('CAPABILITY_DESKTOP_FILE_CONSENT_UNAVAILABLE');
          }
          result = await fileGrantBroker.rejectConsentRequest(request.payload.requestId);
        } else result = await stateStore.requestControl(request.command);
        send(socket, { schemaVersion: 'capability-desktop-shell-response-v1',
          requestId: request.requestId, ok: true, result });
      }).catch(error => send(socket, { schemaVersion: 'capability-desktop-shell-response-v1',
        requestId: null, ok: false, code: error?.code ?? 'CAPABILITY_DESKTOP_SHELL_IPC_FAILED' }))
        .finally(() => socket.end());
    });
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject); server.listen(pipeName, () => {
          server.off('error', reject); resolve();
        });
      });
    } catch (error) {
      server = null;
      if (error?.code === 'EADDRINUSE') fail('CAPABILITY_DESKTOP_SHELL_IPC_ALREADY_RUNNING');
      throw error;
    }
    return { pipeName };
  };
  const close = async () => {
    if (!server) return;
    const active = server; server = null;
    await new Promise((resolve, reject) => active.close(error => error ? reject(error) : resolve()));
  };
  return { pipeName, start, close };
}

export function createDesktopShellControlClient({ rootDirectory, credentialVault, pipeName = null,
  timeoutMs = 5000, interactionTimeoutMs = 30 * 60_000 } = {}) {
  if (!path.isAbsolute(rootDirectory) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 100
    || !Number.isSafeInteger(interactionTimeoutMs) || interactionTimeoutMs < timeoutMs
    || interactionTimeoutMs > 60 * 60_000) {
    fail('CAPABILITY_DESKTOP_SHELL_IPC_CONFIG_INVALID');
  }
  pipeName ??= desktopShellPipeName({ rootDirectory });
  const request = async (command, payload = null) => {
    if (!COMMANDS.has(command)) fail('CAPABILITY_DESKTOP_SHELL_CONTROL_INVALID');
    validatePayload(command, payload);
    const secret = await controlSecret(credentialVault);
    const socket = net.createConnection(pipeName);
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve); socket.once('error', reject);
    });
    const challenge = await receiveLine(socket, { timeoutMs });
    if (!exactKeys(challenge, ['schemaVersion', 'challenge', 'expiresAt'])
      || challenge.schemaVersion !== 'capability-desktop-shell-challenge-v1') {
      socket.destroy(); fail('CAPABILITY_DESKTOP_SHELL_IPC_MESSAGE_INVALID');
    }
    const requestId = crypto.randomUUID();
    send(socket, { schemaVersion: 'capability-desktop-shell-control-v2', requestId, command, payload,
      challenge: challenge.challenge, signature: signature({ secret, challenge: challenge.challenge,
        requestId, command, payload }) });
    const response = await receiveLine(socket, { timeoutMs: command === 'approve-file-consent'
      ? interactionTimeoutMs : timeoutMs }).finally(() => socket.destroy());
    if (response?.schemaVersion !== 'capability-desktop-shell-response-v1'
      || response.requestId !== requestId || response.ok !== true) {
      const error = new Error(response?.code ?? 'CAPABILITY_DESKTOP_SHELL_IPC_FAILED');
      error.code = response?.code ?? 'CAPABILITY_DESKTOP_SHELL_IPC_FAILED'; throw error;
    }
    return response.result;
  };
  return { pipeName, request };
}

export const removeDesktopShellControlSecret = vault => vault.remove(SECRET_KEY);
