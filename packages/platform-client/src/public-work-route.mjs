const publicWorkPath = /^\/w\/([^/?#]+)\/?$/u;
const internalWorkRoute = /^\/works\/([^/?#]+)$/u;
const sourceSet = new Set(['share_copy', 'share_system', 'readme', 'external']);
const campaignPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

const handoff = value => {
  const [path, query = ''] = String(value || '').split('?');
  const match = path.match(internalWorkRoute);
  if (!match) return null;
  const params = new URLSearchParams(query);
  if (params.get('public') !== '1') return null;
  const source = params.get('gh_src'); const campaign = params.get('gh_campaign');
  return {
    workId: match[1],
    source: sourceSet.has(source) ? source : null,
    campaign: campaignPattern.test(campaign || '') ? campaign : null,
  };
};

export function readBrowserRoute(mode, currentLocation) {
  if (mode !== 'hash') return '/discover';
  const publicMatch = String(currentLocation.pathname || '').match(publicWorkPath);
  if (publicMatch) return `/works/${publicMatch[1]}`;
  const hashRoute = String(currentLocation.hash || '').slice(1) || '/discover';
  const incoming = handoff(hashRoute);
  return incoming ? `/works/${incoming.workId}` : hashRoute;
}

export function consumePublicWorkHandoff(currentLocation, browserHistory) {
  const hashRoute = String(currentLocation.hash || '').slice(1);
  const incoming = handoff(hashRoute);
  if (!incoming) return false;
  const params = new URLSearchParams({ ...(incoming.source ? { gh_src: incoming.source } : {}), ...(incoming.campaign ? { gh_campaign: incoming.campaign } : {}) });
  browserHistory.replaceState(browserHistory.state ?? null, '', `/w/${incoming.workId}${params.size ? `?${params}` : ''}`);
  return true;
}

export function navigateBrowserRoute(mode, next, currentLocation, browserHistory, setPath) {
  if (mode !== 'hash') { setPath(next); return; }
  const workMatch = String(next || '').match(internalWorkRoute);
  if (workMatch) {
    browserHistory.pushState(null, '', `/w/${workMatch[1]}`);
    setPath(next);
    return;
  }
  if (publicWorkPath.test(String(currentLocation.pathname || ''))) {
    browserHistory.pushState(null, '', `/#${next}`);
    setPath(next);
    return;
  }
  currentLocation.hash = next;
}
