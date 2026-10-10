const publicWorkPath = /^\/w\/([^/?#]+)\/?$/u;
const publicWorkHandoff = /^\/works\/([^/?#]+)\?public=1$/u;

export function readBrowserRoute(mode, currentLocation) {
  if (mode !== 'hash') return '/discover';
  const publicMatch = String(currentLocation.pathname || '').match(publicWorkPath);
  if (publicMatch) return `/works/${publicMatch[1]}`;
  const hashRoute = String(currentLocation.hash || '').slice(1) || '/discover';
  const handoffMatch = hashRoute.match(publicWorkHandoff);
  return handoffMatch ? `/works/${handoffMatch[1]}` : hashRoute;
}

export function consumePublicWorkHandoff(currentLocation, browserHistory) {
  const hashRoute = String(currentLocation.hash || '').slice(1);
  const match = hashRoute.match(publicWorkHandoff);
  if (!match) return false;
  browserHistory.replaceState(browserHistory.state ?? null, '', `/w/${match[1]}`);
  return true;
}

export function navigateBrowserRoute(mode, next, currentLocation, browserHistory, setPath) {
  if (mode !== 'hash') { setPath(next); return; }
  if (publicWorkPath.test(String(currentLocation.pathname || ''))) {
    browserHistory.pushState(null, '', `/#${next}`);
    setPath(next);
    return;
  }
  currentLocation.hash = next;
}
