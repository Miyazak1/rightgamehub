const publicWorkPath = /^\/w\/([^/?#]+)\/?$/u;
const internalWorkRoute = /^\/works\/([^/?#]+)\/?$/u;
const sourceSet = new Set(['share_copy', 'share_system', 'readme', 'external', 'campaign']);
const campaignPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

const splitRoute = value => {
  const raw = String(value || '').replace(/^#(?=\/)/u, '');
  const queryAt = raw.indexOf('?');
  const pathname = (queryAt < 0 ? raw : raw.slice(0, queryAt)) || '/discover';
  return {
    pathname: pathname.startsWith('/') ? pathname : `/${pathname}`,
    search: queryAt < 0 ? '' : raw.slice(queryAt + 1),
  };
};

const internalRoute = value => {
  const { pathname } = splitRoute(value);
  const publicWork = pathname.match(publicWorkPath);
  if (publicWork) return `/works/${publicWork[1]}`;
  return pathname === '/' ? '/discover' : pathname.replace(/\/$/u, '') || '/discover';
};

const bootstrapRoute = currentLocation => {
  const value = new URLSearchParams(String(currentLocation?.search || '').replace(/^\?/u, '')).get('gh_route');
  return value?.startsWith('/') ? value : null;
};

const isMcpAppLocation = currentLocation => {
  if (String(currentLocation?.pathname || '') !== '/mcp-app') return false;
  const params = new URLSearchParams(String(currentLocation?.search || '').replace(/^\?/u, ''));
  return params.get('gh_host') === 'mcp-app';
};

const routeQuery = (value, currentLocation, includeOuter) => {
  const { pathname, search } = splitRoute(value);
  const params = new URLSearchParams(search);
  params.delete('public');
  params.delete('gh_route');
  const outer = new URLSearchParams(String(currentLocation?.search || '').replace(/^\?/u, ''));
  if (includeOuter) {
    for (const [key, item] of outer) if (key !== 'gh_route' && key !== 'public' && !params.has(key)) params.set(key, item);
  } else if (outer.has('demo')) params.set('demo', '');
  if (pathname.match(internalWorkRoute)) {
    if (!sourceSet.has(params.get('gh_src'))) params.delete('gh_src');
    if (!campaignPattern.test(params.get('gh_campaign') || '')) params.delete('gh_campaign');
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
};

export function browserPathForRoute(value, currentLocation = {}, includeOuter = false) {
  const { pathname } = splitRoute(value);
  const work = pathname.match(internalWorkRoute);
  const cleanPath = work ? `/w/${work[1]}` : pathname === '/' ? '/discover' : pathname.replace(/\/$/u, '') || '/discover';
  return `${cleanPath}${routeQuery(value, currentLocation, includeOuter)}`;
}

export function embeddedBrowserPathForRoute(value, currentLocation = {}) {
  const path = `${internalRoute(value)}${routeQuery(value, {}, false)}`;
  const params = new URLSearchParams();
  params.set('gh_route', path);
  params.set('gh_host', 'mcp-app');
  const outer = new URLSearchParams(String(currentLocation?.search || '').replace(/^\?/u, ''));
  if (outer.has('demo')) params.set('demo', '');
  return `/mcp-app?${params.toString()}`;
}

export function readBrowserRoute(mode, currentLocation) {
  if (mode === 'memory') return '/discover';
  if (mode === 'embedded') return internalRoute(bootstrapRoute(currentLocation) || '/discover');
  const legacy = String(currentLocation.hash || '').slice(1);
  return internalRoute(legacy.startsWith('/') ? legacy : bootstrapRoute(currentLocation) || currentLocation.pathname || '/discover');
}

export function consumePublicWorkHandoff(currentLocation, browserHistory) {
  if (isMcpAppLocation(currentLocation)) return false;
  const legacy = String(currentLocation.hash || '').slice(1);
  const incoming = legacy.startsWith('/') ? legacy : bootstrapRoute(currentLocation);
  if (!incoming) return false;
  browserHistory.replaceState(browserHistory.state ?? null, '', browserPathForRoute(incoming, currentLocation, true));
  return true;
}

export function navigateBrowserRoute(mode, next, currentLocation, browserHistory, setPath) {
  const route = internalRoute(next);
  if (mode === 'memory') { setPath(route); return; }
  browserHistory.pushState(null, '', mode === 'embedded'
    ? embeddedBrowserPathForRoute(next, currentLocation)
    : browserPathForRoute(next, currentLocation));
  setPath(route);
}
