const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const moduleUrl = name => new URL(`../../apps/capability-executor/src/${name}.mjs`, `file://${__filename.replaceAll('\\', '/')}`).href;
const sha256 = async file => {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
};
const managedTemp = async prefix => {
  const root = path.resolve('.runtime/capability-sandbox-acceptance');
  await fs.promises.mkdir(root, { recursive: true });
  return fs.promises.mkdtemp(path.join(root, prefix));
};

const baseSpec = ({ executable, installationRoot, workingDirectory }) => ({
  executable, installationRoot, arguments: [], workingDirectory,
  environment: {
    MOOYU_CAPABILITY_REQUEST: path.join(workingDirectory, 'request.json'),
    MOOYU_CAPABILITY_RESULT: path.join(workingDirectory, 'result.json'),
    MOOYU_CAPABILITY_OUTPUT_DIR: path.join(workingDirectory, 'output'),
  },
  fileGrants: [],
  permissions: { files: 'none', networkDomains: [], devices: [] },
  resources: { cpuCores: 1, memoryMiB: 256, diskMiB: 64, gpuMemoryMiB: 0 },
  dataPolicy: { localOnly: true, upload: 'never' },
  timeoutMs: 10_000, maxDiagnosticBytes: 64 * 1024,
});

test('Windows sandbox host fails closed on helper hash mismatch', async () => {
  const { createWindowsSandboxHost } = await import(moduleUrl('windows-sandbox-host'));
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mooyu-host-hash-'));
  const helper = path.join(root, 'helper.exe');
  await fs.promises.writeFile(helper, 'tampered');
  const host = createWindowsSandboxHost({ helperPath: helper, helperSha256: '0'.repeat(64), platform: 'win32' });
  await assert.rejects(host.run(baseSpec({ executable: helper, installationRoot: root, workingDirectory: root })),
    error => error.code === 'CAPABILITY_SANDBOX_HOST_TAMPERED' && error.safeFailure);
  await fs.promises.rm(root, { recursive: true, force: true });
});

test('Windows sandbox host rejects network and device elevation before launch', async () => {
  const { createWindowsSandboxHost } = await import(moduleUrl('windows-sandbox-host'));
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mooyu-host-policy-'));
  const helper = path.join(root, 'helper.exe');
  await fs.promises.writeFile(helper, 'fixture');
  const host = createWindowsSandboxHost({ helperPath: helper, helperSha256: await sha256(helper), platform: 'win32' });
  const spec = baseSpec({ executable: helper, installationRoot: root, workingDirectory: root });
  spec.permissions.networkDomains.push('example.com');
  await assert.rejects(host.run(spec), error => error.code === 'CAPABILITY_SANDBOX_POLICY_UNSUPPORTED');
  await fs.promises.rm(root, { recursive: true, force: true });
});

test('Windows native sandbox runs a real child in AppContainer at low integrity', {
  skip: process.platform !== 'win32' || process.env.MOOYU_WINDOWS_SANDBOX_ACCEPTANCE !== '1',
  timeout: 30_000,
}, async () => {
  const { createWindowsSandboxHost } = await import(moduleUrl('windows-sandbox-host'));
  const buildRoot = path.resolve('.runtime/capability-sandbox-host');
  const helper = path.join(buildRoot, 'MooyuCapabilitySandboxHost.exe');
  const fixtureSource = path.join(buildRoot, 'SandboxFixtureCapability.exe');
  const root = await managedTemp('mooyu-host-live-');
  const installationRoot = path.join(root, 'install'), workingDirectory = path.join(root, 'work');
  await fs.promises.mkdir(installationRoot); await fs.promises.mkdir(workingDirectory);
  const executable = path.join(installationRoot, 'SandboxFixtureCapability.exe');
  await fs.promises.copyFile(fixtureSource, executable);
  await fs.promises.writeFile(path.join(workingDirectory, 'request.json'), '{"fixture":true}');
  const spec = baseSpec({ executable, installationRoot, workingDirectory });
  await fs.promises.mkdir(spec.environment.MOOYU_CAPABILITY_OUTPUT_DIR);
  const host = createWindowsSandboxHost({ helperPath: helper, helperSha256: await sha256(helper), platform: 'win32' });
  const result = await host.run(spec);
  assert.deepEqual(result, { exitCode: 0, terminationReason: 'exited', stdoutBytes: 0, stderrBytes: 0 });
  const evidence = JSON.parse(await fs.promises.readFile(path.join(workingDirectory, 'output', 'result.json'), 'utf8'));
  assert.equal(evidence.appContainer, true);
  assert.ok(evidence.integrityRid <= 4096);
  assert.equal(evidence.networkConnected, false);
  await fs.promises.rm(root, { recursive: true, force: true });
});

test('Windows sandbox host rejects a same-content file replacement by volume and file ID', {
  skip: process.platform !== 'win32' || process.env.MOOYU_WINDOWS_SANDBOX_ACCEPTANCE !== '1',
  timeout: 30_000,
}, async () => {
  const api = await import(moduleUrl('index'));
  const buildRoot = path.resolve('.runtime/capability-sandbox-host');
  const helper = path.join(buildRoot, 'MooyuCapabilitySandboxHost.exe');
  const root = await managedTemp('mooyu-host-identity-');
  const installationRoot = path.join(root, 'install'), workingDirectory = path.join(root, 'work');
  await fs.promises.mkdir(installationRoot); await fs.promises.mkdir(workingDirectory);
  const executable = path.join(installationRoot, 'SandboxFixtureCapability.exe');
  await fs.promises.copyFile(path.join(buildRoot, 'SandboxFixtureCapability.exe'), executable);
  const selected = path.join(root, 'selected.txt'), original = path.join(root, 'original.txt');
  await fs.promises.writeFile(selected, 'same bytes', 'utf8');
  const opened = await api.openVerifiedWindowsFile(selected), identity = opened.identity;
  await opened.handle.close();
  await fs.promises.rename(selected, original);
  await fs.promises.writeFile(selected, 'same bytes', 'utf8');
  const spec = baseSpec({ executable, installationRoot, workingDirectory });
  spec.permissions.files = 'user-selected';
  spec.fileGrants = [{ sourcePath: selected, access: 'read', identity }];
  await fs.promises.mkdir(spec.environment.MOOYU_CAPABILITY_OUTPUT_DIR);
  const host = api.createWindowsSandboxHost({ helperPath: helper,
    helperSha256: await sha256(helper), platform: 'win32' });
  await assert.rejects(host.run(spec), error =>
    error.code === 'CAPABILITY_SANDBOX_FILE_IDENTITY_CHANGED' && error.safeFailure === true);
  await fs.promises.rm(root, { recursive: true, force: true });
});

test('Windows sandbox host holds an identity-verified file against writes until the task exits', {
  skip: process.platform !== 'win32' || process.env.MOOYU_WINDOWS_SANDBOX_ACCEPTANCE !== '1',
  timeout: 30_000,
}, async () => {
  const api = await import(moduleUrl('index'));
  const buildRoot = path.resolve('.runtime/capability-sandbox-host');
  const helper = path.join(buildRoot, 'MooyuCapabilitySandboxHost.exe');
  const root = await managedTemp('mooyu-host-lock-');
  const installationRoot = path.join(root, 'install'), workingDirectory = path.join(root, 'work');
  await fs.promises.mkdir(installationRoot); await fs.promises.mkdir(workingDirectory);
  const executable = path.join(installationRoot, 'SandboxFixtureCapability.exe');
  await fs.promises.copyFile(path.join(buildRoot, 'SandboxFixtureCapability.exe'), executable);
  const selected = path.join(root, 'selected.txt');
  await fs.promises.writeFile(selected, 'locked bytes', 'utf8');
  const opened = await api.openVerifiedWindowsFile(selected), identity = opened.identity;
  await opened.handle.close();
  const spec = baseSpec({ executable, installationRoot, workingDirectory });
  spec.arguments = ['--sleep=3000']; spec.permissions.files = 'user-selected';
  spec.fileGrants = [{ sourcePath: selected, access: 'read', identity }];
  await fs.promises.mkdir(spec.environment.MOOYU_CAPABILITY_OUTPUT_DIR);
  const host = api.createWindowsSandboxHost({ helperPath: helper,
    helperSha256: await sha256(helper), platform: 'win32' });
  const running = host.run(spec);
  let locked = false;
  for (let attempt = 0; attempt < 60 && !locked; attempt += 1) {
    try {
      const probe = await fs.promises.open(selected, 'r+');
      await probe.close();
    } catch (error) {
      if (['EBUSY', 'EACCES', 'EPERM'].includes(error.code)) locked = true;
      else throw error;
    }
    if (!locked) await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(locked, true);
  await assert.rejects(fs.promises.writeFile(selected, 'replacement', 'utf8'), error =>
    ['EBUSY', 'EACCES', 'EPERM'].includes(error.code));
  assert.equal((await running).terminationReason, 'exited');
  await fs.promises.writeFile(selected, 'replacement', 'utf8');
  assert.equal(await fs.promises.readFile(selected, 'utf8'), 'replacement');
  await fs.promises.rm(root, { recursive: true, force: true });
});

test('Windows native sandbox terminates the process tree on timeout', {
  skip: process.platform !== 'win32' || process.env.MOOYU_WINDOWS_SANDBOX_ACCEPTANCE !== '1',
  timeout: 30_000,
}, async () => {
  const { createWindowsSandboxHost } = await import(moduleUrl('windows-sandbox-host'));
  const buildRoot = path.resolve('.runtime/capability-sandbox-host');
  const helper = path.join(buildRoot, 'MooyuCapabilitySandboxHost.exe');
  const root = await managedTemp('mooyu-host-timeout-');
  const installationRoot = path.join(root, 'install'), workingDirectory = path.join(root, 'work');
  await fs.promises.mkdir(installationRoot); await fs.promises.mkdir(workingDirectory);
  const executable = path.join(installationRoot, 'SandboxFixtureCapability.exe');
  await fs.promises.copyFile(path.join(buildRoot, 'SandboxFixtureCapability.exe'), executable);
  await fs.promises.writeFile(path.join(workingDirectory, 'request.json'), '{}');
  const spec = baseSpec({ executable, installationRoot, workingDirectory });
  spec.arguments = ['--sleep=10000']; spec.timeoutMs = 1000;
  await fs.promises.mkdir(spec.environment.MOOYU_CAPABILITY_OUTPUT_DIR);
  const host = createWindowsSandboxHost({ helperPath: helper, helperSha256: await sha256(helper), platform: 'win32' });
  const result = await host.run(spec);
  assert.equal(result.terminationReason, 'timeout');
  await fs.promises.rm(root, { recursive: true, force: true });
});

test('Windows native sandbox honours cancellation and diagnostic bounds', {
  skip: process.platform !== 'win32' || process.env.MOOYU_WINDOWS_SANDBOX_ACCEPTANCE !== '1',
  timeout: 30_000,
}, async () => {
  const { createWindowsSandboxHost } = await import(moduleUrl('windows-sandbox-host'));
  const buildRoot = path.resolve('.runtime/capability-sandbox-host');
  const helper = path.join(buildRoot, 'MooyuCapabilitySandboxHost.exe');
  const root = await managedTemp('mooyu-host-stop-');
  const installationRoot = path.join(root, 'install'), workingDirectory = path.join(root, 'work');
  await fs.promises.mkdir(installationRoot); await fs.promises.mkdir(workingDirectory);
  const executable = path.join(installationRoot, 'SandboxFixtureCapability.exe');
  await fs.promises.copyFile(path.join(buildRoot, 'SandboxFixtureCapability.exe'), executable);
  await fs.promises.writeFile(path.join(workingDirectory, 'request.json'), '{}');
  await fs.promises.mkdir(path.join(workingDirectory, 'output'));
  const host = createWindowsSandboxHost({ helperPath: helper, helperSha256: await sha256(helper), platform: 'win32' });
  const controller = new AbortController();
  const cancelledSpec = baseSpec({ executable, installationRoot, workingDirectory });
  cancelledSpec.arguments = ['--sleep=10000']; cancelledSpec.signal = controller.signal;
  setTimeout(() => controller.abort(), 300).unref();
  assert.equal((await host.run(cancelledSpec)).terminationReason, 'cancelled');
  const diagnosticSpec = baseSpec({ executable, installationRoot, workingDirectory });
  diagnosticSpec.arguments = ['--stdout=70000']; diagnosticSpec.maxDiagnosticBytes = 8192;
  assert.equal((await host.run(diagnosticSpec)).terminationReason, 'diagnostic-limit');
  const diskSpec = baseSpec({ executable, installationRoot, workingDirectory });
  diskSpec.arguments = ['--bytes=2097152', '--sleep=10000']; diskSpec.resources.diskMiB = 1;
  assert.equal((await host.run(diskSpec)).terminationReason, 'disk-limit');
  await fs.promises.rm(root, { recursive: true, force: true });
});

test('native runner, Windows host and artifact store complete an end-to-end real process run', {
  skip: process.platform !== 'win32' || process.env.MOOYU_WINDOWS_SANDBOX_ACCEPTANCE !== '1',
  timeout: 30_000,
}, async () => {
  const api = await import(moduleUrl('index'));
  const buildRoot = path.resolve('.runtime/capability-sandbox-host');
  const helper = path.join(buildRoot, 'MooyuCapabilitySandboxHost.exe');
  const root = await managedTemp('mooyu-runner-live-');
  const installationRoot = path.join(root, 'installation');
  await fs.promises.mkdir(path.join(installationRoot, 'bin'), { recursive: true });
  const executable = path.join(installationRoot, 'bin', 'fixture.exe');
  await fs.promises.copyFile(path.join(buildRoot, 'SandboxFixtureCapability.exe'), executable);
  const stats = await fs.promises.stat(executable), executableHash = await sha256(executable);
  const installation = { absoluteDirectory: installationRoot, packageManifest: {
    entrypoint: { kind: 'native-executable', path: 'bin/fixture.exe', arguments: [] },
    files: [{ path: 'bin/fixture.exe', sha256: executableHash, sizeBytes: stats.size, executable: true }],
  } };
  const artifactStore = api.createLocalArtifactStore({ rootDirectory: path.join(root, 'artifacts') });
  const sandboxHost = api.createWindowsSandboxHost({ helperPath: helper,
    helperSha256: await sha256(helper), platform: 'win32' });
  const runner = api.createWindowsNativeRunner({ workRoot: path.join(root, 'work'), artifactStore,
    sandboxHost, fileGrantBroker: { async resolve() { return []; } }, platform: 'win32', timeoutMs: 10_000 });
  const result = await runner.run({ installation, input: { fixture: true }, prerequisites: [],
    contract: { key: 'research.fixture', version: 1 },
    lease: { id: '11111111-1111-4111-8111-111111111111' },
    executionPolicy: { permissions: { files: 'none', networkDomains: [], devices: [] },
      resources: { cpuCores: 1, memoryMiB: 256, diskMiB: 64, gpuMemoryMiB: 0 },
      dataPolicy: { localOnly: true, upload: 'never' } } });
  assert.equal(result.storage, 'node-local');
  const stored = await artifactStore.resolve(result.sha256);
  const evidence = JSON.parse(await fs.promises.readFile(stored.artifactFile, 'utf8'));
  assert.deepEqual({ appContainer: evidence.appContainer, integrityRid: evidence.integrityRid,
    networkConnected: evidence.networkConnected }, { appContainer: true, integrityRid: 4096,
    networkConnected: false });
  await fs.promises.rm(root, { recursive: true, force: true });
});
