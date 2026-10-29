import { fail } from './errors.mjs';
import { createDesktopShellControlServer } from './desktop-shell-ipc.mjs';

export function createDesktopShellHost({ rootDirectory, supervisor, credentialVault,
  fileGrantBroker = null, capabilityArtifactHost = null, controlServer = null } = {}) {
  if (!supervisor || typeof supervisor.run !== 'function' || !supervisor.stateStore) {
    fail('CAPABILITY_DESKTOP_SHELL_HOST_CONFIG_INVALID');
  }
  if (capabilityArtifactHost !== null && typeof capabilityArtifactHost?.open !== 'function') {
    fail('CAPABILITY_DESKTOP_SHELL_HOST_CONFIG_INVALID');
  }
  controlServer ??= createDesktopShellControlServer({ rootDirectory, credentialVault,
    stateStore: supervisor.stateStore, fileGrantBroker });
  const run = async options => {
    await controlServer.start();
    try { return await supervisor.run(options); }
    finally { await controlServer.close(); }
  };
  return { controlServer, run,
    ...(capabilityArtifactHost ? { capabilityArtifacts: Object.freeze({
      open: payload => capabilityArtifactHost.open(payload),
    }) } : {}) };
}
