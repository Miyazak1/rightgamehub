const AUTH_CLIENT_KINDS = new Set(['harness', 'vscode', 'cursor', 'browser']);

export function resolveAuthClientKind(capabilities = {}) {
  const host = String(capabilities.host || 'browser').toLowerCase();
  return AUTH_CLIENT_KINDS.has(host) ? host : 'browser';
}
