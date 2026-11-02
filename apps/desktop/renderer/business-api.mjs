import { BUSINESS_METHODS, businessArguments, desktopMediaUrl } from '../src/business-contract.mjs';

const aborted = () => Object.assign(new Error('Aborted'), { name: 'AbortError' });
export function createDesktopBusinessApi(bridge, origin) {
  const api = Object.fromEntries(Object.keys(BUSINESS_METHODS).map(method => [method, async (...args) => {
    const spec = BUSINESS_METHODS[method];
    const signal = args[spec.length]?.signal ?? (spec[0] === 'query' ? args[0]?.signal : undefined);
    if (signal?.aborted) throw aborted();
    const values = businessArguments(method, args.slice(0, spec.length));
    const requestId = globalThis.crypto.randomUUID();
    const pending = bridge.call('business', [{ method, args: values, requestId }]);
    let onAbort;
    try {
      const result = signal ? await Promise.race([pending, new Promise((_, reject) => {
        onAbort = () => {
          Promise.resolve().then(() => bridge.call('cancelBusiness', [requestId])).catch(() => {});
          reject(aborted());
        }; signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
      })]) : await pending;
      if (!result.ok) {
        if (result.error.code === 'REQUEST_CANCELLED') throw aborted();
        throw Object.assign(new Error(result.error.message), result.error);
      }
      return result.value;
    } finally { if (onAbort) signal.removeEventListener('abort', onAbort); }
  }]));
  api.avatarUrl = (avatar, variant) => desktopMediaUrl(variant === 'static' ? avatar?.staticUrl : avatar?.url, origin);
  return new Proxy(api, { get(target, key) {
    if (typeof key !== 'string' || ['then', 'toJSON'].includes(key)) return undefined;
    if (Object.hasOwn(target, key)) return target[key];
    return async () => { throw Object.assign(new Error('此桌面测试版本尚未接通该操作。'), { code: 'DESKTOP_BUSINESS_OPERATION_UNAVAILABLE', status: 503 }); };
  } });
}
