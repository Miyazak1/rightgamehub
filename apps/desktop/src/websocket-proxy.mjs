import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
const denied = () => { throw Object.assign(new Error('DESKTOP_PROXY_UNSUPPORTED'), { code: 'DESKTOP_PROXY_UNSUPPORTED' }); };
export function desktopProxyUrl(value) {
  // Chromium/PAC orders routes. Fail if the selected proxy fails; never silently
  // turn a proxy route into DIRECT or fall back to unrelated environment settings.
  if (typeof value !== 'string') denied();
  const first = value.split(';', 1)[0].trim();
  if (first === 'DIRECT') return null;
  const match = /^(PROXY|HTTP|HTTPS|SOCKS|SOCKS4|SOCKS5)\s+(\[[a-f\d:]+\]|[a-z\d.-]+):(\d{1,5})$/i.exec(first);
  if (!match || Number(match[3]) < 1 || Number(match[3]) > 65535) denied();
  const scheme = {PROXY:'http',HTTP:'http',HTTPS:'https',SOCKS:'socks4',SOCKS4:'socks4',SOCKS5:'socks5h'}[match[1].toUpperCase()];
  return new URL(`${scheme}://${match[2]}:${match[3]}`).href;
}
export function createDesktopProxyResolver(resolveProxy) {
  return async url => {
    const endpoint = new URL(url); endpoint.search = ''; endpoint.hash = '';
    const proxy = desktopProxyUrl(await resolveProxy(endpoint.href));
    if (!proxy) return {};
    const agent = proxy.startsWith('socks') ? new SocksProxyAgent(proxy, {timeout:10000})
      : new HttpsProxyAgent(proxy, {keepAlive:false,negotiate:false});
    return {agent,dispose:()=>agent.destroy()};
  };
}
