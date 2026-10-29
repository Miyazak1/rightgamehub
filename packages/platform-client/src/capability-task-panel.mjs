const HOSTS = new Set(['codex', 'mcp-app', 'harness', 'cursor', 'vscode', 'desktop-app']);

export function createCapabilityTaskHostProfile(hostIdentity, { artifactOpener = false } = {}) {
  const host = String(hostIdentity?.id ?? '').toLowerCase();
  if (!HOSTS.has(host)) return null;
  return {
    schemaVersion: 'capability-host-profile-v1',
    host,
    hostVersion: String(hostIdentity?.version || '1'),
    surface: host === 'mcp-app' ? 'mcp-app'
      : host === 'desktop-app' ? 'desktop-window' : 'sidebar',
    connection: 'control-plane',
    features: {
      submit: true,
      cancel: true,
      resume: false,
      artifacts: artifactOpener === true,
      fileConsent: false,
      background: true,
    },
  };
}
