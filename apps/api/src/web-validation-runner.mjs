import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { WEB_LIMITS } from './web-package-policy.mjs';

const cliPath = fileURLToPath(new URL('./web-zip-validator-cli.mjs', import.meta.url));
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const protocolError = (message, code = 'VALIDATOR_PROTOCOL_INVALID') => Object.assign(new Error(message), { code });

const safeRelative = (root, target, code) => {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw protocolError('Validator path is outside its allowed root.', code);
  return relative.split(path.sep).join('/');
};

const readJsonFile = async (file, maxBytes = 8 * 1024 * 1024) => {
  const stat = await fsp.stat(file);
  if (!stat.isFile() || stat.size < 2 || stat.size > maxBytes) throw protocolError('Validator response size is invalid.');
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); }
  catch { throw protocolError('Validator returned malformed JSON.', 'VALIDATOR_REPORT_INVALID'); }
};

export function runLocalWebValidator({ inputPath, outputDirectory, onHeartbeat }) {
  return new Promise((resolve, reject) => {
    const childEnvironment = Object.fromEntries(['SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'LANG'].flatMap(name => process.env[name] ? [[name, process.env[name]]] : []));
    const child = spawn(process.execPath, [cliPath, inputPath, outputDirectory], { cwd: path.dirname(cliPath), env: childEnvironment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let settled = false;
    const stop = error => { if (!settled) { settled = true; child.kill(); reject(error); } };
    const timeout = setTimeout(() => stop(Object.assign(new Error('ZIP validation timed out.'), { code: 'VALIDATION_TIMEOUT' })), WEB_LIMITS.timeoutMs);
    const heartbeat = setInterval(async () => {
      try { if (!(await onHeartbeat())) stop(Object.assign(new Error('Validation lease was lost.'), { code: 'LEASE_LOST' })); }
      catch (error) { stop(Object.assign(error, { code: error.code ?? 'LEASE_RENEW_FAILED' })); }
    }, 10_000);
    child.stdout.on('data', chunk => {
      outputBytes += chunk.length;
      if (outputBytes > 8 * 1024 * 1024) stop(Object.assign(new Error('Validator report is too large.'), { code: 'VALIDATOR_REPORT_INVALID' }));
      else stdout.push(chunk);
    });
    child.stderr.on('data', chunk => { if (stderr.reduce((sum, value) => sum + value.length, 0) < 64 * 1024) stderr.push(chunk); });
    child.on('error', stop);
    child.on('close', code => {
      clearTimeout(timeout); clearInterval(heartbeat);
      if (settled) return;
      settled = true;
      let result;
      try { result = JSON.parse(Buffer.concat(stdout).toString('utf8')); }
      catch { return reject(Object.assign(new Error('Validator returned malformed JSON.'), { code: 'VALIDATOR_REPORT_INVALID' })); }
      if (code !== 0 || !result.ok) return reject(Object.assign(new Error(result.error?.message ?? Buffer.concat(stderr).toString('utf8') ?? 'Validation failed.'), { code: result.error?.code ?? 'PACKAGE_INVALID' }));
      resolve(result.report);
    });
  });
}

export function createWebValidationRunner({ mode = 'local', validatorRoot, quarantineRoot, ids = () => crypto.randomUUID(), clock = () => new Date() }) {
  if (mode === 'local') return Object.freeze({ run: runLocalWebValidator });
  if (mode !== 'isolated') throw new Error('Unsupported validator execution mode.');
  const root = path.resolve(validatorRoot);
  const quarantine = path.resolve(quarantineRoot);
  const requests = path.join(root, 'requests');
  const responses = path.join(root, 'responses');
  const cancellations = path.join(root, 'cancellations');
  return Object.freeze({
    async run({ inputPath, outputDirectory, onHeartbeat }) {
      const id = ids();
      if (!/^[0-9a-f-]{36}$/u.test(id)) throw protocolError('Validator request ID is invalid.');
      const inputRelative = safeRelative(quarantine, inputPath, 'VALIDATOR_INPUT_INVALID');
      const outputRelative = safeRelative(root, outputDirectory, 'VALIDATOR_OUTPUT_INVALID');
      const requestFile = path.join(requests, `${id}.json`);
      const responseFile = path.join(responses, `${id}.json`);
      const cancelFile = path.join(cancellations, id);
      const temporary = `${requestFile}.${process.pid}.partial`;
      await Promise.all([fsp.mkdir(requests, { recursive: true }), fsp.mkdir(responses, { recursive: true }), fsp.mkdir(cancellations, { recursive: true })]);
      const expiresAt = new Date(clock().getTime() + WEB_LIMITS.timeoutMs + 15_000).toISOString();
      await fsp.writeFile(temporary, JSON.stringify({ version: 1,id,inputRelative,outputRelative,expiresAt }), { flag: 'wx', mode: 0o600 });
      await fsp.rename(temporary, requestFile);
      let lastHeartbeat = Date.now();
      let leaseError = null;
      const deadline = Date.now() + WEB_LIMITS.timeoutMs + 20_000;
      try {
        while (Date.now() < deadline) {
          let result = null;
          try {
            result = await readJsonFile(responseFile);
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
          }
          if (result) {
            if (result.version !== 1 || result.id !== id || typeof result.ok !== 'boolean') throw protocolError('Validator response envelope is invalid.');
            if (leaseError) throw leaseError;
            if (!result.ok) throw Object.assign(new Error(result.error?.message ?? 'Validation failed.'), { code: result.error?.code ?? 'PACKAGE_INVALID' });
            return result.report;
          }
          if (!leaseError && Date.now() - lastHeartbeat >= 10_000) {
            lastHeartbeat = Date.now();
            try {
              if (!(await onHeartbeat())) leaseError = Object.assign(new Error('Validation lease was lost.'), { code: 'LEASE_LOST' });
            } catch (error) { leaseError = Object.assign(error, { code: error.code ?? 'LEASE_RENEW_FAILED' }); }
            if (leaseError) await fsp.writeFile(cancelFile, '', { flag: 'wx', mode: 0o600 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
          }
          await pause(100);
        }
        throw Object.assign(new Error('Isolated ZIP validation timed out.'), { code: 'VALIDATION_TIMEOUT' });
      } finally {
        await Promise.all([
          fsp.rm(requestFile, { force: true }).catch(() => {}),
          fsp.rm(responseFile, { force: true }).catch(() => {}),
          fsp.rm(cancelFile, { force: true }).catch(() => {}),
          fsp.rm(temporary, { force: true }).catch(() => {}),
        ]);
      }
    },
  });
}

export const validatorMailboxPaths = root => Object.freeze({
  root: path.resolve(root),
  requests: path.resolve(root, 'requests'),
  processing: path.resolve(root, 'processing'),
  responses: path.resolve(root, 'responses'),
  cancellations: path.resolve(root, 'cancellations'),
});

export async function writeValidatorResponse(root, id, value) {
  const { responses } = validatorMailboxPaths(root);
  await fsp.mkdir(responses, { recursive: true });
  const target = path.join(responses, `${id}.json`);
  const temporary = `${target}.${process.pid}.partial`;
  await fsp.writeFile(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
  await fsp.rename(temporary, target);
}
