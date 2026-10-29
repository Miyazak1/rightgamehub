const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const executorUrl = pathToFileURL(path.join(root,
  'apps/capability-executor/src/index.mjs')).href;
const contract = { key: 'research.paper.layout', version: 1 };
const policy = {
  permissions: { files: 'user-selected', networkDomains: [], devices: [] },
  resources: { cpuCores: 2, memoryMiB: 3072, diskMiB: 4096, gpuMemoryMiB: 0 },
  dataPolicy: { localOnly: true, upload: 'never' },
};
const capabilities = { schemaVersion: 'windows-sandbox-host-capabilities-v1', platform: 'win32',
  features: { restrictedToken: true, jobObject: true, filesystemProjection: true,
    networkIsolation: true, deviceIsolation: true, processTreeTermination: true } };

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const tempRoot = async prefix => {
  const base = path.resolve(process.cwd(), '.runtime', 'capability-executor-tests');
  await fs.promises.mkdir(base, { recursive: true });
  return fs.promises.mkdtemp(path.join(base, prefix));
};

function runFixtureProcess(spec) {
  return new Promise((resolve, reject) => {
    const child = spawn(spec.executable, spec.arguments, { cwd: spec.workingDirectory,
      env: { ...process.env, ...spec.environment }, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'] });
    let stdoutBytes = 0, stderrBytes = 0;
    child.stdout.on('data', chunk => { stdoutBytes += chunk.length; });
    child.stderr.on('data', chunk => { stderrBytes += chunk.length; });
    child.on('error', reject);
    child.on('exit', exitCode => resolve({ exitCode, terminationReason: 'exited',
      stdoutBytes, stderrBytes }));
  });
}

test('paper layout reference capability completes through local-only egress and audit', {
  skip: process.platform !== 'win32', timeout: 30_000,
}, async t => {
  const api = await import(executorUrl), testRoot = await tempRoot('paper-egress-');
  t.after(() => fs.promises.rm(testRoot, { recursive: true, force: true }));
  const packageRoot = path.join(testRoot, 'package');
  const build = spawnSync(process.execPath, [path.join(root,
    'scripts/build-paper-layout-capability-package.mjs'), '--output', packageRoot],
  { encoding: 'utf8', windowsHide: true });
  assert.equal(build.status, 0, build.stderr);
  const packageManifest = JSON.parse(await fs.promises.readFile(
    path.join(packageRoot, 'capability.json'), 'utf8'));

  const pdfBytes = Buffer.from('%PDF-1.7\nprivate local paper fixture\n%%EOF');
  const pdf = path.join(testRoot, 'private-paper.pdf');
  await fs.promises.writeFile(pdf, pdfBytes);
  const opened = await api.openVerifiedWindowsFile(pdf, null);
  const identity = opened.identity;
  await opened.handle.close();

  const artifactStore = api.createLocalArtifactStore({
    rootDirectory: path.join(testRoot, 'artifacts'),
  });
  const artifactValidator = api.createTrustedCapabilityArtifactValidator();
  const runner = api.createWindowsNativeRunner({ workRoot: path.join(testRoot, 'runs'),
    artifactStore, artifactValidator, platform: 'win32', sandboxHost: { capabilities,
      run: runFixtureProcess }, fileGrantBroker: { async resolve() { return [{
        grantId: '22222222-2222-4222-8222-222222222222', scope: 'user-selected',
        sourcePath: pdf, access: 'read', displayName: 'private-paper.pdf', identity,
      }]; } } });
  const resultEgressGate = api.createCapabilityResultEgressGate({
    rootDirectory: path.join(testRoot, 'result-egress-audit'),
  });
  const claim = { status: 'claimed', input: {
    schemaVersion: 'research-paper-layout-input-v1', artifact: {
      sha256: digest(pdfBytes), mimeType: 'application/pdf', sizeBytes: pdfBytes.length, pageCount: 1,
    }, pageSignals: [{ page: 1, textChars: 500, replacementChars: 0,
      positionedGlyphs: 480, imageCoverageBp: 0, multiColumn: false,
      tableRisk: false, formulaRisk: false }], policy: {
      maxPages: 500, maxBytes: 512 * 1024 * 1024, ocrPageLimit: 50,
      allowOcr: true, allowLayout: true,
    },
  }, prerequisites: [], lease: { id: '11111111-1111-4111-8111-111111111111',
    token: 'lease-token', expiresAt: '2026-10-29T10:00:00.000Z' }, capability: {
    id: 'mooyu.research.paper.layout', version: '1.0.0', contract,
    placement: { placementIndex: 0 }, manifest: { placements: [{ target: 'desktop',
      adapter: 'native-package', ...policy, package: { sha256: digest('package') } }] },
  } };
  let completion = null;
  const runtime = api.createCapabilityExecutorRuntime({ apiClient: {
    async claim() { return claim; }, async packageEvent() {}, async renew() {},
    async complete(_leaseId, input) {
      completion = structuredClone(input);
      return { schemaVersion: 'agent-execution-stage-result-v1', accepted: true };
    }, async fail() { assert.fail('paper layout run must not be reported as failed'); },
  }, packageStore: { async verifyActive() { return {
    capabilityId: claim.capability.id, capabilityVersion: claim.capability.version,
    packageSha256: digest('package'), absoluteDirectory: packageRoot, packageManifest,
  }; }, async install() {} }, credentialVault: api.createMemoryCredentialVault(), runner,
  resultEgressGate, downloadDirectory: path.join(testRoot, 'downloads') });

  assert.equal((await runtime.runOnce()).status, 'completed');
  assert.equal(completion.result.contract.key, contract.key);
  assert.equal(completion.result.storage, 'node-local');
  assert.deepEqual(completion.result.metadata, { route: 'text-layer', textLayerPages: 1,
    localLayoutPages: 0, localOcrPages: 0, executor: {
      schemaVersion: 'capability-local-artifact-pointer-v1',
      localArtifactKey: completion.result.sha256,
    } });
  assert.equal(JSON.stringify(completion).includes(pdf), false);
  assert.equal(JSON.stringify(completion).includes(pdfBytes.toString('utf8')), false);

  const stored = await artifactStore.resolve(completion.result.sha256);
  const decision = JSON.parse(await fs.promises.readFile(stored.artifactFile, 'utf8'));
  assert.equal(decision.schemaVersion, 'research-paper-layout-decision-v1');
  assert.deepEqual(decision.textLayerPages, [1]);
  const audit = await resultEgressGate.inspect(completion.submissionId);
  assert.equal(audit.prepared.contract.key, contract.key);
  assert.deepEqual(audit.prepared.policy, { fileScope: 'user-selected',
    localOnly: true, upload: 'never' });
  assert.deepEqual(audit.prepared.transfer, { kind: 'structured-reference-only',
    rawArtifactUploaded: false, localPathUploaded: false,
    metadataBytes: Buffer.byteLength(JSON.stringify(completion.result.metadata), 'utf8') });
  assert.ok(audit.submitted);
});
