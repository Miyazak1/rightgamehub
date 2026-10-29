import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { downloadCapabilityPackage } from './downloader.mjs';
import { fail } from './errors.mjs';

const JOURNAL_KEY = 'capability-executor-active-lease-v1';

function placementFromClaim(claim) {
  const index = claim?.capability?.placement?.placementIndex;
  const placement = claim?.capability?.manifest?.placements?.[index];
  if (!Number.isInteger(index) || !placement || placement.target !== 'desktop'
    || placement.adapter !== 'native-package' || !placement.package) {
    fail('CAPABILITY_EXECUTOR_PLACEMENT_INVALID');
  }
  return { placement, placementIndex: index };
}

const serializeJournal = value => JSON.stringify({ schemaVersion: 'capability-executor-journal-v1', ...value });
const parseJournal = value => {
  let parsed;
  try { parsed = JSON.parse(value); } catch { fail('CAPABILITY_EXECUTOR_JOURNAL_INVALID'); }
  if (parsed?.schemaVersion !== 'capability-executor-journal-v1'
    || !['claimed', 'resolving-components', 'running', 'result-pending'].includes(parsed.phase)
    || !parsed.claim?.lease?.id || !parsed.claim?.lease?.token) fail('CAPABILITY_EXECUTOR_JOURNAL_INVALID');
  return parsed;
};

export function createCapabilityExecutorRuntime({ apiClient, packageStore, credentialVault,
  runner, downloadDirectory, fetchImpl = globalThis.fetch, leaseSeconds = 120,
  renewalIntervalMs = 30_000, resultEgressGate = null, componentResolver = null } = {}) {
  if (!apiClient || typeof apiClient.claim !== 'function' || typeof apiClient.complete !== 'function'
    || !packageStore || typeof packageStore.install !== 'function'
    || !credentialVault || typeof credentialVault.store !== 'function'
    || !runner || typeof runner.run !== 'function' || !path.isAbsolute(downloadDirectory)
    || !Number.isSafeInteger(leaseSeconds) || leaseSeconds < 15 || leaseSeconds > 600
    || !Number.isSafeInteger(renewalIntervalMs) || renewalIntervalMs < 1000
    || resultEgressGate != null && (typeof resultEgressGate.prepare !== 'function'
      || typeof resultEgressGate.confirm !== 'function')
    || componentResolver != null && typeof componentResolver.resolve !== 'function') {
    fail('CAPABILITY_EXECUTOR_CONFIG_INVALID');
  }
  const writeJournal = value => credentialVault.store(JOURNAL_KEY, serializeJournal(value));
  const clearJournal = () => credentialVault.remove(JOURNAL_KEY);

  const ensurePackage = async claim => {
    const { placement, placementIndex } = placementFromClaim(claim);
    if (typeof packageStore.verifyActive === 'function') {
      const current = await packageStore.verifyActive({ manifest: claim.capability.manifest, placementIndex });
      if (current) return current;
    }
    await apiClient.packageEvent({ capabilityId: claim.capability.id,
      capabilityVersion: claim.capability.version, packageSha256: placement.package.sha256,
      eventType: 'download-started', payload: {} });
    let archivePath;
    try {
      archivePath = await downloadCapabilityPackage({ url: placement.package.url,
        destinationDirectory: downloadDirectory, expectedBytes: placement.package.sizeBytes,
        expectedSha256: placement.package.sha256, fetchImpl });
      await apiClient.packageEvent({ capabilityId: claim.capability.id,
        capabilityVersion: claim.capability.version, packageSha256: placement.package.sha256,
        eventType: 'download-completed', payload: {} });
      const installation = await packageStore.install({ manifest: claim.capability.manifest,
        placementIndex, archivePath });
      await apiClient.packageEvent({ capabilityId: claim.capability.id,
        capabilityVersion: claim.capability.version, packageSha256: placement.package.sha256,
        eventType: 'signature-verified', payload: { keyId: placement.package.keyId } });
      await apiClient.packageEvent({ capabilityId: claim.capability.id,
        capabilityVersion: claim.capability.version, packageSha256: placement.package.sha256,
        eventType: 'install-ready', payload: {} });
      return installation;
    } catch (error) {
      await apiClient.packageEvent({ capabilityId: claim.capability.id,
        capabilityVersion: claim.capability.version, packageSha256: placement.package.sha256,
        eventType: 'install-failed', payload: { errorCode: error?.code ?? 'CAPABILITY_PACKAGE_INSTALL_FAILED' } })
        .catch(() => {});
      throw error;
    } finally {
      if (archivePath) await fs.promises.rm(archivePath, { force: true }).catch(() => {});
    }
  };

  const submitFailure = async (claim, error, outcome = error?.safeFailure === true
    ? 'safe-failure' : 'uncertain') => {
    await apiClient.fail(claim.lease.id, { leaseToken: claim.lease.token,
      errorCode: String(error?.code ?? 'CAPABILITY_EXECUTOR_FAILED').replace(/[^A-Z0-9_]/gu, '_').slice(0, 120),
      errorMessage: String(error?.message ?? error?.code ?? 'Local capability execution failed.').slice(0, 500),
      retryable: outcome === 'safe-failure' && error?.retryable === true, outcome });
    await clearJournal();
    return { status: 'failed-reported', outcome };
  };

  const executeClaim = async (claim, installation = null) => {
    const { placement } = placementFromClaim(claim);
    installation ??= await ensurePackage(claim);
    await writeJournal({ phase: 'claimed', claim, installation: {
      capabilityId: installation.capabilityId, capabilityVersion: installation.capabilityVersion,
      packageSha256: installation.packageSha256, absoluteDirectory: installation.absoluteDirectory,
      packageManifest: installation.packageManifest } });
    await writeJournal({ phase: 'resolving-components', claim, installation: {
      capabilityId: installation.capabilityId, capabilityVersion: installation.capabilityVersion,
      packageSha256: installation.packageSha256, absoluteDirectory: installation.absoluteDirectory,
      packageManifest: installation.packageManifest } });
    let renewalError = null, renewing = false;
    const abortController = new AbortController();
    const renew = async () => {
      if (renewing || renewalError) return;
      renewing = true;
      try { await apiClient.renew(claim.lease.id, claim.lease.token, leaseSeconds); }
      catch (error) {
        renewalError = error;
        abortController.abort(error);
      }
      finally { renewing = false; }
    };
    const timer = setInterval(() => { void renew(); }, renewalIntervalMs);
    timer.unref?.();
    try {
      let componentBindings;
      try {
        componentBindings = componentResolver == null ? []
          : await componentResolver.resolve({ contract: structuredClone(claim.capability.contract),
            input: structuredClone(claim.input),
            prerequisites: structuredClone(claim.prerequisites ?? []),
            signal: abortController.signal });
      } catch (error) {
        throw Object.assign(new Error(error?.message ?? 'Local component resolution failed.',
          { cause: error }), { code: error?.code ?? 'CAPABILITY_COMPONENT_RESOLUTION_FAILED',
          retryable: error?.retryable === true, safeFailure: true });
      }
      if (!Array.isArray(componentBindings)) {
        fail('CAPABILITY_COMPONENT_RESOLUTION_INVALID', { safeFailure: true });
      }
      await writeJournal({ phase: 'running', claim, installation: {
        capabilityId: installation.capabilityId, capabilityVersion: installation.capabilityVersion,
        packageSha256: installation.packageSha256, absoluteDirectory: installation.absoluteDirectory,
        packageManifest: installation.packageManifest } });
      let result = await runner.run({ installation, input: claim.input,
        prerequisites: claim.prerequisites, componentBindings,
        contract: claim.capability.contract,
        lease: { id: claim.lease.id, expiresAt: claim.lease.expiresAt },
        executionPolicy: { permissions: placement.permissions, resources: placement.resources,
          dataPolicy: placement.dataPolicy },
        signal: abortController.signal });
      if (renewalError) throw renewalError;
      const submissionId = crypto.randomUUID();
      if (resultEgressGate) {
        ({ result } = await resultEgressGate.prepare({ submissionId,
          executionLeaseId: claim.lease.id, contract: claim.capability.contract,
          executionPolicy: { permissions: placement.permissions, resources: placement.resources,
            dataPolicy: placement.dataPolicy }, result }));
      }
      await writeJournal({ phase: 'result-pending', claim, result, submissionId });
      try {
        const completed = await apiClient.complete(claim.lease.id,
          { leaseToken: claim.lease.token, submissionId, result });
        if (resultEgressGate) await resultEgressGate.confirm({ submissionId,
          remoteReceipt: completed });
        await clearJournal();
        return { status: 'completed', completed };
      } catch (error) {
        return { status: 'result-pending',
          errorCode: String(error?.code ?? 'CAPABILITY_RESULT_SUBMISSION_PENDING') };
      }
    } catch (error) {
      return submitFailure(claim, error);
    } finally { clearInterval(timer); }
  };

  const recover = async () => {
    const stored = await credentialVault.load(JOURNAL_KEY);
    if (!stored) return null;
    const journal = parseJournal(stored), { claim } = journal;
    if (journal.phase === 'result-pending') {
      const completed = await apiClient.complete(claim.lease.id, { leaseToken: claim.lease.token,
        submissionId: journal.submissionId, result: journal.result });
      if (resultEgressGate) await resultEgressGate.confirm({ submissionId: journal.submissionId,
        remoteReceipt: completed });
      await clearJournal();
      return { status: 'completed-after-recovery', completed };
    }
    if (journal.phase === 'running') {
      const error = Object.assign(new Error('The executor restarted while the capability outcome was unknown.'),
        { code: 'CAPABILITY_EXECUTOR_RESTARTED_DURING_RUN', retryable: false });
      return submitFailure(claim, error, 'uncertain');
    }
    return executeClaim(claim, journal.installation);
  };

  const runOnce = async () => {
    const recovered = await recover();
    if (recovered) return recovered;
    const claim = await apiClient.claim(leaseSeconds);
    if (claim.status === 'idle') return { status: 'idle' };
    if (claim.status !== 'claimed') fail('CAPABILITY_EXECUTOR_CLAIM_INVALID');
    let installation;
    try { installation = await ensurePackage(claim); }
    catch (error) { return submitFailure(claim, error); }
    return executeClaim(claim, installation);
  };
  return { runOnce, recover };
}
