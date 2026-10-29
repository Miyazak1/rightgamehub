import path from 'node:path';
import { fail } from './errors.mjs';
import { createWindowsSandboxHost } from './windows-sandbox-host.mjs';
import { createWindowsNativeRunner } from './windows-native-runner.mjs';
import { createLocalArtifactStore } from './artifact-store.mjs';
import { createCapabilityExecutorRuntime } from './executor-runtime.mjs';
import { createCapabilityResultEgressGate } from './result-egress.mjs';
import { createTrustedCapabilityArtifactValidator } from './trusted-artifact-validator.mjs';

const RUNTIME_ID = /^[a-z][a-z0-9.-]{2,119}$/u;

export function createWindowsExecutorBootstrap({ runtimeStore, runtimeId,
  dataRoot, apiClient, packageStore, credentialVault, fileGrantBroker,
  fetchImpl = globalThis.fetch, leaseSeconds = 120, renewalIntervalMs = 30_000,
  nativeTimeoutMs = 15 * 60_000, platform = process.platform } = {}) {
  if (platform !== 'win32' || !runtimeStore || typeof runtimeStore.active !== 'function'
    || typeof runtimeId !== 'string' || !RUNTIME_ID.test(runtimeId)
    || !path.isAbsolute(dataRoot) || !apiClient || !packageStore || !credentialVault
    || !fileGrantBroker || typeof fileGrantBroker.resolve !== 'function') {
    fail('CAPABILITY_WINDOWS_BOOTSTRAP_CONFIG_INVALID');
  }
  const assemble = async () => {
    const release = await runtimeStore.active(runtimeId);
    if (!release?.manifest || release.runtimeId !== runtimeId
      || release.manifest.runtimeId !== runtimeId) {
      fail('CAPABILITY_WINDOWS_RUNTIME_NOT_INSTALLED', { safeFailure: true });
    }
    const helper = release.manifest.files.find(file => file.role === 'sandbox-host');
    const helperPath = path.resolve(release.absoluteDirectory,
      ...release.manifest.helper.path.split('/'));
    if (!helper || helper.path !== release.manifest.helper.path
      || helper.sha256 !== release.manifest.helper.sha256
      || !helperPath.startsWith(`${path.resolve(release.absoluteDirectory)}${path.sep}`)) {
      fail('CAPABILITY_WINDOWS_RUNTIME_INVALID', { safeFailure: true });
    }
    const sandboxHost = createWindowsSandboxHost({ helperPath,
      helperSha256: helper.sha256, platform,
      cancellationRoot: path.join(dataRoot, 'cancellation') });
    const artifactStore = createLocalArtifactStore({ rootDirectory: path.join(dataRoot, 'artifacts') });
    const artifactValidator = createTrustedCapabilityArtifactValidator();
    const runner = createWindowsNativeRunner({ workRoot: path.join(dataRoot, 'runs'), artifactStore,
      sandboxHost, fileGrantBroker, artifactValidator, platform, timeoutMs: nativeTimeoutMs });
    const resultEgressGate = createCapabilityResultEgressGate({
      rootDirectory: path.join(dataRoot, 'result-egress-audit'),
    });
    const runtime = createCapabilityExecutorRuntime({ apiClient, packageStore, credentialVault,
      runner, downloadDirectory: path.join(dataRoot, 'downloads'), fetchImpl,
      leaseSeconds, renewalIntervalMs, resultEgressGate });
    return { runtime, runner, sandboxHost, artifactStore, artifactValidator, resultEgressGate,
      release: { runtimeId: release.runtimeId, runtimeVersion: release.runtimeVersion,
        manifestSha256: release.manifestSha256, absoluteDirectory: release.absoluteDirectory } };
  };
  return { assemble };
}
