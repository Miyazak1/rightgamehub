import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  validatePaperLayoutEngineProcessProgressV1,
  validatePaperLayoutEngineProcessRequestV1,
  validatePaperLayoutEngineProcessResultV1,
} from '../../../packages/agent-capabilities/src/paper-layout-engine-process.mjs';
import { fail } from './errors.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ENVIRONMENT_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u;
const textDecoder = new TextDecoder('utf-8', { fatal: true });
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

const managerFail = code => fail(code, { safeFailure: true });

async function renameWithRetry(source, destination) {
  for (let attempt = 0;; attempt += 1) {
    try { await fs.promises.rename(source, destination); return; }
    catch (error) {
      if (!['EPERM', 'EACCES'].includes(error?.code) || attempt >= 5) throw error;
      await sleep(10 * (attempt + 1));
    }
  }
}

async function atomicJson(file, value) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.promises.writeFile(temporary, `${JSON.stringify(value)}\n`, {
    encoding: 'utf8', mode: 0o600, flag: 'wx',
  });
  await renameWithRetry(temporary, file);
}

function validateCommand(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['executable', 'arguments', 'environment'].includes(key))
    || !path.isAbsolute(value.executable ?? '')
    || !Array.isArray(value.arguments) || value.arguments.length > 128
    || value.arguments.some(argument => typeof argument !== 'string'
      || argument.length > 4096 || argument.includes('\0'))
    || Buffer.byteLength(JSON.stringify(value.arguments), 'utf8') > 64 * 1024
    || value.environment !== undefined && (value.environment === null
      || typeof value.environment !== 'object' || Array.isArray(value.environment))) {
    managerFail('PAPER_LAYOUT_ENGINE_COMMAND_INVALID');
  }
  const environment = value.environment ?? {};
  if (Object.entries(environment).some(([key, item]) => !ENVIRONMENT_KEY.test(key)
    || typeof item !== 'string' || item.length > 8192 || item.includes('\0'))
    || Buffer.byteLength(JSON.stringify(environment), 'utf8') > 128 * 1024) {
    managerFail('PAPER_LAYOUT_ENGINE_COMMAND_INVALID');
  }
  return { executable: value.executable, arguments: [...value.arguments],
    environment: { ...environment } };
}

async function readBoundedRegularFile(file, maximumBytes, missingCode, invalidCode) {
  const before = await fs.promises.lstat(file).catch(() => null);
  if (!before) managerFail(missingCode);
  if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > maximumBytes) {
    managerFail(invalidCode);
  }
  const handle = await fs.promises.open(file, 'r');
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino
      || opened.size !== before.size) managerFail(invalidCode);
    const content = await handle.readFile();
    const after = await handle.stat();
    if (content.length !== opened.size || after.size !== opened.size
      || after.dev !== opened.dev || after.ino !== opened.ino
      || after.mtimeMs !== opened.mtimeMs) managerFail(invalidCode);
    return content;
  } finally { await handle.close(); }
}

function decodeJson(buffer, invalidCode) {
  try { return JSON.parse(textDecoder.decode(buffer)); }
  catch { managerFail(invalidCode); }
}

function appendBounded(chunks, chunk, state, maximumBytes, onOverflow) {
  state.bytes += chunk.length;
  if (state.bytes > maximumBytes) onOverflow();
  else chunks.push(Buffer.from(chunk));
}

export function createPaperLayoutEngineProcessManager({ rootDirectory,
  spawnProcess = spawn, pollIntervalMs = 25, cancellationGraceMs = 1500,
  defaultTimeoutMs = 15 * 60_000, maxStdoutBytes = 256 * 1024,
  maxStderrBytes = 256 * 1024 } = {}) {
  if (!path.isAbsolute(rootDirectory ?? '') || typeof spawnProcess !== 'function'
    || !Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 5 || pollIntervalMs > 1000
    || !Number.isSafeInteger(cancellationGraceMs) || cancellationGraceMs < 50
    || cancellationGraceMs > 30_000 || !Number.isSafeInteger(defaultTimeoutMs)
    || defaultTimeoutMs < 100 || defaultTimeoutMs > 24 * 60 * 60_000
    || !Number.isSafeInteger(maxStdoutBytes) || maxStdoutBytes < 1024
    || maxStdoutBytes > 16 * 1024 ** 2 || !Number.isSafeInteger(maxStderrBytes)
    || maxStderrBytes < 1024 || maxStderrBytes > 16 * 1024 ** 2) {
    managerFail('PAPER_LAYOUT_ENGINE_PROCESS_MANAGER_CONFIG_INVALID');
  }
  const normalizedRoot = path.resolve(rootDirectory);

  const pathsFor = requestId => {
    if (typeof requestId !== 'string' || !UUID.test(requestId)) {
      managerFail('PAPER_LAYOUT_ENGINE_PROCESS_REQUEST_INVALID');
    }
    const workspace = path.join(normalizedRoot, requestId);
    return { workspace, requestPath: path.join(workspace, 'request.json'),
      resultPath: path.join(workspace, 'result.json'),
      progressPath: path.join(workspace, 'progress.jsonl'),
      cancellationPath: path.join(workspace, 'cancel.json') };
  };

  const run = async ({ request: requestValue, command: commandValue, signal,
    timeoutMs = defaultTimeoutMs, onProgress = null } = {}) => {
    const request = validatePaperLayoutEngineProcessRequestV1(requestValue);
    const command = validateCommand(commandValue);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 24 * 60 * 60_000
      || onProgress !== null && typeof onProgress !== 'function') {
      managerFail('PAPER_LAYOUT_ENGINE_PROCESS_RUN_INVALID');
    }
    const files = pathsFor(request.requestId);
    if (path.resolve(request.output.resultPath) !== files.resultPath
      || path.resolve(request.output.progressPath) !== files.progressPath
      || path.resolve(request.output.cancellationPath) !== files.cancellationPath) {
      managerFail('PAPER_LAYOUT_ENGINE_PROCESS_OUTPUT_INVALID');
    }
    await fs.promises.mkdir(normalizedRoot, { recursive: true, mode: 0o700 });
    const rootStats = await fs.promises.lstat(normalizedRoot);
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
      managerFail('PAPER_LAYOUT_ENGINE_PROCESS_WORKSPACE_INVALID');
    }
    try { await fs.promises.mkdir(files.workspace, { mode: 0o700 }); }
    catch (error) {
      if (error?.code === 'EEXIST') managerFail('PAPER_LAYOUT_ENGINE_PROCESS_WORKSPACE_EXISTS');
      throw error;
    }
    await atomicJson(files.requestPath, request);

    const stdout = [], stderr = [], stdoutState = { bytes: 0 }, stderrState = { bytes: 0 };
    const progress = [];
    let progressSnapshot = Buffer.alloc(0), processedProgressBytes = 0;
    let child, fatalCode = null, stopReason = null, killTimer = null, timeoutTimer = null;
    let abortListener = null, closed = false, progressQueue = Promise.resolve();

    const requestStop = async reason => {
      if (!stopReason) {
        stopReason = reason;
        await atomicJson(files.cancellationPath, {
          schemaVersion: 'paper-layout-engine-cancellation-v1', requestId: request.requestId,
          reason, requestedAt: new Date().toISOString(),
        }).catch(() => { if (!fatalCode) fatalCode = 'PAPER_LAYOUT_ENGINE_CANCELLATION_WRITE_FAILED'; });
      }
      if (child && !closed && !killTimer) {
        killTimer = setTimeout(() => {
          if (closed) return;
          child.kill('SIGTERM');
          killTimer = setTimeout(() => { if (!closed) child.kill('SIGKILL'); },
            cancellationGraceMs);
          killTimer.unref?.();
        }, cancellationGraceMs);
        killTimer.unref?.();
      }
    };

    const protocolFailure = code => {
      if (!fatalCode) fatalCode = code;
      void requestStop('protocol-failure');
    };

    const inspectProgress = async ({ final = false } = {}) => {
      if (fatalCode) return;
      try {
        const stats = await fs.promises.lstat(files.progressPath).catch(() => null);
        if (!stats) return;
        if (!stats.isFile() || stats.isSymbolicLink()) {
          return protocolFailure('PAPER_LAYOUT_ENGINE_PROGRESS_INVALID');
        }
        const handle = await fs.promises.open(files.progressPath, 'r');
        let content;
        try {
          const opened = await handle.stat();
          if (opened.dev !== stats.dev || opened.ino !== stats.ino) {
            return protocolFailure('PAPER_LAYOUT_ENGINE_PROGRESS_INVALID');
          }
          content = await handle.readFile();
          const after = await handle.stat();
          if (after.dev !== opened.dev || after.ino !== opened.ino
            || final && after.size !== content.length) {
            return protocolFailure('PAPER_LAYOUT_ENGINE_PROGRESS_INVALID');
          }
        } finally { await handle.close(); }
        if (content.length > request.limits.maxProgressBytes
          || content.length < progressSnapshot.length
          || !content.subarray(0, progressSnapshot.length).equals(progressSnapshot)) {
          return protocolFailure('PAPER_LAYOUT_ENGINE_PROGRESS_INVALID');
        }
        progressSnapshot = content;
        let newline;
        while ((newline = content.indexOf(0x0a, processedProgressBytes)) !== -1) {
          let line = content.subarray(processedProgressBytes, newline);
          processedProgressBytes = newline + 1;
          if (line.at(-1) === 0x0d) line = line.subarray(0, -1);
          if (line.length < 2) return protocolFailure('PAPER_LAYOUT_ENGINE_PROGRESS_INVALID');
          const value = decodeJson(line, 'PAPER_LAYOUT_ENGINE_PROGRESS_INVALID');
          const validated = validatePaperLayoutEngineProcessProgressV1(value, {
            request, previous: progress.at(-1) ?? null,
          });
          progress.push(validated);
          if (onProgress) await onProgress(structuredClone(validated));
        }
        if (final && processedProgressBytes !== content.length) {
          protocolFailure('PAPER_LAYOUT_ENGINE_PROGRESS_INVALID');
        }
      } catch (error) {
        if (!fatalCode) fatalCode = ['PAPER_LAYOUT_ENGINE_PROCESS_PROGRESS_INVALID',
          'PAPER_LAYOUT_ENGINE_PROGRESS_INVALID'].includes(error?.code)
          ? 'PAPER_LAYOUT_ENGINE_PROGRESS_INVALID' : 'PAPER_LAYOUT_ENGINE_PROGRESS_READ_FAILED';
        void requestStop('protocol-failure');
      }
    };

    const pollProgress = options => {
      const scheduled = progressQueue.then(() => inspectProgress(options));
      progressQueue = scheduled.catch(() => {});
      return scheduled;
    };

    const progressTimer = setInterval(() => { void pollProgress(); }, pollIntervalMs);
    progressTimer.unref?.();
    try {
      if (signal?.aborted) await requestStop('cancelled');
      try {
        child = spawnProcess(command.executable, [...command.arguments, files.requestPath], {
          cwd: files.workspace, env: command.environment, shell: false, windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch { managerFail('PAPER_LAYOUT_ENGINE_PROCESS_START_FAILED'); }
      if (!child || typeof child.on !== 'function' || !child.stdout || !child.stderr) {
        managerFail('PAPER_LAYOUT_ENGINE_PROCESS_START_FAILED');
      }
      if (stopReason) await requestStop(stopReason);
      child.stdout.on('data', chunk => appendBounded(stdout, chunk, stdoutState, maxStdoutBytes,
        () => protocolFailure('PAPER_LAYOUT_ENGINE_STDOUT_LIMIT_EXCEEDED')));
      child.stderr.on('data', chunk => appendBounded(stderr, chunk, stderrState, maxStderrBytes,
        () => protocolFailure('PAPER_LAYOUT_ENGINE_STDERR_LIMIT_EXCEEDED')));
      if (signal) {
        abortListener = () => { void requestStop('cancelled'); };
        signal.addEventListener('abort', abortListener, { once: true });
        if (signal.aborted) await requestStop('cancelled');
      }
      timeoutTimer = setTimeout(() => { void requestStop('timeout'); }, timeoutMs);
      timeoutTimer.unref?.();
      const exit = await new Promise(resolve => {
        child.once('error', error => resolve({ error }));
        child.once('close', (code, childSignal) => resolve({ code, signal: childSignal }));
      });
      closed = true;
      await pollProgress({ final: true });
      if (fatalCode) managerFail(fatalCode);
      if (exit.error) managerFail('PAPER_LAYOUT_ENGINE_PROCESS_START_FAILED');
      let result;
      try {
        const bytes = await readBoundedRegularFile(files.resultPath, request.limits.maxResultBytes,
          'PAPER_LAYOUT_ENGINE_RESULT_MISSING', 'PAPER_LAYOUT_ENGINE_RESULT_INVALID');
        result = validatePaperLayoutEngineProcessResultV1(
          decodeJson(bytes, 'PAPER_LAYOUT_ENGINE_RESULT_INVALID'), { request });
      } catch (error) {
        if (stopReason === 'timeout') managerFail('PAPER_LAYOUT_ENGINE_PROCESS_TIMEOUT');
        if (stopReason === 'cancelled') managerFail('PAPER_LAYOUT_ENGINE_PROCESS_CANCELLED');
        throw error;
      }
      if (exit.code !== 0) managerFail('PAPER_LAYOUT_ENGINE_PROCESS_EXIT_FAILED');
      if (stopReason === 'timeout' && result.error?.code !== 'ENGINE_TIMEOUT') {
        managerFail('PAPER_LAYOUT_ENGINE_PROCESS_TIMEOUT');
      }
      if (stopReason === 'cancelled' && result.status !== 'cancelled') {
        managerFail('PAPER_LAYOUT_ENGINE_PROCESS_CANCELLED');
      }
      const cleanup = async () => fs.promises.rm(files.workspace, { recursive: true, force: true });
      return { result, progress: structuredClone(progress), diagnostics: {
        stdoutBytes: stdoutState.bytes, stderrBytes: stderrState.bytes,
        stdout: textDecoder.decode(Buffer.concat(stdout)),
        stderr: textDecoder.decode(Buffer.concat(stderr)),
        exitCode: exit.code, exitSignal: exit.signal ?? null,
      }, workspace: files.workspace, cleanup };
    } finally {
      closed = true;
      clearInterval(progressTimer); clearTimeout(timeoutTimer); clearTimeout(killTimer);
      if (signal && abortListener) signal.removeEventListener('abort', abortListener);
      if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  };

  return { pathsFor, run };
}
