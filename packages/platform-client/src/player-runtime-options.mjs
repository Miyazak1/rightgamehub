/** Runtime trust comes from the page or trusted editor configuration, never the launch response. */
export function playerRuntimeOptions({ host, pageHostname, development = false, defaultRuntimeDomain = 'runtime.mooyu.fun' } = {}) {
  const pageIsLocal = ['127.0.0.1', 'localhost'].includes(pageHostname);
  let editorIsLocal = false;
  try {
    const api = new URL(host?.apiBaseUrl);
    editorIsLocal = host?.runtimeDomain === 'localhost' &&
      ['http:', 'https:'].includes(api.protocol) && !api.username && !api.password &&
      ['127.0.0.1', 'localhost'].includes(api.hostname);
  } catch {}
  return {
    runtimeDomain: pageIsLocal || editorIsLocal ? 'localhost' : host?.runtimeDomain || defaultRuntimeDomain,
    allowLocalhost: pageIsLocal || editorIsLocal || development,
  };
}
