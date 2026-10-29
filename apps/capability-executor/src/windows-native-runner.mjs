import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fail } from './errors.mjs';
import { normalizeWindowsFileIdentity, openVerifiedWindowsFile } from './windows-file-identity.mjs';
import { verifyInstalledCapabilityComponentBundle } from './component-bundle.mjs';

const SAFE_RELATIVE_PATH = /^(?![A-Za-z]:)(?![\\/])(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))(?!.*[\\])[^\0]+$/u;
const MEDIA_TYPE = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/iu;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));
const within = (root, candidate) => candidate.startsWith(`${root}${path.sep}`);

async function validateContainedFile(root, candidate) {
  const relative = path.relative(root, candidate);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail('CAPABILITY_NATIVE_RESULT_INVALID');
  }
  let current = root;
  const parts = relative.split(path.sep);
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    const stats = await fs.promises.lstat(current).catch(() => null);
    if (!stats || stats.isSymbolicLink()
      || index < parts.length - 1 && !stats.isDirectory()
      || index === parts.length - 1 && !stats.isFile()) {
      fail('CAPABILITY_NATIVE_RESULT_INVALID');
    }
  }
  return current;
}

function validateSandboxHost(host) {
  const value = host?.capabilities;
  const features = ['restrictedToken', 'jobObject', 'filesystemProjection', 'networkIsolation',
    'deviceIsolation', 'processTreeTermination'];
  if (!exact(value, ['schemaVersion', 'platform', 'features'])
    || value.schemaVersion !== 'windows-sandbox-host-capabilities-v1' || value.platform !== 'win32'
    || !exact(value.features, features) || features.some(key => value.features[key] !== true)
    || typeof host.run !== 'function') fail('CAPABILITY_SANDBOX_HOST_UNTRUSTED', { safeFailure: true });
}

async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function validateEntrypoint(installation) {
  const root = path.resolve(installation?.absoluteDirectory ?? '');
  const manifest = installation?.packageManifest, entrypoint = manifest?.entrypoint;
  if (!path.isAbsolute(root) || !object(manifest) || entrypoint?.kind !== 'native-executable'
    || typeof entrypoint.path !== 'string' || !SAFE_RELATIVE_PATH.test(entrypoint.path)
    || !Array.isArray(entrypoint.arguments) || entrypoint.arguments.some(value => typeof value !== 'string')) {
    fail('CAPABILITY_NATIVE_ENTRYPOINT_INVALID', { safeFailure: true });
  }
  if (!Array.isArray(manifest.files) || manifest.files.length < 1) {
    fail('CAPABILITY_NATIVE_ENTRYPOINT_INVALID', { safeFailure: true });
  }
  const paths = new Set();
  for (const declaredFile of manifest.files) {
    if (!object(declaredFile) || typeof declaredFile.path !== 'string'
      || !SAFE_RELATIVE_PATH.test(declaredFile.path) || paths.has(declaredFile.path)
      || !/^[a-f0-9]{64}$/u.test(String(declaredFile.sha256 ?? ''))
      || !Number.isSafeInteger(declaredFile.sizeBytes) || declaredFile.sizeBytes < 0
      || typeof declaredFile.executable !== 'boolean') {
      fail('CAPABILITY_NATIVE_ENTRYPOINT_INVALID', { safeFailure: true });
    }
    paths.add(declaredFile.path);
    const candidate = path.resolve(root, ...declaredFile.path.split('/'));
    if (!within(root, candidate)) fail('CAPABILITY_NATIVE_ENTRYPOINT_INVALID', { safeFailure: true });
    const fileStats = await fs.promises.lstat(candidate).catch(() => null);
    if (!fileStats?.isFile() || fileStats.isSymbolicLink()
      || fileStats.size !== declaredFile.sizeBytes || await hashFile(candidate) !== declaredFile.sha256) {
      fail(declaredFile.path === entrypoint.path ? 'CAPABILITY_NATIVE_ENTRYPOINT_TAMPERED'
        : 'CAPABILITY_NATIVE_PACKAGE_TAMPERED', { safeFailure: true });
    }
  }
  const declared = manifest.files.find(file => file.path === entrypoint.path);
  const executable = path.resolve(root, ...entrypoint.path.split('/'));
  if (!within(root, executable) || !declared?.executable || !/^[a-f0-9]{64}$/u.test(declared.sha256)) {
    fail('CAPABILITY_NATIVE_ENTRYPOINT_INVALID', { safeFailure: true });
  }
  const argumentsList = entrypoint.arguments.map(value => {
    const prefix = '{{PACKAGE_ROOT}}/';
    if (!value.startsWith(prefix)) return value;
    const relative = value.slice(prefix.length);
    if (!SAFE_RELATIVE_PATH.test(relative)) fail('CAPABILITY_NATIVE_ENTRYPOINT_INVALID', { safeFailure: true });
    const resolved = path.resolve(root, ...relative.split('/'));
    if (!within(root, resolved)) fail('CAPABILITY_NATIVE_ENTRYPOINT_INVALID', { safeFailure: true });
    return resolved;
  });
  return { executable, arguments: argumentsList };
}

function validatePolicy(policy) {
  const permissions = policy?.permissions, resources = policy?.resources, dataPolicy = policy?.dataPolicy;
  if (!exact(policy, ['permissions', 'resources', 'dataPolicy'])
    || !exact(permissions, ['files', 'networkDomains', 'devices'])
    || !['none', 'user-selected', 'workspace'].includes(permissions.files)
    || !Array.isArray(permissions.networkDomains) || !Array.isArray(permissions.devices)
    || !exact(resources, ['cpuCores', 'memoryMiB', 'diskMiB', 'gpuMemoryMiB'])
    || Object.values(resources).some(value => !Number.isSafeInteger(value) || value < 0)
    || !exact(dataPolicy, ['localOnly', 'upload'])
    || typeof dataPolicy.localOnly !== 'boolean'
    || !['never', 'consent', 'allowed'].includes(dataPolicy.upload)
    || dataPolicy.localOnly && dataPolicy.upload !== 'never') {
    fail('CAPABILITY_NATIVE_POLICY_INVALID', { safeFailure: true });
  }
  return structuredClone(policy);
}

async function validateFileGrants(grants, fileScope) {
  if (!Array.isArray(grants) || grants.length > 128) fail('CAPABILITY_FILE_GRANTS_INVALID', { safeFailure: true });
  if (fileScope === 'none' && grants.length !== 0) fail('CAPABILITY_FILE_GRANT_FORBIDDEN', { safeFailure: true });
  const ids = new Set(), normalized = [];
  for (const grant of grants) {
    const keys = fileScope === 'user-selected'
      ? ['grantId', 'scope', 'sourcePath', 'access', 'displayName', 'identity']
      : ['grantId', 'scope', 'sourcePath', 'access', 'displayName'];
    if (!exact(grant, keys)
      || !UUID.test(String(grant.grantId ?? '')) || ids.has(grant.grantId)
      || grant.scope !== fileScope || !path.isAbsolute(grant.sourcePath)
      || grant.access !== 'read'
      || typeof grant.displayName !== 'string' || grant.displayName.length < 1
      || grant.displayName.length > 200) fail('CAPABILITY_FILE_GRANTS_INVALID', { safeFailure: true });
    const stats = await fs.promises.lstat(grant.sourcePath).catch(() => null);
    if (!stats || stats.isSymbolicLink() || !stats.isFile() && !stats.isDirectory()) {
      fail('CAPABILITY_FILE_GRANT_SOURCE_INVALID', { safeFailure: true });
    }
    let identity = null;
    if (stats.isFile()) {
      if (fileScope === 'user-selected') {
        try { identity = normalizeWindowsFileIdentity(grant.identity); }
        catch { fail('CAPABILITY_FILE_GRANTS_INVALID', { safeFailure: true }); }
      }
      const opened = await openVerifiedWindowsFile(grant.sourcePath, identity);
      identity = opened.identity;
      await opened.handle.close().catch(() => {});
    }
    ids.add(grant.grantId);
    normalized.push({ ...grant, ...(identity ? { identity } : {}),
      sourcePath: path.resolve(grant.sourcePath) });
  }
  return normalized;
}

async function validateComponentBindings(bindings) {
  if (bindings == null) return { requestBindings: [], readOnlyResources: [] };
  if (!Array.isArray(bindings) || bindings.length > 64) {
    fail('CAPABILITY_COMPONENT_BINDINGS_INVALID', { safeFailure: true });
  }
  const ids = new Set(), requestBindings = [], readOnlyResources = [];
  for (const binding of bindings) {
    const identityKeys = ['componentId', 'role', 'version', 'sha256', 'sizeBytes'];
    const singleFile = exact(binding, [...identityKeys, 'localPath']);
    const bundle = exact(binding, [...identityKeys, 'format', 'archivePath', 'localPath',
      'content', 'files']);
    if (!singleFile && !bundle
      || typeof binding.componentId !== 'string' || binding.componentId.length < 3
      || binding.componentId.length > 120 || ids.has(binding.componentId)
      || typeof binding.role !== 'string' || binding.role.length < 3 || binding.role.length > 120
      || typeof binding.version !== 'string' || binding.version.length < 1
      || binding.version.length > 120 || !/^[a-f0-9]{64}$/u.test(binding.sha256)
      || !Number.isSafeInteger(binding.sizeBytes) || binding.sizeBytes < 1
      || !path.isAbsolute(binding.localPath)) {
      fail('CAPABILITY_COMPONENT_BINDINGS_INVALID', { safeFailure: true });
    }
    ids.add(binding.componentId);
    if (singleFile) {
      const stats = await fs.promises.lstat(binding.localPath).catch(() => null);
      if (!stats?.isFile() || stats.isSymbolicLink() || stats.size !== binding.sizeBytes
        || await hashFile(binding.localPath) !== binding.sha256) {
        fail('CAPABILITY_COMPONENT_BINDING_TAMPERED', { safeFailure: true });
      }
      const opened = await openVerifiedWindowsFile(binding.localPath);
      await opened.handle.close().catch(() => {});
      requestBindings.push({ componentId: binding.componentId, role: binding.role,
        version: binding.version, sha256: binding.sha256, sizeBytes: binding.sizeBytes,
        sourcePath: path.resolve(binding.localPath) });
      readOnlyResources.push({ sourcePath: path.resolve(binding.localPath), access: 'read',
        identity: opened.identity });
      continue;
    }
    if (binding.format !== 'zip-bundle' || !path.isAbsolute(binding.archivePath)
      || !Array.isArray(binding.files) || binding.files.length < 1 || binding.files.length > 4096) {
      fail('CAPABILITY_COMPONENT_BINDINGS_INVALID', { safeFailure: true });
    }
    let verified;
    try {
      verified = await verifyInstalledCapabilityComponentBundle({
        archivePath: binding.archivePath, bundleDirectory: path.dirname(binding.localPath),
        component: Object.fromEntries(identityKeys.map(key => [key, binding[key]])),
        content: binding.content,
      });
    } catch { fail('CAPABILITY_COMPONENT_BINDING_TAMPERED', { safeFailure: true }); }
    if (path.resolve(verified.rootDirectory) !== path.resolve(binding.localPath)
      || verified.files.length !== binding.files.length
      || verified.files.some((file, index) => ['path', 'sha256', 'sizeBytes', 'executable']
        .some(key => file[key] !== binding.files[index]?.[key]))) {
      fail('CAPABILITY_COMPONENT_BINDING_TAMPERED', { safeFailure: true });
    }
    const directoryPaths = new Set([path.resolve(binding.localPath)]);
    for (const file of verified.files) {
      let directory = path.dirname(file.absolutePath);
      while (directory !== path.resolve(binding.localPath)) {
        directoryPaths.add(directory);
        directory = path.dirname(directory);
      }
    }
    for (const directory of [...directoryPaths].sort()) {
      readOnlyResources.push({ sourcePath: directory, access: 'traverse' });
    }
    for (const file of verified.files) {
      const opened = await openVerifiedWindowsFile(file.absolutePath);
      await opened.handle.close().catch(() => {});
      readOnlyResources.push({ sourcePath: file.absolutePath,
        access: file.executable ? 'read-execute' : 'read', identity: opened.identity });
    }
    requestBindings.push({ componentId: binding.componentId, role: binding.role,
      version: binding.version, sha256: binding.sha256, sizeBytes: binding.sizeBytes,
      format: 'zip-bundle', sourcePath: path.resolve(binding.localPath),
      content: structuredClone(binding.content), files: binding.files.map(file => structuredClone(file)) });
  }
  return { requestBindings, readOnlyResources };
}

function validateNativeResult(value) {
  if (!exact(value, ['schemaVersion', 'artifact']) || value.schemaVersion !== 'capability-native-result-v1'
    || !exact(value.artifact, ['path', 'mediaType', 'metadata'])
    || typeof value.artifact.path !== 'string' || !SAFE_RELATIVE_PATH.test(value.artifact.path)
    || typeof value.artifact.mediaType !== 'string' || value.artifact.mediaType.length > 160
    || !MEDIA_TYPE.test(value.artifact.mediaType) || !object(value.artifact.metadata)) {
    fail('CAPABILITY_NATIVE_RESULT_INVALID');
  }
  return structuredClone(value);
}

export function createWindowsNativeRunner({ workRoot, artifactStore, sandboxHost,
  fileGrantBroker, artifactValidator = null, platform = process.platform, timeoutMs = 15 * 60_000,
  maxProtocolBytes = 4 * 1024 * 1024, maxDiagnosticBytes = 256 * 1024 } = {}) {
  if (platform !== 'win32' || !path.isAbsolute(workRoot) || !artifactStore
    || typeof artifactStore.put !== 'function' || !fileGrantBroker
    || typeof fileGrantBroker.resolve !== 'function' || !Number.isSafeInteger(timeoutMs)
    || timeoutMs < 1000 || timeoutMs > 24 * 60 * 60_000
    || !Number.isSafeInteger(maxProtocolBytes) || maxProtocolBytes < 1024
    || !Number.isSafeInteger(maxDiagnosticBytes) || maxDiagnosticBytes < 1024
    || artifactValidator !== null && typeof artifactValidator?.validate !== 'function') {
    fail('CAPABILITY_NATIVE_RUNNER_CONFIG_INVALID');
  }
  validateSandboxHost(sandboxHost);

  const run = async ({ installation, input, prerequisites, componentBindings = [], contract, lease, signal,
    executionPolicy } = {}) => {
    if (!object(contract) || typeof contract.key !== 'string' || !Number.isSafeInteger(contract.version)
      || !UUID.test(String(lease?.id ?? '')) || signal != null && !(signal instanceof AbortSignal)) {
      fail('CAPABILITY_NATIVE_RUN_INPUT_INVALID', { safeFailure: true });
    }
    if (signal?.aborted) fail('CAPABILITY_NATIVE_RUN_CANCELLED', { safeFailure: true });
    const entrypoint = await validateEntrypoint(installation);
    const policy = validatePolicy(executionPolicy);
    const grants = await validateFileGrants(await fileGrantBroker.resolve({ input: structuredClone(input),
      contract: structuredClone(contract), leaseId: lease.id,
      fileScope: policy.permissions.files, signal }), policy.permissions.files);
    const components = await validateComponentBindings(componentBindings);
    const runId = crypto.randomUUID(), runDirectory = path.join(workRoot, runId);
    const outputDirectory = path.join(runDirectory, 'output');
    const requestFile = path.join(runDirectory, 'request.json');
    const resultFile = path.join(runDirectory, 'result.json');
    const request = { schemaVersion: 'capability-native-request-v1', runId,
      contract: structuredClone(contract), input: structuredClone(input),
      prerequisites: structuredClone(prerequisites ?? []),
      fileGrants: grants.map(({ grantId, scope, sourcePath, access, displayName }) => ({
        grantId, scope, sourcePath, access, displayName,
      })), components: components.requestBindings };
    const requestJson = JSON.stringify(request);
    if (Buffer.byteLength(requestJson, 'utf8') > maxProtocolBytes) {
      fail('CAPABILITY_NATIVE_REQUEST_TOO_LARGE', { safeFailure: true });
    }
    await fs.promises.mkdir(outputDirectory, { recursive: true });
    await fs.promises.writeFile(requestFile, requestJson, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    try {
      const hostResult = await sandboxHost.run({ executable: entrypoint.executable,
        installationRoot: path.resolve(installation.absoluteDirectory),
        arguments: entrypoint.arguments, workingDirectory: runDirectory,
        environment: { MOOYU_CAPABILITY_REQUEST: requestFile, MOOYU_CAPABILITY_RESULT: resultFile,
          MOOYU_CAPABILITY_OUTPUT_DIR: outputDirectory }, fileGrants: grants,
        readOnlyResources: components.readOnlyResources,
        permissions: policy.permissions, resources: policy.resources,
        dataPolicy: policy.dataPolicy, timeoutMs, maxDiagnosticBytes, signal });
      if (!exact(hostResult, ['exitCode', 'terminationReason', 'stdoutBytes', 'stderrBytes'])
        || hostResult.exitCode !== 0 || hostResult.terminationReason !== 'exited'
        || !Number.isSafeInteger(hostResult.stdoutBytes) || hostResult.stdoutBytes < 0
        || !Number.isSafeInteger(hostResult.stderrBytes) || hostResult.stderrBytes < 0
        || hostResult.stdoutBytes > maxDiagnosticBytes || hostResult.stderrBytes > maxDiagnosticBytes) {
        fail('CAPABILITY_NATIVE_PROCESS_FAILED');
      }
      const resultStats = await fs.promises.lstat(resultFile).catch(() => null);
      if (!resultStats?.isFile() || resultStats.isSymbolicLink() || resultStats.size > maxProtocolBytes) {
        fail('CAPABILITY_NATIVE_RESULT_INVALID');
      }
      let nativeResult;
      try { nativeResult = validateNativeResult(JSON.parse(await fs.promises.readFile(resultFile, 'utf8'))); }
      catch (error) {
        if (error?.code) throw error;
        fail('CAPABILITY_NATIVE_RESULT_INVALID');
      }
      const outputRoot = path.resolve(outputDirectory);
      const artifactPath = path.resolve(outputRoot, ...nativeResult.artifact.path.split('/'));
      if (!within(outputRoot, artifactPath)) fail('CAPABILITY_NATIVE_RESULT_INVALID');
      const containedArtifact = await validateContainedFile(outputRoot, artifactPath);
      if (artifactValidator) {
        await artifactValidator.validate({ sourcePath: containedArtifact,
          mediaType: nativeResult.artifact.mediaType, contract: structuredClone(contract),
          metadata: structuredClone(nativeResult.artifact.metadata) });
      }
      const stored = await artifactStore.put({ sourcePath: containedArtifact,
        mediaType: nativeResult.artifact.mediaType, contract,
        metadata: nativeResult.artifact.metadata });
      const { local: _local, ...resultRef } = stored;
      return resultRef;
    } finally {
      await fs.promises.rm(runDirectory, { recursive: true, force: true }).catch(() => {});
    }
  };
  return { run };
}
