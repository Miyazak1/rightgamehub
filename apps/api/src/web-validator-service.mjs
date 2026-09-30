import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { WEB_LIMITS } from './web-package-policy.mjs';
import { validatorMailboxPaths, writeValidatorResponse } from './web-validation-runner.mjs';

const cliPath = fileURLToPath(new URL('./web-zip-validator-cli.mjs', import.meta.url));
const validatorRoot = path.resolve(process.env.VALIDATOR_ROOT ?? '/data/validator');
const quarantineRoot = path.resolve(process.env.QUARANTINE_ROOT ?? '/data/quarantine');
const paths = validatorMailboxPaths(validatorRoot);
const readyFile = path.join(validatorRoot, 'service.ready');
const stateFile = path.join(validatorRoot, 'service.state.json');
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const orphanRetentionMs = 60 * 60 * 1000;
let stopping = false;
let nextCleanupAt = 0;
const state = {
  version: 1,
  status: 'starting',
  startedAt: new Date().toISOString(),
  processedTotal: 0,
  failedTotal: 0,
  lastCompletedAt: null,
  lastDurationMs: null,
  lastErrorCode: null,
};

const writeState = async () => {
  const temporary = `${stateFile}.${process.pid}.partial`;
  await fsp.writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
  await fsp.rename(temporary, stateFile);
};

const removeOldEntries = async (directory, now) => {
  const names = await fsp.readdir(directory).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error));
  await Promise.all(names.map(async name => {
    const target = path.join(directory, name);
    const stat = await fsp.stat(target).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (stat && now - stat.mtimeMs > orphanRetentionMs) await fsp.rm(target, { recursive: true, force: true });
  }));
};

const cleanupOrphans = async (now = Date.now()) => {
  await Promise.all([
    removeOldEntries(paths.requests, now),
    removeOldEntries(paths.responses, now),
    removeOldEntries(paths.cancellations, now),
  ]);
  const rootEntries = await fsp.readdir(validatorRoot, { withFileTypes: true });
  await Promise.all(rootEntries
    .filter(entry => entry.isDirectory() && /^attempt-[^/]{6,128}$/u.test(entry.name))
    .map(async entry => {
      const target = path.join(validatorRoot, entry.name);
      const stat = await fsp.stat(target).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
      if (stat && now - stat.mtimeMs > orphanRetentionMs) await fsp.rm(target, { recursive: true, force: true });
    }));
};

const resolveBelow = (root, relative, pattern, code) => {
  if (typeof relative !== 'string' || !pattern.test(relative)) throw Object.assign(new Error('Validator request path is invalid.'), { code });
  const target = path.resolve(root, ...relative.split('/'));
  if (!target.startsWith(`${path.resolve(root)}${path.sep}`)) throw Object.assign(new Error('Validator request path escapes its root.'), { code });
  return target;
};

const readRequest = async file => {
  const stat = await fsp.stat(file);
  if (!stat.isFile() || stat.size < 2 || stat.size > 4096) throw Object.assign(new Error('Validator request size is invalid.'), { code: 'VALIDATOR_PROTOCOL_INVALID' });
  let request;
  try { request = JSON.parse(await fsp.readFile(file, 'utf8')); }
  catch { throw Object.assign(new Error('Validator request is malformed.'), { code: 'VALIDATOR_PROTOCOL_INVALID' }); }
  if (request.version !== 1 || !/^[0-9a-f-]{36}$/u.test(request.id ?? '') || Number.isNaN(Date.parse(request.expiresAt))) throw Object.assign(new Error('Validator request envelope is invalid.'), { code: 'VALIDATOR_PROTOCOL_INVALID' });
  return request;
};

const execute = ({ id,input,output }) => new Promise((resolve, reject) => {
  const childEnvironment = Object.fromEntries(['SYSTEMROOT','WINDIR','TEMP','TMP','LANG'].flatMap(name => process.env[name] ? [[name,process.env[name]]] : []));
  const child = spawn(process.execPath, [cliPath,input,output], { cwd: path.dirname(cliPath),env: childEnvironment,stdio: ['ignore','pipe','pipe'],shell: false });
  const stdout = []; const stderr = []; let bytes = 0; let settled = false;
  const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timeout); clearInterval(cancelWatch); error ? reject(error) : resolve(value); };
  const stop = error => { child.kill('SIGKILL'); finish(error); };
  const timeout = setTimeout(() => stop(Object.assign(new Error('ZIP validation timed out.'), { code: 'VALIDATION_TIMEOUT' })), WEB_LIMITS.timeoutMs);
  const cancelWatch = setInterval(() => { if (fs.existsSync(path.join(paths.cancellations,id))) stop(Object.assign(new Error('Validation was cancelled.'), { code: 'LEASE_LOST' })); }, 100);
  child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > 8 * 1024 * 1024) stop(Object.assign(new Error('Validator report is too large.'), { code: 'VALIDATOR_REPORT_INVALID' })); else stdout.push(chunk); });
  child.stderr.on('data', chunk => { if (stderr.reduce((sum,value) => sum + value.length,0) < 64 * 1024) stderr.push(chunk); });
  child.on('error', error => finish(error));
  child.on('close', code => {
    if (settled) return;
    let result;
    try { result = JSON.parse(Buffer.concat(stdout).toString('utf8')); }
    catch { return finish(Object.assign(new Error('Validator returned malformed JSON.'), { code: 'VALIDATOR_REPORT_INVALID' })); }
    if (code !== 0 || !result.ok) return finish(Object.assign(new Error(result.error?.message ?? Buffer.concat(stderr).toString('utf8') ?? 'Validation failed.'), { code: result.error?.code ?? 'PACKAGE_INVALID' }));
    finish(null,result.report);
  });
});

async function processRequest(file) {
  let request;
  let id = path.basename(file,'.json');
  const startedAt = Date.now();
  let errorCode = null;
  try {
    request = await readRequest(file); id = request.id;
    if (new Date(request.expiresAt) <= new Date()) throw Object.assign(new Error('Validator request expired.'), { code: 'VALIDATION_TIMEOUT' });
    const input = resolveBelow(quarantineRoot,request.inputRelative,/^quarantine\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.zip$/u,'VALIDATOR_INPUT_INVALID');
    const output = resolveBelow(validatorRoot,request.outputRelative,/^attempt-[^/]{6,128}\/output$/u,'VALIDATOR_OUTPUT_INVALID');
    await fsp.rm(output,{ recursive: true,force: true });
    await fsp.mkdir(path.dirname(output),{ recursive: true });
    const report = await execute({ id,input,output });
    await writeValidatorResponse(validatorRoot,id,{ version: 1,id,ok: true,report });
  } catch (error) {
    errorCode = error.code ?? 'PACKAGE_INVALID';
    await writeValidatorResponse(validatorRoot,id,{ version: 1,id,ok: false,error: { code: error.code ?? 'PACKAGE_INVALID',message: error.message } }).catch(() => {});
  } finally {
    state.processedTotal += 1;
    if (errorCode) state.failedTotal += 1;
    state.lastCompletedAt = new Date().toISOString();
    state.lastDurationMs = Date.now() - startedAt;
    state.lastErrorCode = errorCode;
    await writeState().catch(() => {});
    await fsp.rm(file,{ force: true }).catch(() => {});
  }
}

async function claimNext() {
  const claimed = (await fsp.readdir(paths.processing).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error))).filter(name => /^[0-9a-f-]{36}\.json$/u.test(name)).sort();
  if (claimed.length) return path.join(paths.processing,claimed[0]);
  const names = (await fsp.readdir(paths.requests).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error))).filter(name => /^[0-9a-f-]{36}\.json$/u.test(name)).sort();
  for (const name of names) {
    const source = path.join(paths.requests,name); const target = path.join(paths.processing,name);
    try { await fsp.rename(source,target); return target; }
    catch (error) { if (!['ENOENT','EEXIST'].includes(error.code)) throw error; }
  }
  return null;
}

const stop = () => { stopping = true; };
process.once('SIGTERM',stop); process.once('SIGINT',stop);
await Promise.all(Object.values(paths).map(directory => fsp.mkdir(directory,{ recursive: true })));
await cleanupOrphans();
state.status = 'ready';
await writeState();
await fsp.writeFile(readyFile,JSON.stringify({ pid: process.pid,startedAt: new Date().toISOString() }),{ mode: 0o600 });
try {
  while (!stopping) {
    if (Date.now() >= nextCleanupAt) {
      await cleanupOrphans();
      nextCleanupAt = Date.now() + 60_000;
    }
    const request = await claimNext();
    if (request) await processRequest(request); else await pause(100);
  }
} finally {
  state.status = 'stopped';
  await writeState().catch(() => {});
  await fsp.rm(readyFile,{ force: true }).catch(() => {});
}
