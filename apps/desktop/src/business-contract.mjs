// Fixed operations, not a renderer-controlled HTTP tunnel. Product API methods
// still own endpoint construction, authentication and refresh behavior.
import { GAME_METHODS, gameArgument } from './game-api-contract.mjs';
export const BUSINESS_METHODS = Object.freeze({
  ...GAME_METHODS,
  listWorks: ['query'], listDiscoveryCampaigns: ['limit'], getDiscoveryCampaign: ['id'],
  getWork: ['id'], listWorkLeaderboards: ['id'], getWorkLeaderboard: ['id', 'query'],
  readCompetitionLeaderboard: ['id', 'id', 'query'],
  listWorkRemixes: ['id'], listWorkTimeline: ['id'], getPublicProjectClaim: ['id'],
  listBlogArticles: ['query'], getBlogArticle: ['id'],
  getPublicUserProfile: ['id'], getPublicProfile: ['id'],
  listLibrary: ['query'], getLibraryState: ['id'], saveToLibrary: ['id'], removeFromLibrary: ['id'],
  getLaunch: ['id', 'optional-id'], recordPlay: ['id'],
  getGuessBaikeDaily: [],
});
const queryKeys = new Set(['limit', 'offset', 'q', 'kind', 'openSource', 'remixable', 'claimable',
  'runtime', 'source', 'cursor', 'locale', 'author', 'recent', 'date', 'puzzleId']);
const denied = () => { throw Object.assign(new Error('DESKTOP_BUSINESS_INPUT_INVALID'), { code: 'DESKTOP_BUSINESS_INPUT_INVALID', status: 400 }); };
export function businessArguments(method, args = []) {
  if (!Object.hasOwn(BUSINESS_METHODS, method) || !Array.isArray(args)) denied();
  const spec = BUSINESS_METHODS[method];
  if (args.length > spec.length) denied();
  return spec.map((kind, index) => {
    const value = args[index];
    if (Object.hasOwn(GAME_METHODS, method)) return gameArgument(kind, value);
    if (kind === 'optional-id' && value === undefined) return undefined;
    if (kind === 'id' || kind === 'optional-id') {
      if (typeof value !== 'string' || !value.length || value.length > 200 || /[\u0000-\u001f\\/]/u.test(value)) denied();
      return value;
    }
    if (kind === 'limit') { if (value === undefined) return undefined; if (!Number.isInteger(value) || value < 1 || value > 100) denied(); return value; }
    if (value === undefined) return {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) denied();
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      // AbortSignals are enforced in the renderer and never cross IPC.
      if (item === undefined || key === 'signal') continue;
      if (!queryKeys.has(key) || !['string', 'number', 'boolean'].includes(typeof item) ||
          typeof item === 'string' && item.length > 300 || typeof item === 'number' && (!Number.isSafeInteger(item) || item < 0 || item > 100000)) denied();
      if (key === 'limit' && (!Number.isInteger(item) || item < 1 || item > 100)) denied();
      result[key] = item;
    }
    return result;
  });
}

const mediaPath = /^\/v1\/(?:works\/[a-zA-Z0-9-]+\/cover|avatars\/[a-fA-F0-9-]{36}|discovery\/campaigns\/[a-zA-Z0-9-]+\/share-card\.png)$/u;
export function businessMediaPath(value, origin) {
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || url.username || url.password || url.hash || !mediaPath.test(url.pathname) ||
      [...url.searchParams.keys()].some(k => !['v', 'variant', 'lang'].includes(k)) || url.search.length > 200) return null;
    return url.pathname + url.search;
  } catch { return null; }
}
export function desktopMediaUrl(value, origin) {
  const pathname = typeof value === 'string' ? businessMediaPath(value, origin) : null;
  return pathname ? 'mooyu-app://client/__desktop-media?path=' + encodeURIComponent(pathname) : null;
}
export function rewriteBusinessMedia(value, origin) {
  if (Array.isArray(value)) return value.map(item => rewriteBusinessMedia(item, origin));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    key === 'coverUrl' ? desktopMediaUrl(item, origin) : rewriteBusinessMedia(item, origin)]));
}
