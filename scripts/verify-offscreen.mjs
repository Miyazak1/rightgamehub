import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createControlPipe } from '../poc/offscreen/control-pipe.cjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (!args.includes('--run')) {
  console.log('Prepared only: no Electron or game process was started.');
  console.log('After explicit desktop-test consent:');
  console.log('node scripts/verify-offscreen.mjs --run --electron "<absolute path to electron.exe>"');
  console.log('Uses a platform-owned offscreen sample for about 10 seconds; no OS input injection.');
  process.exit(0);
}
const runtime = args[args.indexOf('--electron') + 1];
if (process.platform !== 'win32' || !args.includes('--electron') || !path.isAbsolute(runtime || '') ||
    path.basename(runtime).toLowerCase() !== 'electron.exe' || !(await stat(runtime)).isFile()) {
  throw new Error('Supply an explicitly chosen Windows Electron runtime, not the original game EXE.');
}
const outputBase = path.join(root, '.runtime', 'offscreen-probe');
await mkdir(outputBase, { recursive: true });
const output = await mkdtemp(path.join(outputBase, 'run-'));
await mkdir(path.join(output, 'profile'));
const control = await createControlPipe();
const env = { ...process.env, GAMEHUB_OFFSCREEN_EXPERIMENT: '1', GAMEHUB_OFFSCREEN_PROFILE: path.join(output, 'profile'),
  GAMEHUB_OFFSCREEN_PIPE: control.name, GAMEHUB_OFFSCREEN_TOKEN: control.token,
  ELECTRON_NO_ATTACH_CONSOLE: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(runtime, [path.join(root, 'poc', 'offscreen', 'main.cjs')], {
  cwd: root, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
});
const events = new EventEmitter(), records = [];
let failure, closed, firstFrame, lastFrame, frameCount = 0, stderr = '';
let firstFrameAt, lastFrameAt, largestFrameGapMs = 0;
let hiddenUnfocusedFrameChecks = 0;
function fail(error) { failure ||= error; events.emit('change'); }
const exit = new Promise(resolve => child.on('close', (code, signal) => {
  closed = { code, signal }; resolve(closed); events.emit('change');
}));
child.on('error', error => fail(error));
control.events.on('failure', fail);
child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-16384); });
control.events.on('packet', packet => {
  try {
      if (failure) return;
      if (packet.type === 'frame') {
        if (typeof packet.jpeg !== 'string' || packet.jpeg.length > 2800000 ||
            !Number.isSafeInteger(packet.id) || packet.id <= (lastFrame?.id || 0)) throw new Error('Invalid frame');
        const now = Date.now();
        if (packet.windowState?.visible !== false || packet.windowState?.focused !== false) {
          throw new Error('Runtime did not confirm a hidden, unfocused game window');
        }
        hiddenUnfocusedFrameChecks++;
        if (lastFrameAt) largestFrameGapMs = Math.max(largestFrameGapMs, now - lastFrameAt);
        firstFrameAt ??= now; lastFrameAt = now;
        firstFrame ??= packet; lastFrame = packet; frameCount++;
      } else {
        records.push(packet);
        if (records.length > 256) throw new Error('Too many runtime reports');
        if (packet.type === 'stopped' && packet.reason !== 'requested') throw new Error(packet.reason);
      }
      events.emit('change');
  } catch (error) { fail(error); }
});
child.stdout.resume(); // Windows GUI stdout is not the protocol transport.
function waitFor(check, milliseconds = 10000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error('Runtime response timeout')), milliseconds);
    const finish = (error, value) => {
      clearTimeout(timeout); events.removeListener('change', changed);
      error ? reject(error) : resolve(value);
    };
    const changed = () => {
      if (failure) return finish(failure);
      const value = check();
      if (value) return finish(null, value);
      if (closed) finish(new Error('Runtime exited before verification completed'));
    };
    events.on('change', changed); changed();
  });
}
function send(command) {
  if (!closed) control.send(command);
}
async function input(command) {
  send(command);
  return (await waitFor(() => records.find(r => r.type === 'applied' && r.seq === command.seq))).state;
}
const heartbeat = setInterval(() => send({ type: 'ping' }), 3000);
const checks = {};
let forcedTermination = false;
try {
  await waitFor(() => records.find(r => r.type === 'ready'));
  await waitFor(() => firstFrame);
  const clicked = await input({ type: 'click', seq: 1, x: 320, y: 180 });
  checks.click = clicked.score === 1;
  const typed = await input({ type: 'text', seq: 2, value: '侧栏测试 🐱' });
  checks.text = typed.label === '侧栏测试 🐱';
  await input({ type: 'key', seq: 3, key: 'ArrowRight', down: true });
  await delay(250);
  const released = await input({ type: 'release', seq: 4 });
  await delay(250);
  const idle = await input({ type: 'release', seq: 5 });
  checks.directionAndRelease = released.x > 160 && idle.x === released.x;
  await delay(10000);
  await waitFor(() => lastFrame && Date.now() - lastFrameAt < 2000);
  checks.changingFrames = frameCount >= 30 && lastFrame.jpeg !== firstFrame.jpeg && largestFrameGapMs < 2000;
  if (!Object.values(checks).every(Boolean)) throw new Error('One or more probe checks failed');
} catch (error) { fail(error); }
finally {
  clearInterval(heartbeat);
  send({ type: 'stop' });
  await Promise.race([exit, delay(4000)]);
  if (!closed) {
    forcedTermination = true;
    child.kill(); // Only the directly spawned process. Descendant cleanup still needs validation.
    await Promise.race([exit, delay(2000)]);
  }
  child.stdout.destroy(); child.stderr.destroy(); child.unref();
  await control.close();
  const result = {
    status: !failure && !forcedTermination && closed?.code === 0 ? 'probe-checks-passed' : 'probe-failed',
    productAcceptance: 'not-tested', originalExe: false, sidebarIntegration: 'not-tested',
    desktopWindowObservation: 'not-collected', audio: 'not-implemented',
    electronWindowState: { hiddenUnfocusedFrameChecks, unexpectedShowOrFocusEvent: records.some(
      r => r.type === 'stopped' && ['unexpected-visible-window', 'unexpected-window-focus', 'window-contract-violated'].includes(r.reason)) },
    runtime: records.find(r => r.type === 'runtime') || null, checks,
    frames: { count: frameCount, spanMs: lastFrameAt - firstFrameAt || 0, largestGapMs: largestFrameGapMs },
    process: { ...closed, forcedTermination, descendantCleanup: 'not-observed' },
    error: failure?.message || null, stderr,
  };
  if (firstFrame) await writeFile(path.join(output, 'first.jpg'), Buffer.from(firstFrame.jpeg, 'base64'));
  if (lastFrame) await writeFile(path.join(output, 'last.jpg'), Buffer.from(lastFrame.jpeg, 'base64'));
  await writeFile(path.join(output, 'report.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(`${result.status}: ${path.join(output, 'report.json')}`);
  process.exitCode = result.status === 'probe-checks-passed' ? 0 : 1;
}
