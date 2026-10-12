export const attributionSources = ['share_copy', 'share_system', 'readme', 'external', 'campaign'];

const sourceSet = new Set(attributionSources);
const campaignPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const storageKey = 'gamehub.analytics.attribution';
const publicWorkPath = /^\/w\/([^/?#]+)\/?$/u;

const safeDecode = value => {
  try { return decodeURIComponent(value); } catch { return value; }
};

const readStore = storage => {
  try {
    const value = JSON.parse(storage?.getItem(storageKey) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
};

export function attributedWorkUrl(baseUrl, source, campaignKey) {
  const url = new URL(baseUrl);
  if (!sourceSet.has(source)) throw new TypeError('Invalid attribution source.');
  url.searchParams.set('gh_src', source);
  if (campaignKey != null) {
    if (!campaignPattern.test(String(campaignKey))) throw new TypeError('Invalid campaign key.');
    url.searchParams.set('gh_campaign', String(campaignKey));
  }
  return url.toString();
}

export function captureWorkAttribution(workId, currentLocation = globalThis.location, storage = globalThis.sessionStorage) {
  const match = String(currentLocation?.pathname || '').match(publicWorkPath);
  if (!match || safeDecode(match[1]) !== String(workId)) return getWorkAttribution(workId, storage);
  const params = new URLSearchParams(String(currentLocation?.search || ''));
  const attributionSource = params.get('gh_src');
  const campaignKey = params.get('gh_campaign');
  if (!sourceSet.has(attributionSource) || (campaignKey != null && !campaignPattern.test(campaignKey))) return getWorkAttribution(workId, storage);
  return rememberWorkAttribution(workId, attributionSource, campaignKey, storage);
}

export function rememberWorkAttribution(workId, attributionSource, campaignKey, storage = globalThis.sessionStorage) {
  if (!sourceSet.has(attributionSource) || (campaignKey != null && !campaignPattern.test(String(campaignKey)))) return getWorkAttribution(workId, storage);
  const next = { attributionSource, ...(campaignKey ? { campaignKey: String(campaignKey) } : {}) };
  try {
    const values = readStore(storage);
    const entries = Object.entries({ ...values, [workId]: next }).slice(-20);
    storage?.setItem(storageKey, JSON.stringify(Object.fromEntries(entries)));
  } catch {}
  return next;
}

export function getWorkAttribution(workId, storage = globalThis.sessionStorage) {
  const value = readStore(storage)[workId];
  if (!value || !sourceSet.has(value.attributionSource)) return {};
  if (value.campaignKey != null && !campaignPattern.test(value.campaignKey)) return {};
  return { attributionSource: value.attributionSource, ...(value.campaignKey ? { campaignKey: value.campaignKey } : {}) };
}
