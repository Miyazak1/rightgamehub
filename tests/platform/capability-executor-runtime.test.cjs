const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const executorUrl = pathToFileURL(path.resolve(__dirname,
  '../../apps/capability-executor/src/index.mjs')).href;
const JOURNAL_KEY = 'capability-executor-active-lease-v1';
const body = Buffer.from('signed fixture package');
const digest = crypto.createHash('sha256').update(body).digest('hex');
const tempRoot = async prefix => {
  const base = path.resolve(process.cwd(), '.runtime', 'capability-executor-tests');
  await fs.promises.mkdir(base, { recursive: true });
  return fs.promises.mkdtemp(path.join(base, prefix));
};

const claim = () => ({ status: 'claimed', input: { document: 'local.pdf' }, prerequisites: [],
  lease: { id: '11111111-1111-4111-8111-111111111111', token: 'lease-token-value',
    expiresAt: '2026-10-28T10:10:00.000Z' },
  capability: { id: 'research.fixture', version: '1.0.0',
    contract: { key: 'research.fixture', version: 1 }, placement: { placementIndex: 0 },
    manifest: { capabilityId: 'research.fixture', capabilityVersion: '1.0.0',
      contract: { key: 'research.fixture', version: 1 }, placements: [{ target: 'desktop',
        adapter: 'native-package', platforms: ['windows-x64'],
        permissions: { files: 'user-selected', networkDomains: [], devices: [] },
        resources: { cpuCores: 2, memoryMiB: 1024, diskMiB: 1024, gpuMemoryMiB: 0 },
        dataPolicy: { localOnly: true, upload: 'never' }, package: {
          url: 'https://downloads.mooyu.fun/fixture.zip', sha256: digest,
          sizeBytes: body.length, keyId: 'mooyu.release.fixture', signature: 'x'.repeat(64),
        } }] } } });

function apiFixture(nextClaim = claim()) {
  const calls = [];
  return { calls,
    async claim() { calls.push(['claim']); return nextClaim; },
    async packageEvent(input) { calls.push(['packageEvent', input.eventType]); return {}; },
    async renew(...args) { calls.push(['renew', ...args]); return {}; },
    async complete(...args) { calls.push(['complete', ...args]); return { accepted: true }; },
    async fail(...args) { calls.push(['fail', ...args]); return { accepted: true }; },
  };
}

const installResult = directory => ({ capabilityId: 'research.fixture', capabilityVersion: '1.0.0',
  packageSha256: digest, absoluteDirectory: directory,
  packageManifest: { entrypoint: { kind: 'native-executable', path: 'bin/fixture.exe', arguments: [] } } });

test('runtime downloads, installs, executes and submits one idempotent result', async t => {
  const api = await import(executorUrl), root = await tempRoot('runtime-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const client = apiFixture(), vault = api.createMemoryCredentialVault(), installs = [], runs = [];
  const runtime = api.createCapabilityExecutorRuntime({ apiClient: client, credentialVault: vault,
    downloadDirectory: path.join(root, 'downloads'), packageStore: {
      async verifyActive() { return null; },
      async install(input) { installs.push(input); return installResult(path.join(root, 'installed')); },
    }, runner: { async run(input) { runs.push(input); return { text: 'verified local output' }; } },
    fetchImpl: async () => new Response(body, { status: 200,
      headers: { 'content-length': String(body.length) } }) });
  const result = await runtime.runOnce();
  assert.equal(result.status, 'completed');
  assert.equal(installs.length, 1);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].signal.aborted, false);
  assert.deepEqual(runs[0].executionPolicy, {
    permissions: { files: 'user-selected', networkDomains: [], devices: [] },
    resources: { cpuCores: 2, memoryMiB: 1024, diskMiB: 1024, gpuMemoryMiB: 0 },
    dataPolicy: { localOnly: true, upload: 'never' },
  });
  assert.deepEqual(client.calls.filter(item => item[0] === 'packageEvent').map(item => item[1]),
    ['download-started', 'download-completed', 'signature-verified', 'install-ready']);
  const completion = client.calls.find(item => item[0] === 'complete');
  assert.match(completion[2].submissionId, /^[0-9a-f-]{36}$/u);
  assert.deepEqual(completion[2].result, { text: 'verified local output' });
  assert.equal(await vault.load(JOURNAL_KEY), null);
});

test('runtime resolves local components under the renewable lease and passes them to the runner', async t => {
  const api = await import(executorUrl), root = await tempRoot('runtime-components-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const current = claim();
  current.prerequisites = [{ stageKey: 'paper-layout-engine-plan', status: 'succeeded',
    outputRef: { plan: true } }];
  const client = apiFixture(current), bindings = [{ componentId: 'fixture-model' }];
  let resolution, runInputValue;
  const runtime = api.createCapabilityExecutorRuntime({ apiClient: client,
    credentialVault: api.createMemoryCredentialVault(), downloadDirectory: path.join(root, 'downloads'),
    packageStore: { async verifyActive() { return installResult(path.join(root, 'installed')); },
      async install() {} },
    componentResolver: { async resolve(input) { resolution = input; return bindings; } },
    runner: { async run(input) { runInputValue = input; return { ok: true }; } } });
  assert.equal((await runtime.runOnce()).status, 'completed');
  assert.deepEqual(resolution.contract, current.capability.contract);
  assert.deepEqual(resolution.prerequisites, current.prerequisites);
  assert.equal(resolution.signal.aborted, false);
  assert.deepEqual(runInputValue.componentBindings, bindings);
});

test('component resolution failure is safe because native execution has not started', async t => {
  const api = await import(executorUrl), root = await tempRoot('runtime-component-failure-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const client = apiFixture(); let runs = 0;
  const runtime = api.createCapabilityExecutorRuntime({ apiClient: client,
    credentialVault: api.createMemoryCredentialVault(), downloadDirectory: path.join(root, 'downloads'),
    packageStore: { async verifyActive() { return installResult(path.join(root, 'installed')); },
      async install() {} }, componentResolver: { async resolve() {
      throw Object.assign(new Error('catalog unavailable'), { code: 'COMPONENT_CATALOG_UNAVAILABLE' });
    } }, runner: { async run() { runs += 1; } } });
  assert.deepEqual(await runtime.runOnce(), { status: 'failed-reported', outcome: 'safe-failure' });
  assert.equal(runs, 0);
  const failure = client.calls.find(item => item[0] === 'fail');
  assert.equal(failure[2].errorCode, 'COMPONENT_CATALOG_UNAVAILABLE');
  assert.equal(failure[2].outcome, 'safe-failure');
});

test('runtime reuses a verified active package without downloading', async t => {
  const api = await import(executorUrl), root = await tempRoot('reuse-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const client = apiFixture(), vault = api.createMemoryCredentialVault();
  let fetched = false, installed = false;
  const runtime = api.createCapabilityExecutorRuntime({ apiClient: client, credentialVault: vault,
    downloadDirectory: path.join(root, 'downloads'), packageStore: {
      async verifyActive() { return installResult(path.join(root, 'installed')); },
      async install() { installed = true; },
    }, runner: { async run() { return { ok: true }; } },
    fetchImpl: async () => { fetched = true; throw new Error('unexpected fetch'); } });
  assert.equal((await runtime.runOnce()).status, 'completed');
  assert.equal(fetched, false);
  assert.equal(installed, false);
  assert.equal(client.calls.some(item => item[0] === 'packageEvent'), false);
});

test('recovery resubmits pending results and never repeats an uncertain native run', async t => {
  const api = await import(executorUrl), root = await tempRoot('recovery-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const vault = api.createMemoryCredentialVault(), client = apiFixture(), current = claim();
  let runs = 0;
  const runtime = api.createCapabilityExecutorRuntime({ apiClient: client, credentialVault: vault,
    downloadDirectory: path.join(root, 'downloads'), packageStore: { async install() {} },
    runner: { async run() { runs += 1; return {}; } } });
  await vault.store(JOURNAL_KEY, JSON.stringify({ schemaVersion: 'capability-executor-journal-v1',
    phase: 'result-pending', claim: current, submissionId: '22222222-2222-4222-8222-222222222222',
    result: { output: 'already produced' } }));
  assert.equal((await runtime.recover()).status, 'completed-after-recovery');
  assert.equal(runs, 0);
  assert.equal(client.calls.filter(item => item[0] === 'complete').length, 1);

  await vault.store(JOURNAL_KEY, JSON.stringify({ schemaVersion: 'capability-executor-journal-v1',
    phase: 'running', claim: current, installation: installResult(path.join(root, 'installed')) }));
  const uncertain = await runtime.recover();
  assert.deepEqual(uncertain, { status: 'failed-reported', outcome: 'uncertain' });
  assert.equal(runs, 0);
  const failed = client.calls.findLast(item => item[0] === 'fail');
  assert.equal(failed[2].errorCode, 'CAPABILITY_EXECUTOR_RESTARTED_DURING_RUN');
  assert.equal(failed[2].retryable, false);
});

test('recovery may safely resume component resolution before native execution begins', async t => {
  const api = await import(executorUrl), root = await tempRoot('resolution-recovery-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const vault = api.createMemoryCredentialVault(), client = apiFixture(), current = claim();
  let resolved = 0, runs = 0;
  const runtime = api.createCapabilityExecutorRuntime({ apiClient: client, credentialVault: vault,
    downloadDirectory: path.join(root, 'downloads'), packageStore: { async install() {} },
    componentResolver: { async resolve() { resolved += 1; return []; } },
    runner: { async run() { runs += 1; return { ok: true }; } } });
  await vault.store(JOURNAL_KEY, JSON.stringify({ schemaVersion: 'capability-executor-journal-v1',
    phase: 'resolving-components', claim: current,
    installation: installResult(path.join(root, 'installed')) }));
  assert.equal((await runtime.recover()).status, 'completed');
  assert.equal(resolved, 1);
  assert.equal(runs, 1);
  assert.equal(client.calls.some(item => item[0] === 'fail'), false);
});

test('safe package failures are reported without invoking native code', async t => {
  const api = await import(executorUrl), root = await tempRoot('safe-failure-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const client = apiFixture(), vault = api.createMemoryCredentialVault();
  let runs = 0;
  const runtime = api.createCapabilityExecutorRuntime({ apiClient: client, credentialVault: vault,
    downloadDirectory: path.join(root, 'downloads'), packageStore: {
      async verifyActive() { return null; }, async install() { throw Object.assign(new Error('bad package'),
        { code: 'CAPABILITY_PACKAGE_SIGNATURE_INVALID', safeFailure: true, retryable: false }); },
    }, runner: { async run() { runs += 1; } },
    fetchImpl: async () => new Response(body, { status: 200,
      headers: { 'content-length': String(body.length) } }) });
  assert.deepEqual(await runtime.runOnce(), { status: 'failed-reported', outcome: 'safe-failure' });
  assert.equal(runs, 0);
  assert.equal(client.calls.find(item => item[0] === 'fail')[2].outcome, 'safe-failure');
});

test('a failed lease renewal aborts a cooperative native runner and reports uncertainty', async t => {
  const api = await import(executorUrl), root = await tempRoot('renewal-abort-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const client = apiFixture(), vault = api.createMemoryCredentialVault();
  client.renew = async () => { throw Object.assign(new Error('lease lost'),
    { code: 'EXECUTION_STAGE_LEASE_LOST' }); };
  let aborted = false;
  const runtime = api.createCapabilityExecutorRuntime({ apiClient: client, credentialVault: vault,
    downloadDirectory: path.join(root, 'downloads'), renewalIntervalMs: 1000,
    packageStore: { async verifyActive() { return installResult(path.join(root, 'installed')); },
      async install() {} }, runner: { async run({ signal }) {
      return new Promise((_resolve, reject) => {
        const guard = setTimeout(() => reject(new Error('runner was not aborted')), 5000);
        signal.addEventListener('abort', () => {
          clearTimeout(guard);
          aborted = true;
          reject(signal.reason);
        }, { once: true });
      });
    } } });
  assert.deepEqual(await runtime.runOnce(), { status: 'failed-reported', outcome: 'uncertain' });
  assert.equal(aborted, true);
  assert.equal(client.calls.find(item => item[0] === 'fail')[2].retryable, false);
});
