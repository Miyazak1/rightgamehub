// Temporary product pause. Preserve community code and data for a future return.
export const COMMUNITY_ENABLED = false;
export function visiblePlatformRoute(route) {
  const path=String(route).split(/[?#]/,1)[0];
  if (path === '/games/guess-baike/players' || /^\/challenge(?:\/|$)/.test(path)) return '/games/guess-baike/community';
  return !COMMUNITY_ENABLED && /^\/(community|social|contribute)(?:\/|$)/.test(path) ? '/discover' : route;
}
