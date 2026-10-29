const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const executorUrl = pathToFileURL(path.resolve(__dirname,
  '../../apps/capability-executor/src/index.mjs')).href;
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const tempRoot = async prefix => {
  const base = path.resolve(process.cwd(), '.runtime', 'capability-executor-tests');
  await fs.promises.mkdir(base, { recursive: true });
  return fs.promises.mkdtemp(path.join(base, prefix));
};
const hostCapabilities = (overrides = {}) => ({
  schemaVersion: 'windows-sandbox-host-capabilities-v1', platform: 'win32', features: {
    restrictedToken: true, jobObject: true, filesystemProjection: true,
    networkIsolation: true, deviceIsolation: true, processTreeTermination: true,
    ...overrides,
  },
});
const policy = (overrides = {}) => ({
  permissions: { files: 'none', networkDomains: [], devices: [] },
  resources: { cpuCores: 2, memoryMiB: 1024, diskMiB: 1024, gpuMemoryMiB: 0 },
  dataPolicy: { localOnly: true, upload: 'never' }, ...overrides,
});

async function installation(root, executable = Buffer.from('signed native fixture'),
  argumentsList = ['--headless']) {
  const directory = path.join(root, 'installation'), executablePath = path.join(directory, 'bin', 'fixture.exe');
  await fs.promises.mkdir(path.dirname(executablePath), { recursive: true });
  await fs.promises.writeFile(executablePath, executable);
  return { absoluteDirectory: directory, packageManifest: {
    entrypoint: { kind: 'native-executable', path: 'bin/fixture.exe', arguments: argumentsList },
    files: [{ path: 'bin/fixture.exe', sha256: sha256(executable),
      sizeBytes: executable.length, executable: true }],
  } };
}

const runInput = (installed, executionPolicy = policy()) => ({ installation: installed,
  input: { documentRef: 'local:fixture' }, prerequisites: [],
  contract: { key: 'research.fixture', version: 1 },
  lease: { id: '11111111-1111-4111-8111-111111111111',
    expiresAt: '2026-10-28T12:00:00.000Z' }, executionPolicy,
  signal: new AbortController().signal });

test('native runner fails closed when the Windows host lacks a required sandbox primitive', async t => {
  const api = await import(executorUrl), root = await tempRoot('native-untrusted-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const artifactStore = api.createLocalArtifactStore({ rootDirectory: path.join(root, 'artifacts') });
  assert.throws(() => api.createWindowsNativeRunner({ workRoot: path.join(root, 'work'), artifactStore,
    fileGrantBroker: { async resolve() { return []; } }, platform: 'win32',
    sandboxHost: { capabilities: hostCapabilities({ restrictedToken: false }), async run() {} } }),
  error => error.code === 'CAPABILITY_SANDBOX_HOST_UNTRUSTED' && error.safeFailure === true);
});

test('native runner projects least privilege and stores a content-addressed local result', async t => {
  const api = await import(executorUrl), root = await tempRoot('native-success-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const installed = await installation(root), calls = [];
  const artifactStore = api.createLocalArtifactStore({ rootDirectory: path.join(root, 'artifacts') });
  const sandboxHost = { capabilities: hostCapabilities(), async run(spec) {
    calls.push(spec);
    assert.deepEqual(Object.keys(spec.environment).sort(),
      ['MOOYU_CAPABILITY_OUTPUT_DIR', 'MOOYU_CAPABILITY_REQUEST', 'MOOYU_CAPABILITY_RESULT']);
    assert.deepEqual(spec.permissions, { files: 'none', networkDomains: [], devices: [] });
    const request = JSON.parse(await fs.promises.readFile(spec.environment.MOOYU_CAPABILITY_REQUEST, 'utf8'));
    assert.equal(request.leaseToken, undefined);
    assert.equal(request.contract.key, 'research.fixture');
    await fs.promises.writeFile(path.join(spec.environment.MOOYU_CAPABILITY_OUTPUT_DIR, 'result.json'),
      JSON.stringify({ page: 1, blocks: ['verified'] }));
    await fs.promises.writeFile(spec.environment.MOOYU_CAPABILITY_RESULT, JSON.stringify({
      schemaVersion: 'capability-native-result-v1', artifact: { path: 'result.json',
        mediaType: 'application/vnd.mooyu.fixture+json', metadata: { pageCount: 1 } },
    }));
    return { exitCode: 0, terminationReason: 'exited', stdoutBytes: 10, stderrBytes: 0 };
  } };
  const runner = api.createWindowsNativeRunner({ workRoot: path.join(root, 'work'), artifactStore,
    sandboxHost, fileGrantBroker: { async resolve() { return []; } }, platform: 'win32' });
  const result = await runner.run(runInput(installed));
  assert.equal(calls.length, 1);
  assert.equal(result.schemaVersion, 'capability-output-ref-v1');
  assert.equal(result.storage, 'node-local');
  assert.equal(result.contract.key, 'research.fixture');
  assert.equal(result.metadata.executor.localArtifactKey, result.sha256);
  const stored = await artifactStore.resolve(result.sha256);
  assert.deepEqual(JSON.parse(await fs.promises.readFile(stored.artifactFile, 'utf8')),
    { page: 1, blocks: ['verified'] });
  assert.deepEqual(await fs.promises.readdir(path.join(root, 'work')), []);
});

test('native runner projects verified engine components as read-only sandbox resources', async t => {
  const api = await import(executorUrl), root = await tempRoot('native-components-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const installed = await installation(root), componentBytes = Buffer.from('signed model component');
  const componentPath = path.join(root, 'components', 'layout-model.bin');
  await fs.promises.mkdir(path.dirname(componentPath), { recursive: true });
  await fs.promises.writeFile(componentPath, componentBytes);
  const component = { componentId: 'pp-layout-model', role: 'layout-model', version: '1.0.0',
    sha256: sha256(componentBytes), sizeBytes: componentBytes.length, localPath: componentPath };
  const runner = api.createWindowsNativeRunner({ workRoot: path.join(root, 'work'),
    artifactStore: api.createLocalArtifactStore({ rootDirectory: path.join(root, 'artifacts') }),
    fileGrantBroker: { async resolve() { return []; } }, platform: 'win32',
    sandboxHost: { capabilities: hostCapabilities(), async run(spec) {
      assert.equal(spec.readOnlyResources.length, 1);
      assert.equal(spec.readOnlyResources[0].sourcePath, path.resolve(componentPath));
      assert.equal(spec.readOnlyResources[0].access, 'read');
      assert.equal(spec.readOnlyResources[0].identity.schemaVersion, 'windows-file-identity-v1');
      const request = JSON.parse(await fs.promises.readFile(
        spec.environment.MOOYU_CAPABILITY_REQUEST, 'utf8'));
      assert.deepEqual(request.components, [{ componentId: component.componentId,
        role: component.role, version: component.version, sha256: component.sha256,
        sizeBytes: component.sizeBytes, sourcePath: path.resolve(componentPath) }]);
      assert.equal(request.components[0].identity, undefined);
      await fs.promises.writeFile(path.join(spec.environment.MOOYU_CAPABILITY_OUTPUT_DIR,
        'result.json'), '{}');
      await fs.promises.writeFile(spec.environment.MOOYU_CAPABILITY_RESULT, JSON.stringify({
        schemaVersion: 'capability-native-result-v1', artifact: { path: 'result.json',
          mediaType: 'application/json', metadata: {} },
      }));
      return { exitCode: 0, terminationReason: 'exited', stdoutBytes: 0, stderrBytes: 0 };
    } } });
  await runner.run({ ...runInput(installed), componentBindings: [component] });
});

test('native runner rejects a changed component before starting the sandbox', async t => {
  const api = await import(executorUrl), root = await tempRoot('native-component-tamper-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const installed = await installation(root), componentPath = path.join(root, 'component.bin');
  await fs.promises.writeFile(componentPath, 'changed bytes');
  let started = false;
  const runner = api.createWindowsNativeRunner({ workRoot: path.join(root, 'work'),
    artifactStore: api.createLocalArtifactStore({ rootDirectory: path.join(root, 'artifacts') }),
    fileGrantBroker: { async resolve() { return []; } }, platform: 'win32',
    sandboxHost: { capabilities: hostCapabilities(), async run() { started = true; } } });
  await assert.rejects(runner.run({ ...runInput(installed), componentBindings: [{
    componentId: 'pp-layout-model', role: 'layout-model', version: '1.0.0',
    sha256: 'f'.repeat(64), sizeBytes: 13, localPath: componentPath,
  }] }), error => error.code === 'CAPABILITY_COMPONENT_BINDING_TAMPERED'
    && error.safeFailure === true);
  assert.equal(started, false);
});

test('native runner projects a verified bundle with traverse, read and execute-minimum rights', async t => {
  const api = await import(executorUrl), root = await tempRoot('native-component-bundle-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const zipUrl = pathToFileURL(path.resolve(__dirname,
    '../../apps/api/src/zip-buffer-writer.mjs')).href;
  const { createZipBuffer } = await import(zipUrl), installed = await installation(root);
  const payload = [{ path: 'models/layout.bin', data: Buffer.from('weights'), executable: false },
    { path: 'bin/engine.exe', data: Buffer.from('executable'), executable: true }];
  payload.sort((left, right) => left.path < right.path ? -1 : 1);
  const files = payload.map(item => ({ path: item.path, sha256: sha256(item.data),
    sizeBytes: item.data.length, executable: item.executable }));
  const manifest = { schemaVersion: 'capability-component-bundle-v1', component: {
    componentId: 'pp-layout-model', role: 'layout-model', version: '1.0.0',
  }, files };
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  const archive = createZipBuffer([{ name: 'component.bundle.json', data: manifestBytes },
    ...payload.map(item => ({ name: `payload/${item.path}`, data: item.data }))]);
  const archivePath = path.join(root, 'component.zip'), bundleDirectory = path.join(root, 'bundle');
  await fs.promises.writeFile(archivePath, archive);
  const identity = { componentId: 'pp-layout-model', role: 'layout-model', version: '1.0.0',
    sha256: sha256(archive), sizeBytes: archive.length };
  const content = { kind: 'zip-bundle', manifestSha256: sha256(manifestBytes),
    fileCount: files.length, expandedSizeBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0) };
  const extracted = await api.extractVerifiedCapabilityComponentBundle({ archivePath,
    destination: bundleDirectory, component: identity, content });
  const binding = { ...identity, format: 'zip-bundle', archivePath,
    localPath: extracted.rootDirectory, content, files };
  const runner = api.createWindowsNativeRunner({ workRoot: path.join(root, 'work'),
    artifactStore: api.createLocalArtifactStore({ rootDirectory: path.join(root, 'artifacts') }),
    fileGrantBroker: { async resolve() { return []; } }, platform: 'win32',
    sandboxHost: { capabilities: hostCapabilities(), async run(spec) {
      const resources = spec.readOnlyResources;
      assert.equal(resources.filter(item => item.access === 'traverse').length, 3);
      assert.equal(resources.filter(item => item.access === 'read').length, 1);
      assert.equal(resources.filter(item => item.access === 'read-execute').length, 1);
      assert.equal(resources.filter(item => item.access !== 'traverse')
        .every(item => item.identity.schemaVersion === 'windows-file-identity-v1'), true);
      const request = JSON.parse(await fs.promises.readFile(
        spec.environment.MOOYU_CAPABILITY_REQUEST, 'utf8'));
      assert.equal(request.components[0].format, 'zip-bundle');
      assert.equal(request.components[0].sourcePath, path.resolve(extracted.rootDirectory));
      assert.deepEqual(request.components[0].files, files);
      await fs.promises.writeFile(path.join(spec.environment.MOOYU_CAPABILITY_OUTPUT_DIR,
        'result.json'), '{}');
      await fs.promises.writeFile(spec.environment.MOOYU_CAPABILITY_RESULT, JSON.stringify({
        schemaVersion: 'capability-native-result-v1', artifact: { path: 'result.json',
          mediaType: 'application/json', metadata: {} },
      }));
      return { exitCode: 0, terminationReason: 'exited', stdoutBytes: 0, stderrBytes: 0 };
    } } });
  await runner.run({ ...runInput(installed), componentBindings: [binding] });
  await fs.promises.writeFile(extracted.files[0].absolutePath, 'tampered');
  await assert.rejects(runner.run({ ...runInput(installed), componentBindings: [binding] }),
    error => error.code === 'CAPABILITY_COMPONENT_BINDING_TAMPERED');
});

test('native runner validates worker artifact content before the local artifact store', async t => {
  const api = await import(executorUrl), root = await tempRoot('native-trusted-artifact-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const installed = await installation(root); let stored = 0, validated = 0;
  const runner = api.createWindowsNativeRunner({ workRoot: path.join(root, 'work'),
    artifactStore: { async put() { stored += 1; assert.fail('untrusted artifact reached store'); } },
    artifactValidator: { async validate(value) {
      validated += 1;
      assert.equal(value.contract.key, 'research.fixture');
      assert.equal(value.mediaType, 'application/json');
      const error = new Error('CAPABILITY_TRUSTED_ARTIFACT_CONTRACT_INVALID');
      error.code = 'CAPABILITY_TRUSTED_ARTIFACT_CONTRACT_INVALID';
      throw error;
    } }, fileGrantBroker: { async resolve() { return []; } }, platform: 'win32',
    sandboxHost: { capabilities: hostCapabilities(), async run(spec) {
      await fs.promises.writeFile(path.join(spec.environment.MOOYU_CAPABILITY_OUTPUT_DIR,
        'result.json'), '{}');
      await fs.promises.writeFile(spec.environment.MOOYU_CAPABILITY_RESULT, JSON.stringify({
        schemaVersion: 'capability-native-result-v1', artifact: { path: 'result.json',
          mediaType: 'application/json', metadata: {} },
      }));
      return { exitCode: 0, terminationReason: 'exited', stdoutBytes: 0, stderrBytes: 0 };
    } } });
  await assert.rejects(runner.run(runInput(installed)),
    error => error.code === 'CAPABILITY_TRUSTED_ARTIFACT_CONTRACT_INVALID');
  assert.equal(validated, 1);
  assert.equal(stored, 0);
});

test('native request discloses only explicitly granted local paths to the sandboxed capability', async t => {
  const api = await import(executorUrl), root = await tempRoot('native-grant-path-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const installed = await installation(root), selected = path.join(root, 'selected.pdf');
  await fs.promises.writeFile(selected, '%PDF-1.7');
  const artifactStore = api.createLocalArtifactStore({ rootDirectory: path.join(root, 'artifacts') });
  const runner = api.createWindowsNativeRunner({ workRoot: path.join(root, 'work'), artifactStore,
    platform: 'win32', fileGrantBroker: { async resolve() {
      const opened = await api.openVerifiedWindowsFile(selected);
      await opened.handle.close();
      return [{ grantId: '22222222-2222-4222-8222-222222222222', scope: 'user-selected',
        sourcePath: selected, access: 'read', displayName: 'selected.pdf', identity: opened.identity }];
    } }, sandboxHost: { capabilities: hostCapabilities(), async run(spec) {
      const request = JSON.parse(await fs.promises.readFile(spec.environment.MOOYU_CAPABILITY_REQUEST, 'utf8'));
      assert.deepEqual(request.fileGrants, [{ grantId: '22222222-2222-4222-8222-222222222222',
        scope: 'user-selected', sourcePath: path.resolve(selected), access: 'read',
        displayName: 'selected.pdf' }]);
      await fs.promises.writeFile(path.join(spec.environment.MOOYU_CAPABILITY_OUTPUT_DIR, 'result.json'), '{}');
      await fs.promises.writeFile(spec.environment.MOOYU_CAPABILITY_RESULT, JSON.stringify({
        schemaVersion: 'capability-native-result-v1', artifact: { path: 'result.json',
          mediaType: 'application/json', metadata: {} },
      }));
      return { exitCode: 0, terminationReason: 'exited', stdoutBytes: 0, stderrBytes: 0 };
    } } });
  await runner.run(runInput(installed, policy({ permissions: {
    files: 'user-selected', networkDomains: [], devices: [],
  } })));
});

test('native runner expands portable package-root arguments inside the verified installation', async t => {
  const api = await import(executorUrl), root = await tempRoot('native-package-root-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const installed = await installation(root, Buffer.from('signed native fixture'),
    ['{{PACKAGE_ROOT}}/app/worker.mjs', '--mode=admit']);
  await fs.promises.mkdir(path.join(installed.absoluteDirectory, 'app'), { recursive: true });
  const workerBytes = Buffer.from('// verified worker');
  await fs.promises.writeFile(path.join(installed.absoluteDirectory, 'app', 'worker.mjs'), workerBytes);
  installed.packageManifest.files.push({ path: 'app/worker.mjs', sha256: sha256(workerBytes),
    sizeBytes: workerBytes.length, executable: false });
  const runner = api.createWindowsNativeRunner({ workRoot: path.join(root, 'work'),
    artifactStore: api.createLocalArtifactStore({ rootDirectory: path.join(root, 'artifacts') }),
    fileGrantBroker: { async resolve() { return []; } }, platform: 'win32',
    sandboxHost: { capabilities: hostCapabilities(), async run(spec) {
      assert.deepEqual(spec.arguments, [path.join(installed.absoluteDirectory, 'app', 'worker.mjs'),
        '--mode=admit']);
      await fs.promises.writeFile(path.join(spec.environment.MOOYU_CAPABILITY_OUTPUT_DIR, 'result.json'), '{}');
      await fs.promises.writeFile(spec.environment.MOOYU_CAPABILITY_RESULT, JSON.stringify({
        schemaVersion: 'capability-native-result-v1', artifact: { path: 'result.json',
          mediaType: 'application/json', metadata: {} },
      }));
      return { exitCode: 0, terminationReason: 'exited', stdoutBytes: 0, stderrBytes: 0 };
    } } });
  await runner.run(runInput(installed));
});

test('tampering with a non-entrypoint package module is rejected before launch', async t => {
  const api = await import(executorUrl), root = await tempRoot('native-module-tamper-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const installed = await installation(root), moduleBytes = Buffer.from('trusted module');
  const modulePath = path.join(installed.absoluteDirectory, 'lib', 'module.mjs');
  await fs.promises.mkdir(path.dirname(modulePath), { recursive: true });
  await fs.promises.writeFile(modulePath, moduleBytes);
  installed.packageManifest.files.push({ path: 'lib/module.mjs', sha256: sha256(moduleBytes),
    sizeBytes: moduleBytes.length, executable: false });
  await fs.promises.appendFile(modulePath, 'tampered');
  let started = false;
  const runner = api.createWindowsNativeRunner({ workRoot: path.join(root, 'work'),
    artifactStore: api.createLocalArtifactStore({ rootDirectory: path.join(root, 'artifacts') }),
    sandboxHost: { capabilities: hostCapabilities(), async run() { started = true; } },
    fileGrantBroker: { async resolve() { return []; } }, platform: 'win32' });
  await assert.rejects(runner.run(runInput(installed)),
    error => error.code === 'CAPABILITY_NATIVE_PACKAGE_TAMPERED' && error.safeFailure === true);
  assert.equal(started, false);
});

test('entrypoint tampering is rejected before the sandbox host starts', async t => {
  const api = await import(executorUrl), root = await tempRoot('native-tamper-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const installed = await installation(root);
  await fs.promises.appendFile(path.join(installed.absoluteDirectory, 'bin', 'fixture.exe'), 'tampered');
  let started = false;
  const runner = api.createWindowsNativeRunner({ workRoot: path.join(root, 'work'),
    artifactStore: api.createLocalArtifactStore({ rootDirectory: path.join(root, 'artifacts') }),
    sandboxHost: { capabilities: hostCapabilities(), async run() { started = true; } },
    fileGrantBroker: { async resolve() { return []; } }, platform: 'win32' });
  await assert.rejects(runner.run(runInput(installed)),
    error => error.code === 'CAPABILITY_NATIVE_ENTRYPOINT_TAMPERED' && error.safeFailure === true);
  assert.equal(started, false);
});

test('file grants cannot exceed the frozen placement permission', async t => {
  const api = await import(executorUrl), root = await tempRoot('native-grants-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const installed = await installation(root), selected = path.join(root, 'selected.txt');
  await fs.promises.writeFile(selected, 'private');
  let started = false;
  const runner = api.createWindowsNativeRunner({ workRoot: path.join(root, 'work'),
    artifactStore: api.createLocalArtifactStore({ rootDirectory: path.join(root, 'artifacts') }),
    sandboxHost: { capabilities: hostCapabilities(), async run() { started = true; } },
    fileGrantBroker: { async resolve() { return [{ grantId: crypto.randomUUID(), scope: 'none',
      sourcePath: selected, access: 'read', displayName: 'selected.txt' }]; } }, platform: 'win32' });
  await assert.rejects(runner.run(runInput(installed)),
    error => error.code === 'CAPABILITY_FILE_GRANT_FORBIDDEN' && error.safeFailure === true);
  assert.equal(started, false);
});

test('file grants remain read-only until the capability contract gains a write permission', async t => {
  const api = await import(executorUrl), root = await tempRoot('native-write-grant-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const installed = await installation(root), selected = path.join(root, 'selected.txt');
  await fs.promises.writeFile(selected, 'private');
  let started = false;
  const runner = api.createWindowsNativeRunner({ workRoot: path.join(root, 'work'),
    artifactStore: api.createLocalArtifactStore({ rootDirectory: path.join(root, 'artifacts') }),
    sandboxHost: { capabilities: hostCapabilities(), async run() { started = true; } },
    fileGrantBroker: { async resolve() { return [{ grantId: crypto.randomUUID(), scope: 'user-selected',
      sourcePath: selected, access: 'read-write', displayName: 'selected.txt' }]; } }, platform: 'win32' });
  const selectedPolicy = policy({ permissions: {
    files: 'user-selected', networkDomains: [], devices: [],
  } });
  await assert.rejects(runner.run(runInput(installed, selectedPolicy)),
    error => error.code === 'CAPABILITY_FILE_GRANTS_INVALID' && error.safeFailure === true);
  assert.equal(started, false);
});

test('native result traversal and diagnostic overflow are rejected after execution', async t => {
  const api = await import(executorUrl), root = await tempRoot('native-result-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const installed = await installation(root), artifactStore = api.createLocalArtifactStore({
    rootDirectory: path.join(root, 'artifacts') });
  const create = run => api.createWindowsNativeRunner({ workRoot: path.join(root, crypto.randomUUID()),
    artifactStore, sandboxHost: { capabilities: hostCapabilities(), run },
    fileGrantBroker: { async resolve() { return []; } }, platform: 'win32', maxDiagnosticBytes: 1024 });
  const traversal = create(async spec => {
    await fs.promises.writeFile(spec.environment.MOOYU_CAPABILITY_RESULT, JSON.stringify({
      schemaVersion: 'capability-native-result-v1', artifact: { path: '../private.txt',
        mediaType: 'text/plain', metadata: {} },
    }));
    return { exitCode: 0, terminationReason: 'exited', stdoutBytes: 0, stderrBytes: 0 };
  });
  await assert.rejects(traversal.run(runInput(installed)),
    error => error.code === 'CAPABILITY_NATIVE_RESULT_INVALID');
  const overflow = create(async () => ({ exitCode: 0, terminationReason: 'exited',
    stdoutBytes: 1025, stderrBytes: 0 }));
  await assert.rejects(overflow.run(runInput(installed)),
    error => error.code === 'CAPABILITY_NATIVE_PROCESS_FAILED');
});
