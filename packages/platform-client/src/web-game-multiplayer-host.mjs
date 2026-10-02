import { createWebGameHost } from './web-game-host.mjs';

// Compatibility entry point for older hosts. New mounts pass the trusted descriptor.
export function createWebGameMultiplayerHost(options = {}) {
  return createWebGameHost({
    ...options,
    descriptor: options.descriptor ?? { workId: options.workId, capabilities: { multiplayer: true } },
  });
}
