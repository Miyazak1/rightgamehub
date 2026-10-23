import { communityApi } from './community.mjs';
export class ApiError extends Error {
  constructor({ code = 'NETWORK_ERROR', message = '请求失败，请稍后重试。', status = 0, retryable = true, requestId = null, details = {} } = {}) {
    super(message); this.name = 'ApiError'; this.code = code; this.status = status; this.retryable = retryable; this.requestId = requestId; this.details = details && typeof details === 'object' && !Array.isArray(details) ? details : {};
  }
}

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

export function createApiClient({ baseUrl = '', fetchImpl = globalThis.fetch, getAccessToken = () => null, getRefreshToken = () => null, setTokens = () => {}, withRefreshLock = callback => callback(), timeoutMs = 15000, xhrFactory = () => new XMLHttpRequest() } = {}) {
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
  async function authenticatedDownload(path, options = {}) {
    const token = await getAccessToken();
    const response = await fetchImpl(`${baseUrl}${path}`, { signal: options.signal,headers: { Accept: options.accept ?? 'application/zip',...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new ApiError({ status: response.status,...(payload.error ?? {}),message: payload.error?.message ?? `下载失败 (${response.status})` });
    }
    return { data: await response.blob(),digest: response.headers.get('digest') };
  }
  return {
    ...communityApi(request),
    listBlogArticles: ({ limit = 20, cursor = null, locale = null, q = null, author = null } = {}, options) => request(`/v1/blog/articles?${new URLSearchParams(Object.fromEntries(Object.entries({ limit, cursor, locale, q, author }).filter(([, value]) => value != null && value !== '')))}`, options),
    getBlogArticle: (slug, options) => request(`/v1/blog/articles/${encodeURIComponent(slug)}`, options),
    askBlogQuestion: (slug, body, options) => request(`/v1/blog/articles/${encodeURIComponent(slug)}/questions`, { ...options, requestTimeoutMs: options?.requestTimeoutMs ?? 130000, method: 'POST', body, auth: true, idempotent: true }),
    listMyBlogArticles: ({ limit = 50, cursor = null } = {}, options) => request(`/v1/me/blog/articles?${new URLSearchParams(Object.fromEntries(Object.entries({ limit, cursor }).filter(([, value]) => value != null && value !== '')))}`, { ...options, auth: true }),
    getMyBlogArticle: (articleId, options) => request(`/v1/me/blog/articles/${encodeURIComponent(articleId)}`, { ...options, auth: true }),
    createBlogDraft: (body, options) => request('/v1/me/blog/articles', { ...options, method: 'POST', body, auth: true, idempotent: true }),
    updateBlogDraft: (articleId, version, body, options) => request(`/v1/me/blog/articles/${encodeURIComponent(articleId)}/draft`, { ...options, method: 'PUT', body, auth: true, idempotent: true, headers: { 'If-Match': `"article-${articleId}-${version}"`, ...(options?.headers ?? {}) } }),
    publishBlogArticle: (articleId, version, options) => request(`/v1/me/blog/articles/${encodeURIComponent(articleId)}/publish`, { ...options, method: 'POST', auth: true, idempotent: true, headers: { 'If-Match': `"article-${articleId}-${version}"`, ...(options?.headers ?? {}) } }),
    withdrawBlogArticle: (articleId, version, options) => request(`/v1/me/blog/articles/${encodeURIComponent(articleId)}/withdraw`, { ...options, method: 'POST', auth: true, idempotent: true, headers: { 'If-Match': `"article-${articleId}-${version}"`, ...(options?.headers ?? {}) } }),
    listAdminAgents: options => request('/v1/admin/agents', { ...options, auth: true }),
    createAdminAgent: (body, options) => request('/v1/admin/agents', { ...options, method: 'POST', body, auth: true }),
    suspendAdminAgent: (agentUserId, options) => request(`/v1/admin/agents/${encodeURIComponent(agentUserId)}/suspend`, { ...options, method: 'POST', auth: true }),
    setAdminAgentProviderKey: (agentUserId, apiKey, options) => request(`/v1/admin/agents/${encodeURIComponent(agentUserId)}/provider-key`, { ...options, method: 'PUT', body: { apiKey }, auth: true }),
    listAdminAgentProviderModels: (agentUserId, options) => request(`/v1/admin/agents/${encodeURIComponent(agentUserId)}/provider-models`, { ...options, auth: true }),
    deleteAdminAgentProviderKey: (agentUserId, options) => request(`/v1/admin/agents/${encodeURIComponent(agentUserId)}/provider-key`, { ...options, method: 'DELETE', auth: true }),
    updateAdminAgentBlogAutomation: (agentUserId, body, options) => request(`/v1/admin/agents/${encodeURIComponent(agentUserId)}/blog-automation`, { ...options, method: 'PUT', body, auth: true }),
    runAdminAgentBlogNow: (agentUserId, options) => request(`/v1/admin/agents/${encodeURIComponent(agentUserId)}/blog-runs`, { ...options, method: 'POST', auth: true }),
    listAdminAgentBlogRuns: (agentUserId, limit = 30, options) => request(`/v1/admin/agents/${encodeURIComponent(agentUserId)}/blog-runs?limit=${encodeURIComponent(limit)}`, { ...options, auth: true }),
    withdrawAdminAgentBlogArticle: (agentUserId, runId, options) => request(`/v1/admin/agents/${encodeURIComponent(agentUserId)}/blog-runs/${encodeURIComponent(runId)}/withdraw`, { ...options, method: 'POST', auth: true }),
    listChangeWatches: options => request('/v1/me/change-watches', { ...options, auth: true }),
    createChangeWatch: (body, options) => request('/v1/me/change-watches', { ...options, method: 'POST', body, auth: true }),
    getChangeWatch: (id, options) => request(`/v1/me/change-watches/${encodeURIComponent(id)}`, { ...options, auth: true }),
    updateChangeWatch: (id, body, options) => request(`/v1/me/change-watches/${encodeURIComponent(id)}`, { ...options, method: 'PATCH', body, auth: true }),
    deleteChangeWatch: (id, options) => request(`/v1/me/change-watches/${encodeURIComponent(id)}`, { ...options, method: 'DELETE', auth: true }),
    listChangeWatchSnapshots: (id, options) => request(`/v1/me/change-watches/${encodeURIComponent(id)}/snapshots`, { ...options, auth: true }),
    checkChangeWatch: (id, options) => request(`/v1/me/change-watches/${encodeURIComponent(id)}/check`, { ...options, method: 'POST', auth: true }),
    getResearchNewsSourceCatalog: options => request('/v1/me/research-news-source-catalog', { ...options, auth: true }),
    listResearchTopics: options => request('/v1/me/research-topics', { ...options, auth: true }),
    createResearchTopic: (body, options) => request('/v1/me/research-topics', { ...options, method: 'POST', body, auth: true }),
    getResearchTopic: (id, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}`, { ...options, auth: true }),
    updateResearchTopic: (id, body, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}`, { ...options, method: 'PATCH', body, auth: true }),
    createResearchContract: (id, body, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/contracts`, { ...options, method: 'POST', body, auth: true }),
    listResearchTopicWatches: (id, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/watches`, { ...options, auth: true }),
    linkResearchTopicWatch: (id, watchId, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/watches/${encodeURIComponent(watchId)}`, { ...options, method: 'PUT', auth: true }),
    unlinkResearchTopicWatch: (id, watchId, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/watches/${encodeURIComponent(watchId)}`, { ...options, method: 'DELETE', auth: true }),
    listResearchTopicRuns: (id, limit = 30, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/runs?limit=${encodeURIComponent(limit)}`, { ...options, auth: true }),
    getResearchTopicOperationsSummary: (id, days = 30, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/operations-summary?days=${encodeURIComponent(days)}`, { ...options, auth: true }),
    getResearchTopicStorageAssessment: (id, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/storage-assessment`, { ...options, auth: true }),
    listResearchTopicBillingReconciliations: (id, limit = 50, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/billing-reconciliations?limit=${encodeURIComponent(limit)}`, { ...options, auth: true }),
    createResearchTopicBillingReconciliation: (id, body, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/billing-reconciliations`, { ...options, method: 'POST', body, auth: true }),
    reviewResearchTopicBillingReconciliation: (id, reconciliationId, body, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/billing-reconciliations/${encodeURIComponent(reconciliationId)}/reviews`, { ...options, method: 'POST', body, auth: true }),
    listResearchRunActions: (id, runId, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}/actions`, { ...options, auth: true }),
    listResearchRunSources: (id, runId, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}/sources`, { ...options, auth: true }),
    triggerResearchTopicRun: (id, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/runs`, { ...options, method: 'POST', auth: true }),
    listResearchTopicSources: (id, limit = 100, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/sources?limit=${encodeURIComponent(limit)}`, { ...options, auth: true }),
    listResearchTopicSourceRelationships: (id, limit = 100, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/source-relationships?limit=${encodeURIComponent(limit)}`, { ...options, auth: true }),
    reviewResearchTopicSourceRelationship: (id, body, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/source-relationships`, { ...options, method: 'POST', body, auth: true }),
    listResearchTopicDiscoveries: (id, query = 50, options) => { const params = typeof query === 'number' ? { limit: query } : Object.fromEntries(Object.entries({ limit: query?.limit ?? 50, decision: query?.decision, evaluatorKind: query?.evaluatorKind, sourceStatus: query?.sourceStatus, sort: query?.sort, minTopicRelevance: query?.minTopicRelevance }).filter(([,value]) => value != null && value !== '')); return request(`/v1/me/research-topics/${encodeURIComponent(id)}/discoveries?${new URLSearchParams(params)}`, { ...options, auth: true }); },
    getResearchTopicDiscoveryStats: (id, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/discovery-stats`, { ...options, auth: true }),
    getResearchTopicCandidateEvaluation: (id, evaluationKey = null, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/candidate-evaluation${evaluationKey?`?evaluationKey=${encodeURIComponent(evaluationKey)}`:''}`, { ...options, auth: true }),
    listResearchTopicCandidateEvaluationDatasets: (id, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/candidate-evaluation-datasets`, { ...options, auth: true }),
    createResearchTopicCandidateEvaluationDataset: (id, body, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/candidate-evaluation-datasets`, { ...options, method: 'POST', auth: true, body }),
    importResearchTopicCandidateEvaluationDataset: (id, body, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/candidate-evaluation-datasets/import`, { ...options, method: 'POST', auth: true, body }),
    listResearchTopicCandidateEvaluationRuns: (id, datasetId, limit = 20, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/candidate-evaluation-datasets/${encodeURIComponent(datasetId)}/runs?limit=${encodeURIComponent(limit)}`, { ...options, auth: true }),
    listResearchTopicCandidateEvaluationPredictions: (id, datasetId, options={}) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/candidate-evaluation-datasets/${encodeURIComponent(datasetId)}/predictions${query({evaluationKey:options.evaluationKey,limit:options.limit??500})}`, { ...options, auth: true }),
    runResearchTopicCandidateEvaluationDataset: (id, datasetId, body = {}, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/candidate-evaluation-datasets/${encodeURIComponent(datasetId)}/runs`, { ...options, method: 'POST', auth: true, body }),
    reviewResearchTopicDiscovery: (id, discoveryId, body, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/discoveries/${encodeURIComponent(discoveryId)}/reviews`, { ...options, method: 'POST', auth: true, body }),
    listResearchTopicEntities: (id, limit = 100, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/entities?limit=${encodeURIComponent(limit)}`, { ...options, auth: true }),
    createResearchTopicEntity: (id, body, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/entities`, { ...options, method: 'POST', body, auth: true }),
    updateResearchTopicEntity: (id, entityId, body, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/entities/${encodeURIComponent(entityId)}`, { ...options, method: 'PATCH', body, auth: true }),
    listResearchTopicEntityStatusReviews: (id, entityId, limit = 50, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/entities/${encodeURIComponent(entityId)}/status-reviews?limit=${encodeURIComponent(limit)}`, { ...options, auth: true }),
    addResearchTopicSource: (id, body, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/sources`, { ...options, method: 'POST', body, auth: true }),
    updateResearchTopicSource: (id, sourceId, body, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/sources/${encodeURIComponent(sourceId)}`, { ...options, method: 'PATCH', body, auth: true }),
    listResearchTopicSourceStatusReviews: (id, sourceId, limit = 50, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/sources/${encodeURIComponent(sourceId)}/status-reviews?limit=${encodeURIComponent(limit)}`, { ...options, auth: true }),
    listResearchTopicSourceAuthorityReviews: (id, sourceId, limit = 50, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/sources/${encodeURIComponent(sourceId)}/authority-reviews?limit=${encodeURIComponent(limit)}`, { ...options, auth: true }),
    reviewResearchTopicSourceAuthority: (id, sourceId, body, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/sources/${encodeURIComponent(sourceId)}/authority-reviews`, { ...options, method: 'POST', body, auth: true }),
    inspectResearchTopicSource: (id, sourceId, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/sources/${encodeURIComponent(sourceId)}/inspect`, { ...options, method: 'POST', auth: true }),
    listResearchTopicEvidence: (id, limit = 50, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/evidence?limit=${encodeURIComponent(limit)}`, { ...options, auth: true }),
    listResearchTopicEvents: (id, limit = 50, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/events?limit=${encodeURIComponent(limit)}`, { ...options, auth: true }),
    listResearchTopicEventClusterDiagnostics: (id, limit = 50, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/event-cluster-diagnostics?limit=${encodeURIComponent(limit)}`, { ...options, auth: true }),
    listResearchTopicReports: (id, limit = 30, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/reports?limit=${encodeURIComponent(limit)}`, { ...options, auth: true }),
    listResearchTopicNotifications: (id, { unreadOnly = false, limit = 50 } = {}, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/notifications?unreadOnly=${encodeURIComponent(unreadOnly)}&limit=${encodeURIComponent(limit)}`, { ...options, auth: true }),
    markResearchEventRead: (eventId, options) => request(`/v1/me/research-events/${encodeURIComponent(eventId)}/read`, { ...options, method: 'POST', auth: true }),
    linkResearchTopicEventEntity: (id, eventId, entityId, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/events/${encodeURIComponent(eventId)}/entities/${encodeURIComponent(entityId)}`, { ...options, method: 'PUT', auth: true }),
    getResearcherCapabilities: (id, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/researcher`, { ...options, auth: true }),
    listResearcherNodes: options => request('/v1/me/researcher-nodes', { ...options, auth: true }),
    createResearcherNode: (body, options) => request('/v1/me/researcher-nodes', { ...options, method: 'POST', body, auth: true }),
    revokeResearcherNode: (nodeId, options) => request(`/v1/me/researcher-nodes/${encodeURIComponent(nodeId)}`, { ...options, method: 'DELETE', auth: true }),
    listResearchTopicGaps: (id, limit = 100, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/gaps?limit=${encodeURIComponent(limit)}`, { ...options, auth: true }),
    createResearchTopicGap: (id, body, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/gaps`, { ...options, method: 'POST', body, auth: true }),
    queueResearcherJob: (id, gapId, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/gaps/${encodeURIComponent(gapId)}/jobs`, { ...options, method: 'POST', auth: true }),
    listResearcherJobs: (id, limit = 50, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/researcher-jobs?limit=${encodeURIComponent(limit)}`, { ...options, auth: true }),
    cancelResearcherJob: (id, jobId, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/researcher-jobs/${encodeURIComponent(jobId)}`, { ...options, method: 'DELETE', auth: true }),
    listResearchTopicClaims: (id, query = 100, options) => { const params = typeof query === 'number' ? { limit: query } : { limit: query?.limit ?? 100, ...(query?.status ? { status: query.status } : {}) }; return request(`/v1/me/research-topics/${encodeURIComponent(id)}/claims?${new URLSearchParams(params)}`, { ...options, auth: true }); },
    getResearchTopicFactTimeline: (id, query = {}, options) => { const params = new URLSearchParams(Object.entries({ subject: query.subject, dimensionKey: query.dimensionKey, predicateKey: query.predicateKey, scopeKey: query.scopeKey, scopeValue: query.scopeValue, from: query.from, to: query.to, limit: query.limit ?? 200 }).filter(([,value]) => value != null && value !== '')); return request(`/v1/me/research-topics/${encodeURIComponent(id)}/fact-timeline?${params}`, { ...options, auth: true }); },
    listResearchTopicClaimReviewSignals: (id, query = {}, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/claim-review-signals?${new URLSearchParams({ limit: query?.limit ?? 50, openOnly: query?.openOnly !== false })}`, { ...options, auth: true }),
    resolveResearchClaimReviewSignal: (signalId, body, options) => request(`/v1/me/research-claim-review-signals/${encodeURIComponent(signalId)}/resolutions`, { ...options, method: 'POST', body, auth: true }),
    getResearchTopicClaim: (id, claimId, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/claims/${encodeURIComponent(claimId)}`, { ...options, auth: true }),
    reviewResearchTopicClaim: (id, claimId, body, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/claims/${encodeURIComponent(claimId)}/reviews`, { ...options, method: 'POST', body, auth: true }),
    listResearchTopicMethodTemplates: (id, status, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/method-templates${status?`?status=${encodeURIComponent(status)}`:''}`, { ...options, auth: true }),
    createResearchTopicMethodTemplate: (id, body, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/method-templates`, { ...options, method: 'POST', body, auth: true }),
    retireResearchTopicMethodTemplate: (id, methodId, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/method-templates/${encodeURIComponent(methodId)}`, { ...options, method: 'DELETE', auth: true }),
    listResearchTopicMetrics: (id, filters = {}, options) => { const params = new URLSearchParams(Object.entries({ status: filters.status ?? 'active', metricKey: filters.metricKey, from: filters.from, to: filters.to, dimensionKey: filters.dimensionKey, dimensionValue: filters.dimensionValue, limit: filters.limit ?? 500 }).filter(([,value]) => value != null && value !== '')); return request(`/v1/me/research-topics/${encodeURIComponent(id)}/metrics?${params}`, { ...options, auth: true }); },
    compareResearchTopicMetric: (id, query, options) => { const params = new URLSearchParams(Object.entries({ metricKey: query.metricKey, methodVersion: query.methodVersion, dimensionKey: query.dimensionKey, from: query.from, to: query.to }).filter(([,value]) => value != null && value !== '')); return request(`/v1/me/research-topics/${encodeURIComponent(id)}/metric-comparison?${params}`, { ...options, auth: true }); },
    matrixResearchTopicMetrics: (id, body, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/metric-matrix`, { ...options, method: 'POST', body, auth: true }),
    trendResearchTopicMetric: (id, query, options) => { const params = new URLSearchParams(Object.entries({ metricKey: query.metricKey, methodVersion: query.methodVersion, interval: query.interval ?? 'month', dimensionKey: query.dimensionKey, dimensionValue: query.dimensionValue, from: query.from, to: query.to }).filter(([,value]) => value != null && value !== '')); return request(`/v1/me/research-topics/${encodeURIComponent(id)}/metric-trend?${params}`, { ...options, auth: true }); },
    listResearchTopicMetricViews: (id, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/metric-views`, { ...options, auth: true }),
    createResearchTopicMetricView: (id, body, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/metric-views`, { ...options, method: 'POST', body, auth: true }),
    deleteResearchTopicMetricView: (id, viewId, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/metric-views/${encodeURIComponent(viewId)}`, { ...options, method: 'DELETE', auth: true }),
    getResearchTopicQualitySummary: (id, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/quality-summary`, { ...options, auth: true }),
    listResearchTopicExternalBenchmarkCases: (id, query = {}, options) => { const params = new URLSearchParams(Object.entries({ periodKey: query.periodKey, status: query.status, limit: query.limit ?? 100 }).filter(([,value]) => value != null && value !== '')); return request(`/v1/me/research-topics/${encodeURIComponent(id)}/external-benchmark-cases?${params}`, { ...options, auth: true }); },
    createResearchTopicExternalBenchmarkCase: (id, body, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/external-benchmark-cases`, { ...options, method: 'POST', body, auth: true }),
    reviewResearchTopicExternalBenchmarkCase: (id, caseId, body, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/external-benchmark-cases/${encodeURIComponent(caseId)}/reviews`, { ...options, method: 'POST', body, auth: true }),
    listResearchTopicQualitySamples: (id, query = {}, options) => { const params = new URLSearchParams(Object.entries({ status: query.status, periodKey: query.periodKey, sampleKind: query.sampleKind, limit: query.limit }).filter(([,value]) => value != null && value !== '')); return request(`/v1/me/research-topics/${encodeURIComponent(id)}/quality-samples?${params}`, { ...options, auth: true }); },
    generateResearchTopicQualitySamples: (id, body = {}, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/quality-samples/generate`, { ...options, method: 'POST', body, auth: true }),
    reviewResearchTopicQualitySample: (id, sampleId, body, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/quality-samples/${encodeURIComponent(sampleId)}/reviews`, { ...options, method: 'POST', body, auth: true }),
    resolveResearchTopicQualityCorrection: (id, sampleId, body, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/quality-samples/${encodeURIComponent(sampleId)}/correction-resolution`, { ...options, method: 'POST', body, auth: true }),
    listResearchTopicDerivedMetrics: (id, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/derived-metrics`, { ...options, auth: true }),
    createResearchTopicDerivedMetric: (id, body, options) => request(`/v1/me/research-topics/${encodeURIComponent(id)}/derived-metrics`, { ...options, method: 'POST', body, auth: true }),
    evaluateResearchTopicDerivedMetric: (id, derivedId, query = {}, options) => { const params = new URLSearchParams(Object.entries({ from: query.from, to: query.to }).filter(([,value]) => value != null && value !== '')); return request(`/v1/me/research-topics/${encodeURIComponent(id)}/derived-metrics/${encodeURIComponent(derivedId)}/evaluation?${params}`, { ...options, auth: true }); },
    listChangeEvents: ({ unreadOnly = false, limit = 50 } = {}, options) => request(`/v1/me/change-events?${new URLSearchParams({ unreadOnly: String(Boolean(unreadOnly)), limit: String(limit) })}`, { ...options, auth: true }),
    markChangeEventRead: (id, options) => request(`/v1/me/change-events/${encodeURIComponent(id)}/read`, { ...options, method: 'POST', auth: true }),
    listWorkLeaderboards: (workId,options) => request(`/v1/works/${encodeURIComponent(workId)}/leaderboards`,options),
    readCompetitionLeaderboard: (workId,boardId,query={},options) => request(`/v1/works/${encodeURIComponent(workId)}/leaderboards/${encodeURIComponent(boardId)}?${new URLSearchParams(Object.entries(query).filter(([,value])=>value!=null))}`,{...options,auth:true}),
    listCompetitionModes: (session,options) => request('/v1/competition/modes',{...options,auth:true,headers:{'X-GameHub-Session':session}}),
    startCompetitionRun: (session,body,options) => request('/v1/competition/runs',{...options,auth:true,method:'POST',body,headers:{'X-GameHub-Session':session}}),
    getCompetitionRun: (session,id,options) => request('/v1/competition/runs/'+encodeURIComponent(id),{...options,auth:true,headers:{'X-GameHub-Session':session}}),
    finishCompetitionRun: (session,id,body,options) => request('/v1/competition/runs/'+encodeURIComponent(id)+'/finish',{...options,auth:true,method:'POST',body,headers:{'X-GameHub-Session':session}}),
    abandonCompetitionRun: (session,id,options) => request('/v1/competition/runs/'+encodeURIComponent(id)+'/abandon',{...options,auth:true,method:'POST',headers:{'X-GameHub-Session':session}}),
    listWorks: ({ limit = 20, kind, q, offset, openSource, remixable, claimable, runtime, source } = {}, options) => request(`/v1/works?limit=${limit}${kind ? `&kind=${encodeURIComponent(kind)}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}${offset ? `&offset=${encodeURIComponent(offset)}` : ''}${openSource ? '&openSource=true' : ''}${remixable ? '&remixable=true' : ''}${claimable ? '&claimable=true' : ''}${runtime ? `&runtime=${encodeURIComponent(runtime)}` : ''}${source ? `&source=${encodeURIComponent(source)}` : ''}`, options),
    listDiscoveryCampaigns: (limit = 3, options) => request(`/v1/discovery/campaigns?limit=${encodeURIComponent(limit)}`, options),
    getDiscoveryCampaign: (slug, options) => request(`/v1/discovery/campaigns/${encodeURIComponent(slug)}`, options),
    discoveryCampaignShareCardUrl: (slug, { download = false, version, locale } = {}) => {
      const query = new URLSearchParams({ ...(version ? { v: String(version) } : {}), ...(locale ? { lang: locale } : {}), ...(download ? { download: '1' } : {}) });
      return `/v1/discovery/campaigns/${encodeURIComponent(slug)}/share-card.png${query.size ? `?${query}` : ''}`;
    },
    listAdminDiscoveryCampaigns: options => request('/v1/admin/discovery-campaigns', { ...options, auth: true }),
    createDiscoveryCampaign: (body, options) => request('/v1/admin/discovery-campaigns', { ...options, method: 'POST', body, auth: true }),
    updateDiscoveryCampaign: (campaignId, body, options) => request(`/v1/admin/discovery-campaigns/${encodeURIComponent(campaignId)}`, { ...options, method: 'PATCH', body, auth: true }),
    getWork: (id, options) => request(`/v1/works/${encodeURIComponent(id)}`, options),
    workShareCardUrl: (id, { download = false, version, locale } = {}) => {
      const query = new URLSearchParams({ ...(version ? { v: String(version) } : {}), ...(locale ? { lang: locale } : {}), ...(download ? { download: '1' } : {}) });
      return `${baseUrl}/v1/works/${encodeURIComponent(id)}/share-card.png${query.size ? `?${query}` : ''}`;
    },
    workXhsPromoUrl: (id, slide, { download = false, version } = {}) => {
      const query = new URLSearchParams({ ...(version ? { v: String(version) } : {}), ...(download ? { download: '1' } : {}) });
      return `${baseUrl}/v1/works/${encodeURIComponent(id)}/promo/xhs/${encodeURIComponent(slide)}.png${query.size ? `?${query}` : ''}`;
    },
    getWorkLeaderboard: (id, {date,puzzleId,limit=10,offset=0}={}, options) => request(`/v1/works/${encodeURIComponent(id)}/leaderboard?${new URLSearchParams({limit,offset,...(date?{date}:{}),...(puzzleId?{puzzleId}:{})})}`, {...options,auth:true}),
    getLaunch: (id, releaseId, options) => request(`/v1/works/${encodeURIComponent(id)}/launch${releaseId ? `?releaseId=${encodeURIComponent(releaseId)}` : ''}`, options),
    releaseDownloadUrl: (workId, releaseId) => `${baseUrl}/v1/works/${encodeURIComponent(workId)}/releases/${encodeURIComponent(releaseId)}/download`,
    trackAnalytics: (events, options) => request('/v1/analytics/events', { ...options, method: 'POST', body: { events }, auth: true, keepalive: true }),
    getAdminAnalytics: (days = 7, options) => request(`/v1/admin/analytics?days=${encodeURIComponent(days)}`, { ...options, auth: true }),
    getCreatorAnalytics: (days = 30, options) => request(`/v1/creator/analytics?days=${encodeURIComponent(days)}`, { ...options, auth: true }),
    getSaveHealth: ({admin=false,afterWorkId}={}) => request((admin?'/v1/admin/save-operations/health':'/v1/creator/save-health')+(afterWorkId?'?afterWorkId='+encodeURIComponent(afterWorkId):''),{auth:true}),
    getSaveCapacity: () => request('/v1/admin/save-operations/capacity',{auth:true}),
    setSaveCapacity: input => request('/v1/admin/save-operations/capacity',{auth:true,method:'PATCH',body:input}),
    pauseSavePolicy: (policyId,input) => request('/v1/admin/save-operations/policies/'+encodeURIComponent(policyId),{auth:true,method:'PATCH',body:input}),
    maintainGameSaves: (workId,input) => request('/v1/admin/save-operations/works/'+encodeURIComponent(workId)+'/maintenance',{auth:true,method:'POST',body:input}),
    getSaveAdminAudit: () => request('/v1/admin/save-operations/audit',{auth:true}),
    getAdminStorage: options => request('/v1/admin/storage', { ...options, auth: true }),
    createGameShare: (gameSessionId,body,options) => request('/v1/game-shares',{...options,method:'POST',auth:true,body,headers:{'X-GameHub-Session':gameSessionId}}),
    getGameShare: (code,options) => request('/v1/game-shares/'+encodeURIComponent(code),options),
    revokeGameShare: (code,options) => request('/v1/game-shares/'+encodeURIComponent(code),{...options,method:'DELETE',auth:true}),
    createGameSession: (body, options) => request('/v1/game-sessions', { ...options, method: 'POST', body, auth: true }),
    getGameSession: (gameSessionId, options) => request('/v1/game-sessions/current', { ...options, auth: true, headers: { 'X-GameHub-Session': gameSessionId } }),
    revokeGameSession: (gameSessionId, options) => request('/v1/game-sessions/current', { ...options, method: 'DELETE', auth: true, headers: { 'X-GameHub-Session': gameSessionId } }),
    listSaveLibrary: (afterSlotId,options) => request('/v1/me/save-library'+(afterSlotId?'?afterSlotId='+encodeURIComponent(afterSlotId):''),{...options,auth:true}),
    getSaveLibraryHistory: (slotId,beforeRevision,options) => request('/v1/me/save-library/'+encodeURIComponent(slotId)+'/history'+(beforeRevision?'?beforeRevision='+encodeURIComponent(beforeRevision):''),{...options,auth:true}),
    readSaveLibraryRevision: (slotId,revisionId,expectedEtag,options) => request('/v1/me/save-library/'+encodeURIComponent(slotId)+'/revisions/'+encodeURIComponent(revisionId)+'/content',{
      ...options,auth:true,responseBytesLimit:1048576,headers:{'If-Match':expectedEtag,Accept:'application/octet-stream, application/json'},
    }),
    restoreSaveLibraryRevision: (slotId,input,options) => request('/v1/me/save-library/'+encodeURIComponent(slotId)+'/restore',{
      ...options,auth:true,method:'POST',body:{revisionId:input.revisionId},headers:saveConditions(input),
    }),
    getGameSavePolicy: (scope,options) => request('/v1/works/'+encodeURIComponent(scope.workId)+'/save-policy?namespace='+encodeURIComponent(scope.namespace),saveOptions(scope,options)),
    listGameSaves: (scope,options) => request(savePath(scope),saveOptions(scope,options)),
    getGameSaveMetadata: (scope,options) => request(savePath(scope,'/metadata'),saveOptions(scope,options)),
    readGameSave: (scope,expectedEtag,options) => request(savePath(scope,'/content'),{
      ...saveOptions(scope,options),responseBytesLimit:1048576,
      headers:{'X-GameHub-Session':scope.gameSessionId,'If-Match':expectedEtag,Accept:'application/octet-stream, application/json'},
    }),
    getGameSaveWriteReceipt: (scope,input,options) => request(savePath(scope,'/write-receipt'),{
      ...saveOptions(scope,options),method:'POST',body:{schemaVersion:input.schemaVersion,contentType:input.contentType,sha256:input.sha256},
      headers:{'X-GameHub-Session':scope.gameSessionId,...saveConditions(input)},
    }),
    writeGameSave: (scope,input,options) => request(savePath(scope),{
      ...saveOptions(scope,options),method:'PUT',rawBody:input.bytes,
      headers:{'X-GameHub-Session':scope.gameSessionId,...saveConditions(input),'Content-Type':input.contentType,'X-GameHub-Save-Schema':String(input.schemaVersion),'X-Content-SHA256':input.sha256},
    }),
    deleteGameSave: (scope,input,options) => request(savePath(scope),{
      ...saveOptions(scope,options),method:'DELETE',headers:{'X-GameHub-Session':scope.gameSessionId,...saveConditions(input)},
    }),
    listGameSaveHistory: (scope,beforeRevision,options) => request(savePath(scope,'/history')+(beforeRevision?'&beforeRevision='+encodeURIComponent(beforeRevision):''),saveOptions(scope,options)),
    restoreGameSave: (scope,input,options) => request(savePath(scope,'/restore'),{
      ...saveOptions(scope,options),method:'POST',body:{revisionId:input.revisionId},headers:{'X-GameHub-Session':scope.gameSessionId,...saveConditions(input)},
    }),
    createRealtimeTicket: options => request('/v1/realtime/tickets', { ...options, method: 'POST', auth: true }),
    listMultiplayerModes: (workId, options) => request(`/v1/works/${encodeURIComponent(workId)}/multiplayer-modes`, options),
    createMultiplayerMode: (body, options) => request('/v1/admin/multiplayer/modes', { ...options, method: 'POST', body, auth: true }),
    listMultiplayerRooms: (modeId, limit = 30, query = '', options) => request(`/v1/multiplayer/rooms?modeId=${encodeURIComponent(modeId)}&limit=${encodeURIComponent(limit)}${query ? `&query=${encodeURIComponent(query)}` : ''}`, options),
    createMultiplayerRoom: (body, options) => request('/v1/multiplayer/rooms', { ...options, method: 'POST', body, auth: true, idempotent: true }),
    getMultiplayerRoom: (roomId, options) => request(`/v1/multiplayer/rooms/${encodeURIComponent(roomId)}`, { ...options, auth: true }),
    joinMultiplayerRoom: (roomId, joinCode, options) => request(`/v1/multiplayer/rooms/${encodeURIComponent(roomId)}/join`, { ...options, method: 'POST', body: joinCode ? { joinCode } : {}, auth: true }),
    joinMultiplayerRoomScoped: (roomId, modeId, joinCode, options) => request(`/v1/multiplayer/rooms/${encodeURIComponent(roomId)}/join`, { ...options, method: 'POST', body: { modeId,...(joinCode ? { joinCode } : {}) }, auth: true }),
    createMultiplayerInvite: (roomId, options) => request(`/v1/multiplayer/rooms/${encodeURIComponent(roomId)}/invite`, { ...options, method: 'POST', auth: true }),
    leaveMultiplayerRoom: (roomId, options) => request(`/v1/multiplayer/rooms/${encodeURIComponent(roomId)}/leave`, { ...options, method: 'POST', auth: true }),
    setMultiplayerReady: (roomId, ready, options) => request(`/v1/multiplayer/rooms/${encodeURIComponent(roomId)}/ready`, { ...options, method: 'POST', body: { ready }, auth: true }),
    startMultiplayerRoom: (roomId, options) => request(`/v1/multiplayer/rooms/${encodeURIComponent(roomId)}/start`, { ...options, method: 'POST', auth: true, idempotent: true }),
    getMultiplayerMatch: (matchId, options) => request(`/v1/multiplayer/matches/${encodeURIComponent(matchId)}`, { ...options, auth: true }),
    listMultiplayerMatchEvents: (matchId, afterSeq = 0, limit = 100, options) => request(`/v1/multiplayer/matches/${encodeURIComponent(matchId)}/events?afterSeq=${encodeURIComponent(afterSeq)}&limit=${encodeURIComponent(limit)}`, { ...options, auth: true }),
    getMultiplayerReplay: (matchId, options) => request(`/v1/multiplayer/matches/${encodeURIComponent(matchId)}/replay`, { ...options, auth: true }),
    getAdminMultiplayerOverview: options => request('/v1/admin/multiplayer/overview', { ...options, auth: true }),
    listAdminMultiplayerMatches: (status = 'all', limit = 50, options) => request(`/v1/admin/multiplayer/matches?status=${encodeURIComponent(status)}&limit=${encodeURIComponent(limit)}`, { ...options, auth: true }),
    abortAdminMultiplayerMatch: (matchId, reason, options) => request(`/v1/admin/multiplayer/matches/${encodeURIComponent(matchId)}/abort`, { ...options, method: 'POST',body: { reason },auth: true }),
    listAdminMultiplayerAudit: (limit = 50, options) => request(`/v1/admin/multiplayer/audit?limit=${encodeURIComponent(limit)}`, { ...options, auth: true }),
    createMultiplayerRuleSubmission: (workId, body, options) => request(`/v1/creator/works/${encodeURIComponent(workId)}/multiplayer-rule-submissions`, { ...options,method: 'POST',body,auth: true,idempotent: true }),
    listMultiplayerRuleSubmissions: (workId, options) => request(`/v1/creator/works/${encodeURIComponent(workId)}/multiplayer-rule-submissions`, { ...options,auth: true }),
    getMultiplayerRuleSubmission: (submissionId, options) => request(`/v1/creator/multiplayer-rule-submissions/${encodeURIComponent(submissionId)}`, { ...options,auth: true }),
    createMultiplayerRuleUploadGrant: (submissionId, options) => request(`/v1/creator/multiplayer-rule-submissions/${encodeURIComponent(submissionId)}/grant`, { ...options,method: 'POST',auth: true }),
    uploadMultiplayerRulePackage(submissionId, file, grantToken, { signal,onProgress = () => {} } = {}) {
      return new Promise((resolve,reject) => {
        const xhr = xhrFactory();
        const fail = () => reject(new ApiError({ code: 'UPLOAD_INTERRUPTED',message: '规则源码包上传中断；请刷新提交状态后再决定是否重试。' }));
        xhr.open('PUT',`${baseUrl}/v1/creator/multiplayer-rule-submissions/${encodeURIComponent(submissionId)}/package`);
        xhr.timeout = 10 * 60 * 1000;
        xhr.setRequestHeader('Authorization',`Upload ${grantToken}`);
        xhr.setRequestHeader('Content-Type','application/zip');
        xhr.upload.onprogress = event => event.lengthComputable && onProgress({ loaded: event.loaded,total: event.total,percent: Math.round(event.loaded / event.total * 100) });
        xhr.onerror = fail;
        xhr.ontimeout = () => reject(new ApiError({ code: 'REQUEST_TIMEOUT',message: '规则源码包上传超时。' }));
        xhr.onabort = () => reject(new ApiError({ code: 'UPLOAD_CANCELLED',message: '本机已取消上传。',retryable: true }));
        xhr.onload = () => {
          let payload = {}; try { payload = JSON.parse(xhr.responseText || '{}'); } catch {}
          if (xhr.status < 200 || xhr.status >= 300) reject(new ApiError({ status: xhr.status,...(payload.error ?? {}),message: payload.error?.message ?? `上传失败 (${xhr.status})` }));
          else resolve({ data: payload.data });
        };
        const abort = () => xhr.abort(); signal?.addEventListener('abort',abort,{ once: true }); xhr.onloadend = () => signal?.removeEventListener('abort',abort); xhr.send(file);
      });
    },
    submitMultiplayerRuleSubmission: (submissionId, options) => request(`/v1/creator/multiplayer-rule-submissions/${encodeURIComponent(submissionId)}/submit`, { ...options,method: 'POST',auth: true,idempotent: true }),
    listAdminMultiplayerRuleSubmissions: (state = 'queue',limit = 50,options) => request(`/v1/admin/multiplayer/rule-submissions?state=${encodeURIComponent(state)}&limit=${encodeURIComponent(limit)}`, { ...options,auth: true }),
    getAdminMultiplayerRuleSubmission: (submissionId,options) => request(`/v1/admin/multiplayer/rule-submissions/${encodeURIComponent(submissionId)}`, { ...options,auth: true }),
    reviewAdminMultiplayerRuleSubmission: (submissionId,body,options) => request(`/v1/admin/multiplayer/rule-submissions/${encodeURIComponent(submissionId)}/review`, { ...options,method: 'POST',body,auth: true }),
    downloadAdminMultiplayerRulePackage: (submissionId,options) => authenticatedDownload(`/v1/admin/multiplayer/rule-submissions/${encodeURIComponent(submissionId)}/package`,options),
    downloadAdminMultiplayerRuleBuild: (buildId,options) => authenticatedDownload(`/v1/admin/multiplayer/rule-builds/${encodeURIComponent(buildId)}/package`,{ ...options,accept: 'application/javascript' }),
    createChallenge: (body, options) => request('/v1/auth/email/challenges', { ...options, method: 'POST', body }),
    verifyChallenge: (body, options) => request('/v1/auth/email/verify', { ...options, method: 'POST', body }),
    startGitHubDevice: (body, options) => request('/v1/auth/github/device', { ...options, method: 'POST', body }),
    pollGitHubDevice: (challengeId, options) => request(`/v1/auth/github/device/${encodeURIComponent(challengeId)}/poll`, { ...options, method: 'POST' }),
    startGitHubWeb: (body, options) => request('/v1/auth/github/web', { ...options, method: 'POST', body }),
    pollGitHubWeb: (challengeId, options) => request(`/v1/auth/github/web/${encodeURIComponent(challengeId)}/poll`, { ...options, method: 'POST' }),
    getProfile: options => request('/v1/me', { ...options, auth: true }),
    bootstrapSession: (refreshToken, options) => request('/v1/auth/session', {
      ...options, method: 'POST', body: { ...(refreshToken ? { refreshToken } : {}) }, auth: true, allowRefresh: false,
    }),
    getCreatorApplication: options => request('/v1/me/creator-application', { ...options, auth: true }),
    applyForCreator: (statement, options) => request('/v1/me/creator-application', { ...options, method: 'POST', body: { statement }, auth: true }),
    listCreatorApplications: (status = 'pending', options) => request(`/v1/admin/creator-applications?status=${encodeURIComponent(status)}`, { ...options, auth: true }),
    decideCreatorApplication: (applicationId, body, options) => request(`/v1/admin/creator-applications/${encodeURIComponent(applicationId)}/decision`, { ...options, method: 'POST', body, auth: true }),
    updateProfile: (body, options) => request('/v1/me', { ...options, method: 'PATCH', body, auth: true }),
    selectAvatar: (presetKey, options) => request('/v1/me/avatar', { ...options, method: 'PATCH', body: { presetKey }, auth: true }),
    uploadAvatar: (file, options) => request('/v1/me/avatar', { ...options, method: 'PUT', rawBody: file, headers: { 'Content-Type': file.type, ...(options?.headers ?? {}) }, auth: true }),
    avatarUrl: (avatar, variant = 'animated') => { const path = variant === 'static' ? avatar?.staticUrl : avatar?.url; return path ? `${baseUrl}${path}` : null; },
    listLibrary: ({limit,recent,...options}={}) => request('/v1/me/library'+(limit||recent?'?'+new URLSearchParams({...limit?{limit}:{},...recent?{recent:'true'}:{}}):''), { ...options, auth: true }),
    getLibraryState: (workId, options) => request(`/v1/me/library/${encodeURIComponent(workId)}`, { ...options, auth: true }),
    saveToLibrary: (workId, options) => request(`/v1/me/library/${encodeURIComponent(workId)}`, { ...options, method: 'PUT', auth: true }),
    removeFromLibrary: (workId, options) => request(`/v1/me/library/${encodeURIComponent(workId)}`, { ...options, method: 'DELETE', auth: true }),
    recordPlay: (workId, options) => request(`/v1/me/recent/${encodeURIComponent(workId)}`, { ...options, method: 'POST', auth: true }),
    getGuessBaikeDaily: options => request('/v1/games/guess-baike/daily', options),
    saveGuessBaikeResult: (body, options) => request('/v1/games/guess-baike/results', { ...options, method: 'POST', body, auth: true }),
    listAdminGuessBaikePuzzles: options => request('/v1/admin/games/guess-baike/puzzles', { ...options, auth: true }),
    getGuessBaikeAutomationStatus: options => request('/v1/admin/games/guess-baike/automation', { ...options, auth: true }),
    updateAdminGuessBaikePuzzle: (puzzleId, status, options) => request(`/v1/admin/games/guess-baike/puzzles/${encodeURIComponent(puzzleId)}`, { ...options, method: 'PATCH', body: { status }, auth: true }),
    scheduleGuessBaikePuzzle: (date, puzzleId, options) => request('/v1/admin/games/guess-baike/schedule', { ...options, method: 'PUT', body: { date, puzzleId }, auth: true }),
    getSocialProfile: options => request('/v1/me/social', { ...options, auth: true }),
    updateSocialProfile: (body, options) => request('/v1/me/social', { ...options, method: 'PATCH', body, auth: true }),
    getPublicUserProfile: (handle, options) => request(`/v1/profiles/${encodeURIComponent(handle)}`, { ...options, auth: true }),
    updatePublicUserProfile: (body, options) => request('/v1/me/public-profile', { ...options, method: 'PATCH', body, auth: true }),
    getPublicProfile: (userId, options) => request(`/v1/users/${encodeURIComponent(userId)}`, { ...options, auth: true }),
    followUser: (userId, options) => request(`/v1/users/${encodeURIComponent(userId)}/follow`, { ...options, method: 'PUT', auth: true }),
    unfollowUser: (userId, options) => request(`/v1/users/${encodeURIComponent(userId)}/follow`, { ...options, method: 'DELETE', auth: true }),
    blockUser: (userId, options) => request(`/v1/users/${encodeURIComponent(userId)}/block`, { ...options, method: 'PUT', auth: true }),
    unblockUser: (userId, options) => request(`/v1/users/${encodeURIComponent(userId)}/block`, { ...options, method: 'DELETE', auth: true }),
    getGuessBaikeLeaderboard: (date, scope = 'global', options) => request(`/v1/games/guess-baike/leaderboard?date=${encodeURIComponent(date)}&scope=${encodeURIComponent(scope)}`, { ...options, auth: true }),
    reactToGuessBaikeResult: (userId, body, options) => request(`/v1/games/guess-baike/reactions/${encodeURIComponent(userId)}`, { ...options, method: 'PUT', body, auth: true }),
    removeGuessBaikeReaction: (userId, puzzleDate, options) => request(`/v1/games/guess-baike/reactions/${encodeURIComponent(userId)}`, { ...options, method: 'DELETE', body: { puzzleDate }, auth: true }),
    listSocialNotifications: options => request('/v1/me/notifications', { ...options, auth: true }),
    markSocialNotificationsRead: options => request('/v1/me/notifications/read', { ...options, method: 'POST', auth: true }),
    createGuessBaikeChallenge: (puzzleDate, options) => request('/v1/games/guess-baike/challenges', { ...options, method: 'POST', body: { puzzleDate }, auth: true }),
    getGuessBaikeChallenge: (code, options) => request(`/v1/challenges/${encodeURIComponent(code)}`, { ...options, auth: true }),
    acceptGuessBaikeChallenge: (code, options) => request(`/v1/challenges/${encodeURIComponent(code)}/accept`, { ...options, method: 'POST', auth: true }),
    completeGuessBaikeChallenge: (code, options) => request(`/v1/challenges/${encodeURIComponent(code)}/complete`, { ...options, method: 'POST', auth: true }),
    listGuessBaikeChallenges: options => request('/v1/me/challenges', { ...options, auth: true }),
    getPlayerRetention: options => request('/v1/me/retention', { ...options, auth: true }),
    getNotificationPreferences: options => request('/v1/me/notification-preferences', { ...options, auth: true }),
    updateNotificationPreferences: (body, options) => request('/v1/me/notification-preferences', { ...options, method: 'PUT', body, auth: true }),
    reportWork: (workId, body, options) => request(`/v1/works/${encodeURIComponent(workId)}/reports`, { ...options, method: 'POST', body, auth: true }),
    getPublicProjectClaim: (workId, options) => request(`/v1/works/${encodeURIComponent(workId)}/claim`, options),
    createProjectClaim: (workId, body, options) => request(`/v1/works/${encodeURIComponent(workId)}/claims`, { ...options, method: 'POST', body, auth: true }),
    listMyProjectClaims: (status = 'all', limit = 50, options) => request(`/v1/me/project-claims?status=${encodeURIComponent(status)}&limit=${encodeURIComponent(limit)}`, { ...options, auth: true }),
    cancelProjectClaim: (claimId, options) => request(`/v1/project-claims/${encodeURIComponent(claimId)}/cancel`, { ...options, method: 'POST', auth: true }),
    listAdminProjectClaims: (status = 'pending', limit = 50, options) => request(`/v1/admin/project-claims?status=${encodeURIComponent(status)}&limit=${encodeURIComponent(limit)}`, { ...options, auth: true }),
    listAdminProjectClaimEvents: (claimId, options) => request(`/v1/admin/project-claims/${encodeURIComponent(claimId)}/events`, { ...options, auth: true }),
    listAdminWorkProvenance: (limit = 50, options) => request(`/v1/admin/work-provenance?limit=${encodeURIComponent(limit)}`, { ...options, auth: true }),
    listAdminWorkProvenanceEvents: (workId, options) => request(`/v1/admin/works/${encodeURIComponent(workId)}/provenance-events`, { ...options, auth: true }),
    updateAdminWorkProvenance: (workId, body, options) => request(`/v1/admin/works/${encodeURIComponent(workId)}/provenance`, { ...options, method: 'PATCH', body, auth: true }),
    listAuthorOutreach: (status = 'all', options) => request(`/v1/admin/author-outreach?status=${encodeURIComponent(status)}&limit=100`, { ...options, auth: true }),
    syncAuthorOutreach: options => request('/v1/admin/author-outreach/sync', { ...options, method: 'POST', auth: true }),
    updateAuthorOutreach: (outreachId, body, options) => request(`/v1/admin/author-outreach/${encodeURIComponent(outreachId)}`, { ...options, method: 'PATCH', body, auth: true }),
    listAuthorOutreachEvents: (outreachId, options) => request(`/v1/admin/author-outreach/${encodeURIComponent(outreachId)}/events`, { ...options, auth: true }),
    decideProjectClaim: (claimId, body, options) => request(`/v1/admin/project-claims/${encodeURIComponent(claimId)}/decision`, { ...options, method: 'POST', body, auth: true }),
    createCreatorFeedback: (workId, body, options) => request(`/v1/works/${encodeURIComponent(workId)}/feedback`, { ...options, method: 'POST', body, auth: true }),
    listCreatorFeedback: (status = 'all', options) => request(`/v1/creator/feedback?status=${encodeURIComponent(status)}`, { ...options, auth: true }),
    createCreatorFeedbackIssueDraft: (feedbackId, options) => request(`/v1/creator/feedback/${encodeURIComponent(feedbackId)}/issue-draft`, { ...options, method: 'POST', auth: true }),
    updateCreatorFeedback: (feedbackId, body, options) => request(`/v1/creator/feedback/${encodeURIComponent(feedbackId)}`, { ...options, method: 'PATCH', body, auth: true }),
    createContributionTaskFromFeedback: (feedbackId, body, options) => request(`/v1/creator/feedback/${encodeURIComponent(feedbackId)}/contribution-task`, { ...options, method: 'POST', body, auth: true }),
    listCreatorContributionTasks: (limit = 50, options = {}) => request(`/v1/creator/contribution-tasks?limit=${encodeURIComponent(limit)}${options.offset ? '&offset='+encodeURIComponent(options.offset) : ''}`, { ...options, auth: true }),
    updateCreatorContributionTask: (taskId, body, options) => request(`/v1/creator/contribution-tasks/${encodeURIComponent(taskId)}`, { ...options, method: 'PATCH', body, auth: true }),
    createContributionIssueDraft: (taskId, options) => request(`/v1/creator/contribution-tasks/${encodeURIComponent(taskId)}/issue-draft`, { ...options, method: 'POST', auth: true }),
    listContributionTasks: (status = 'all', limit = 50, options = {}) => request(`/v1/contribution-tasks?status=${encodeURIComponent(status)}&limit=${encodeURIComponent(limit)}${options.offset ? '&offset='+encodeURIComponent(options.offset) : ''}${options.mine ? '&mine=true' : ''}${options.projectId ? '&projectId='+encodeURIComponent(options.projectId) : ''}${options.standalone ? '&standalone=true' : ''}`, { ...options, auth: true }),
    claimContributionTask: (taskId, options) => request(`/v1/contribution-tasks/${encodeURIComponent(taskId)}/claim`, { ...options, method: 'POST', auth: true }),
    releaseContributionTask: (taskId, options) => request(`/v1/contribution-tasks/${encodeURIComponent(taskId)}/release`, { ...options, method: 'POST', auth: true }),
    getContributionTask: (id, options) => request('/v1/contribution-tasks/'+encodeURIComponent(id), { ...options, auth:true }),
    renewContributionTask: (id, options) => request('/v1/contribution-tasks/'+encodeURIComponent(id)+'/renew', { ...options, method:'POST', auth:true }),
    withdrawContributionTask: (id, options) => request('/v1/contribution-tasks/'+encodeURIComponent(id)+'/withdraw', { ...options, method:'POST', auth:true }),
    listContributionNotifications: (limit=21, offset=0, options) => request('/v1/contribution-notifications?limit='+limit+'&offset='+offset, { ...options, auth:true }),
    readContributionNotification: (id, options) => request('/v1/contribution-notifications/'+encodeURIComponent(id)+'/read', { ...options, method:'POST', auth:true }),
    submitContributionTask: (taskId, body, options) => request(`/v1/contribution-tasks/${encodeURIComponent(taskId)}/submission`, { ...options, method: 'POST', body, auth: true }),
    listReports: (status = 'open', options) => request(`/v1/admin/reports?status=${encodeURIComponent(status)}`, { ...options, auth: true }),
    decideReport: (reportId, body, options) => request(`/v1/admin/reports/${encodeURIComponent(reportId)}/decision`, { ...options, method: 'POST', body, auth: true }),
    listModerationAudit: options => request('/v1/admin/audit', { ...options, auth: true }),
    listDevices: options => request('/v1/me/devices', { ...options, auth: true }),
    revokeDevice: (grantId, options) => request(`/v1/me/devices/${encodeURIComponent(grantId)}`, { ...options, method: 'DELETE', auth: true }),
    logoutOthers: options => request('/v1/auth/devices/logout-others', { ...options, method: 'POST', auth: true }),
    logoutAll: options => request('/v1/auth/devices/logout-all', { ...options, method: 'POST', auth: true }),
    logout: options => request('/v1/auth/device/logout', { ...options, method: 'POST', auth: true }),
    listCreatorWorks: options => request('/v1/creator/works', { ...options, auth: true }),
    listCreatorDrafts: (studio, options) => request(`/v1/creator/drafts${studio ? `?studio=${encodeURIComponent(studio)}` : ''}`, { ...options, auth: true }),
    createCreatorDraft: (body, options) => request('/v1/creator/drafts', { ...options, method: 'POST', body, auth: true, idempotent: true }),
    getCreatorDraft: (draftId, options) => request(`/v1/creator/drafts/${encodeURIComponent(draftId)}`, { ...options, auth: true }),
    previewCreatorDraft: (draftId, options) => request(`/v1/creator/drafts/${encodeURIComponent(draftId)}/preview`, { ...options, auth: true }),
    updateCreatorDraft: (draftId, body, revision, options) => request(`/v1/creator/drafts/${encodeURIComponent(draftId)}`, { ...options, method: 'PUT', body, auth: true, idempotent: true, headers: { 'If-Match': `"creator-draft-${draftId}-${revision}"`, ...(options?.headers ?? {}) } }),
    buildCreatorDraft: (draftId, body, revision, options) => request(`/v1/creator/drafts/${encodeURIComponent(draftId)}/builds`, { ...options, method: 'POST', body, auth: true, idempotent: true, headers: { 'If-Match': `"creator-draft-${draftId}-${revision}"`, ...(options?.headers ?? {}) } }),
    startGitHubSourceInstall: options => request('/v1/creator/source-connections/github/install', { ...options, method: 'POST', auth: true }),
    completeGitHubSourceInstall: (body, options) => request('/v1/creator/source-connections/github/complete', { ...options, method: 'POST', body, auth: true }),
    listGitHubSourceConnections: options => request('/v1/creator/source-connections', { ...options, auth: true }),
    disconnectGitHubSourceConnection: (connectionId, options) => request(`/v1/creator/source-connections/${encodeURIComponent(connectionId)}`, { ...options, method: 'DELETE', auth: true }),
    listGitHubSourceRepositories: (connectionId, options) => request(`/v1/creator/source-connections/${encodeURIComponent(connectionId)}/repositories`, { ...options, auth: true }),
    previewGitHubSourceImport: (body, options) => request('/v1/creator/source-imports/preview', { ...options, method: 'POST', body, auth: true }),
    createGitHubImportedDraft: (body, options) => request('/v1/creator/source-imports/drafts', { ...options, method: 'POST', body, auth: true, idempotent: true }),
    getWorkSource: (workId, options) => request(`/v1/creator/works/${encodeURIComponent(workId)}/source`, { ...options, auth: true }),
    createSourceBuild: (workId, body, options) => request(`/v1/creator/works/${encodeURIComponent(workId)}/builds`, { ...options, method: 'POST', body, auth: true, idempotent: true }),
    listSourceBuilds: (workId, options) => request(`/v1/creator/works/${encodeURIComponent(workId)}/builds`, { ...options, auth: true }),
    getSourceBuild: (workId, buildId, options) => request(`/v1/creator/works/${encodeURIComponent(workId)}/builds/${encodeURIComponent(buildId)}`, { ...options, auth: true }),
    publishSourceBuild: (workId, buildId, options) => request(`/v1/creator/works/${encodeURIComponent(workId)}/builds/${encodeURIComponent(buildId)}/publish`, { ...options, method: 'POST', auth: true }),
    getGitHubSourceAdminOverview: options => request('/v1/admin/source-imports/overview', { ...options, auth: true }),
    listGitHubSourceAudit: (limit = 50, options) => request(`/v1/admin/source-imports/audit?limit=${encodeURIComponent(limit)}`, { ...options, auth: true }),
    createWork: (body, options) => request('/v1/creator/works', { ...options, method: 'POST', body, auth: true, idempotent: true }),
    listWorkRemixes: (workId, options) => request(`/v1/works/${encodeURIComponent(workId)}/remixes`, options),
    listWorkTimeline: (workId, options) => request(`/v1/works/${encodeURIComponent(workId)}/timeline`, options),
    listDevelopmentEntries: (workId, options) => request(`/v1/creator/works/${encodeURIComponent(workId)}/development-entries`, { ...options, auth: true }),
    createDevelopmentEntry: (workId, body, options) => request(`/v1/creator/works/${encodeURIComponent(workId)}/development-entries`, { ...options, method: 'POST', body, auth: true }),
    updateDevelopmentEntry: (entryId, body, options) => request(`/v1/creator/development-entries/${encodeURIComponent(entryId)}`, { ...options, method: 'PATCH', body, auth: true }),
    updateWork: (workId, revision, body, options) => request(`/v1/creator/works/${encodeURIComponent(workId)}`, { ...options, method: 'PATCH', body, auth: true, idempotent: true, headers: { 'Idempotency-Key': randomKey(), ...(options?.headers ?? {}), 'If-Match': `"work-${workId}-${revision}"` } }),
    uploadWorkCover: (workId, file, options) => request(`/v1/creator/works/${encodeURIComponent(workId)}/cover`, { ...options, method: 'PUT', rawBody: file, headers: { 'Content-Type': file.type, ...(options?.headers ?? {}) }, auth: true }),
    listWorkReleases: (workId, options) => request(`/v1/creator/works/${encodeURIComponent(workId)}/releases`, { ...options, auth: true }),
    publishWorkRelease: (workId, releaseId, revision, options) => request(`/v1/creator/works/${encodeURIComponent(workId)}/releases/${encodeURIComponent(releaseId)}/publish`, { ...options,method:'POST',auth:true,idempotent:true,headers:{ 'If-Match':`"work-${workId}-${revision}"`,...(options?.headers??{}) } }),
    withdrawWork: (workId, revision, options) => request(`/v1/creator/works/${encodeURIComponent(workId)}/withdraw`, { ...options, method: 'POST', auth: true, idempotent: true, headers: { 'If-Match': `"work-${workId}-${revision}"`, ...(options?.headers ?? {}) } }),
    createUpload: (workId, body, options) => request(`/v1/creator/works/${encodeURIComponent(workId)}/uploads`, { ...options, method: 'POST', body, auth: true, idempotent: true }),
    createUploadGrant: (uploadId, options) => request(`/v1/creator/uploads/${encodeURIComponent(uploadId)}/grant`, { ...options, method: 'POST', auth: true }),
    uploadContent(uploadId, file, grantToken, { signal, onProgress = () => {} } = {}) {
      return new Promise((resolve, reject) => {
        const xhr = xhrFactory();
        const fail = () => reject(new ApiError({ code: 'UPLOAD_INTERRUPTED', message: '上传连接中断；请刷新任务状态后再决定是否重试。' }));
        xhr.open('PUT', `${baseUrl}/v1/creator/uploads/${encodeURIComponent(uploadId)}/content`);
        xhr.timeout = 30 * 60 * 1000;
        xhr.setRequestHeader('Authorization', `Upload ${grantToken}`);
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        xhr.upload.onprogress = event => event.lengthComputable && onProgress({ loaded: event.loaded, total: event.total, percent: Math.round(event.loaded / event.total * 100) });
        xhr.onerror = fail;
        xhr.ontimeout = () => reject(new ApiError({ code: 'REQUEST_TIMEOUT', message: '上传超时；任务状态仍需向服务端确认。' }));
        xhr.onabort = () => reject(new ApiError({ code: 'UPLOAD_CANCELLED', message: '本机传输已取消；已收到的临时字节不会被发布。', retryable: true }));
        xhr.onload = () => {
          let payload = {}; try { payload = JSON.parse(xhr.responseText || '{}'); } catch {}
          if (xhr.status < 200 || xhr.status >= 300) reject(new ApiError({ status: xhr.status, ...(payload.error ?? {}), message: payload.error?.message ?? `上传失败 (${xhr.status})` }));
          else resolve({ data: payload.data });
        };
        const abort = () => xhr.abort();
        signal?.addEventListener('abort', abort, { once: true });
        xhr.onloadend = () => signal?.removeEventListener('abort', abort);
        xhr.send(file);
      });
    },
    async uploadContentBytes(uploadId, bytes, grantToken, options = {}) {
      const response = await fetchImpl(`${baseUrl}/v1/creator/uploads/${encodeURIComponent(uploadId)}/content`, { method:'PUT',signal:options.signal,headers:{ Authorization:`Upload ${grantToken}`,'Content-Type':'application/octet-stream' },body:bytes });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new ApiError({ status:response.status,...(payload.error??{}),message:payload.error?.message??`上传失败 (${response.status})` });
      return { data:payload.data };
    },
    completeUpload: (uploadId, options) => request(`/v1/creator/uploads/${encodeURIComponent(uploadId)}/complete`, { ...options, method: 'POST', auth: true, idempotent: true }),
    getUpload: (id, options) => request(`/v1/creator/uploads/${encodeURIComponent(id)}`, { ...options, auth: true }),
  };
}
