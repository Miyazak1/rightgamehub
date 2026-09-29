import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createControlPipe } from './control-pipe.cjs';
import { validateCommand } from './protocol.cjs';
import { verifyInstalledPackage } from '../../extensions/harness/src/offscreen-install.mjs';

export const RUNTIME_SHA256 = 'bd14928e0728366fd3f41499cb398ff3f4304dab259a3e605077899a6f8c748e';
const directory = fileURLToPath(new URL('.', import.meta.url));
const failure = (message, status = 409) => Object.assign(new Error(message), { status });

export function normalizePlayerInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.hasOwn(value, 'seq') ||
      !['click', 'key', 'text', 'release', 'reset'].includes(value.type)) throw failure('Unsupported game input', 400);
  try { const { seq, ...command } = validateCommand({ ...value, seq: 1 }); return command; }
  catch { throw failure('Invalid game input', 400); }
}

// Fixed runtime and host-owned entry; renderer packages must match the reviewed
// archive and asset digests. A caller never supplies an EXE or main/preload script.
export async function startOffscreenSample({ runtimeFile, outputDir, startupMs = 15000, packageDirectory }) {
  if (process.platform !== 'win32' || !path.isAbsolute(runtimeFile) || !path.isAbsolute(outputDir)) {
    throw failure('A local Windows runtime and isolated output directory are required');
  }
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(runtimeFile)) hash.update(chunk);
  if (hash.digest('hex') !== RUNTIME_SHA256) throw failure('Electron runtime digest does not match the verified version');
  if (packageDirectory) await verifyInstalledPackage(packageDirectory);
  const profile = path.join(outputDir, 'profile');
  await mkdir(profile, { recursive: true });
  const control = await createControlPipe();
  let child;
  try {
    const env = { ...process.env, GAMEHUB_OFFSCREEN_EXPERIMENT: '1', GAMEHUB_OFFSCREEN_PROFILE: profile,
      GAMEHUB_OFFSCREEN_PIPE: control.name, GAMEHUB_OFFSCREEN_TOKEN: control.token, ELECTRON_NO_ATTACH_CONSOLE: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.GAMEHUB_OFFSCREEN_PACKAGE_DIR;
    if (packageDirectory) env.GAMEHUB_OFFSCREEN_PACKAGE_DIR = packageDirectory;
    child = spawn(runtimeFile, [path.join(directory, 'main.cjs')], {
      cwd: directory, env, shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
    });
  } catch (error) { await control.close(); throw error; }
  let frame, ready = false, ended = false, stopping, problem, seq = 0, queued = 0;
  let chain = Promise.resolve(), acknowledge, stderr = '';
  let resolveReady, rejectReady;
  const startup = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const exited = new Promise(resolve => child.once('close', (code, signal) => {
    ended = true;
    if (!stopping) fail(failure(`Offscreen runtime exited (${code ?? signal})`));
    resolve({ code, signal });
  }));
  function fail(error) {
    problem ||= error;
    rejectReady(problem);
    acknowledge?.reject(problem);
    if (!stopping) void stop().catch(() => {});
  }
  child.once('error', fail);
  child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4096); });
  control.events.on('failure', fail);
  control.events.on('disconnected', () => { if (!stopping) fail(failure('Runtime control connection closed')); });
  control.events.on('packet', packet => {
    if (stopping) return;
    try {
      if (packet.type === 'ready') ready = true;
      if (packet.type === 'frame') {
        if (!Number.isSafeInteger(packet.id) || packet.id <= (frame?.id || 0) ||
            packet.width !== 640 || packet.height !== 360 || typeof packet.jpeg !== 'string' || packet.jpeg.length > 2800000 ||
            packet.windowState?.visible !== false || packet.windowState?.focused !== false) throw failure('Invalid hidden-window frame');
        const jpeg = Buffer.from(packet.jpeg, 'base64');
        if (jpeg.length > 2 * 1024 * 1024 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw failure('Invalid JPEG frame');
        frame = { id: packet.id, jpeg, width: packet.width, height: packet.height, receivedAt: Date.now() };
      }
      if (ready && frame) resolveReady();
      if (packet.type === 'applied' && acknowledge?.seq === packet.seq) acknowledge.resolve(packet.state);
      if (packet.type === 'stopped') throw failure('Offscreen session ended: ' + packet.reason);
    } catch (error) { fail(error); }
  });
  const heartbeat = setInterval(() => { if (!stopping && !ended) control.send({ type: 'ping' }); }, 3000);
  heartbeat.unref();
  let startupTimer;
  async function stop() {
    if (stopping) return stopping;
    // Set the promise before cleanup can synchronously emit any pipe events.
    stopping = Promise.resolve().then(async () => {
      clearInterval(heartbeat); clearTimeout(startupTimer);
      rejectReady(failure('Offscreen session stopped'));
      acknowledge?.reject(failure('Offscreen session stopped'));
      if (!ended) control.send({ type: 'stop' });
      let timer;
      let forced = false;
      try {
        await Promise.race([exited, new Promise(resolve => { timer = setTimeout(resolve, 4000); })]);
        if (!ended) {
          forced = true; child.kill(); clearTimeout(timer);
          await Promise.race([exited, new Promise(resolve => { timer = setTimeout(resolve, 2000); })]);
        }
      } finally {
        clearTimeout(timer); await control.close(); child.stderr.destroy(); child.unref();
      }
      if (forced || !ended) throw failure('Runtime did not exit normally; process cleanup requires checking', 503);
    });
    return stopping;
  }
  startupTimer = setTimeout(() => fail(failure('Offscreen startup timed out')), startupMs);
  try { await startup; clearTimeout(startupTimer); }
  catch (error) { await stop().catch(() => {}); throw error; }
  return {
    getFrame() { if (problem || ended || stopping) throw problem || failure('Offscreen session ended', 410); return frame; },
    input(value) {
      const command = normalizePlayerInput(value);
      if (problem || ended || stopping) return Promise.reject(problem || failure('Offscreen session ended', 410));
      if (queued >= 16) return Promise.reject(failure('Too many queued game inputs', 429));
      queued++;
      const job = chain.then(async () => {
        if (problem || ended || stopping) throw problem || failure('Offscreen session ended', 410);
        let timer;
        try {
          return await new Promise((resolve, reject) => {
            acknowledge = { seq: ++seq, resolve, reject };
            timer = setTimeout(() => { const error = failure('Game input acknowledgement timed out'); fail(error); reject(error); }, 2500);
            if (!control.send({ ...command, seq })) fail(failure('Game input transport is unavailable'));
          });
        } finally { clearTimeout(timer); acknowledge = null; }
      });
      chain = job.catch(() => {}).finally(() => queued--);
      return job;
    },
    stop,
    diagnostics: () => ({ ended, error: problem?.message || null, stderr }),
  };
}
