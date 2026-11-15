// Independent practice transport; retains account refresh and cancellation semantics.
import { ApiError } from './index.mjs';
async function readBoundedResponse(response,limit,signal) {
  if(!Number.isSafeInteger(limit)||limit<0||limit>1048576)throw new TypeError('Invalid save response limit.');
  const declared=response.headers.get('content-length');
  if(declared!==null&&(!/^[0-9]+$/u.test(declared)||Number(declared)>limit)) {
    response.body?.cancel?.().catch(()=>{});
    throw new ApiError({code:'SAVE_DOCUMENT_TOO_LARGE',message:'云存档正文超过下载限制。',retryable:false});
  }
  if(!response.body)return new Uint8Array(0);
  if(!response.body.getReader)throw new ApiError({code:'SAVE_RESPONSE_INVALID',message:'当前宿主不支持受限存档下载。',retryable:false});
  const reader=response.body.getReader(),chunks=[];let length=0,abort;
  const interrupted=new Promise((_,reject)=>{
    abort=()=>{reader.cancel().catch(()=>{});reject(new DOMException('Aborted','AbortError'));};
    signal?.addEventListener('abort',abort,{once:true});
  });
  try {
    while(true) {
      if(signal?.aborted)throw new DOMException('Aborted','AbortError');
      const {done,value}=await Promise.race([reader.read(),interrupted]);
      if(signal?.aborted)throw new DOMException('Aborted','AbortError');
      if(done)break;
      length+=value.byteLength;
      if(length>limit)throw new ApiError({code:'SAVE_DOCUMENT_TOO_LARGE',message:'云存档正文超过下载限制。',retryable:false});
      chunks.push(value);
    }
    const bytes=new Uint8Array(length);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    return bytes;
  } finally {
    signal?.removeEventListener('abort',abort);
    reader.cancel().catch(()=>{});
    reader.releaseLock();
  }
}
const savePath=(scope,suffix='')=>'/v1/me/game-saves/'+encodeURIComponent(scope.workId)+'/slots'
  +(scope.slotKey!==undefined?'/'+encodeURIComponent(scope.slotKey):'')+suffix+'?namespace='+encodeURIComponent(scope.namespace);
const saveOptions=(scope,options)=>({...options,auth:true,headers:{'X-GameHub-Session':scope.gameSessionId}});
const saveConditions=input=>({
  'Idempotency-Key':input.idempotencyKey,
  ...(input.createOnly?{'If-None-Match':'*'}:{'If-Match':input.expectedEtag}),
});

const randomKey = () => globalThis.crypto?.randomUUID?.() ?? `gh-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function createPracticeApiClient({ baseUrl = '', fetchImpl = globalThis.fetch, getAccessToken = () => null, getRefreshToken = () => null, setTokens = () => {}, withRefreshLock = callback => callback(), timeoutMs = 15000, xhrFactory = () => new XMLHttpRequest() } = {}) {
  let refreshPromise = null;
  const refreshSession = (signal, expiredToken) => {
    if (!refreshPromise) {
      refreshPromise = withRefreshLock(async () => {
        const currentToken = await getAccessToken();
        if (currentToken && currentToken !== expiredToken) return true;
        const refreshToken = await getRefreshToken();
        if (!refreshToken) return false;
        const refreshed = await request('/v1/auth/refresh', { method: 'POST', body: { refreshToken }, signal, allowRefresh: false });
        // A logout or account switch while refresh was in flight must win.
        if (await getRefreshToken() !== refreshToken) return Boolean(await getAccessToken());
        await setTokens(refreshed.data);
        return true;
      }, signal).finally(() => { refreshPromise = null; });
    }
    return refreshPromise;
  };
  async function request(path, { method = 'GET', body, rawBody, headers = {}, signal, auth = false, idempotent = false, allowRefresh = true, keepalive = false, beforeRequest, responseBytesLimit, requestTimeoutMs = timeoutMs } = {}) {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new Error('timeout')), requestTimeoutMs);
    const hasCombinedSignal = Boolean(globalThis.AbortSignal?.any);
    const combined = hasCombinedSignal ? AbortSignal.any([timeout.signal, ...(signal ? [signal] : [])]) : timeout.signal;
    const cancel = () => timeout.abort(signal?.reason);
    if (!hasCombinedSignal) signal?.addEventListener('abort', cancel, { once: true });
    try {
      const token = auth ? await getAccessToken() : null;
      await beforeRequest?.();
      if (combined.aborted || signal?.aborted) throw new ApiError({ code: 'REQUEST_CANCELLED', message: '请求已取消。', retryable: false });
      const response = await fetchImpl(`${baseUrl}${path}`, {
        method, signal: combined, keepalive,
        headers: {
          Accept: 'application/json',
          ...(body != null ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(idempotent ? { 'Idempotency-Key': randomKey() } : {}),
          ...headers,
        },
        ...(body != null ? { body: JSON.stringify(body) } : rawBody != null ? { body: rawBody } : {}),
      });
      if (response.status === 401 && auth && allowRefresh) {
        const currentToken = await getAccessToken();
        if (token && currentToken && token !== currentToken) {
          return request(path, { method, body, rawBody, headers, signal, auth, idempotent, allowRefresh: false, keepalive, beforeRequest, responseBytesLimit, requestTimeoutMs });
        }
        if (await refreshSession(signal, token)) return request(path, { method, body, rawBody, headers, signal, auth, idempotent, allowRefresh: false, keepalive, beforeRequest, responseBytesLimit, requestTimeoutMs });
      }
      if (response.ok && responseBytesLimit !== undefined) {
        const bytes = await readBoundedResponse(response, responseBytesLimit, combined);
        return { data: bytes, etag: response.headers.get('etag'), sha256: response.headers.get('x-content-sha256'), schemaVersion: Number(response.headers.get('x-gamehub-save-schema')), contentType: response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() };
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new ApiError({ status: response.status, ...(payload.error ?? {}), message: payload.error?.message ?? `请求失败 (${response.status})` });
      return { data: payload.data, etag: response.headers.get('etag') };
    } catch (error) {
      if (error instanceof ApiError || error?.code === 'BRIDGE_ACCOUNT_CHANGED' || error?.code === 'BRIDGE_CLOSED') throw error;
      if (signal?.aborted) throw new ApiError({ code: 'REQUEST_CANCELLED', message: '请求已取消。', retryable: false });
      if (error?.name === 'AbortError' || timeout.signal.aborted) throw new ApiError({ code: 'REQUEST_TIMEOUT', message: '连接超时，请检查网络后重试。' });
      throw new ApiError({ message: '暂时无法连接墨鱼工坊，请稍后重试。' });
    } finally { clearTimeout(timer); if (!hasCombinedSignal) signal?.removeEventListener('abort', cancel); }
  }
  return {
    getAssistantCapabilities: options => request('/v1/me/assistant/capabilities', { ...options, auth: true }),
    sendAssistantMessage: (body, options) => request('/v1/me/assistant/messages', { requestTimeoutMs:80000,...options, method: 'POST', body, auth: true }),
    executeAgentTool: (name,args={},options) => request('/v1/me/agent/tools',{...options,method:'POST',body:{name,arguments:args},auth:true}),
    getLearningInsights: (query={},options) => request('/v1/me/learning/insights?'+new URLSearchParams(Object.entries(query).filter(([,v])=>v!==undefined&&v!==null&&v!=='')),{...options,auth:true}),
    getPracticeCatalog: (filter = {}, options) => request('/v1/learning/practice/catalog?' + new URLSearchParams(Object.entries(filter).filter(([,value]) => value)), options),
    listPracticeHistory: options => request('/v1/me/practice', { ...options, auth: true }),
    startPractice: (body, key, options) => request('/v1/me/practice', { ...options, method: 'POST', body, auth: true, headers: { 'Idempotency-Key': key } }),
    getPractice: (id, options) => request('/v1/me/practice/' + encodeURIComponent(id), { ...options, auth: true }),
    updatePractice: (id, body, options) => request('/v1/me/practice/' + encodeURIComponent(id), { ...options, method: 'PATCH', body, auth: true }),
    continuePractice: (id, key, options) => request('/v1/me/practice/' + encodeURIComponent(id) + '/continue', { ...options, method: 'POST', auth: true, headers: { 'Idempotency-Key': key } }),
    retryPractice: (id, options) => request('/v1/me/practice/' + encodeURIComponent(id) + '/retry', { ...options, method: 'POST', auth: true }),
  };
}
