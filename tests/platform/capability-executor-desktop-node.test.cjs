const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const apiUrl = pathToFileURL(path.resolve(__dirname,
  '../../apps/capability-executor/src/index.mjs')).href;
const tempRoot = async prefix => {
  const base = path.resolve('.runtime/capability-desktop-node-tests');
  await fs.promises.mkdir(base, { recursive: true });
  return fs.promises.mkdtemp(path.join(base, prefix));
};
const resources = { cpuCores: 4, memoryMiB: 8192, diskMiB: 32768, gpuMemoryMiB: 0 };

function fixtures({ outcomes = [{ status: 'idle' }], updateStatus = 'current',
  updateStatuses = null } = {}) {
  const calls = [], queue = [...outcomes], updates = updateStatuses ? [...updateStatuses] : null;
  const runtime = {
    async recover() { calls.push('runtime.recover'); return null; },
    async runOnce() {
      calls.push('runtime.runOnce');
      const value = queue.shift() ?? { status: 'idle' };
      if (value instanceof Error) throw value;
      return value;
    },
  };
  return { calls, runtime,
    updater: {
      async recover() { calls.push('updater.recover'); return null; },
      async checkAndApply() { calls.push('updater.check'); return {
        status: updates?.shift() ?? updateStatus }; },
    },
    bootstrap: { async assemble() { calls.push('bootstrap.assemble'); return { runtime,
      release: { runtimeId: 'mooyu.windows.runtime', runtimeVersion: '1.0.0',
        manifestSha256: 'a'.repeat(64) } }; } },
    apiClient: { async heartbeat(input) { calls.push('heartbeat'); return input; } },
  };
}

test('desktop supervisor recovers, updates, assembles, heartbeats and runs bounded cycles', async t => {
  const api = await import(apiUrl), root = await tempRoot('lifecycle-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const fixture = fixtures({ outcomes: [{ status: 'completed' }, { status: 'idle' }] });
  let time = Date.parse('2026-10-28T02:00:00.000Z');
  const supervisor = api.createDesktopNodeSupervisor({ rootDirectory: root,
    runtimeUpdater: fixture.updater, bootstrap: fixture.bootstrap, apiClient: fixture.apiClient,
    resources, metadata: { deviceLabel: 'test-node' }, now: () => new Date(time), random: () => 0.5,
    sleep: async milliseconds => { time += milliseconds; }, pollIntervalMs: 50,
    heartbeatIntervalMs: 50, updateIntervalMs: 10_000, lockStaleAfterMs: 1000,
    initialBackoffMs: 10, maximumBackoffMs: 100, circuitFailureThreshold: 3,
    circuitCooldownMs: 100 });
  const result = await supervisor.run({ maximumCycles: 2 });
  assert.deepEqual(result, { status: 'stopped', cycles: 2, lastOutcome: 'idle' });
  assert.deepEqual(fixture.calls.slice(0, 5), ['updater.recover', 'updater.check',
    'bootstrap.assemble', 'runtime.recover', 'heartbeat']);
  assert.equal(fixture.calls.filter(item => item === 'runtime.runOnce').length, 2);
  const status = await supervisor.stateStore.readStatus();
  assert.equal(status.state, 'stopped');
  assert.equal(status.runtime.manifestSha256, 'a'.repeat(64));
  const diagnostics = path.join(root, 'diagnostics.json');
  const report = await api.exportDesktopNodeDiagnostics({ stateStore: supervisor.stateStore,
    destination: diagnostics, now: () => new Date(time) });
  assert.equal(report.status.state, 'stopped');
  assert.ok(report.events.some(item => item.type === 'cycle-completed'));
  assert.doesNotMatch(await fs.promises.readFile(diagnostics, 'utf8'), /accessToken|renewalToken/iu);
});

test('transient failures use bounded backoff and open a circuit without a busy loop', async t => {
  const api = await import(apiUrl), root = await tempRoot('circuit-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const transient = () => Object.assign(new Error('temporary'), {
    code: 'CAPABILITY_NODE_API_HTTP_503', retryable: true, safeFailure: true,
  });
  const fixture = fixtures({ outcomes: [transient(), transient(), transient()] });
  let time = Date.parse('2026-10-28T02:00:00.000Z');
  const waits = [];
  const supervisor = api.createDesktopNodeSupervisor({ rootDirectory: root,
    runtimeUpdater: fixture.updater, bootstrap: fixture.bootstrap, apiClient: fixture.apiClient,
    resources, now: () => new Date(time), random: () => 0.5,
    sleep: async milliseconds => { waits.push(milliseconds); time += milliseconds; },
    pollIntervalMs: 50, heartbeatIntervalMs: 10_000, updateIntervalMs: 10_000,
    lockStaleAfterMs: 1000, initialBackoffMs: 10, maximumBackoffMs: 25,
    circuitFailureThreshold: 3, circuitCooldownMs: 500 });
  await supervisor.run({ maximumCycles: 3 });
  assert.deepEqual(waits, [10, 20]);
  const status = await supervisor.stateStore.readStatus();
  assert.equal(status.consecutiveFailures, 3);
  assert.equal(status.circuitOpenUntil, '2026-10-28T02:00:00.530Z');
  const events = await supervisor.stateStore.readEvents();
  assert.equal(events.filter(item => item.type === 'cycle-failed').length, 3);
});

test('an idle trusted update is reassembled before the next claim cycle', async t => {
  const api = await import(apiUrl), root = await tempRoot('reassemble-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const fixture = fixtures({ outcomes: [{ status: 'idle' }, { status: 'completed' }],
    updateStatuses: ['current', 'updated'] });
  let time = Date.parse('2026-10-28T02:00:00.000Z');
  const supervisor = api.createDesktopNodeSupervisor({ rootDirectory: root,
    runtimeUpdater: fixture.updater, bootstrap: fixture.bootstrap, apiClient: fixture.apiClient,
    resources, now: () => new Date(time), sleep: async milliseconds => { time += milliseconds; },
    pollIntervalMs: 50, heartbeatIntervalMs: 1000, updateIntervalMs: 50,
    lockStaleAfterMs: 1000, initialBackoffMs: 10, maximumBackoffMs: 100,
    circuitFailureThreshold: 3, circuitCooldownMs: 100 });
  await supervisor.run({ maximumCycles: 2 });
  assert.equal(fixture.calls.filter(item => item === 'updater.check').length, 2);
  assert.equal(fixture.calls.filter(item => item === 'bootstrap.assemble').length, 2);
  const secondAssembly = fixture.calls.lastIndexOf('bootstrap.assemble');
  assert.ok(secondAssembly < fixture.calls.lastIndexOf('runtime.runOnce'));
});

test('fatal trust or session uncertainty pauses instead of retrying unsafe work', async t => {
  const api = await import(apiUrl), root = await tempRoot('fatal-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const fatal = Object.assign(new Error('uncertain refresh'), {
    code: 'CAPABILITY_NODE_SESSION_REFRESH_UNCERTAIN', safeFailure: true,
  });
  const fixture = fixtures({ outcomes: [fatal] });
  const supervisor = api.createDesktopNodeSupervisor({ rootDirectory: root,
    runtimeUpdater: fixture.updater, bootstrap: fixture.bootstrap, apiClient: fixture.apiClient,
    resources, sleep: async () => {}, pollIntervalMs: 50, heartbeatIntervalMs: 50,
    updateIntervalMs: 1000, lockStaleAfterMs: 1000, initialBackoffMs: 10,
    maximumBackoffMs: 100, circuitFailureThreshold: 3, circuitCooldownMs: 100 });
  await supervisor.run({ maximumCycles: 1 });
  const status = await supervisor.stateStore.readStatus();
  assert.equal(status.paused, true);
  assert.equal(status.consecutiveFailures, 1);
});

test('control requests are exact, consumed once and stop before claiming more work', async t => {
  const api = await import(apiUrl), root = await tempRoot('control-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const fixture = fixtures();
  const stateStore = api.createDesktopNodeStateStore({ rootDirectory: root });
  await stateStore.requestControl('stop');
  await stateStore.requestControl('resume');
  const supervisor = api.createDesktopNodeSupervisor({ rootDirectory: root, stateStore,
    runtimeUpdater: fixture.updater, bootstrap: fixture.bootstrap, apiClient: fixture.apiClient,
    resources, sleep: async () => {}, pollIntervalMs: 50, heartbeatIntervalMs: 50,
    updateIntervalMs: 1000, lockStaleAfterMs: 1000, initialBackoffMs: 10,
    maximumBackoffMs: 100, circuitFailureThreshold: 3, circuitCooldownMs: 100 });
  const result = await supervisor.run({ maximumCycles: 1 });
  assert.equal(result.cycles, 0);
  assert.equal(fixture.calls.includes('runtime.runOnce'), false);
  assert.equal(await stateStore.consumeControl(), null);
});

test('lifecycle CLI exposes status, exact controls and a redacted diagnostic report', async t => {
  const api = await import(apiUrl), root = await tempRoot('cli-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const store = api.createDesktopNodeStateStore({ rootDirectory: root });
  await store.writeStatus({ state: 'ready', generation: 1, pid: process.pid, paused: false,
    startedAt: '2026-10-28T00:00:00.000Z', runtime: { runtimeId: 'mooyu.windows.runtime',
      runtimeVersion: '1.0.0', manifestSha256: 'b'.repeat(64) }, consecutiveFailures: 0,
    lastOutcome: 'idle', nextAttemptAt: null, circuitOpenUntil: null });
  const invoke = args => spawnSync(process.execPath, ['scripts/windows-desktop-node-cli.mjs', ...args],
    { cwd: path.resolve('.'), encoding: 'utf8', windowsHide: true });
  const status = invoke(['status', '--root', root]);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).state, 'ready');
  const pause = invoke(['pause', '--root', root]);
  assert.equal(pause.status, 0, pause.stderr);
  assert.equal(JSON.parse(pause.stdout).command, 'pause');
  assert.equal((await store.consumeControl()).command, 'pause');
  const output = path.join(root, 'support', 'diagnostics.json');
  const diagnostics = invoke(['diagnostics', '--root', root, '--output', output]);
  assert.equal(diagnostics.status, 0, diagnostics.stderr);
  assert.equal(JSON.parse(diagnostics.stdout).output, output);
  assert.equal(JSON.parse(await fs.promises.readFile(output, 'utf8')).status.state, 'ready');
  const cli = await import(pathToFileURL(path.resolve('scripts/windows-desktop-node-cli.mjs')).href);
  assert.equal(cli.windowsDesktopNodeExitCode({ code: 'CAPABILITY_DESKTOP_NODE_ALREADY_RUNNING' }), 20);
  assert.equal(cli.windowsDesktopNodeExitCode({ code: 'CAPABILITY_NODE_SESSION_REFRESH_UNCERTAIN' }), 40);
  assert.equal(cli.windowsDesktopNodeExitCode({ code: 'CAPABILITY_RUNTIME_UPDATE_HEALTH_FAILED' }), 50);
});

test('a live supervisor lock cannot be stolen even after the stale-time threshold', async t => {
  const api = await import(apiUrl), root = await tempRoot('single-instance-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const make = () => {
    const fixture = fixtures();
    return api.createDesktopNodeSupervisor({ rootDirectory: root, runtimeUpdater: fixture.updater,
      bootstrap: fixture.bootstrap, apiClient: fixture.apiClient, resources,
      sleep: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
      pollIntervalMs: 50, heartbeatIntervalMs: 50, updateIntervalMs: 1000,
      lockStaleAfterMs: 1000, initialBackoffMs: 10, maximumBackoffMs: 100,
      circuitFailureThreshold: 3, circuitCooldownMs: 100 });
  };
  const first = make(), controller = new AbortController();
  const active = first.run({ signal: controller.signal });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if ((await first.stateStore.readStatus().catch(() => null))?.state === 'ready') break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  await assert.rejects(make().run({ maximumCycles: 1 }),
    error => error.code === 'CAPABILITY_DESKTOP_NODE_ALREADY_RUNNING');
  controller.abort(new Error('test stop'));
  assert.equal((await active).status, 'stopped');
});

test('graceful stop drains an active cycle and does not claim another one', async t => {
  const api = await import(apiUrl), root = await tempRoot('drain-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  let enter, release;
  const entered = new Promise(resolve => { enter = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let runs = 0;
  const fixture = fixtures();
  fixture.runtime.runOnce = async () => { runs += 1; enter(); await gate; return { status: 'completed' }; };
  const supervisor = api.createDesktopNodeSupervisor({ rootDirectory: root,
    runtimeUpdater: fixture.updater, bootstrap: fixture.bootstrap, apiClient: fixture.apiClient,
    resources, sleep: async () => {}, pollIntervalMs: 50, heartbeatIntervalMs: 1000,
    updateIntervalMs: 1000, lockStaleAfterMs: 1000, initialBackoffMs: 10,
    maximumBackoffMs: 100, circuitFailureThreshold: 3, circuitCooldownMs: 100 });
  const controller = new AbortController(), active = supervisor.run({ signal: controller.signal });
  await entered;
  controller.abort(new Error('graceful stop'));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(runs, 1);
  release();
  const result = await active;
  assert.equal(result.cycles, 1);
  assert.equal(runs, 1);
});

test('Windows supervisor path exercises the real helper self-test and DPAPI vault', {
  skip: process.platform !== 'win32', timeout: 60_000,
}, async t => {
  const api = await import(apiUrl), root = await tempRoot('windows-e2e-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const output = path.join(root, 'native');
  const compile = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    'scripts/build-capability-sandbox-host-windows.ps1', '-OutputDirectory', output, '-SkipFixture'],
  { cwd: path.resolve('.'), encoding: 'utf8', windowsHide: true });
  assert.equal(compile.status, 0, compile.stderr || compile.stdout);
  const helperPath = path.join(output, 'MooyuCapabilitySandboxHost.exe');
  const helperSha256 = crypto.createHash('sha256').update(await fs.promises.readFile(helperPath)).digest('hex');
  const vault = api.createWindowsDpapiCredentialVault({ directory: path.join(root, 'vault') });
  const calls = [];
  const bootstrap = { async assemble() {
    await api.probeWindowsSandboxHost({ helperPath, helperSha256, platform: 'win32' });
    return { release: { runtimeId: 'mooyu.windows.runtime', runtimeVersion: '1.0.0',
      manifestSha256: helperSha256 }, runtime: {
      async recover() { assert.equal(await vault.load('node-e2e'), null); return null; },
      async runOnce() {
        await vault.store('node-e2e', 'protected-value');
        assert.equal(await vault.load('node-e2e'), 'protected-value');
        await vault.remove('node-e2e');
        calls.push('ran');
        return { status: 'idle' };
      },
    } };
  } };
  const supervisor = api.createDesktopNodeSupervisor({ rootDirectory: root,
    runtimeUpdater: { async recover() {}, async checkAndApply() { return { status: 'current' }; } },
    bootstrap, apiClient: { async heartbeat() {} }, resources,
    sleep: async () => {}, pollIntervalMs: 50, heartbeatIntervalMs: 50,
    updateIntervalMs: 1000, lockStaleAfterMs: 1000, initialBackoffMs: 10,
    maximumBackoffMs: 100, circuitFailureThreshold: 3, circuitCooldownMs: 100 });
  await supervisor.run({ maximumCycles: 1 });
  assert.deepEqual(calls, ['ran']);
});
