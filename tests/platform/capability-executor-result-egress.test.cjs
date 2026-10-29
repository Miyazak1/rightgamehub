const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const executorUrl = pathToFileURL(path.resolve(__dirname,
  '../../apps/capability-executor/src/index.mjs')).href;
const JOURNAL_KEY = 'capability-executor-active-lease-v1';
const leaseId = '11111111-1111-4111-8111-111111111111';
const contract = { key: 'research.ocr', version: 1 };
const policy = {
  permissions: { files: 'user-selected', networkDomains: [], devices: [] },
  resources: { cpuCores: 2, memoryMiB: 2048, diskMiB: 1024, gpuMemoryMiB: 0 },
  dataPolicy: { localOnly: true, upload: 'never' },
};
const sha256 = crypto.createHash('sha256').update('structured OCR fixture').digest('hex');

const outputRef = (overrides = {}) => ({
  schemaVersion: 'capability-output-ref-v1',
  artifactId: '22222222-2222-4222-8222-222222222222',
  storage: 'node-local',
  sha256,
  sizeBytes: 2048,
  mediaType: 'application/json',
  contract,
  metadata: { pageCount: 2, executor: {
    schemaVersion: 'capability-local-artifact-pointer-v1', localArtifactKey: sha256,
  } },
  ...overrides,
});

const tempRoot = async prefix => {
  const base = path.resolve(process.cwd(), '.runtime', 'capability-executor-tests');
  await fs.promises.mkdir(base, { recursive: true });
  return fs.promises.mkdtemp(path.join(base, prefix));
};

test('result egress gate records reference-only transfer without private file material', async t => {
  const api = await import(executorUrl), root = await tempRoot('egress-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const gate = api.createCapabilityResultEgressGate({ rootDirectory: root,
    now: () => new Date('2026-10-29T02:00:00.000Z') });
  const submissionId = '33333333-3333-4333-8333-333333333333';
  const prepared = await gate.prepare({ submissionId, executionLeaseId: leaseId,
    contract, executionPolicy: policy, result: outputRef() });
  assert.deepEqual(prepared.result, outputRef());
  assert.deepEqual(prepared.receipt.transfer, { kind: 'structured-reference-only',
    rawArtifactUploaded: false, localPathUploaded: false,
    metadataBytes: Buffer.byteLength(JSON.stringify(outputRef().metadata), 'utf8') });
  assert.equal(JSON.stringify(prepared.receipt).includes('sourcePath'), false);
  assert.equal(JSON.stringify(prepared.receipt).includes('structured OCR fixture'), false);

  const submitted = await gate.confirm({ submissionId,
    remoteReceipt: { schemaVersion: 'agent-execution-stage-result-v1', accepted: true } });
  assert.match(submitted.preparedSha256, /^[a-f0-9]{64}$/u);
  assert.match(submitted.remoteReceiptSha256, /^[a-f0-9]{64}$/u);
  const inspected = await gate.inspect(submissionId);
  assert.equal(inspected.prepared.policy.upload, 'never');
  assert.equal(inspected.submitted.submissionId, submissionId);

  assert.deepEqual((await gate.prepare({ submissionId, executionLeaseId: leaseId,
    contract, executionPolicy: policy, result: outputRef() })).receipt, prepared.receipt);
  assert.deepEqual(await gate.confirm({ submissionId,
    remoteReceipt: { schemaVersion: 'agent-execution-stage-result-v1', accepted: true,
      replayed: true } }), submitted);
});

test('result egress gate fails closed on raw, remote or contract-confused results', async t => {
  const api = await import(executorUrl), root = await tempRoot('egress-invalid-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const gate = api.createCapabilityResultEgressGate({ rootDirectory: root });
  const attempt = result => gate.prepare({ submissionId: crypto.randomUUID(),
    executionLeaseId: leaseId, contract, executionPolicy: policy, result });
  await assert.rejects(attempt({ rawDocument: 'private bytes' }),
    error => error.code === 'CAPABILITY_RESULT_EGRESS_REF_INVALID');
  await assert.rejects(attempt(outputRef({ storage: 'remote' })),
    error => error.code === 'CAPABILITY_RESULT_EGRESS_REF_INVALID');
  await assert.rejects(attempt(outputRef({ contract: { key: 'research.paper', version: 1 } })),
    error => error.code === 'CAPABILITY_RESULT_EGRESS_REF_INVALID');
  const executor = outputRef().metadata.executor;
  await assert.rejects(attempt(outputRef({ metadata: { sourcePath: 'C:\\private.pdf', executor } })),
    error => error.code === 'CAPABILITY_RESULT_EGRESS_METADATA_INVALID');
  await assert.rejects(attempt(outputRef({ metadata: { rawContent: 'private source text', executor } })),
    error => error.code === 'CAPABILITY_RESULT_EGRESS_METADATA_INVALID');
});

test('runtime retains a prepared result until idempotent remote submission is audited', async t => {
  const api = await import(executorUrl), root = await tempRoot('egress-runtime-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const gate = api.createCapabilityResultEgressGate({ rootDirectory: path.join(root, 'audit') });
  const vault = api.createMemoryCredentialVault();
  const submissionIds = [];
  let completionAttempts = 0, failures = 0;
  const claim = { status: 'claimed', input: { authorizationId: crypto.randomUUID() }, prerequisites: [],
    lease: { id: leaseId, token: 'lease-token', expiresAt: '2026-10-29T03:00:00.000Z' },
    capability: { id: 'research.ocr', version: '1.0.0', contract,
      placement: { placementIndex: 0 }, manifest: { placements: [{ target: 'desktop',
        adapter: 'native-package', package: { sha256: sha256 }, ...policy }] } } };
  const client = {
    async claim() { return claim; }, async packageEvent() {}, async renew() {},
    async complete(_leaseId, input) {
      completionAttempts += 1;
      submissionIds.push(input.submissionId);
      if (completionAttempts === 1) throw Object.assign(new Error('offline'), { code: 'NETWORK_OFFLINE' });
      return { schemaVersion: 'agent-execution-stage-result-v1', accepted: true };
    },
    async fail() { failures += 1; },
  };
  const installation = { capabilityId: 'research.ocr', capabilityVersion: '1.0.0',
    packageSha256: sha256, absoluteDirectory: path.join(root, 'installed'), packageManifest: {} };
  const runtime = api.createCapabilityExecutorRuntime({ apiClient: client, credentialVault: vault,
    packageStore: { async verifyActive() { return installation; }, async install() {} },
    runner: { async run() { return outputRef(); } },
    downloadDirectory: path.join(root, 'downloads'), resultEgressGate: gate });

  assert.deepEqual(await runtime.runOnce(), { status: 'result-pending', errorCode: 'NETWORK_OFFLINE' });
  assert.equal(failures, 0);
  assert.ok(await vault.load(JOURNAL_KEY));
  let audit = await gate.inspect(submissionIds[0]);
  assert.ok(audit.prepared);
  assert.equal(audit.submitted, null);

  assert.equal((await runtime.recover()).status, 'completed-after-recovery');
  assert.equal(submissionIds[1], submissionIds[0]);
  assert.equal(await vault.load(JOURNAL_KEY), null);
  audit = await gate.inspect(submissionIds[0]);
  assert.ok(audit.submitted);
  assert.equal(failures, 0);
});

test('Windows bootstrap installs trusted validation and result egress into the runtime graph', async t => {
  const api = await import(executorUrl), root = await tempRoot('egress-bootstrap-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const runtimeId = 'mooyu.windows.capability-runtime';
  const helperSha256 = crypto.createHash('sha256').update('trusted helper').digest('hex');
  const releaseRoot = path.join(root, 'runtime-release');
  const bootstrap = api.createWindowsExecutorBootstrap({
    runtimeStore: { async active() { return { runtimeId, runtimeVersion: '1.2.0',
      manifestSha256: sha256, absoluteDirectory: releaseRoot, manifest: { runtimeId,
        helper: { path: 'bin/MooyuCapabilitySandboxHost.exe', sha256: helperSha256 },
        files: [{ path: 'bin/MooyuCapabilitySandboxHost.exe', sha256: helperSha256,
          role: 'sandbox-host' }] } }; } },
    runtimeId,
    dataRoot: path.join(root, 'data'),
    apiClient: { async claim() { return { status: 'idle' }; }, async complete() {} },
    packageStore: { async install() {} },
    credentialVault: api.createMemoryCredentialVault(),
    fileGrantBroker: { async resolve() { return []; } },
    platform: 'win32',
  });
  const assembled = await bootstrap.assemble();
  assert.equal(typeof assembled.artifactValidator.validate, 'function');
  assert.equal(typeof assembled.resultEgressGate.prepare, 'function');
  const submissionId = crypto.randomUUID();
  await assembled.resultEgressGate.prepare({ submissionId, executionLeaseId: leaseId,
    contract, executionPolicy: policy, result: outputRef() });
  assert.ok((await assembled.resultEgressGate.inspect(submissionId)).prepared);
  assert.equal(await fs.promises.stat(path.join(root, 'data', 'result-egress-audit',
    submissionId, 'prepared.json')).then(item => item.isFile()), true);
});
