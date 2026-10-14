// scripts/submit-creator-package.mjs
import fs5 from "node:fs/promises";
import path5 from "node:path";

// packages/platform-api-client/src/community.mjs
var segment = (value) => encodeURIComponent(value);
var query = (input) => {
  const params = new URLSearchParams(Object.entries(input).filter(([, v]) => v !== void 0 && v !== null && v !== ""));
  return params.size ? "?" + params.toString() : "";
};
var postPath = (id) => "/v1/community/posts/" + segment(id);
var mutation = (version, key) => ({ "If-Match": '"' + version + '"', "Idempotency-Key": key });
function communityApi(request) {
  return {
    communityCapabilities: (options) => request("/v1/community/capabilities", { ...options, auth: true }),
    communityList: ({ kind = "feed", ...filters } = {}, options) => request((kind === "feed" ? "/v1/community/posts" : "/v1/community/me/" + (kind === "mine" ? "posts" : "bookmarks")) + query(filters), { ...options, auth: true }),
    communityPost: (id, { manage = false, ...options } = {}) => request((manage ? "/v1/community/me/posts/" : "/v1/community/posts/") + segment(id), { ...options, auth: true }),
    communitySave: (id, body, { version, key, ...options }) => request(id ? postPath(id) : "/v1/community/posts", { ...options, method: id ? "PATCH" : "POST", body, auth: true, headers: mutation(version, key) }),
    communitySubmit: (post, { key, ...options }) => request(postPath(post.id) + "/submit", { ...options, method: "POST", auth: true, headers: mutation(post.version, key) }),
    communityWithdraw: (post, remove = false, options) => request(postPath(post.id) + (remove ? "" : "/withdraw"), { ...options, method: remove ? "DELETE" : "POST", auth: true, headers: { "If-Match": '"' + post.version + '"' } }),
    communityInteract: (id, type, active, options) => request(postPath(id) + "/" + segment(type), { ...options, method: active ? "PUT" : "DELETE", auth: true }),
    communityReport: (id, body, options) => request(postPath(id) + "/reports", { ...options, method: "POST", body, auth: true }),
    communityReview: ({ cursor, ...options } = {}) => request("/v1/admin/community/review" + query({ cursor }), { ...options, auth: true }),
    communityDecide: (post, body, { key, ...options }) => request("/v1/admin/community/posts/" + segment(post.id) + "/decisions", { ...options, method: "POST", body: { ...body, revisionId: post.revisionId }, auth: true, headers: mutation(post.version, key) }),
    communityMember: (userId, body, options) => request("/v1/admin/community/members/" + segment(userId), { ...options, method: "PUT", body, auth: true }),
    communityProjects: (filters = {}, options) => request("/v1/community/projects" + query(filters), { ...options, auth: true }),
    communityProject: (id, options) => request("/v1/community/projects/" + segment(id), { ...options, auth: true }),
    communityProjectCreate: (body, options) => request("/v1/community/projects", { ...options, method: "POST", body, auth: true }),
    communityProjectUpdate: (id, body, options) => request("/v1/community/projects/" + segment(id), { ...options, method: "PATCH", body, auth: true }),
    communityProjectApply: (id, body, options) => request("/v1/community/projects/" + segment(id) + "/applications", { ...options, method: "POST", body, auth: true }),
    communityProjectDecide: (id, applicationId, body, options) => request("/v1/community/projects/" + segment(id) + "/applications/" + segment(applicationId) + "/decision", { ...options, method: "POST", body, auth: true }),
    communityProjectLeave: (id, options) => request("/v1/community/projects/" + segment(id) + "/leave", { ...options, method: "POST", auth: true }),
    communityOverview: (options) => request("/v1/community/overview", { ...options, auth: true }),
    communityParticipation: (options) => request("/v1/community/me/participation", { ...options, auth: true }),
    communityParticipationNotificationRead: (id, options) => request("/v1/community/me/participation/notifications/" + segment(id) + "/read", { ...options, method: "POST", auth: true }),
    communityEvents: (filters = {}, options) => request("/v1/community/events" + query(filters), { ...options, auth: true }),
    communityEvent: (id, options) => request("/v1/community/events/" + segment(id), { ...options, auth: true }),
    communityEventCreate: (body, options) => request("/v1/community/events", { ...options, method: "POST", body, auth: true }),
    communityEventUpdate: (id, body, options) => request("/v1/community/events/" + segment(id), { ...options, method: "PATCH", body, auth: true }),
    communityEventRegister: (id, options) => request("/v1/community/events/" + segment(id) + "/register", { ...options, method: "POST", auth: true }),
    communityEventUnregister: (id, options) => request("/v1/community/events/" + segment(id) + "/unregister", { ...options, method: "POST", auth: true }),
    communityParties: (filters = {}, options) => request("/v1/community/parties" + query(filters), { ...options, auth: true }),
    communityParty: (id, options) => request("/v1/community/parties/" + segment(id), { ...options, auth: true }),
    communityPartyCreate: (body, options) => request("/v1/community/parties", { ...options, method: "POST", body, auth: true }),
    communityPartyJoin: (id, options) => request("/v1/community/parties/" + segment(id) + "/join", { ...options, method: "POST", auth: true }),
    communityPartyLeave: (id, options) => request("/v1/community/parties/" + segment(id) + "/leave", { ...options, method: "POST", auth: true }),
    communityPartyReady: (id, ready, options) => request("/v1/community/parties/" + segment(id) + "/ready", { ...options, method: "POST", body: { ready }, auth: true }),
    communityPartyStart: (id, options) => request("/v1/community/parties/" + segment(id) + "/start", { ...options, method: "POST", auth: true }),
    communityPartyFinish: (id, state, options) => request("/v1/community/parties/" + segment(id) + "/finish", { ...options, method: "POST", body: { state }, auth: true }),
    communityReserve: (postId, body, { key, ...options }) => request(postPath(postId) + "/media", { ...options, method: "POST", body, auth: true, headers: { "Idempotency-Key": key } }),
    communityUpload: (id, bytes, options) => request("/v1/community/media/" + segment(id) + "/content", { ...options, method: "PUT", auth: true, rawBody: bytes, headers: { "Content-Type": "application/octet-stream" } }),
    communityComplete: (id, options) => request("/v1/community/media/" + segment(id) + "/complete", { ...options, method: "POST", auth: true }),
    communityMediaStatus: (id, options) => request("/v1/community/me/media/" + segment(id), { ...options, auth: true }),
    async communityImage(id, { preview = false, variant = "display", ...options } = {}) {
      try {
        const result3 = await request("/v1/community/media/" + segment(id) + "/" + segment(variant) + query({ preview: preview || void 0 }), { ...options, auth: true, responseBytesLimit: variant === "thumb" ? 163840 : 1048576, headers: { Accept: "image/webp" } });
        if (result3.contentType !== "image/webp") throw new Error("\u56FE\u7247\u54CD\u5E94\u683C\u5F0F\u65E0\u6548\u3002");
        return { data: new Blob([result3.data], { type: "image/webp" }) };
      } catch (error) {
        if (error.code?.startsWith("SAVE_")) {
          error.code = "MEDIA_RESPONSE_INVALID";
          error.message = "\u56FE\u7247\u8D85\u8FC7\u4E0B\u8F7D\u9650\u5236\u6216\u65E0\u6CD5\u8BFB\u53D6\u3002";
        }
        throw error;
      }
    }
  };
}

// packages/platform-api-client/src/index.mjs
var ApiError = class extends Error {
  constructor({ code = "NETWORK_ERROR", message = "\u8BF7\u6C42\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002", status = 0, retryable = true, requestId = null, details = {} } = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.requestId = requestId;
    this.details = details && typeof details === "object" && !Array.isArray(details) ? details : {};
  }
};
async function readBoundedResponse(response, limit, signal) {
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 1048576) throw new TypeError("Invalid save response limit.");
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^[0-9]+$/u.test(declared) || Number(declared) > limit)) {
    response.body?.cancel?.().catch(() => {
    });
    throw new ApiError({ code: "SAVE_DOCUMENT_TOO_LARGE", message: "\u4E91\u5B58\u6863\u6B63\u6587\u8D85\u8FC7\u4E0B\u8F7D\u9650\u5236\u3002", retryable: false });
  }
  if (!response.body) return new Uint8Array(0);
  if (!response.body.getReader) throw new ApiError({ code: "SAVE_RESPONSE_INVALID", message: "\u5F53\u524D\u5BBF\u4E3B\u4E0D\u652F\u6301\u53D7\u9650\u5B58\u6863\u4E0B\u8F7D\u3002", retryable: false });
  const reader = response.body.getReader(), chunks = [];
  let length = 0, abort;
  const interrupted = new Promise((_, reject) => {
    abort = () => {
      reader.cancel().catch(() => {
      });
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const { done, value } = await Promise.race([reader.read(), interrupted]);
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new ApiError({ code: "SAVE_DOCUMENT_TOO_LARGE", message: "\u4E91\u5B58\u6863\u6B63\u6587\u8D85\u8FC7\u4E0B\u8F7D\u9650\u5236\u3002", retryable: false });
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.cancel().catch(() => {
    });
    reader.releaseLock();
  }
}
var savePath = (scope, suffix = "") => "/v1/me/game-saves/" + encodeURIComponent(scope.workId) + "/slots" + (scope.slotKey !== void 0 ? "/" + encodeURIComponent(scope.slotKey) : "") + suffix + "?namespace=" + encodeURIComponent(scope.namespace);
var saveOptions = (scope, options) => ({ ...options, auth: true, headers: { "X-GameHub-Session": scope.gameSessionId } });
var saveConditions = (input) => ({
  "Idempotency-Key": input.idempotencyKey,
  ...input.createOnly ? { "If-None-Match": "*" } : { "If-Match": input.expectedEtag }
});
var randomKey = () => globalThis.crypto?.randomUUID?.() ?? `gh-${Date.now()}-${Math.random().toString(16).slice(2)}`;
function createApiClient({ baseUrl = "", fetchImpl = globalThis.fetch, getAccessToken = () => null, getRefreshToken = () => null, setTokens = () => {
}, timeoutMs = 15e3, xhrFactory = () => new XMLHttpRequest() } = {}) {
  let refreshPromise = null;
  const refreshSession = (signal) => {
    if (!refreshPromise) {
      refreshPromise = (async () => {
        const refreshToken = await getRefreshToken();
        if (!refreshToken) return false;
        const refreshed = await request("/v1/auth/refresh", { method: "POST", body: { refreshToken }, signal, allowRefresh: false });
        await setTokens(refreshed.data);
        return true;
      })().finally(() => {
        refreshPromise = null;
      });
    }
    return refreshPromise;
  };
  async function request(path6, { method = "GET", body, rawBody, headers = {}, signal, auth = false, idempotent = false, allowRefresh = true, keepalive = false, beforeRequest, responseBytesLimit } = {}) {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new Error("timeout")), timeoutMs);
    const hasCombinedSignal = Boolean(globalThis.AbortSignal?.any);
    const combined = hasCombinedSignal ? AbortSignal.any([timeout.signal, ...signal ? [signal] : []]) : timeout.signal;
    const cancel = () => timeout.abort(signal?.reason);
    if (!hasCombinedSignal) signal?.addEventListener("abort", cancel, { once: true });
    try {
      const token = auth ? await getAccessToken() : null;
      await beforeRequest?.();
      if (combined.aborted || signal?.aborted) throw new ApiError({ code: "REQUEST_CANCELLED", message: "\u8BF7\u6C42\u5DF2\u53D6\u6D88\u3002", retryable: false });
      const response = await fetchImpl(`${baseUrl}${path6}`, {
        method,
        signal: combined,
        keepalive,
        headers: {
          Accept: "application/json",
          ...body != null ? { "Content-Type": "application/json" } : {},
          ...token ? { Authorization: `Bearer ${token}` } : {},
          ...idempotent ? { "Idempotency-Key": randomKey() } : {},
          ...headers
        },
        ...body != null ? { body: JSON.stringify(body) } : rawBody != null ? { body: rawBody } : {}
      });
      if (response.status === 401 && auth && allowRefresh) {
        const currentToken = await getAccessToken();
        if (token && currentToken && token !== currentToken) {
          return request(path6, { method, body, rawBody, headers, signal, auth, idempotent, allowRefresh: false, keepalive, beforeRequest, responseBytesLimit });
        }
        if (await refreshSession(signal)) return request(path6, { method, body, rawBody, headers, signal, auth, idempotent, allowRefresh: false, keepalive, beforeRequest, responseBytesLimit });
      }
      if (response.ok && responseBytesLimit !== void 0) {
        const bytes = await readBoundedResponse(response, responseBytesLimit, combined);
        return { data: bytes, etag: response.headers.get("etag"), sha256: response.headers.get("x-content-sha256"), schemaVersion: Number(response.headers.get("x-gamehub-save-schema")), contentType: response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() };
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new ApiError({ status: response.status, ...payload.error ?? {}, message: payload.error?.message ?? `\u8BF7\u6C42\u5931\u8D25 (${response.status})` });
      return { data: payload.data, etag: response.headers.get("etag") };
    } catch (error) {
      if (error instanceof ApiError || error?.code === "BRIDGE_ACCOUNT_CHANGED" || error?.code === "BRIDGE_CLOSED") throw error;
      if (signal?.aborted) throw new ApiError({ code: "REQUEST_CANCELLED", message: "\u8BF7\u6C42\u5DF2\u53D6\u6D88\u3002", retryable: false });
      if (error?.name === "AbortError" || timeout.signal.aborted) throw new ApiError({ code: "REQUEST_TIMEOUT", message: "\u8FDE\u63A5\u8D85\u65F6\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\u540E\u91CD\u8BD5\u3002" });
      throw new ApiError({ message: "\u6682\u65F6\u65E0\u6CD5\u8FDE\u63A5\u58A8\u9C7C\u5DE5\u574A\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002" });
    } finally {
      clearTimeout(timer);
      if (!hasCombinedSignal) signal?.removeEventListener("abort", cancel);
    }
  }
  async function authenticatedDownload(path6, options = {}) {
    const token = await getAccessToken();
    const response = await fetchImpl(`${baseUrl}${path6}`, { signal: options.signal, headers: { Accept: options.accept ?? "application/zip", ...token ? { Authorization: `Bearer ${token}` } : {} } });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new ApiError({ status: response.status, ...payload.error ?? {}, message: payload.error?.message ?? `\u4E0B\u8F7D\u5931\u8D25 (${response.status})` });
    }
    return { data: await response.blob(), digest: response.headers.get("digest") };
  }
  return {
    ...communityApi(request),
    listWorkLeaderboards: (workId, options) => request(`/v1/works/${encodeURIComponent(workId)}/leaderboards`, options),
    readCompetitionLeaderboard: (workId, boardId, query2 = {}, options) => request(`/v1/works/${encodeURIComponent(workId)}/leaderboards/${encodeURIComponent(boardId)}?${new URLSearchParams(Object.entries(query2).filter(([, value]) => value != null))}`, { ...options, auth: true }),
    listCompetitionModes: (session, options) => request("/v1/competition/modes", { ...options, auth: true, headers: { "X-GameHub-Session": session } }),
    startCompetitionRun: (session, body, options) => request("/v1/competition/runs", { ...options, auth: true, method: "POST", body, headers: { "X-GameHub-Session": session } }),
    getCompetitionRun: (session, id, options) => request("/v1/competition/runs/" + encodeURIComponent(id), { ...options, auth: true, headers: { "X-GameHub-Session": session } }),
    finishCompetitionRun: (session, id, body, options) => request("/v1/competition/runs/" + encodeURIComponent(id) + "/finish", { ...options, auth: true, method: "POST", body, headers: { "X-GameHub-Session": session } }),
    abandonCompetitionRun: (session, id, options) => request("/v1/competition/runs/" + encodeURIComponent(id) + "/abandon", { ...options, auth: true, method: "POST", headers: { "X-GameHub-Session": session } }),
    listWorks: ({ limit = 20, kind, q, offset, openSource, remixable, claimable, runtime, source } = {}, options) => request(`/v1/works?limit=${limit}${kind ? `&kind=${encodeURIComponent(kind)}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}${offset ? `&offset=${encodeURIComponent(offset)}` : ""}${openSource ? "&openSource=true" : ""}${remixable ? "&remixable=true" : ""}${claimable ? "&claimable=true" : ""}${runtime ? `&runtime=${encodeURIComponent(runtime)}` : ""}${source ? `&source=${encodeURIComponent(source)}` : ""}`, options),
    listDiscoveryCampaigns: (limit = 3, options) => request(`/v1/discovery/campaigns?limit=${encodeURIComponent(limit)}`, options),
    getDiscoveryCampaign: (slug, options) => request(`/v1/discovery/campaigns/${encodeURIComponent(slug)}`, options),
    discoveryCampaignShareCardUrl: (slug, { download = false, version, locale } = {}) => {
      const query2 = new URLSearchParams({ ...version ? { v: String(version) } : {}, ...locale ? { lang: locale } : {}, ...download ? { download: "1" } : {} });
      return `/v1/discovery/campaigns/${encodeURIComponent(slug)}/share-card.png${query2.size ? `?${query2}` : ""}`;
    },
    listAdminDiscoveryCampaigns: (options) => request("/v1/admin/discovery-campaigns", { ...options, auth: true }),
    createDiscoveryCampaign: (body, options) => request("/v1/admin/discovery-campaigns", { ...options, method: "POST", body, auth: true }),
    updateDiscoveryCampaign: (campaignId, body, options) => request(`/v1/admin/discovery-campaigns/${encodeURIComponent(campaignId)}`, { ...options, method: "PATCH", body, auth: true }),
    getWork: (id, options) => request(`/v1/works/${encodeURIComponent(id)}`, options),
    workShareCardUrl: (id, { download = false, version, locale } = {}) => {
      const query2 = new URLSearchParams({ ...version ? { v: String(version) } : {}, ...locale ? { lang: locale } : {}, ...download ? { download: "1" } : {} });
      return `${baseUrl}/v1/works/${encodeURIComponent(id)}/share-card.png${query2.size ? `?${query2}` : ""}`;
    },
    workXhsPromoUrl: (id, slide, { download = false, version } = {}) => {
      const query2 = new URLSearchParams({ ...version ? { v: String(version) } : {}, ...download ? { download: "1" } : {} });
      return `${baseUrl}/v1/works/${encodeURIComponent(id)}/promo/xhs/${encodeURIComponent(slide)}.png${query2.size ? `?${query2}` : ""}`;
    },
    getWorkLeaderboard: (id, { date, puzzleId, limit = 10, offset = 0 } = {}, options) => request(`/v1/works/${encodeURIComponent(id)}/leaderboard?${new URLSearchParams({ limit, offset, ...date ? { date } : {}, ...puzzleId ? { puzzleId } : {} })}`, { ...options, auth: true }),
    getLaunch: (id, releaseId, options) => request(`/v1/works/${encodeURIComponent(id)}/launch${releaseId ? `?releaseId=${encodeURIComponent(releaseId)}` : ""}`, options),
    releaseDownloadUrl: (workId, releaseId) => `${baseUrl}/v1/works/${encodeURIComponent(workId)}/releases/${encodeURIComponent(releaseId)}/download`,
    trackAnalytics: (events, options) => request("/v1/analytics/events", { ...options, method: "POST", body: { events }, auth: true, keepalive: true }),
    getAdminAnalytics: (days = 7, options) => request(`/v1/admin/analytics?days=${encodeURIComponent(days)}`, { ...options, auth: true }),
    getCreatorAnalytics: (days = 30, options) => request(`/v1/creator/analytics?days=${encodeURIComponent(days)}`, { ...options, auth: true }),
    getSaveHealth: ({ admin = false, afterWorkId } = {}) => request((admin ? "/v1/admin/save-operations/health" : "/v1/creator/save-health") + (afterWorkId ? "?afterWorkId=" + encodeURIComponent(afterWorkId) : ""), { auth: true }),
    getSaveCapacity: () => request("/v1/admin/save-operations/capacity", { auth: true }),
    setSaveCapacity: (input) => request("/v1/admin/save-operations/capacity", { auth: true, method: "PATCH", body: input }),
    pauseSavePolicy: (policyId, input) => request("/v1/admin/save-operations/policies/" + encodeURIComponent(policyId), { auth: true, method: "PATCH", body: input }),
    maintainGameSaves: (workId, input) => request("/v1/admin/save-operations/works/" + encodeURIComponent(workId) + "/maintenance", { auth: true, method: "POST", body: input }),
    getSaveAdminAudit: () => request("/v1/admin/save-operations/audit", { auth: true }),
    getAdminStorage: (options) => request("/v1/admin/storage", { ...options, auth: true }),
    createGameShare: (gameSessionId, body, options) => request("/v1/game-shares", { ...options, method: "POST", auth: true, body, headers: { "X-GameHub-Session": gameSessionId } }),
    getGameShare: (code, options) => request("/v1/game-shares/" + encodeURIComponent(code), options),
    revokeGameShare: (code, options) => request("/v1/game-shares/" + encodeURIComponent(code), { ...options, method: "DELETE", auth: true }),
    createGameSession: (body, options) => request("/v1/game-sessions", { ...options, method: "POST", body, auth: true }),
    getGameSession: (gameSessionId, options) => request("/v1/game-sessions/current", { ...options, auth: true, headers: { "X-GameHub-Session": gameSessionId } }),
    revokeGameSession: (gameSessionId, options) => request("/v1/game-sessions/current", { ...options, method: "DELETE", auth: true, headers: { "X-GameHub-Session": gameSessionId } }),
    listSaveLibrary: (afterSlotId, options) => request("/v1/me/save-library" + (afterSlotId ? "?afterSlotId=" + encodeURIComponent(afterSlotId) : ""), { ...options, auth: true }),
    getSaveLibraryHistory: (slotId, beforeRevision, options) => request("/v1/me/save-library/" + encodeURIComponent(slotId) + "/history" + (beforeRevision ? "?beforeRevision=" + encodeURIComponent(beforeRevision) : ""), { ...options, auth: true }),
    readSaveLibraryRevision: (slotId, revisionId, expectedEtag, options) => request("/v1/me/save-library/" + encodeURIComponent(slotId) + "/revisions/" + encodeURIComponent(revisionId) + "/content", {
      ...options,
      auth: true,
      responseBytesLimit: 1048576,
      headers: { "If-Match": expectedEtag, Accept: "application/octet-stream, application/json" }
    }),
    restoreSaveLibraryRevision: (slotId, input, options) => request("/v1/me/save-library/" + encodeURIComponent(slotId) + "/restore", {
      ...options,
      auth: true,
      method: "POST",
      body: { revisionId: input.revisionId },
      headers: saveConditions(input)
    }),
    getGameSavePolicy: (scope, options) => request("/v1/works/" + encodeURIComponent(scope.workId) + "/save-policy?namespace=" + encodeURIComponent(scope.namespace), saveOptions(scope, options)),
    listGameSaves: (scope, options) => request(savePath(scope), saveOptions(scope, options)),
    getGameSaveMetadata: (scope, options) => request(savePath(scope, "/metadata"), saveOptions(scope, options)),
    readGameSave: (scope, expectedEtag, options) => request(savePath(scope, "/content"), {
      ...saveOptions(scope, options),
      responseBytesLimit: 1048576,
      headers: { "X-GameHub-Session": scope.gameSessionId, "If-Match": expectedEtag, Accept: "application/octet-stream, application/json" }
    }),
    getGameSaveWriteReceipt: (scope, input, options) => request(savePath(scope, "/write-receipt"), {
      ...saveOptions(scope, options),
      method: "POST",
      body: { schemaVersion: input.schemaVersion, contentType: input.contentType, sha256: input.sha256 },
      headers: { "X-GameHub-Session": scope.gameSessionId, ...saveConditions(input) }
    }),
    writeGameSave: (scope, input, options) => request(savePath(scope), {
      ...saveOptions(scope, options),
      method: "PUT",
      rawBody: input.bytes,
      headers: { "X-GameHub-Session": scope.gameSessionId, ...saveConditions(input), "Content-Type": input.contentType, "X-GameHub-Save-Schema": String(input.schemaVersion), "X-Content-SHA256": input.sha256 }
    }),
    deleteGameSave: (scope, input, options) => request(savePath(scope), {
      ...saveOptions(scope, options),
      method: "DELETE",
      headers: { "X-GameHub-Session": scope.gameSessionId, ...saveConditions(input) }
    }),
    listGameSaveHistory: (scope, beforeRevision, options) => request(savePath(scope, "/history") + (beforeRevision ? "&beforeRevision=" + encodeURIComponent(beforeRevision) : ""), saveOptions(scope, options)),
    restoreGameSave: (scope, input, options) => request(savePath(scope, "/restore"), {
      ...saveOptions(scope, options),
      method: "POST",
      body: { revisionId: input.revisionId },
      headers: { "X-GameHub-Session": scope.gameSessionId, ...saveConditions(input) }
    }),
    createRealtimeTicket: (options) => request("/v1/realtime/tickets", { ...options, method: "POST", auth: true }),
    listMultiplayerModes: (workId, options) => request(`/v1/works/${encodeURIComponent(workId)}/multiplayer-modes`, options),
    createMultiplayerMode: (body, options) => request("/v1/admin/multiplayer/modes", { ...options, method: "POST", body, auth: true }),
    listMultiplayerRooms: (modeId, limit = 30, query2 = "", options) => request(`/v1/multiplayer/rooms?modeId=${encodeURIComponent(modeId)}&limit=${encodeURIComponent(limit)}${query2 ? `&query=${encodeURIComponent(query2)}` : ""}`, options),
    createMultiplayerRoom: (body, options) => request("/v1/multiplayer/rooms", { ...options, method: "POST", body, auth: true, idempotent: true }),
    getMultiplayerRoom: (roomId, options) => request(`/v1/multiplayer/rooms/${encodeURIComponent(roomId)}`, { ...options, auth: true }),
    joinMultiplayerRoom: (roomId, joinCode, options) => request(`/v1/multiplayer/rooms/${encodeURIComponent(roomId)}/join`, { ...options, method: "POST", body: joinCode ? { joinCode } : {}, auth: true }),
    joinMultiplayerRoomScoped: (roomId, modeId, joinCode, options) => request(`/v1/multiplayer/rooms/${encodeURIComponent(roomId)}/join`, { ...options, method: "POST", body: { modeId, ...joinCode ? { joinCode } : {} }, auth: true }),
    createMultiplayerInvite: (roomId, options) => request(`/v1/multiplayer/rooms/${encodeURIComponent(roomId)}/invite`, { ...options, method: "POST", auth: true }),
    leaveMultiplayerRoom: (roomId, options) => request(`/v1/multiplayer/rooms/${encodeURIComponent(roomId)}/leave`, { ...options, method: "POST", auth: true }),
    setMultiplayerReady: (roomId, ready, options) => request(`/v1/multiplayer/rooms/${encodeURIComponent(roomId)}/ready`, { ...options, method: "POST", body: { ready }, auth: true }),
    startMultiplayerRoom: (roomId, options) => request(`/v1/multiplayer/rooms/${encodeURIComponent(roomId)}/start`, { ...options, method: "POST", auth: true, idempotent: true }),
    getMultiplayerMatch: (matchId, options) => request(`/v1/multiplayer/matches/${encodeURIComponent(matchId)}`, { ...options, auth: true }),
    listMultiplayerMatchEvents: (matchId, afterSeq = 0, limit = 100, options) => request(`/v1/multiplayer/matches/${encodeURIComponent(matchId)}/events?afterSeq=${encodeURIComponent(afterSeq)}&limit=${encodeURIComponent(limit)}`, { ...options, auth: true }),
    getMultiplayerReplay: (matchId, options) => request(`/v1/multiplayer/matches/${encodeURIComponent(matchId)}/replay`, { ...options, auth: true }),
    getAdminMultiplayerOverview: (options) => request("/v1/admin/multiplayer/overview", { ...options, auth: true }),
    listAdminMultiplayerMatches: (status = "all", limit = 50, options) => request(`/v1/admin/multiplayer/matches?status=${encodeURIComponent(status)}&limit=${encodeURIComponent(limit)}`, { ...options, auth: true }),
    abortAdminMultiplayerMatch: (matchId, reason, options) => request(`/v1/admin/multiplayer/matches/${encodeURIComponent(matchId)}/abort`, { ...options, method: "POST", body: { reason }, auth: true }),
    listAdminMultiplayerAudit: (limit = 50, options) => request(`/v1/admin/multiplayer/audit?limit=${encodeURIComponent(limit)}`, { ...options, auth: true }),
    createMultiplayerRuleSubmission: (workId, body, options) => request(`/v1/creator/works/${encodeURIComponent(workId)}/multiplayer-rule-submissions`, { ...options, method: "POST", body, auth: true, idempotent: true }),
    listMultiplayerRuleSubmissions: (workId, options) => request(`/v1/creator/works/${encodeURIComponent(workId)}/multiplayer-rule-submissions`, { ...options, auth: true }),
    getMultiplayerRuleSubmission: (submissionId, options) => request(`/v1/creator/multiplayer-rule-submissions/${encodeURIComponent(submissionId)}`, { ...options, auth: true }),
    createMultiplayerRuleUploadGrant: (submissionId, options) => request(`/v1/creator/multiplayer-rule-submissions/${encodeURIComponent(submissionId)}/grant`, { ...options, method: "POST", auth: true }),
    uploadMultiplayerRulePackage(submissionId, file, grantToken, { signal, onProgress = () => {
    } } = {}) {
      return new Promise((resolve, reject) => {
        const xhr = xhrFactory();
        const fail = () => reject(new ApiError({ code: "UPLOAD_INTERRUPTED", message: "\u89C4\u5219\u6E90\u7801\u5305\u4E0A\u4F20\u4E2D\u65AD\uFF1B\u8BF7\u5237\u65B0\u63D0\u4EA4\u72B6\u6001\u540E\u518D\u51B3\u5B9A\u662F\u5426\u91CD\u8BD5\u3002" }));
        xhr.open("PUT", `${baseUrl}/v1/creator/multiplayer-rule-submissions/${encodeURIComponent(submissionId)}/package`);
        xhr.timeout = 10 * 60 * 1e3;
        xhr.setRequestHeader("Authorization", `Upload ${grantToken}`);
        xhr.setRequestHeader("Content-Type", "application/zip");
        xhr.upload.onprogress = (event) => event.lengthComputable && onProgress({ loaded: event.loaded, total: event.total, percent: Math.round(event.loaded / event.total * 100) });
        xhr.onerror = fail;
        xhr.ontimeout = () => reject(new ApiError({ code: "REQUEST_TIMEOUT", message: "\u89C4\u5219\u6E90\u7801\u5305\u4E0A\u4F20\u8D85\u65F6\u3002" }));
        xhr.onabort = () => reject(new ApiError({ code: "UPLOAD_CANCELLED", message: "\u672C\u673A\u5DF2\u53D6\u6D88\u4E0A\u4F20\u3002", retryable: true }));
        xhr.onload = () => {
          let payload = {};
          try {
            payload = JSON.parse(xhr.responseText || "{}");
          } catch {
          }
          if (xhr.status < 200 || xhr.status >= 300) reject(new ApiError({ status: xhr.status, ...payload.error ?? {}, message: payload.error?.message ?? `\u4E0A\u4F20\u5931\u8D25 (${xhr.status})` }));
          else resolve({ data: payload.data });
        };
        const abort = () => xhr.abort();
        signal?.addEventListener("abort", abort, { once: true });
        xhr.onloadend = () => signal?.removeEventListener("abort", abort);
        xhr.send(file);
      });
    },
    submitMultiplayerRuleSubmission: (submissionId, options) => request(`/v1/creator/multiplayer-rule-submissions/${encodeURIComponent(submissionId)}/submit`, { ...options, method: "POST", auth: true, idempotent: true }),
    listAdminMultiplayerRuleSubmissions: (state = "queue", limit = 50, options) => request(`/v1/admin/multiplayer/rule-submissions?state=${encodeURIComponent(state)}&limit=${encodeURIComponent(limit)}`, { ...options, auth: true }),
    getAdminMultiplayerRuleSubmission: (submissionId, options) => request(`/v1/admin/multiplayer/rule-submissions/${encodeURIComponent(submissionId)}`, { ...options, auth: true }),
    reviewAdminMultiplayerRuleSubmission: (submissionId, body, options) => request(`/v1/admin/multiplayer/rule-submissions/${encodeURIComponent(submissionId)}/review`, { ...options, method: "POST", body, auth: true }),
    downloadAdminMultiplayerRulePackage: (submissionId, options) => authenticatedDownload(`/v1/admin/multiplayer/rule-submissions/${encodeURIComponent(submissionId)}/package`, options),
    downloadAdminMultiplayerRuleBuild: (buildId, options) => authenticatedDownload(`/v1/admin/multiplayer/rule-builds/${encodeURIComponent(buildId)}/package`, { ...options, accept: "application/javascript" }),
    createChallenge: (body, options) => request("/v1/auth/email/challenges", { ...options, method: "POST", body }),
    verifyChallenge: (body, options) => request("/v1/auth/email/verify", { ...options, method: "POST", body }),
    startGitHubDevice: (body, options) => request("/v1/auth/github/device", { ...options, method: "POST", body }),
    pollGitHubDevice: (challengeId, options) => request(`/v1/auth/github/device/${encodeURIComponent(challengeId)}/poll`, { ...options, method: "POST" }),
    startGitHubWeb: (body, options) => request("/v1/auth/github/web", { ...options, method: "POST", body }),
    pollGitHubWeb: (challengeId, options) => request(`/v1/auth/github/web/${encodeURIComponent(challengeId)}/poll`, { ...options, method: "POST" }),
    getProfile: (options) => request("/v1/me", { ...options, auth: true }),
    getCreatorApplication: (options) => request("/v1/me/creator-application", { ...options, auth: true }),
    applyForCreator: (statement, options) => request("/v1/me/creator-application", { ...options, method: "POST", body: { statement }, auth: true }),
    listCreatorApplications: (status = "pending", options) => request(`/v1/admin/creator-applications?status=${encodeURIComponent(status)}`, { ...options, auth: true }),
    decideCreatorApplication: (applicationId, body, options) => request(`/v1/admin/creator-applications/${encodeURIComponent(applicationId)}/decision`, { ...options, method: "POST", body, auth: true }),
    updateProfile: (body, options) => request("/v1/me", { ...options, method: "PATCH", body, auth: true }),
    selectAvatar: (presetKey, options) => request("/v1/me/avatar", { ...options, method: "PATCH", body: { presetKey }, auth: true }),
    uploadAvatar: (file, options) => request("/v1/me/avatar", { ...options, method: "PUT", rawBody: file, headers: { "Content-Type": file.type, ...options?.headers ?? {} }, auth: true }),
    avatarUrl: (avatar, variant = "animated") => {
      const path6 = variant === "static" ? avatar?.staticUrl : avatar?.url;
      return path6 ? `${baseUrl}${path6}` : null;
    },
    listLibrary: ({ limit, recent, ...options } = {}) => request("/v1/me/library" + (limit || recent ? "?" + new URLSearchParams({ ...limit ? { limit } : {}, ...recent ? { recent: "true" } : {} }) : ""), { ...options, auth: true }),
    getLibraryState: (workId, options) => request(`/v1/me/library/${encodeURIComponent(workId)}`, { ...options, auth: true }),
    saveToLibrary: (workId, options) => request(`/v1/me/library/${encodeURIComponent(workId)}`, { ...options, method: "PUT", auth: true }),
    removeFromLibrary: (workId, options) => request(`/v1/me/library/${encodeURIComponent(workId)}`, { ...options, method: "DELETE", auth: true }),
    recordPlay: (workId, options) => request(`/v1/me/recent/${encodeURIComponent(workId)}`, { ...options, method: "POST", auth: true }),
    getGuessBaikeDaily: (options) => request("/v1/games/guess-baike/daily", options),
    saveGuessBaikeResult: (body, options) => request("/v1/games/guess-baike/results", { ...options, method: "POST", body, auth: true }),
    listAdminGuessBaikePuzzles: (options) => request("/v1/admin/games/guess-baike/puzzles", { ...options, auth: true }),
    getGuessBaikeAutomationStatus: (options) => request("/v1/admin/games/guess-baike/automation", { ...options, auth: true }),
    updateAdminGuessBaikePuzzle: (puzzleId, status, options) => request(`/v1/admin/games/guess-baike/puzzles/${encodeURIComponent(puzzleId)}`, { ...options, method: "PATCH", body: { status }, auth: true }),
    scheduleGuessBaikePuzzle: (date, puzzleId, options) => request("/v1/admin/games/guess-baike/schedule", { ...options, method: "PUT", body: { date, puzzleId }, auth: true }),
    getSocialProfile: (options) => request("/v1/me/social", { ...options, auth: true }),
    updateSocialProfile: (body, options) => request("/v1/me/social", { ...options, method: "PATCH", body, auth: true }),
    getPublicUserProfile: (handle, options) => request(`/v1/profiles/${encodeURIComponent(handle)}`, { ...options, auth: true }),
    updatePublicUserProfile: (body, options) => request("/v1/me/public-profile", { ...options, method: "PATCH", body, auth: true }),
    getPublicProfile: (userId, options) => request(`/v1/users/${encodeURIComponent(userId)}`, { ...options, auth: true }),
    followUser: (userId, options) => request(`/v1/users/${encodeURIComponent(userId)}/follow`, { ...options, method: "PUT", auth: true }),
    unfollowUser: (userId, options) => request(`/v1/users/${encodeURIComponent(userId)}/follow`, { ...options, method: "DELETE", auth: true }),
    blockUser: (userId, options) => request(`/v1/users/${encodeURIComponent(userId)}/block`, { ...options, method: "PUT", auth: true }),
    unblockUser: (userId, options) => request(`/v1/users/${encodeURIComponent(userId)}/block`, { ...options, method: "DELETE", auth: true }),
    getGuessBaikeLeaderboard: (date, scope = "global", options) => request(`/v1/games/guess-baike/leaderboard?date=${encodeURIComponent(date)}&scope=${encodeURIComponent(scope)}`, { ...options, auth: true }),
    reactToGuessBaikeResult: (userId, body, options) => request(`/v1/games/guess-baike/reactions/${encodeURIComponent(userId)}`, { ...options, method: "PUT", body, auth: true }),
    removeGuessBaikeReaction: (userId, puzzleDate, options) => request(`/v1/games/guess-baike/reactions/${encodeURIComponent(userId)}`, { ...options, method: "DELETE", body: { puzzleDate }, auth: true }),
    listSocialNotifications: (options) => request("/v1/me/notifications", { ...options, auth: true }),
    markSocialNotificationsRead: (options) => request("/v1/me/notifications/read", { ...options, method: "POST", auth: true }),
    createGuessBaikeChallenge: (puzzleDate, options) => request("/v1/games/guess-baike/challenges", { ...options, method: "POST", body: { puzzleDate }, auth: true }),
    getGuessBaikeChallenge: (code, options) => request(`/v1/challenges/${encodeURIComponent(code)}`, { ...options, auth: true }),
    acceptGuessBaikeChallenge: (code, options) => request(`/v1/challenges/${encodeURIComponent(code)}/accept`, { ...options, method: "POST", auth: true }),
    completeGuessBaikeChallenge: (code, options) => request(`/v1/challenges/${encodeURIComponent(code)}/complete`, { ...options, method: "POST", auth: true }),
    listGuessBaikeChallenges: (options) => request("/v1/me/challenges", { ...options, auth: true }),
    getPlayerRetention: (options) => request("/v1/me/retention", { ...options, auth: true }),
    getNotificationPreferences: (options) => request("/v1/me/notification-preferences", { ...options, auth: true }),
    updateNotificationPreferences: (body, options) => request("/v1/me/notification-preferences", { ...options, method: "PUT", body, auth: true }),
    reportWork: (workId, body, options) => request(`/v1/works/${encodeURIComponent(workId)}/reports`, { ...options, method: "POST", body, auth: true }),
    getPublicProjectClaim: (workId, options) => request(`/v1/works/${encodeURIComponent(workId)}/claim`, options),
    createProjectClaim: (workId, body, options) => request(`/v1/works/${encodeURIComponent(workId)}/claims`, { ...options, method: "POST", body, auth: true }),
    listMyProjectClaims: (status = "all", limit = 50, options) => request(`/v1/me/project-claims?status=${encodeURIComponent(status)}&limit=${encodeURIComponent(limit)}`, { ...options, auth: true }),
    cancelProjectClaim: (claimId, options) => request(`/v1/project-claims/${encodeURIComponent(claimId)}/cancel`, { ...options, method: "POST", auth: true }),
    listAdminProjectClaims: (status = "pending", limit = 50, options) => request(`/v1/admin/project-claims?status=${encodeURIComponent(status)}&limit=${encodeURIComponent(limit)}`, { ...options, auth: true }),
    listAdminProjectClaimEvents: (claimId, options) => request(`/v1/admin/project-claims/${encodeURIComponent(claimId)}/events`, { ...options, auth: true }),
    listAdminWorkProvenance: (limit = 50, options) => request(`/v1/admin/work-provenance?limit=${encodeURIComponent(limit)}`, { ...options, auth: true }),
    listAdminWorkProvenanceEvents: (workId, options) => request(`/v1/admin/works/${encodeURIComponent(workId)}/provenance-events`, { ...options, auth: true }),
    updateAdminWorkProvenance: (workId, body, options) => request(`/v1/admin/works/${encodeURIComponent(workId)}/provenance`, { ...options, method: "PATCH", body, auth: true }),
    listAuthorOutreach: (status = "all", options) => request(`/v1/admin/author-outreach?status=${encodeURIComponent(status)}&limit=100`, { ...options, auth: true }),
    syncAuthorOutreach: (options) => request("/v1/admin/author-outreach/sync", { ...options, method: "POST", auth: true }),
    updateAuthorOutreach: (outreachId, body, options) => request(`/v1/admin/author-outreach/${encodeURIComponent(outreachId)}`, { ...options, method: "PATCH", body, auth: true }),
    listAuthorOutreachEvents: (outreachId, options) => request(`/v1/admin/author-outreach/${encodeURIComponent(outreachId)}/events`, { ...options, auth: true }),
    decideProjectClaim: (claimId, body, options) => request(`/v1/admin/project-claims/${encodeURIComponent(claimId)}/decision`, { ...options, method: "POST", body, auth: true }),
    createCreatorFeedback: (workId, body, options) => request(`/v1/works/${encodeURIComponent(workId)}/feedback`, { ...options, method: "POST", body, auth: true }),
    listCreatorFeedback: (status = "all", options) => request(`/v1/creator/feedback?status=${encodeURIComponent(status)}`, { ...options, auth: true }),
    createCreatorFeedbackIssueDraft: (feedbackId, options) => request(`/v1/creator/feedback/${encodeURIComponent(feedbackId)}/issue-draft`, { ...options, method: "POST", auth: true }),
    updateCreatorFeedback: (feedbackId, body, options) => request(`/v1/creator/feedback/${encodeURIComponent(feedbackId)}`, { ...options, method: "PATCH", body, auth: true }),
    createContributionTaskFromFeedback: (feedbackId, body, options) => request(`/v1/creator/feedback/${encodeURIComponent(feedbackId)}/contribution-task`, { ...options, method: "POST", body, auth: true }),
    listCreatorContributionTasks: (limit = 50, options = {}) => request(`/v1/creator/contribution-tasks?limit=${encodeURIComponent(limit)}${options.offset ? "&offset=" + encodeURIComponent(options.offset) : ""}`, { ...options, auth: true }),
    updateCreatorContributionTask: (taskId, body, options) => request(`/v1/creator/contribution-tasks/${encodeURIComponent(taskId)}`, { ...options, method: "PATCH", body, auth: true }),
    createContributionIssueDraft: (taskId, options) => request(`/v1/creator/contribution-tasks/${encodeURIComponent(taskId)}/issue-draft`, { ...options, method: "POST", auth: true }),
    listContributionTasks: (status = "all", limit = 50, options = {}) => request(`/v1/contribution-tasks?status=${encodeURIComponent(status)}&limit=${encodeURIComponent(limit)}${options.offset ? "&offset=" + encodeURIComponent(options.offset) : ""}${options.mine ? "&mine=true" : ""}${options.projectId ? "&projectId=" + encodeURIComponent(options.projectId) : ""}${options.standalone ? "&standalone=true" : ""}`, { ...options, auth: true }),
    claimContributionTask: (taskId, options) => request(`/v1/contribution-tasks/${encodeURIComponent(taskId)}/claim`, { ...options, method: "POST", auth: true }),
    releaseContributionTask: (taskId, options) => request(`/v1/contribution-tasks/${encodeURIComponent(taskId)}/release`, { ...options, method: "POST", auth: true }),
    getContributionTask: (id, options) => request("/v1/contribution-tasks/" + encodeURIComponent(id), { ...options, auth: true }),
    renewContributionTask: (id, options) => request("/v1/contribution-tasks/" + encodeURIComponent(id) + "/renew", { ...options, method: "POST", auth: true }),
    withdrawContributionTask: (id, options) => request("/v1/contribution-tasks/" + encodeURIComponent(id) + "/withdraw", { ...options, method: "POST", auth: true }),
    listContributionNotifications: (limit = 21, offset = 0, options) => request("/v1/contribution-notifications?limit=" + limit + "&offset=" + offset, { ...options, auth: true }),
    readContributionNotification: (id, options) => request("/v1/contribution-notifications/" + encodeURIComponent(id) + "/read", { ...options, method: "POST", auth: true }),
    submitContributionTask: (taskId, body, options) => request(`/v1/contribution-tasks/${encodeURIComponent(taskId)}/submission`, { ...options, method: "POST", body, auth: true }),
    listReports: (status = "open", options) => request(`/v1/admin/reports?status=${encodeURIComponent(status)}`, { ...options, auth: true }),
    decideReport: (reportId, body, options) => request(`/v1/admin/reports/${encodeURIComponent(reportId)}/decision`, { ...options, method: "POST", body, auth: true }),
    listModerationAudit: (options) => request("/v1/admin/audit", { ...options, auth: true }),
    listDevices: (options) => request("/v1/me/devices", { ...options, auth: true }),
    revokeDevice: (grantId, options) => request(`/v1/me/devices/${encodeURIComponent(grantId)}`, { ...options, method: "DELETE", auth: true }),
    logoutOthers: (options) => request("/v1/auth/devices/logout-others", { ...options, method: "POST", auth: true }),
    logoutAll: (options) => request("/v1/auth/devices/logout-all", { ...options, method: "POST", auth: true }),
    logout: (options) => request("/v1/auth/device/logout", { ...options, method: "POST", auth: true }),
    listCreatorWorks: (options) => request("/v1/creator/works", { ...options, auth: true }),
    listCreatorDrafts: (studio, options) => request(`/v1/creator/drafts${studio ? `?studio=${encodeURIComponent(studio)}` : ""}`, { ...options, auth: true }),
    createCreatorDraft: (body, options) => request("/v1/creator/drafts", { ...options, method: "POST", body, auth: true, idempotent: true }),
    getCreatorDraft: (draftId, options) => request(`/v1/creator/drafts/${encodeURIComponent(draftId)}`, { ...options, auth: true }),
    previewCreatorDraft: (draftId, options) => request(`/v1/creator/drafts/${encodeURIComponent(draftId)}/preview`, { ...options, auth: true }),
    updateCreatorDraft: (draftId, body, revision, options) => request(`/v1/creator/drafts/${encodeURIComponent(draftId)}`, { ...options, method: "PUT", body, auth: true, idempotent: true, headers: { "If-Match": `"creator-draft-${draftId}-${revision}"`, ...options?.headers ?? {} } }),
    buildCreatorDraft: (draftId, body, revision, options) => request(`/v1/creator/drafts/${encodeURIComponent(draftId)}/builds`, { ...options, method: "POST", body, auth: true, idempotent: true, headers: { "If-Match": `"creator-draft-${draftId}-${revision}"`, ...options?.headers ?? {} } }),
    startGitHubSourceInstall: (options) => request("/v1/creator/source-connections/github/install", { ...options, method: "POST", auth: true }),
    completeGitHubSourceInstall: (body, options) => request("/v1/creator/source-connections/github/complete", { ...options, method: "POST", body, auth: true }),
    listGitHubSourceConnections: (options) => request("/v1/creator/source-connections", { ...options, auth: true }),
    disconnectGitHubSourceConnection: (connectionId, options) => request(`/v1/creator/source-connections/${encodeURIComponent(connectionId)}`, { ...options, method: "DELETE", auth: true }),
    listGitHubSourceRepositories: (connectionId, options) => request(`/v1/creator/source-connections/${encodeURIComponent(connectionId)}/repositories`, { ...options, auth: true }),
    previewGitHubSourceImport: (body, options) => request("/v1/creator/source-imports/preview", { ...options, method: "POST", body, auth: true }),
    createGitHubImportedDraft: (body, options) => request("/v1/creator/source-imports/drafts", { ...options, method: "POST", body, auth: true, idempotent: true }),
    getWorkSource: (workId, options) => request(`/v1/creator/works/${encodeURIComponent(workId)}/source`, { ...options, auth: true }),
    createSourceBuild: (workId, body, options) => request(`/v1/creator/works/${encodeURIComponent(workId)}/builds`, { ...options, method: "POST", body, auth: true, idempotent: true }),
    listSourceBuilds: (workId, options) => request(`/v1/creator/works/${encodeURIComponent(workId)}/builds`, { ...options, auth: true }),
    getSourceBuild: (workId, buildId, options) => request(`/v1/creator/works/${encodeURIComponent(workId)}/builds/${encodeURIComponent(buildId)}`, { ...options, auth: true }),
    publishSourceBuild: (workId, buildId, options) => request(`/v1/creator/works/${encodeURIComponent(workId)}/builds/${encodeURIComponent(buildId)}/publish`, { ...options, method: "POST", auth: true }),
    getGitHubSourceAdminOverview: (options) => request("/v1/admin/source-imports/overview", { ...options, auth: true }),
    listGitHubSourceAudit: (limit = 50, options) => request(`/v1/admin/source-imports/audit?limit=${encodeURIComponent(limit)}`, { ...options, auth: true }),
    createWork: (body, options) => request("/v1/creator/works", { ...options, method: "POST", body, auth: true, idempotent: true }),
    listWorkRemixes: (workId, options) => request(`/v1/works/${encodeURIComponent(workId)}/remixes`, options),
    listWorkTimeline: (workId, options) => request(`/v1/works/${encodeURIComponent(workId)}/timeline`, options),
    listDevelopmentEntries: (workId, options) => request(`/v1/creator/works/${encodeURIComponent(workId)}/development-entries`, { ...options, auth: true }),
    createDevelopmentEntry: (workId, body, options) => request(`/v1/creator/works/${encodeURIComponent(workId)}/development-entries`, { ...options, method: "POST", body, auth: true }),
    updateDevelopmentEntry: (entryId, body, options) => request(`/v1/creator/development-entries/${encodeURIComponent(entryId)}`, { ...options, method: "PATCH", body, auth: true }),
    updateWork: (workId, revision, body, options) => request(`/v1/creator/works/${encodeURIComponent(workId)}`, { ...options, method: "PATCH", body, auth: true, idempotent: true, headers: { "Idempotency-Key": randomKey(), ...options?.headers ?? {}, "If-Match": `"work-${workId}-${revision}"` } }),
    uploadWorkCover: (workId, file, options) => request(`/v1/creator/works/${encodeURIComponent(workId)}/cover`, { ...options, method: "PUT", rawBody: file, headers: { "Content-Type": file.type, ...options?.headers ?? {} }, auth: true }),
    listWorkReleases: (workId, options) => request(`/v1/creator/works/${encodeURIComponent(workId)}/releases`, { ...options, auth: true }),
    publishWorkRelease: (workId, releaseId, revision, options) => request(`/v1/creator/works/${encodeURIComponent(workId)}/releases/${encodeURIComponent(releaseId)}/publish`, { ...options, method: "POST", auth: true, idempotent: true, headers: { "If-Match": `"work-${workId}-${revision}"`, ...options?.headers ?? {} } }),
    withdrawWork: (workId, revision, options) => request(`/v1/creator/works/${encodeURIComponent(workId)}/withdraw`, { ...options, method: "POST", auth: true, idempotent: true, headers: { "If-Match": `"work-${workId}-${revision}"`, ...options?.headers ?? {} } }),
    createUpload: (workId, body, options) => request(`/v1/creator/works/${encodeURIComponent(workId)}/uploads`, { ...options, method: "POST", body, auth: true, idempotent: true }),
    createUploadGrant: (uploadId, options) => request(`/v1/creator/uploads/${encodeURIComponent(uploadId)}/grant`, { ...options, method: "POST", auth: true }),
    uploadContent(uploadId, file, grantToken, { signal, onProgress = () => {
    } } = {}) {
      return new Promise((resolve, reject) => {
        const xhr = xhrFactory();
        const fail = () => reject(new ApiError({ code: "UPLOAD_INTERRUPTED", message: "\u4E0A\u4F20\u8FDE\u63A5\u4E2D\u65AD\uFF1B\u8BF7\u5237\u65B0\u4EFB\u52A1\u72B6\u6001\u540E\u518D\u51B3\u5B9A\u662F\u5426\u91CD\u8BD5\u3002" }));
        xhr.open("PUT", `${baseUrl}/v1/creator/uploads/${encodeURIComponent(uploadId)}/content`);
        xhr.timeout = 30 * 60 * 1e3;
        xhr.setRequestHeader("Authorization", `Upload ${grantToken}`);
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        xhr.upload.onprogress = (event) => event.lengthComputable && onProgress({ loaded: event.loaded, total: event.total, percent: Math.round(event.loaded / event.total * 100) });
        xhr.onerror = fail;
        xhr.ontimeout = () => reject(new ApiError({ code: "REQUEST_TIMEOUT", message: "\u4E0A\u4F20\u8D85\u65F6\uFF1B\u4EFB\u52A1\u72B6\u6001\u4ECD\u9700\u5411\u670D\u52A1\u7AEF\u786E\u8BA4\u3002" }));
        xhr.onabort = () => reject(new ApiError({ code: "UPLOAD_CANCELLED", message: "\u672C\u673A\u4F20\u8F93\u5DF2\u53D6\u6D88\uFF1B\u5DF2\u6536\u5230\u7684\u4E34\u65F6\u5B57\u8282\u4E0D\u4F1A\u88AB\u53D1\u5E03\u3002", retryable: true }));
        xhr.onload = () => {
          let payload = {};
          try {
            payload = JSON.parse(xhr.responseText || "{}");
          } catch {
          }
          if (xhr.status < 200 || xhr.status >= 300) reject(new ApiError({ status: xhr.status, ...payload.error ?? {}, message: payload.error?.message ?? `\u4E0A\u4F20\u5931\u8D25 (${xhr.status})` }));
          else resolve({ data: payload.data });
        };
        const abort = () => xhr.abort();
        signal?.addEventListener("abort", abort, { once: true });
        xhr.onloadend = () => signal?.removeEventListener("abort", abort);
        xhr.send(file);
      });
    },
    async uploadContentBytes(uploadId, bytes, grantToken, options = {}) {
      const response = await fetchImpl(`${baseUrl}/v1/creator/uploads/${encodeURIComponent(uploadId)}/content`, { method: "PUT", signal: options.signal, headers: { Authorization: `Upload ${grantToken}`, "Content-Type": "application/octet-stream" }, body: bytes });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new ApiError({ status: response.status, ...payload.error ?? {}, message: payload.error?.message ?? `\u4E0A\u4F20\u5931\u8D25 (${response.status})` });
      return { data: payload.data };
    },
    completeUpload: (uploadId, options) => request(`/v1/creator/uploads/${encodeURIComponent(uploadId)}/complete`, { ...options, method: "POST", auth: true, idempotent: true }),
    getUpload: (id, options) => request(`/v1/creator/uploads/${encodeURIComponent(id)}`, { ...options, auth: true })
  };
}

// packages/creator-tools/src/index.mjs
import fs4 from "node:fs/promises";
import path4 from "node:path";

// packages/rules-sdk/src/index.mjs
var RULES_MANIFEST_PROTOCOL = "gamehub.rules-manifest.v1";
var RULES_MANIFEST_MAX_BYTES = 64 * 1024;
var RULES_BUNDLE_MAX_BYTES = 1024 * 1024;
var emptyReleaseDescription = Object.freeze({
  installed: false,
  protocol: RULES_MANIFEST_PROTOCOL,
  manifestSha256: null,
  keyId: null,
  createdAt: null,
  adapterCount: 0
});

// packages/creator-tools/src/courseware.mjs
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
var COURSEWARE_FORMAT = "mooyu.courseware";
var COURSEWARE_SCHEMA_VERSION = 1;
var COURSEWARE_DOCTOR_REPORT_VERSION = 1;
var COURSEWARE_VALIDATOR_VERSION = "0.1.0";
var idPattern = /^[a-z][a-z0-9._-]{0,63}$/u;
var localePattern = /^[a-z]{2,3}(?:-[A-Z][A-Za-z0-9]{1,7})?$/u;
var audienceStages = /* @__PURE__ */ new Set(["primary", "lower-secondary", "upper-secondary", "higher-education", "professional", "lifelong"]);
var runtimeCapabilities = /* @__PURE__ */ new Set(["fullscreen", "pointerLock", "localSave", "fileExport", "shareLinks", "learningProgress", "learningEvents", "assessmentResult"]);
var sceneTypes = /* @__PURE__ */ new Set(["explain", "explore", "simulate", "practice", "assess", "reflect"]);
var checkpointKinds = /* @__PURE__ */ new Set(["observation", "prediction", "multiple-choice", "numeric", "ordering", "free-response"]);
var sourceTypes = /* @__PURE__ */ new Set(["book", "paper", "standard", "documentation", "dataset", "web"]);
var verificationKinds = /* @__PURE__ */ new Set(["primary-source", "cross-checked", "reviewed", "author-asserted"]);
var journeyActions = /* @__PURE__ */ new Set(["enter", "set", "click", "answer", "assert", "complete"]);
var ignoredDirectories = /* @__PURE__ */ new Set([".git", ".gamehub", ".mooyu", "node_modules"]);
var finding = (severity, code, message, details = {}) => ({ severity, code, message, ...details });
var isObject = (value) => Boolean(value) && !Array.isArray(value) && typeof value === "object";
var isTextMap = (value) => isObject(value) && Object.keys(value).length > 0 && Object.entries(value).every(([locale, text]) => localePattern.test(locale) && typeof text === "string" && text.trim().length > 0);
var safeRelativePath = (value) => typeof value === "string" && value.length > 0 && value.length <= 255 && !path.isAbsolute(value) && !value.includes("\\") && value.split("/").every((part) => part && part !== "." && part !== "..");
function rejectUnknown(value, allowed, findings, file, pointer = "") {
  if (!isObject(value)) return;
  for (const key of Object.keys(value)) if (!allowed.includes(key)) {
    findings.push(finding("error", "COURSEWARE_ADDITIONAL_PROPERTY", `${file} \u5305\u542B\u672A\u5B9A\u4E49\u5B57\u6BB5 ${key}\u3002`, { path: file, pointer: `${pointer}/${key}` }));
  }
}
function requireFields(value, required, findings, file, pointer = "") {
  if (!isObject(value)) {
    findings.push(finding("error", "COURSEWARE_OBJECT_REQUIRED", `${file}${pointer || "/"} \u5FC5\u987B\u662F JSON \u5BF9\u8C61\u3002`, { path: file, pointer: pointer || "/" }));
    return false;
  }
  for (const key of required) if (!(key in value)) {
    findings.push(finding("error", "COURSEWARE_FIELD_REQUIRED", `${file} \u7F3A\u5C11\u5B57\u6BB5 ${key}\u3002`, { path: file, pointer: `${pointer}/${key}` }));
  }
  return true;
}
function requireId(value, findings, file, pointer) {
  if (!idPattern.test(value ?? "")) findings.push(finding("error", "COURSEWARE_ID_INVALID", `${file}${pointer} \u5FC5\u987B\u662F\u7A33\u5B9A\u7684\u5C0F\u5199\u6807\u8BC6\u7B26\u3002`, { path: file, pointer }));
}
function requireIdList(value, findings, file, pointer, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || !allowEmpty && value.length === 0 || value.some((id) => !idPattern.test(id)) || new Set(value).size !== value.length) {
    findings.push(finding("error", "COURSEWARE_ID_LIST_INVALID", `${file}${pointer} \u5FC5\u987B\u662F${allowEmpty ? "" : "\u975E\u7A7A"}\u3001\u65E0\u91CD\u590D\u7684\u7A33\u5B9A\u6807\u8BC6\u7B26\u6570\u7EC4\u3002`, { path: file, pointer }));
    return [];
  }
  return value;
}
function requireTextMap(value, findings, file, pointer) {
  if (!isTextMap(value)) findings.push(finding("error", "COURSEWARE_LOCALIZED_TEXT_INVALID", `${file}${pointer} \u5FC5\u987B\u662F\u975E\u7A7A\u7684\u8BED\u8A00\u5230\u6587\u5B57\u6620\u5C04\u3002`, { path: file, pointer }));
}
async function readJson(projectRoot, relative, findings, code = "COURSEWARE_JSON_INVALID") {
  if (!safeRelativePath(relative)) {
    findings.push(finding("error", "COURSEWARE_PATH_INVALID", `\u8BFE\u7A0B\u5305\u8DEF\u5F84 ${String(relative)} \u4E0D\u5B89\u5168\u3002`, { path: "mooyu-courseware.json", pointer: "/" }));
    return null;
  }
  try {
    const absolute = path.join(projectRoot, ...relative.split("/"));
    const stat = await fs.lstat(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("\u4E0D\u662F\u666E\u901A\u6587\u4EF6");
    return JSON.parse(await fs.readFile(absolute, "utf8"));
  } catch (error) {
    findings.push(finding("error", code, `${relative} \u65E0\u6CD5\u8BFB\u53D6\u4E3A\u666E\u901A JSON \u6587\u4EF6\uFF1A${error.message}`, { path: relative, pointer: "/" }));
    return null;
  }
}
async function projectDigest(projectRoot) {
  const hash = crypto.createHash("sha256");
  const walk = async (directory, prefix = "") => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "en"))) {
      if (entry.isSymbolicLink()) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) await walk(path.join(directory, entry.name), relative);
      } else if (entry.isFile()) {
        hash.update(relative.replaceAll("\\", "/"));
        hash.update("\0");
        hash.update(await fs.readFile(path.join(directory, entry.name)));
        hash.update("\0");
      }
    }
  };
  try {
    await walk(projectRoot);
  } catch (error) {
    hash.update(`unreadable:${error.message}`);
  }
  return hash.digest("hex");
}
async function publishableProjectDigest(projectRoot, manifest) {
  const fixed = ["mooyu-courseware.json", manifest?.course, manifest?.evidence, manifest?.tests];
  if (fixed.some((relative) => !safeRelativePath(relative))) return projectDigest(projectRoot);
  const records = [];
  const add = async (relative) => records.push({ relative, bytes: await fs.readFile(path.join(projectRoot, ...relative.split("/"))) });
  try {
    for (const relative of fixed) await add(relative);
    const walk = async (directory, prefix = "dist") => {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const relative = `${prefix}/${entry.name}`;
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) await walk(path.join(directory, entry.name), relative);
        else if (entry.isFile()) await add(relative);
      }
    };
    await walk(path.join(projectRoot, "dist"));
    const hash = crypto.createHash("sha256");
    for (const record of [...new Map(records.map((record2) => [record2.relative, record2])).values()].sort((left, right) => left.relative.localeCompare(right.relative, "en"))) {
      hash.update(record.relative);
      hash.update("\0");
      hash.update(record.bytes);
      hash.update("\0");
    }
    return hash.digest("hex");
  } catch {
    return projectDigest(projectRoot);
  }
}
function validateManifest(manifest, findings) {
  const file = "mooyu-courseware.json";
  const allowed = ["format", "schemaVersion", "id", "title", "summary", "defaultLocale", "locales", "subjects", "audience", "course", "evidence", "tests", "build", "runtime", "licenses"];
  const required = ["format", "schemaVersion", "id", "title", "defaultLocale", "locales", "subjects", "audience", "course", "evidence", "tests", "build", "runtime", "licenses"];
  if (!requireFields(manifest, required, findings, file)) return;
  rejectUnknown(manifest, allowed, findings, file);
  if (manifest.format !== COURSEWARE_FORMAT || manifest.schemaVersion !== COURSEWARE_SCHEMA_VERSION) findings.push(finding("error", "COURSEWARE_FORMAT_UNSUPPORTED", "\u8BFE\u7A0B\u5305\u5FC5\u987B\u4F7F\u7528 mooyu.courseware schemaVersion 1\u3002", { path: file, pointer: "/format" }));
  requireId(manifest.id, findings, file, "/id");
  requireTextMap(manifest.title, findings, file, "/title");
  if (manifest.summary !== void 0) requireTextMap(manifest.summary, findings, file, "/summary");
  if (!localePattern.test(manifest.defaultLocale ?? "") || !Array.isArray(manifest.locales) || !manifest.locales.includes(manifest.defaultLocale) || new Set(manifest.locales).size !== manifest.locales.length || manifest.locales.some((locale) => !localePattern.test(locale))) findings.push(finding("error", "COURSEWARE_LOCALES_INVALID", "defaultLocale \u5FC5\u987B\u51FA\u73B0\u5728\u65E0\u91CD\u590D\u7684 locales \u5217\u8868\u4E2D\u3002", { path: file, pointer: "/locales" }));
  requireIdList(manifest.subjects, findings, file, "/subjects");
  if (!isObject(manifest.audience) || !Array.isArray(manifest.audience.stages) || !manifest.audience.stages.length || new Set(manifest.audience.stages).size !== manifest.audience.stages.length || manifest.audience.stages.some((stage) => !audienceStages.has(stage))) findings.push(finding("error", "COURSEWARE_AUDIENCE_INVALID", "audience.stages \u5FC5\u987B\u662F\u65E0\u91CD\u590D\u7684\u53D7\u652F\u6301\u5B66\u4E60\u9636\u6BB5\u3002", { path: file, pointer: "/audience" }));
  else rejectUnknown(manifest.audience, ["stages", "minimumAge", "maximumAge"], findings, file, "/audience");
  for (const key of ["course", "evidence", "tests"]) if (!safeRelativePath(manifest[key])) findings.push(finding("error", "COURSEWARE_PATH_INVALID", `${key} \u5FC5\u987B\u662F\u5305\u5185\u5B89\u5168\u76F8\u5BF9\u8DEF\u5F84\u3002`, { path: file, pointer: `/${key}` }));
  if (!isObject(manifest.build) || manifest.build.profile !== "mooyu-static-v1" || manifest.build.entry !== "dist/index.html") findings.push(finding("error", "COURSEWARE_BUILD_PROFILE_INVALID", "build \u5FC5\u987B\u4F7F\u7528 mooyu-static-v1 \u548C dist/index.html\u3002", { path: file, pointer: "/build" }));
  else rejectUnknown(manifest.build, ["profile", "entry"], findings, file, "/build");
  if (!isObject(manifest.runtime) || manifest.runtime.learningSdk !== 1 || !["static-web", "static-wasm"].includes(manifest.runtime.kind) || !Array.isArray(manifest.runtime.capabilities) || new Set(manifest.runtime.capabilities).size !== manifest.runtime.capabilities.length || manifest.runtime.capabilities.some((capability) => !runtimeCapabilities.has(capability))) findings.push(finding("error", "COURSEWARE_RUNTIME_INVALID", "runtime \u5FC5\u987B\u58F0\u660E\u9759\u6001\u8FD0\u884C\u7C7B\u578B\u3001Learning SDK v1 \u4E0E\u65E0\u91CD\u590D\u7684\u5DF2\u77E5\u80FD\u529B\u6570\u7EC4\u3002", { path: file, pointer: "/runtime" }));
  else rejectUnknown(manifest.runtime, ["kind", "learningSdk", "capabilities"], findings, file, "/runtime");
  if (!isObject(manifest.licenses) || typeof manifest.licenses.code !== "string" || typeof manifest.licenses.content !== "string") findings.push(finding("error", "COURSEWARE_LICENSE_INVALID", "licenses \u5FC5\u987B\u58F0\u660E code \u4E0E content\u3002", { path: file, pointer: "/licenses" }));
  else rejectUnknown(manifest.licenses, ["code", "content"], findings, file, "/licenses");
}
function validateCourse(course, findings, file) {
  const required = ["schemaVersion", "objectives", "prerequisites", "misconceptions", "scenes", "checkpoints", "completion"];
  if (!requireFields(course, required, findings, file)) return null;
  rejectUnknown(course, required, findings, file);
  if (course.schemaVersion !== 1) findings.push(finding("error", "COURSEWARE_COURSE_VERSION_INVALID", "course schemaVersion \u5FC5\u987B\u4E3A 1\u3002", { path: file, pointer: "/schemaVersion" }));
  const collections = [["objectives", course.objectives], ["scenes", course.scenes], ["checkpoints", course.checkpoints]];
  const sets = {};
  for (const [name, values] of collections) {
    if (!Array.isArray(values) || values.length === 0) {
      findings.push(finding("error", "COURSEWARE_COLLECTION_EMPTY", `${name} \u81F3\u5C11\u9700\u8981\u4E00\u9879\u3002`, { path: file, pointer: `/${name}` }));
      sets[name] = /* @__PURE__ */ new Set();
      continue;
    }
    const ids = values.map((value) => value?.id);
    sets[name] = new Set(ids);
    ids.forEach((id, index) => requireId(id, findings, file, `/${name}/${index}/id`));
    if (sets[name].size !== ids.length) findings.push(finding("error", "COURSEWARE_ID_DUPLICATE", `${name} \u4E2D\u5B58\u5728\u91CD\u590D ID\u3002`, { path: file, pointer: `/${name}` }));
  }
  for (const [index, objective] of (course.objectives ?? []).entries()) {
    rejectUnknown(objective, ["id", "text"], findings, file, `/objectives/${index}`);
    requireTextMap(objective?.text, findings, file, `/objectives/${index}/text`);
  }
  if (!Array.isArray(course.prerequisites) || course.prerequisites.some((value) => !isTextMap(value))) findings.push(finding("error", "COURSEWARE_PREREQUISITES_INVALID", "prerequisites \u5FC5\u987B\u662F\u672C\u5730\u5316\u6587\u5B57\u6570\u7EC4\u3002", { path: file, pointer: "/prerequisites" }));
  if (!Array.isArray(course.misconceptions)) findings.push(finding("error", "COURSEWARE_MISCONCEPTIONS_INVALID", "misconceptions \u5FC5\u987B\u662F\u6570\u7EC4\u3002", { path: file, pointer: "/misconceptions" }));
  for (const [index, misconception] of (course.misconceptions ?? []).entries()) {
    rejectUnknown(misconception, ["id", "text", "objectiveIds"], findings, file, `/misconceptions/${index}`);
    requireId(misconception?.id, findings, file, `/misconceptions/${index}/id`);
    requireTextMap(misconception?.text, findings, file, `/misconceptions/${index}/text`);
    for (const id of requireIdList(misconception?.objectiveIds, findings, file, `/misconceptions/${index}/objectiveIds`)) if (!sets.objectives.has(id)) findings.push(finding("error", "COURSEWARE_OBJECTIVE_REFERENCE_INVALID", `\u8BEF\u533A ${misconception?.id} \u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u76EE\u6807 ${id}\u3002`, { path: file, pointer: `/misconceptions/${index}/objectiveIds` }));
  }
  for (const [index, scene] of (course.scenes ?? []).entries()) {
    rejectUnknown(scene, ["id", "type", "title", "objectiveIds", "evidenceIds", "component", "fallback"], findings, file, `/scenes/${index}`);
    requireTextMap(scene?.title, findings, file, `/scenes/${index}/title`);
    requireTextMap(scene?.fallback, findings, file, `/scenes/${index}/fallback`);
    if (!sceneTypes.has(scene?.type)) findings.push(finding("error", "COURSEWARE_SCENE_TYPE_INVALID", `\u573A\u666F ${scene?.id ?? index} \u7684 type \u4E0D\u53D7\u652F\u6301\u3002`, { path: file, pointer: `/scenes/${index}/type` }));
    const objectiveIds = requireIdList(scene?.objectiveIds, findings, file, `/scenes/${index}/objectiveIds`);
    for (const id of objectiveIds) if (!sets.objectives.has(id)) findings.push(finding("error", "COURSEWARE_OBJECTIVE_REFERENCE_INVALID", `\u573A\u666F ${scene?.id} \u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u76EE\u6807 ${id}\u3002`, { path: file, pointer: `/scenes/${index}/objectiveIds` }));
    requireIdList(scene?.evidenceIds, findings, file, `/scenes/${index}/evidenceIds`, { allowEmpty: true });
    if (!isObject(scene?.component) || !idPattern.test(scene.component.type ?? "") || scene.component.config !== void 0 && !isObject(scene.component.config)) findings.push(finding("error", "COURSEWARE_COMPONENT_INVALID", `\u573A\u666F ${scene?.id ?? index} \u7F3A\u5C11\u7A33\u5B9A\u7EC4\u4EF6\u7C7B\u578B\u6216 config \u4E0D\u662F\u5BF9\u8C61\u3002`, { path: file, pointer: `/scenes/${index}/component` }));
    else rejectUnknown(scene.component, ["type", "config"], findings, file, `/scenes/${index}/component`);
  }
  for (const [index, checkpoint] of (course.checkpoints ?? []).entries()) {
    rejectUnknown(checkpoint, ["id", "sceneId", "objectiveIds", "kind", "prompt", "answer"], findings, file, `/checkpoints/${index}`);
    if (!checkpointKinds.has(checkpoint?.kind)) findings.push(finding("error", "COURSEWARE_CHECKPOINT_KIND_INVALID", `\u68C0\u67E5\u70B9 ${checkpoint?.id ?? index} \u7684 kind \u4E0D\u53D7\u652F\u6301\u3002`, { path: file, pointer: `/checkpoints/${index}/kind` }));
    if (!sets.scenes.has(checkpoint?.sceneId)) findings.push(finding("error", "COURSEWARE_SCENE_REFERENCE_INVALID", `\u68C0\u67E5\u70B9 ${checkpoint?.id} \u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u573A\u666F ${checkpoint?.sceneId}\u3002`, { path: file, pointer: `/checkpoints/${index}/sceneId` }));
    const objectiveIds = requireIdList(checkpoint?.objectiveIds, findings, file, `/checkpoints/${index}/objectiveIds`);
    for (const id of objectiveIds) if (!sets.objectives.has(id)) findings.push(finding("error", "COURSEWARE_OBJECTIVE_REFERENCE_INVALID", `\u68C0\u67E5\u70B9 ${checkpoint?.id} \u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u76EE\u6807 ${id}\u3002`, { path: file, pointer: `/checkpoints/${index}/objectiveIds` }));
    requireTextMap(checkpoint?.prompt, findings, file, `/checkpoints/${index}/prompt`);
  }
  const completionObjectives = requireIdList(course.completion?.objectiveIds, findings, file, "/completion/objectiveIds");
  const completionCheckpoints = requireIdList(course.completion?.checkpointIds, findings, file, "/completion/checkpointIds");
  rejectUnknown(course.completion, ["objectiveIds", "checkpointIds"], findings, file, "/completion");
  for (const id of completionObjectives) if (!sets.objectives.has(id)) findings.push(finding("error", "COURSEWARE_COMPLETION_REFERENCE_INVALID", `\u5B8C\u6210\u89C4\u5219\u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u76EE\u6807 ${id}\u3002`, { path: file, pointer: "/completion/objectiveIds" }));
  for (const id of completionCheckpoints) if (!sets.checkpoints.has(id)) findings.push(finding("error", "COURSEWARE_COMPLETION_REFERENCE_INVALID", `\u5B8C\u6210\u89C4\u5219\u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u68C0\u67E5\u70B9 ${id}\u3002`, { path: file, pointer: "/completion/checkpointIds" }));
  for (const id of sets.objectives) {
    if (!(course.scenes ?? []).some((scene) => scene.objectiveIds?.includes(id))) findings.push(finding("error", "COURSEWARE_OBJECTIVE_UNCOVERED", `\u5B66\u4E60\u76EE\u6807 ${id} \u6CA1\u6709\u573A\u666F\u8986\u76D6\u3002`, { path: file, pointer: "/scenes" }));
    if (!(course.checkpoints ?? []).some((checkpoint) => checkpoint.objectiveIds?.includes(id))) findings.push(finding("error", "COURSEWARE_OBJECTIVE_UNASSESSED", `\u5B66\u4E60\u76EE\u6807 ${id} \u6CA1\u6709\u68C0\u67E5\u70B9\u9A8C\u8BC1\u3002`, { path: file, pointer: "/checkpoints" }));
  }
  return { objectiveIds: sets.objectives, sceneIds: sets.scenes, checkpointIds: sets.checkpoints };
}
function validateEvidence(evidence, findings, file, course, courseFile) {
  if (!requireFields(evidence, ["schemaVersion", "sources", "claims"], findings, file)) return;
  rejectUnknown(evidence, ["schemaVersion", "sources", "claims", "assets"], findings, file);
  if (evidence.schemaVersion !== 1) findings.push(finding("error", "COURSEWARE_EVIDENCE_VERSION_INVALID", "evidence schemaVersion \u5FC5\u987B\u4E3A 1\u3002", { path: file, pointer: "/schemaVersion" }));
  const sources = Array.isArray(evidence.sources) ? evidence.sources : [];
  const claims = Array.isArray(evidence.claims) ? evidence.claims : [];
  if (!sources.length || !claims.length) findings.push(finding("error", "COURSEWARE_EVIDENCE_EMPTY", "\u8BC1\u636E\u6587\u4EF6\u81F3\u5C11\u9700\u8981\u4E00\u4E2A\u6765\u6E90\u548C\u4E00\u4E2A\u4E8B\u5B9E\u58F0\u660E\u3002", { path: file, pointer: "/" }));
  const sourceIds = new Set(sources.map((source) => source?.id));
  const claimIds = new Set(claims.map((claim) => claim?.id));
  if (sourceIds.size !== sources.length || claimIds.size !== claims.length) findings.push(finding("error", "COURSEWARE_ID_DUPLICATE", "\u8BC1\u636E\u6765\u6E90\u6216\u58F0\u660E\u5B58\u5728\u91CD\u590D ID\u3002", { path: file, pointer: "/" }));
  for (const [index, source] of sources.entries()) {
    rejectUnknown(source, ["id", "type", "title", "authors", "publisher", "url", "publishedAt", "accessedAt", "license", "locator"], findings, file, `/sources/${index}`);
    requireId(source?.id, findings, file, `/sources/${index}/id`);
    if (typeof source?.title !== "string" || !source.title.trim() || !sourceTypes.has(source?.type)) findings.push(finding("error", "COURSEWARE_SOURCE_INVALID", "\u6765\u6E90\u5FC5\u987B\u6709\u6807\u9898\u548C\u53D7\u652F\u6301\u7684 type\u3002", { path: file, pointer: `/sources/${index}` }));
  }
  for (const [index, claim] of claims.entries()) {
    rejectUnknown(claim, ["id", "text", "sourceIds", "locators", "verification"], findings, file, `/claims/${index}`);
    requireId(claim?.id, findings, file, `/claims/${index}/id`);
    requireTextMap(claim?.text, findings, file, `/claims/${index}/text`);
    if (!verificationKinds.has(claim?.verification)) findings.push(finding("error", "COURSEWARE_VERIFICATION_INVALID", `\u58F0\u660E ${claim?.id ?? index} \u7684 verification \u4E0D\u53D7\u652F\u6301\u3002`, { path: file, pointer: `/claims/${index}/verification` }));
    for (const id of requireIdList(claim?.sourceIds, findings, file, `/claims/${index}/sourceIds`)) if (!sourceIds.has(id)) findings.push(finding("error", "COURSEWARE_SOURCE_REFERENCE_INVALID", `\u58F0\u660E ${claim?.id} \u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u6765\u6E90 ${id}\u3002`, { path: file, pointer: `/claims/${index}/sourceIds` }));
  }
  for (const [index, asset] of (evidence.assets ?? []).entries()) {
    rejectUnknown(asset, ["path", "sourceIds", "license"], findings, file, `/assets/${index}`);
    if (!safeRelativePath(asset?.path) || typeof asset?.license !== "string" || !asset.license.trim()) findings.push(finding("error", "COURSEWARE_ASSET_INVALID", `\u7D20\u6750 ${index} \u7F3A\u5C11\u5B89\u5168\u8DEF\u5F84\u6216\u8BB8\u53EF\u8BC1\u3002`, { path: file, pointer: `/assets/${index}` }));
    for (const id of requireIdList(asset?.sourceIds, findings, file, `/assets/${index}/sourceIds`)) if (!sourceIds.has(id)) findings.push(finding("error", "COURSEWARE_SOURCE_REFERENCE_INVALID", `\u7D20\u6750 ${asset?.path ?? index} \u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u6765\u6E90 ${id}\u3002`, { path: file, pointer: `/assets/${index}/sourceIds` }));
  }
  for (const [index, scene] of (course?.scenes ?? []).entries()) for (const id of scene.evidenceIds ?? []) if (!claimIds.has(id)) findings.push(finding("error", "COURSEWARE_EVIDENCE_REFERENCE_INVALID", `\u573A\u666F ${scene.id} \u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u8BC1\u636E\u58F0\u660E ${id}\u3002`, { path: courseFile, pointer: `/scenes/${index}/evidenceIds` }));
}
function validateJourneys(journeys, findings, file, courseSets) {
  if (!requireFields(journeys, ["schemaVersion", "journeys"], findings, file)) return;
  rejectUnknown(journeys, ["schemaVersion", "journeys"], findings, file);
  if (journeys.schemaVersion !== 1) findings.push(finding("error", "COURSEWARE_JOURNEY_VERSION_INVALID", "journeys schemaVersion \u5FC5\u987B\u4E3A 1\u3002", { path: file, pointer: "/schemaVersion" }));
  if (!Array.isArray(journeys.journeys) || !journeys.journeys.length) {
    findings.push(finding("error", "COURSEWARE_JOURNEY_EMPTY", "\u81F3\u5C11\u9700\u8981\u4E00\u6761\u5B66\u4E60\u8DEF\u5F84\u3002", { path: file, pointer: "/journeys" }));
    return;
  }
  const ids = journeys.journeys.map((journey) => journey?.id);
  if (new Set(ids).size !== ids.length) findings.push(finding("error", "COURSEWARE_ID_DUPLICATE", "\u5B66\u4E60\u8DEF\u5F84\u5B58\u5728\u91CD\u590D ID\u3002", { path: file, pointer: "/journeys" }));
  for (const [index, journey] of journeys.journeys.entries()) {
    rejectUnknown(journey, ["id", "title", "locale", "steps", "expectsCompletion"], findings, file, `/journeys/${index}`);
    requireId(journey?.id, findings, file, `/journeys/${index}/id`);
    if (typeof journey?.title !== "string" || !journey.title.trim() || !localePattern.test(journey?.locale ?? "") || typeof journey?.expectsCompletion !== "boolean") findings.push(finding("error", "COURSEWARE_JOURNEY_INVALID", `\u5B66\u4E60\u8DEF\u5F84 ${journey?.id ?? index} \u7684\u6807\u9898\u3001\u8BED\u8A00\u6216\u5B8C\u6210\u58F0\u660E\u65E0\u6548\u3002`, { path: file, pointer: `/journeys/${index}` }));
    if (!Array.isArray(journey?.steps) || !journey.steps.length) findings.push(finding("error", "COURSEWARE_JOURNEY_STEPS_EMPTY", `\u5B66\u4E60\u8DEF\u5F84 ${journey?.id} \u6CA1\u6709\u6B65\u9AA4\u3002`, { path: file, pointer: `/journeys/${index}/steps` }));
    for (const [stepIndex, step] of (journey?.steps ?? []).entries()) {
      rejectUnknown(step, ["action", "target", "value", "expect"], findings, file, `/journeys/${index}/steps/${stepIndex}`);
      if (!journeyActions.has(step?.action) || !idPattern.test(step?.target ?? "")) findings.push(finding("error", "COURSEWARE_JOURNEY_STEP_INVALID", `\u5B66\u4E60\u8DEF\u5F84 ${journey?.id} \u5305\u542B\u65E0\u6548\u6B65\u9AA4\u3002`, { path: file, pointer: `/journeys/${index}/steps/${stepIndex}` }));
      if (step?.action === "enter" && !courseSets?.sceneIds.has(step.target)) findings.push(finding("error", "COURSEWARE_JOURNEY_SCENE_INVALID", `\u5B66\u4E60\u8DEF\u5F84 ${journey?.id} \u8FDB\u5165\u4E86\u4E0D\u5B58\u5728\u7684\u573A\u666F ${step.target}\u3002`, { path: file, pointer: `/journeys/${index}/steps/${stepIndex}/target` }));
    }
  }
  if (!journeys.journeys.some((journey) => journey.expectsCompletion === true && journey.steps?.some((step) => step.action === "complete"))) findings.push(finding("error", "COURSEWARE_COMPLETION_JOURNEY_MISSING", "\u81F3\u5C11\u9700\u8981\u4E00\u6761\u53EF\u5B8C\u6210\u8BFE\u7A0B\u7684\u9A8C\u6536\u8DEF\u5F84\u3002", { path: file, pointer: "/journeys" }));
}
async function inspectCoursewareProject(root) {
  const projectRoot = path.resolve(root);
  const findings = [];
  const manifest = await readJson(projectRoot, "mooyu-courseware.json", findings, "COURSEWARE_MANIFEST_INVALID");
  if (manifest) validateManifest(manifest, findings);
  const coursePath = safeRelativePath(manifest?.course) ? manifest.course : "courseware/course.json";
  const evidencePath = safeRelativePath(manifest?.evidence) ? manifest.evidence : "evidence/sources.json";
  const testsPath = safeRelativePath(manifest?.tests) ? manifest.tests : "tests/journeys.json";
  const course = manifest ? await readJson(projectRoot, coursePath, findings) : null;
  const courseSets = course ? validateCourse(course, findings, coursePath) : null;
  const evidence = manifest ? await readJson(projectRoot, evidencePath, findings) : null;
  if (evidence) validateEvidence(evidence, findings, evidencePath, course, coursePath);
  const journeys = manifest ? await readJson(projectRoot, testsPath, findings) : null;
  if (journeys) validateJourneys(journeys, findings, testsPath, courseSets);
  const entry = manifest?.build?.entry ?? "dist/index.html";
  if (safeRelativePath(entry)) try {
    const stat = await fs.lstat(path.join(projectRoot, ...entry.split("/")));
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 16) throw new Error("\u4E0D\u662F\u6709\u6548\u666E\u901A\u6587\u4EF6");
  } catch (error) {
    findings.push(finding("error", "COURSEWARE_ENTRY_MISSING", `\u6784\u5EFA\u5165\u53E3 ${entry} \u4E0D\u53EF\u7528\uFF1A${error.message}`, { path: "mooyu-courseware.json", pointer: "/build/entry" }));
  }
  if (!findings.some((value) => value.severity === "error")) findings.push(finding("info", "COURSEWARE_CONTRACT_READY", "\u8BFE\u7A0B\u7ED3\u6784\u3001\u8BC1\u636E\u94FE\u3001\u5B66\u4E60\u8DEF\u5F84\u548C\u6784\u5EFA\u5165\u53E3\u901A\u8FC7 L0 \u5951\u7EA6\u68C0\u67E5\u3002"));
  findings.push(finding("warning", "COURSEWARE_DOCTOR_LIMIT", "L0 Doctor \u9A8C\u8BC1\u7ED3\u6784\u4E0E\u5F15\u7528\u5B8C\u6574\u6027\uFF0C\u4E0D\u66FF\u4EE3\u5B66\u79D1\u4E13\u5BB6\u5BA1\u6821\u3001\u65E0\u969C\u788D\u5BA1\u8BA1\u6216\u6D4F\u89C8\u5668\u65C5\u7A0B\u6267\u884C\u3002"));
  const summary = { errors: findings.filter((value) => value.severity === "error").length, warnings: findings.filter((value) => value.severity === "warning").length, info: findings.filter((value) => value.severity === "info").length };
  return { reportVersion: COURSEWARE_DOCTOR_REPORT_VERSION, validatorVersion: COURSEWARE_VALIDATOR_VERSION, projectDigest: await publishableProjectDigest(projectRoot, manifest), root: projectRoot, ok: summary.errors === 0, summary, findings };
}

// packages/creator-tools/src/courseware-toolkit.mjs
import crypto2 from "node:crypto";
import fs2 from "node:fs/promises";
import path2 from "node:path";
import { createRequire } from "node:module";
import { crc32, deflateRawSync } from "node:zlib";
var require2 = createRequire(import.meta.url);
var managedDirectory = ".mooyu";
var CoursewareToolkitError = class extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "CoursewareToolkitError";
    this.code = code;
    this.details = details;
  }
};
var sha256 = (value) => crypto2.createHash("sha256").update(value).digest("hex");
var safeRelativePath2 = (value) => typeof value === "string" && value.length > 0 && value.length <= 255 && !path2.isAbsolute(value) && !value.includes("\\") && value.split("/").every((part) => part && part !== "." && part !== "..");
var readJson2 = async (file) => JSON.parse(await fs2.readFile(file, "utf8"));
async function assertNoSymlinkAncestors(target) {
  const resolved = path2.resolve(target);
  const parsed = path2.parse(resolved);
  let current = parsed.root;
  for (const part of resolved.slice(parsed.root.length).split(path2.sep).filter(Boolean)) {
    current = path2.join(current, part);
    const stat = await fs2.lstat(current).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (stat?.isSymbolicLink()) throw new CoursewareToolkitError("COURSEWARE_OUTPUT_SYMLINK_FORBIDDEN", `\u8F93\u51FA\u8DEF\u5F84\u4E0D\u80FD\u7ECF\u8FC7\u7B26\u53F7\u94FE\u63A5\uFF1A${current}`);
    if (!stat) break;
  }
}
async function fileRecord(root, relative) {
  if (!safeRelativePath2(relative)) throw new CoursewareToolkitError("COURSEWARE_PATH_INVALID", `\u4E0D\u5B89\u5168\u7684\u8BFE\u7A0B\u5305\u8DEF\u5F84\uFF1A${relative}`);
  const absolute = path2.join(root, ...relative.split("/"));
  const stat = await fs2.lstat(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new CoursewareToolkitError("COURSEWARE_FILE_INVALID", `${relative} \u5FC5\u987B\u662F\u666E\u901A\u6587\u4EF6\u3002`);
  const bytes = await fs2.readFile(absolute);
  return { relative, absolute, bytes, size: bytes.length, sha256: sha256(bytes) };
}
async function loadCoursewareInventory(root) {
  const projectRoot = path2.resolve(root);
  const manifest = await readJson2(path2.join(projectRoot, "mooyu-courseware.json"));
  const fixed = ["mooyu-courseware.json", manifest.course, manifest.evidence, manifest.tests];
  const records = [];
  for (const relative of fixed) records.push(await fileRecord(projectRoot, relative));
  const distRoot = path2.join(projectRoot, "dist");
  const walk = async (directory, prefix = "dist") => {
    for (const entry of (await fs2.readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name, "en"))) {
      const relative = `${prefix}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new CoursewareToolkitError("COURSEWARE_SYMLINK_FORBIDDEN", `${relative} \u662F\u7B26\u53F7\u94FE\u63A5\u3002`);
      if (entry.isDirectory()) await walk(path2.join(directory, entry.name), relative);
      else if (entry.isFile()) records.push(await fileRecord(projectRoot, relative));
      else throw new CoursewareToolkitError("COURSEWARE_FILE_INVALID", `${relative} \u4E0D\u662F\u666E\u901A\u6587\u4EF6\u3002`);
      if (records.length > 2e3) throw new CoursewareToolkitError("COURSEWARE_FILE_COUNT_EXCEEDED", "\u8BFE\u7A0B\u5305\u6587\u4EF6\u8D85\u8FC7 2000 \u4E2A\u3002");
    }
  };
  await walk(distRoot);
  const deduplicated = [...new Map(records.map((record) => [record.relative, record])).values()].sort((left, right) => left.relative.localeCompare(right.relative, "en"));
  const totalBytes = deduplicated.reduce((sum, record) => sum + record.size, 0);
  if (totalBytes > 128 * 1024 * 1024) throw new CoursewareToolkitError("COURSEWARE_PROJECT_TOO_LARGE", "\u8BFE\u7A0B\u5305\u8D85\u8FC7 128 MiB\u3002");
  const digest2 = sha256(Buffer.concat(deduplicated.flatMap((record) => [Buffer.from(record.relative), Buffer.from([0]), record.bytes, Buffer.from([0])])));
  return { root: projectRoot, manifest, files: deduplicated, totalBytes, projectDigest: digest2 };
}
function zipBuffer(records) {
  const files = [];
  const central = [];
  let offset = 0;
  for (const record of records) {
    const name = Buffer.from(record.relative, "utf8");
    const packed = deflateRawSync(record.bytes, { level: 9 });
    const checksum = crc32(record.bytes);
    const flags = 2048;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(67324752);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(33, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(record.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(33639248);
    header.writeUInt16LE(788, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(flags, 8);
    header.writeUInt16LE(8, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt16LE(33, 14);
    header.writeUInt32LE(checksum, 16);
    header.writeUInt32LE(packed.length, 20);
    header.writeUInt32LE(record.bytes.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(33188 << 16 >>> 0, 38);
    header.writeUInt32LE(offset, 42);
    files.push(local, name, packed);
    central.push(header, name);
    offset += local.length + name.length + packed.length;
  }
  const table = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(101010256);
  end.writeUInt16LE(records.length, 8);
  end.writeUInt16LE(records.length, 10);
  end.writeUInt32LE(table.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...files, table, end]);
}
async function packageCoursewareProject(root, { inspect, outputPath } = {}) {
  const report = await inspect(root);
  if (!report.ok) throw new CoursewareToolkitError("COURSEWARE_DOCTOR_FAILED", "Doctor \u672A\u901A\u8FC7\uFF0C\u4E0D\u80FD\u6253\u5305\u8BFE\u4EF6\u3002", report);
  const inventory = await loadCoursewareInventory(root);
  const bytes = zipBuffer(inventory.files);
  const artifactSha256 = sha256(bytes);
  const destination = path2.resolve(outputPath ?? path2.join(inventory.root, managedDirectory, "packages", `${inventory.manifest.id}-${inventory.projectDigest.slice(0, 12)}.zip`));
  if (path2.extname(destination).toLowerCase() !== ".zip") throw new CoursewareToolkitError("COURSEWARE_PACKAGE_EXTENSION_INVALID", "\u8BFE\u4EF6\u5305\u8F93\u51FA\u5FC5\u987B\u4F7F\u7528 .zip \u6269\u5C55\u540D\u3002");
  await assertNoSymlinkAncestors(destination);
  const destinationStat = await fs2.lstat(destination).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (destinationStat?.isSymbolicLink() || destinationStat && !destinationStat.isFile()) throw new CoursewareToolkitError("COURSEWARE_PACKAGE_PATH_INVALID", "\u8BFE\u4EF6\u5305\u8F93\u51FA\u5FC5\u987B\u662F\u666E\u901A ZIP \u6587\u4EF6\uFF0C\u4E0D\u80FD\u662F\u7B26\u53F7\u94FE\u63A5\u3002");
  const current = destinationStat ? await fs2.readFile(destination) : null;
  if (current) {
    if (sha256(current) !== artifactSha256) throw new CoursewareToolkitError("COURSEWARE_PACKAGE_EXISTS", "\u76EE\u6807\u5305\u5DF2\u5B58\u5728\u4E14\u5185\u5BB9\u4E0D\u540C\uFF1B\u4E0D\u4F1A\u8986\u76D6\u3002");
    return { format: "mooyu.courseware-package", version: 1, coursewareId: inventory.manifest.id, projectDigest: inventory.projectDigest, artifactSha256, artifactBytes: bytes.length, path: destination, reused: true };
  }
  await fs2.mkdir(path2.dirname(destination), { recursive: true });
  await fs2.writeFile(destination, bytes, { flag: "wx" });
  return { format: "mooyu.courseware-package", version: 1, coursewareId: inventory.manifest.id, projectDigest: inventory.projectDigest, artifactSha256, artifactBytes: bytes.length, path: destination, reused: false };
}
var submissionStatePath = (root) => path2.join(path2.resolve(root), managedDirectory, "submission.json");
var uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
var localized = (value, locale) => value?.[locale] ?? value?.["zh-CN"] ?? value?.en ?? Object.values(value ?? {})[0] ?? "";
var stableKey = (value) => `courseware-${sha256(Buffer.from(JSON.stringify(value))).slice(0, 48)}`;
async function readSubmissionState(root, expectedOrigin) {
  const state = await readJson2(submissionStatePath(root)).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (!state) return null;
  if (state.format !== "mooyu.courseware-submission" || state.version !== 1 || !uuidPattern.test(state.workId ?? "") || state.uploadId !== null && !uuidPattern.test(state.uploadId ?? "") || !/^[a-f0-9]{64}$/u.test(state.projectDigest ?? "")) throw new CoursewareToolkitError("COURSEWARE_SUBMISSION_STATE_INVALID", "\u672C\u5730\u8BFE\u4EF6\u63D0\u4EA4\u72B6\u6001\u65E0\u6548\uFF1B\u4E3A\u907F\u514D\u8986\u76D6\u8FDC\u7AEF\u4F5C\u54C1\uFF0C\u64CD\u4F5C\u5DF2\u505C\u6B62\u3002");
  if (state.platformOrigin !== expectedOrigin) throw new CoursewareToolkitError("COURSEWARE_PLATFORM_MISMATCH", `\u8BE5\u8BFE\u4EF6\u5DF2\u5173\u8054 ${state.platformOrigin}\uFF0C\u4E0D\u4F1A\u9759\u9ED8\u64CD\u4F5C\u53E6\u4E00\u4E2A\u5E73\u53F0\u3002`);
  return state;
}
async function writeSubmissionState(root, state) {
  const target = submissionStatePath(root);
  await assertNoSymlinkAncestors(target);
  await fs2.mkdir(path2.dirname(target), { recursive: true });
  const current = await fs2.lstat(target).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (current?.isSymbolicLink() || current && !current.isFile()) throw new CoursewareToolkitError("COURSEWARE_SUBMISSION_STATE_INVALID", "\u8BFE\u4EF6\u63D0\u4EA4\u72B6\u6001\u5FC5\u987B\u662F\u666E\u901A\u6587\u4EF6\u3002");
  await fs2.writeFile(target, `${JSON.stringify(state, null, 2)}
`, { encoding: "utf8", mode: 384, flag: current ? "w" : "wx" });
}
var normalizePlatformOrigin = (value) => {
  let origin;
  try {
    origin = new URL(value).origin;
  } catch {
    throw new CoursewareToolkitError("COURSEWARE_PLATFORM_INVALID", "\u63D0\u4EA4\u5E73\u53F0\u5730\u5740\u65E0\u6548\u3002");
  }
  if (!/^https:/u.test(origin) && !/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/u.test(origin)) throw new CoursewareToolkitError("COURSEWARE_PLATFORM_INVALID", "\u5E73\u53F0\u5730\u5740\u5FC5\u987B\u4F7F\u7528 HTTPS\uFF0C\u6216\u672C\u673A loopback HTTP\u3002");
  return origin;
};
async function submitCoursewareProject(root, { inspect, apiClient, platformUrl, releaseLabel = "courseware-draft" } = {}) {
  if (!apiClient?.createWork || !apiClient?.createUpload || !apiClient?.createUploadGrant || !apiClient?.uploadContentBytes || !apiClient?.completeUpload || !apiClient?.getUpload) throw new CoursewareToolkitError("COURSEWARE_API_REQUIRED", "\u5E73\u53F0 API \u5BA2\u6237\u7AEF\u7F3A\u5C11\u8BFE\u4EF6\u63D0\u4EA4\u6D41\u7A0B\u3002");
  const origin = normalizePlatformOrigin(platformUrl), inventory = await loadCoursewareInventory(root), report = await inspect(root);
  if (!report.ok) throw new CoursewareToolkitError("COURSEWARE_DOCTOR_FAILED", "Doctor \u672A\u901A\u8FC7\uFF0C\u4E0D\u80FD\u63D0\u4EA4\u8BFE\u4EF6\u3002", report);
  const previous = await readSubmissionState(inventory.root, origin);
  if (previous?.uploadId && previous.projectDigest === inventory.projectDigest) {
    const remote = (await apiClient.getUpload(previous.uploadId)).data;
    if (!["failed", "expired"].includes(remote.state)) return { action: "unchanged", workId: previous.workId, upload: remote, projectDigest: inventory.projectDigest, state: previous };
  }
  let workId = previous?.workId;
  if (!workId) {
    const locale = inventory.manifest.defaultLocale, title = localized(inventory.manifest.title, locale), description = localized(inventory.manifest.summary, locale);
    const work = (await apiClient.createWork({ title: title.slice(0, 120), description: description.slice(0, 4e3), instructions: "", kind: "courseware", estimatedMinutes: 10, tags: (inventory.manifest.subjects ?? []).slice(0, 6).map((value) => String(value).slice(0, 20)), agentLabel: "Agent-native Courseware", attributionKind: "publisher" }, { headers: { "Idempotency-Key": stableKey({ origin, coursewareId: inventory.manifest.id, projectDigest: inventory.projectDigest }) } })).data;
    workId = work.id;
    await writeSubmissionState(inventory.root, { format: "mooyu.courseware-submission", version: 1, platformOrigin: origin, workId, uploadId: null, projectDigest: inventory.projectDigest, artifactSha256: null, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
  }
  const packaged = await packageCoursewareProject(inventory.root, { inspect });
  const bytes = await fs2.readFile(packaged.path);
  const normalizedReleaseLabel = String(releaseLabel ?? "").trim().slice(0, 64) || "courseware-draft";
  const upload = (await apiClient.createUpload(workId, { fileName: path2.basename(packaged.path), declaredBytes: String(bytes.length), sha256: packaged.artifactSha256, releaseLabel: normalizedReleaseLabel, autoPublish: false, targetKey: "web", packageType: "web_zip" }, { headers: { "Idempotency-Key": stableKey({ workId, projectDigest: inventory.projectDigest, artifactSha256: packaged.artifactSha256 }) } })).data;
  const state = { format: "mooyu.courseware-submission", version: 1, platformOrigin: origin, workId, uploadId: upload.id, projectDigest: inventory.projectDigest, artifactSha256: packaged.artifactSha256, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
  await writeSubmissionState(inventory.root, state);
  const grant = (await apiClient.createUploadGrant(upload.id)).data;
  await apiClient.uploadContentBytes(upload.id, bytes, grant.token);
  const queued = (await apiClient.completeUpload(upload.id, { headers: { "Idempotency-Key": stableKey({ uploadId: upload.id, action: "complete" }) } })).data;
  return { action: previous ? "updated" : "created", workId, upload: queued, projectDigest: inventory.projectDigest, state };
}
async function coursewareSubmissionStatus(root, { apiClient, platformUrl } = {}) {
  if (!apiClient?.getUpload) throw new CoursewareToolkitError("COURSEWARE_API_REQUIRED", "\u5E73\u53F0 API \u5BA2\u6237\u7AEF\u7F3A\u5C11\u8BFE\u4EF6\u72B6\u6001\u67E5\u8BE2\u80FD\u529B\u3002");
  const origin = normalizePlatformOrigin(platformUrl), state = await readSubmissionState(root, origin);
  if (!state) throw new CoursewareToolkitError("COURSEWARE_NOT_SUBMITTED", "\u8BE5\u8BFE\u4EF6\u5C1A\u672A\u63D0\u4EA4\u3002");
  if (!state.uploadId) throw new CoursewareToolkitError("COURSEWARE_UPLOAD_NOT_CREATED", "\u4F5C\u54C1\u5DF2\u7ECF\u5EFA\u7ACB\uFF0C\u4F46\u8BFE\u4EF6\u4E0A\u4F20\u4EFB\u52A1\u5C1A\u672A\u5EFA\u7ACB\uFF1B\u8BF7\u91CD\u65B0\u6267\u884C submit\u3002");
  const upload = (await apiClient.getUpload(state.uploadId)).data;
  return { state, upload, ready: upload.state === "succeeded" && upload.publicationOutcome === "draft" && uuidPattern.test(upload.releaseId ?? "") };
}
async function publishCoursewareSubmission(root, { apiClient, platformUrl } = {}) {
  if (!apiClient?.publishWorkRelease || !apiClient?.listCreatorWorks) throw new CoursewareToolkitError("COURSEWARE_API_REQUIRED", "\u5E73\u53F0 API \u5BA2\u6237\u7AEF\u7F3A\u5C11\u8BFE\u4EF6\u53D1\u5E03\u6D41\u7A0B\u3002");
  const status = await coursewareSubmissionStatus(root, { apiClient, platformUrl });
  if (!status.ready) throw new CoursewareToolkitError("COURSEWARE_RELEASE_NOT_READY", status.upload.state === "failed" ? `\u5E73\u53F0\u9A8C\u8BC1\u5931\u8D25\uFF1A${status.upload.errorCode ?? "UNKNOWN"}` : "\u53EA\u6709\u5DF2\u901A\u8FC7\u5E73\u53F0\u9A8C\u8BC1\u7684\u79C1\u6709 Release \u624D\u80FD\u53D1\u5E03\u3002", status.upload);
  const work = (await apiClient.listCreatorWorks()).data.find((item3) => item3.id === status.state.workId);
  if (!work) throw new CoursewareToolkitError("COURSEWARE_WORK_NOT_FOUND", "\u5E73\u53F0\u4E2D\u627E\u4E0D\u5230\u672C\u5730\u72B6\u6001\u5173\u8054\u7684\u8BFE\u4EF6\u4F5C\u54C1\u3002");
  const published = (await apiClient.publishWorkRelease(work.id, status.upload.releaseId, work.revision, { headers: { "Idempotency-Key": stableKey({ workId: work.id, releaseId: status.upload.releaseId, action: "publish" }) } })).data;
  await writeSubmissionState(root, { ...status.state, releaseId: status.upload.releaseId, publishedAt: (/* @__PURE__ */ new Date()).toISOString(), updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
  return published;
}

// packages/creator-tools/src/creator-package.mjs
import crypto3 from "node:crypto";
import fs3 from "node:fs/promises";
import path3 from "node:path";
var CREATOR_PACKAGE_FORMAT = "gamehub.creator-package";
var CREATOR_PACKAGE_VERSION = 1;
var CREATOR_DRAFT_STATE_FORMAT = "gamehub.creator-draft-state";
var CREATOR_DRAFT_STATE_VERSION = 1;
var CreatorPackageError = class extends Error {
  constructor(code, message, report = null) {
    super(message);
    this.name = "CreatorPackageError";
    this.code = code;
    this.report = report;
  }
};
var item = (severity, code, message, fix) => ({ severity, code, message, ...fix ? { fix } : {} });
var result = (root, findings) => ({
  version: 1,
  root,
  ok: !findings.some((value) => value.severity === "error"),
  summary: { errors: findings.filter((value) => value.severity === "error").length, warnings: findings.filter((value) => value.severity === "warning").length, info: findings.filter((value) => value.severity === "info").length },
  findings
});
var readJson3 = async (file) => JSON.parse(await fs3.readFile(file, "utf8"));
var canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};
var digest = (value) => crypto3.createHash("sha256").update(canonicalJson(value)).digest("hex");
var safePackagePath = (value) => typeof value === "string" && value.length > 0 && value.length <= 255 && !path3.isAbsolute(value) && !value.includes("\\") && value.split("/").every((part) => part && part !== "." && part !== "..");
var validTextList = (value, maximum = 30) => Array.isArray(value) && value.length >= 1 && value.length <= maximum && value.every((entry) => typeof entry === "string" && entry.trim().length >= 1 && entry.length <= 80);
function inspectBingoSource(content, findings) {
  if (!content || Array.isArray(content) || typeof content !== "object") {
    findings.push(item("error", "BINGO_SOURCE_INVALID", "Bingo source \u5FC5\u987B\u662F JSON \u5BF9\u8C61\u3002"));
    return;
  }
  if (typeof content.tableTitle !== "string" || !content.tableTitle.trim() || content.tableTitle.length > 120) findings.push(item("error", "BINGO_TITLE_INVALID", "tableTitle \u5FC5\u987B\u662F 1 \u81F3 120 \u4E2A\u5B57\u7B26\u3002"));
  if (content.subtitle !== void 0 && (typeof content.subtitle !== "string" || content.subtitle.length > 160)) findings.push(item("error", "BINGO_SUBTITLE_INVALID", "subtitle \u4E0D\u80FD\u8D85\u8FC7 160 \u4E2A\u5B57\u7B26\u3002"));
  if (!validTextList(content.columnHeaders)) findings.push(item("error", "BINGO_COLUMNS_INVALID", "columnHeaders \u5FC5\u987B\u5305\u542B 1 \u81F3 30 \u4E2A\u975E\u7A7A\u6807\u9898\uFF0C\u6BCF\u9879\u4E0D\u8D85\u8FC7 80 \u4E2A\u5B57\u7B26\u3002"));
  if (!validTextList(content.rowHeaders)) findings.push(item("error", "BINGO_ROWS_INVALID", "rowHeaders \u5FC5\u987B\u5305\u542B 1 \u81F3 30 \u4E2A\u975E\u7A7A\u6807\u9898\uFF0C\u6BCF\u9879\u4E0D\u8D85\u8FC7 80 \u4E2A\u5B57\u7B26\u3002"));
  const rows = Array.isArray(content.rowHeaders) ? content.rowHeaders.length : 0;
  const columns = Array.isArray(content.columnHeaders) ? content.columnHeaders.length : 0;
  if (content.cells !== void 0 && (!content.cells || Array.isArray(content.cells) || typeof content.cells !== "object")) findings.push(item("error", "BINGO_CELLS_INVALID", "cells \u5FC5\u987B\u662F\u5750\u6807\u5230\u6587\u5B57\u7684 JSON \u5BF9\u8C61\u3002"));
  else for (const [coordinate, value] of Object.entries(content.cells ?? {})) {
    const match = /^(\d+):(\d+)$/u.exec(coordinate);
    if (!match || Number(match[1]) >= rows || Number(match[2]) < 1 || Number(match[2]) >= columns || typeof value !== "string" || value.length > 200) {
      findings.push(item("error", "BINGO_CELL_INVALID", `\u5355\u5143\u683C ${coordinate} \u7684\u5750\u6807\u6216\u6587\u5B57\u65E0\u6548\u3002`));
    }
  }
  if (!findings.some((finding2) => finding2.severity === "error")) findings.push(item("info", "BINGO_SOURCE_VALID", "Bingo \u7ED3\u6784\u5316\u6E90\u7801\u901A\u8FC7\u672C\u5730\u68C0\u67E5\u3002"));
}
async function inspectAndLoad(root) {
  const projectRoot = path3.resolve(root);
  const findings = [];
  const manifestPath = path3.join(projectRoot, "creator-manifest.json");
  let manifest;
  let content = null;
  let sourcePath = null;
  try {
    const stat = await fs3.lstat(manifestPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error();
    manifest = await readJson3(manifestPath);
  } catch {
    findings.push(item("error", "CREATOR_MANIFEST_INVALID", "\u7F3A\u5C11\u6709\u6548\u7684 creator-manifest.json\u3002", "\u4ECE\u5B98\u65B9\u7ED3\u6784\u5316\u521B\u4F5C\u5305\u6A21\u677F\u5F00\u59CB\u3002"));
    return { report: result(projectRoot, findings), manifest: null, content: null, sourcePath: null };
  }
  if (manifest.format !== CREATOR_PACKAGE_FORMAT || manifest.version !== CREATOR_PACKAGE_VERSION) findings.push(item("error", "CREATOR_FORMAT_UNSUPPORTED", `creator-manifest.json \u5FC5\u987B\u58F0\u660E ${CREATOR_PACKAGE_FORMAT} v${CREATOR_PACKAGE_VERSION}\u3002`));
  if (manifest.studio !== "bingo") findings.push(item("error", "CREATOR_STUDIO_UNSUPPORTED", "\u5F53\u524D\u672C\u5730\u6821\u9A8C\u5668\u53EA\u652F\u6301 studio=bingo\u3002"));
  if (manifest.schemaVersion !== 1) findings.push(item("error", "CREATOR_SCHEMA_UNSUPPORTED", "\u5F53\u524D Bingo schemaVersion \u5FC5\u987B\u4E3A 1\u3002"));
  if (typeof manifest.title !== "string" || !manifest.title.trim() || manifest.title.length > 120) findings.push(item("error", "CREATOR_TITLE_INVALID", "\u521B\u4F5C\u5305\u6807\u9898\u5FC5\u987B\u662F 1 \u81F3 120 \u4E2A\u5B57\u7B26\u3002"));
  if (!safePackagePath(manifest.source) || !manifest.source.startsWith("source/") || !manifest.source.endsWith(".json")) {
    findings.push(item("error", "CREATOR_SOURCE_PATH_INVALID", "source \u5FC5\u987B\u6307\u5411\u5305\u5185 source/ \u76EE\u5F55\u4E0B\u7684 JSON \u6587\u4EF6\u3002"));
  } else {
    sourcePath = path3.resolve(projectRoot, ...manifest.source.split("/"));
    if (!sourcePath.startsWith(`${projectRoot}${path3.sep}`)) findings.push(item("error", "CREATOR_SOURCE_PATH_INVALID", "source \u4E0D\u80FD\u8D8A\u8FC7\u521B\u4F5C\u5305\u6839\u76EE\u5F55\u3002"));
    else try {
      const stat = await fs3.lstat(sourcePath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 1024 * 1024) throw new Error("source \u6587\u4EF6\u5FC5\u987B\u662F 2 \u5B57\u8282\u81F3 1 MiB \u7684\u666E\u901A\u6587\u4EF6\u3002");
      content = await readJson3(sourcePath);
      if (manifest.studio === "bingo") inspectBingoSource(content, findings);
    } catch (error) {
      findings.push(item("error", "CREATOR_SOURCE_INVALID", `\u65E0\u6CD5\u8BFB\u53D6\u7ED3\u6784\u5316\u6E90\u7801\uFF1A${error.message || "\u6587\u4EF6\u65E0\u6548"}`));
    }
  }
  if (!findings.some((finding2) => finding2.severity === "error")) findings.push(item("info", "CREATOR_PACKAGE_READY", "\u521B\u4F5C\u5305\u53EF\u4EE5\u63D0\u4EA4\u4E3A\u5E73\u53F0\u5F85\u53D1\u5E03\u8349\u7A3F\uFF1B\u672C\u62A5\u544A\u4E0D\u4EE3\u8868\u5DF2\u7ECF\u516C\u5F00\u53D1\u5E03\u3002"));
  return { report: result(projectRoot, findings), manifest, content, sourcePath };
}
async function loadCreatorPackage(root) {
  const loaded = await inspectAndLoad(root);
  if (!loaded.report.ok) throw new CreatorPackageError("CREATOR_PACKAGE_INVALID", "\u521B\u4F5C\u5305\u672A\u901A\u8FC7\u672C\u5730\u68C0\u67E5\u3002", loaded.report);
  return {
    root: loaded.report.root,
    manifest: loaded.manifest,
    sourcePath: loaded.sourcePath,
    content: loaded.content,
    draft: {
      studio: loaded.manifest.studio,
      schemaVersion: loaded.manifest.schemaVersion,
      title: loaded.manifest.title.trim(),
      content: loaded.content
    },
    report: loaded.report
  };
}
var statePathFor = (root) => path3.join(root, ".gamehub", "draft.json");
var validState = (value) => value && value.format === CREATOR_DRAFT_STATE_FORMAT && value.version === CREATOR_DRAFT_STATE_VERSION && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value.draftId ?? "") && /^\d+$/u.test(value.revision ?? "") && /^[a-f0-9]{64}$/u.test(value.contentSha256 ?? "") && typeof value.platformOrigin === "string";
async function readDraftState(root) {
  const statePath = statePathFor(root);
  try {
    const stat = await fs3.lstat(statePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 16 * 1024) throw new CreatorPackageError("CREATOR_STATE_INVALID", "\u672C\u5730\u8349\u7A3F\u72B6\u6001\u6587\u4EF6\u4E0D\u662F\u5B89\u5168\u7684\u666E\u901A\u6587\u4EF6\u3002");
    const state = await readJson3(statePath);
    if (!validState(state)) throw new CreatorPackageError("CREATOR_STATE_INVALID", "\u672C\u5730\u8349\u7A3F\u72B6\u6001\u6587\u4EF6\u683C\u5F0F\u65E0\u6548\uFF1B\u4E3A\u907F\u514D\u91CD\u590D\u6216\u8986\u76D6\uFF0C\u63D0\u4EA4\u5DF2\u505C\u6B62\u3002");
    return state;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error instanceof CreatorPackageError) throw error;
    throw new CreatorPackageError("CREATOR_STATE_INVALID", `\u65E0\u6CD5\u8BFB\u53D6\u672C\u5730\u8349\u7A3F\u72B6\u6001\uFF1A${error.message || "\u6587\u4EF6\u65E0\u6548"}`);
  }
}
async function writeDraftState(root, state) {
  const stateDirectory = path3.join(root, ".gamehub");
  try {
    const existing = await fs3.lstat(stateDirectory).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) throw new CreatorPackageError("CREATOR_STATE_PATH_INVALID", ".gamehub \u5FC5\u987B\u662F\u521B\u4F5C\u5305\u5185\u7684\u666E\u901A\u76EE\u5F55\uFF0C\u4E0D\u80FD\u662F\u7B26\u53F7\u94FE\u63A5\u3002");
    if (!existing) await fs3.mkdir(stateDirectory, { mode: 448 });
    const target = statePathFor(root);
    const current = await fs3.lstat(target).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (current?.isSymbolicLink() || current && !current.isFile()) throw new CreatorPackageError("CREATOR_STATE_PATH_INVALID", "draft.json \u5FC5\u987B\u662F\u666E\u901A\u6587\u4EF6\uFF0C\u4E0D\u80FD\u662F\u7B26\u53F7\u94FE\u63A5\u3002");
    await fs3.writeFile(target, `${JSON.stringify(state, null, 2)}
`, { encoding: "utf8", mode: 384, flag: current ? "w" : "wx" });
  } catch (error) {
    if (error instanceof CreatorPackageError) throw error;
    throw new CreatorPackageError("CREATOR_STATE_WRITE_FAILED", `\u5E73\u53F0\u8349\u7A3F\u5DF2\u4FDD\u5B58\uFF0C\u4F46\u672C\u5730\u5173\u8054\u72B6\u6001\u5199\u5165\u5931\u8D25\uFF1A${error.message || "\u65E0\u6CD5\u5199\u5165"}`);
  }
}
async function submitCreatorPackage({ root, apiClient, platformOrigin }) {
  if (!apiClient || typeof apiClient.createCreatorDraft !== "function") throw new CreatorPackageError("CREATOR_API_REQUIRED", "\u7F3A\u5C11\u53EF\u7528\u7684\u5E73\u53F0 API \u5BA2\u6237\u7AEF\u3002");
  const loaded = await loadCreatorPackage(root);
  let origin;
  try {
    origin = new URL(platformOrigin).origin;
  } catch {
    throw new CreatorPackageError("CREATOR_PLATFORM_INVALID", "\u63D0\u4EA4\u65F6\u5FC5\u987B\u63D0\u4F9B\u6709\u6548\u7684\u5E73\u53F0 HTTPS \u5730\u5740\u6216\u672C\u673A loopback \u5730\u5740\u3002");
  }
  if (!/^https:/u.test(origin) && !/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/u.test(origin)) throw new CreatorPackageError("CREATOR_PLATFORM_INVALID", "\u5E73\u53F0\u5730\u5740\u5FC5\u987B\u4F7F\u7528 HTTPS\uFF0C\u6216\u672C\u673A loopback HTTP\u3002");
  const contentSha256 = digest(loaded.draft);
  const state = await readDraftState(loaded.root);
  if (state && state.platformOrigin !== origin) throw new CreatorPackageError("CREATOR_PLATFORM_MISMATCH", `\u8FD9\u4E2A\u521B\u4F5C\u5305\u5DF2\u5173\u8054 ${state.platformOrigin}\uFF0C\u4E0D\u4F1A\u9759\u9ED8\u63D0\u4EA4\u5230\u53E6\u4E00\u4E2A\u5E73\u53F0\u3002`);
  let response;
  let action;
  if (state) {
    if (typeof apiClient.getCreatorDraft !== "function" || typeof apiClient.updateCreatorDraft !== "function") throw new CreatorPackageError("CREATOR_API_REQUIRED", "API \u5BA2\u6237\u7AEF\u4E0D\u652F\u6301\u5B89\u5168\u66F4\u65B0\u8349\u7A3F\u3002");
    const remote = await apiClient.getCreatorDraft(state.draftId);
    if (!remote?.data?.id || String(remote.data.revision) !== state.revision) throw new CreatorPackageError("CREATOR_DRAFT_CONFLICT", "\u5E73\u53F0\u8349\u7A3F\u5DF2\u5728\u522B\u5904\u66F4\u65B0\uFF1B\u4E3A\u907F\u514D\u8986\u76D6\uFF0C\u63D0\u4EA4\u5DF2\u505C\u6B62\u3002\u8BF7\u5148\u5728\u7F51\u9875\u786E\u8BA4\u4FEE\u8BA2\u3002");
    if (state.contentSha256 === contentSha256) return { draft: remote.data, report: loaded.report, manifest: loaded.manifest, action: "unchanged", state };
    response = await apiClient.updateCreatorDraft(state.draftId, {
      title: loaded.draft.title,
      schemaVersion: loaded.draft.schemaVersion,
      content: loaded.draft.content
    }, state.revision, { headers: { "Idempotency-Key": `creator-package-update:${digest({ draftId: state.draftId, revision: state.revision, contentSha256 })}` } });
    action = "updated";
  } else {
    const packageIdentity = digest({ root: loaded.root, platformOrigin: origin, contentSha256 });
    response = await apiClient.createCreatorDraft(loaded.draft, { headers: { "Idempotency-Key": `creator-package-create:${packageIdentity}` } });
    action = "created";
  }
  if (!response?.data?.id) throw new CreatorPackageError("CREATOR_SUBMISSION_INVALID", "\u5E73\u53F0\u6CA1\u6709\u8FD4\u56DE\u6709\u6548\u7684\u8349\u7A3F\u3002");
  const nextState = {
    format: CREATOR_DRAFT_STATE_FORMAT,
    version: CREATOR_DRAFT_STATE_VERSION,
    platformOrigin: origin,
    draftId: response.data.id,
    revision: String(response.data.revision),
    studio: loaded.manifest.studio,
    schemaVersion: loaded.manifest.schemaVersion,
    contentSha256,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  await writeDraftState(loaded.root, nextState);
  return { draft: response.data, report: loaded.report, manifest: loaded.manifest, action, state: nextState };
}

// packages/creator-tools/src/index.mjs
var CREATOR_DOCTOR_REPORT_VERSION = 1;
var item2 = (severity, code, message, fix) => ({ severity, code, message, ...fix ? { fix } : {} });
var result2 = (root, findings) => ({
  version: CREATOR_DOCTOR_REPORT_VERSION,
  root,
  ok: !findings.some((value) => value.severity === "error"),
  summary: { errors: findings.filter((value) => value.severity === "error").length, warnings: findings.filter((value) => value.severity === "warning").length, info: findings.filter((value) => value.severity === "info").length },
  findings
});
var staticTextExtensions = /* @__PURE__ */ new Set([".html", ".htm", ".css", ".js", ".mjs", ".json", ".txt", ".md", ".xml", ".svg", ".twee", ".bitsy", ".puzzlescript"]);
var staticForbiddenExtensions = /* @__PURE__ */ new Set([".exe", ".dll", ".msi", ".bat", ".cmd", ".ps1", ".com", ".scr", ".sys", ".dylib", ".so", ".app", ".apk", ".jar", ".zip", ".rar", ".7z"]);
var staticSecretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{20,}\b/u,
  /\b(?:access|refresh|api)[_-]?token\s*[:=]\s*["'][^"']{12,}["']/iu,
  /\bapi[_-]?key\s*[:=]\s*["'][^"']{12,}["']/iu
];
async function inspectStaticWebProject(root) {
  const projectRoot = path4.resolve(root);
  const findings = [];
  const files = [];
  let totalBytes = 0;
  const walk = async (directory, prefix = "") => {
    let entries;
    try {
      entries = await fs4.readdir(directory, { withFileTypes: true });
    } catch (error) {
      findings.push(item2("error", "WEB_PROJECT_UNREADABLE", `\u65E0\u6CD5\u8BFB\u53D6 ${prefix || "\u9879\u76EE\u76EE\u5F55"}\uFF1A${error.message}`));
      return;
    }
    for (const entry2 of entries) {
      const relative = prefix ? `${prefix}/${entry2.name}` : entry2.name;
      if (entry2.isSymbolicLink()) {
        findings.push(item2("error", "WEB_SYMLINK_FORBIDDEN", `${relative} \u662F\u7B26\u53F7\u94FE\u63A5\u3002`, "\u5C06\u76EE\u6807\u5185\u5BB9\u590D\u5236\u4E3A\u9879\u76EE\u5185\u666E\u901A\u6587\u4EF6\u3002"));
        continue;
      }
      if (entry2.isDirectory()) {
        if (entry2.name === ".git" || entry2.name === "node_modules" || entry2.name === ".gamehub") continue;
        await walk(path4.join(directory, entry2.name), relative);
        continue;
      }
      if (!entry2.isFile()) {
        findings.push(item2("error", "WEB_FILE_TYPE_INVALID", `${relative} \u4E0D\u662F\u666E\u901A\u6587\u4EF6\u3002`));
        continue;
      }
      const absolute = path4.join(directory, entry2.name);
      const stat = await fs4.stat(absolute);
      totalBytes += stat.size;
      files.push({ relative, absolute, size: stat.size, extension: path4.extname(entry2.name).toLowerCase() });
      if (files.length > 2e3) {
        findings.push(item2("error", "WEB_FILE_COUNT_EXCEEDED", "\u9879\u76EE\u6587\u4EF6\u8D85\u8FC7 2000 \u4E2A\u3002", "\u5220\u9664\u6784\u5EFA\u7F13\u5B58\u3001\u6E90\u7801\u4F9D\u8D56\u548C\u65E0\u5173\u6587\u4EF6\uFF0C\u53EA\u4FDD\u7559\u6D4F\u89C8\u5668\u8FD0\u884C\u6240\u9700\u8D44\u6E90\u3002"));
        return;
      }
    }
  };
  await walk(projectRoot);
  const entry = files.find((file) => file.relative === "index.html");
  if (!entry) findings.push(item2("error", "WEB_ENTRY_MISSING", "\u9879\u76EE\u6839\u76EE\u5F55\u7F3A\u5C11 index.html\u3002", "\u628A\u53EF\u73A9\u7684\u7F51\u9875\u5165\u53E3\u653E\u5728\u9879\u76EE\u6839\u76EE\u5F55\u5E76\u547D\u540D\u4E3A index.html\u3002"));
  else if (entry.size < 16 || entry.size > 5 * 1024 * 1024) findings.push(item2("error", "WEB_ENTRY_SIZE_INVALID", "index.html \u5FC5\u987B\u662F 16 \u5B57\u8282\u81F3 5 MiB \u7684\u666E\u901A\u6587\u4EF6\u3002"));
  if (totalBytes > 128 * 1024 * 1024) findings.push(item2("error", "WEB_PROJECT_TOO_LARGE", "\u9879\u76EE\u6587\u4EF6\u603B\u91CF\u8D85\u8FC7 128 MiB\u3002", "\u79FB\u9664\u6E90\u7D20\u6750\u3001\u7F16\u8F91\u5668\u7F13\u5B58\u548C\u672A\u4F7F\u7528\u8D44\u6E90\u3002"));
  for (const file of files) {
    if (staticForbiddenExtensions.has(file.extension)) findings.push(item2("error", "WEB_EXECUTABLE_FORBIDDEN", `${file.relative} \u4E0D\u662F\u7F51\u9875\u53D1\u5E03\u7269\u5141\u8BB8\u7684\u6587\u4EF6\u7C7B\u578B\u3002`, "\u7F51\u9875\u5305\u53EA\u5E94\u5305\u542B\u6D4F\u89C8\u5668\u53EF\u8BFB\u53D6\u7684\u9759\u6001\u8D44\u6E90\u3002"));
    if (/^(?:\.env(?:\.|$)|credentials?|secrets?)(?:\.|$)/iu.test(path4.basename(file.relative))) findings.push(item2("error", "WEB_SECRET_FILE", `${file.relative} \u770B\u8D77\u6765\u662F\u51ED\u636E\u6587\u4EF6\u3002`, "\u4ECE\u53D1\u5E03\u76EE\u5F55\u5220\u9664\u51ED\u636E\uFF0C\u5E76\u7ACB\u5373\u8F6E\u6362\u5DF2\u7ECF\u66B4\u9732\u7684\u5BC6\u94A5\u3002"));
    if (!staticTextExtensions.has(file.extension) || file.size > 1024 * 1024) continue;
    let source;
    try {
      source = await fs4.readFile(file.absolute, "utf8");
    } catch {
      continue;
    }
    if (staticSecretPatterns.some((pattern) => pattern.test(source))) findings.push(item2("error", "WEB_SECRET_REFERENCE", `${file.relative} \u7591\u4F3C\u5305\u542B\u5BC6\u94A5\u6216\u4EE4\u724C\u3002`, "\u4ECE\u6210\u54C1\u4E2D\u79FB\u9664\u51ED\u636E\uFF0C\u5E76\u4F7F\u7528\u5E73\u53F0\u63D0\u4F9B\u7684\u53D7\u9650\u80FD\u529B\u6865\u3002"));
    if (/<(?:script|link)\b[^>]*(?:src|href)\s*=\s*["']https?:\/\//iu.test(source)) findings.push(item2("warning", "WEB_REMOTE_RUNTIME", `${file.relative} \u5F15\u7528\u4E86\u8FDC\u7A0B\u811A\u672C\u6216\u6837\u5F0F\u3002`, "\u5C06\u8FD0\u884C\u4F9D\u8D56\u4FDD\u5B58\u5230\u9879\u76EE\u5185\uFF0C\u786E\u4FDD\u79BB\u7EBF\u548C\u9694\u79BB\u73AF\u5883\u53EF\u8FD0\u884C\u3002"));
    if (/\b(?:file:\/\/\/|[A-Z]:\\Users\\|\/home\/[^/]+\/)/u.test(source)) findings.push(item2("warning", "WEB_LOCAL_PATH_REFERENCE", `${file.relative} \u53EF\u80FD\u5305\u542B\u672C\u673A\u7EDD\u5BF9\u8DEF\u5F84\u3002`, "\u6539\u7528\u9879\u76EE\u5185\u76F8\u5BF9\u8DEF\u5F84\u3002"));
  }
  if (!findings.some((finding2) => finding2.severity === "error")) findings.push(item2("info", "WEB_PROJECT_READY", `\u672C\u5730\u7F51\u9875\u9879\u76EE\u5305\u542B ${files.length} \u4E2A\u6587\u4EF6\u3001${totalBytes} \u5B57\u8282\uFF0C\u53EF\u4EE5\u7EE7\u7EED\u538B\u7F29\u5E76\u4E0A\u4F20\u5E73\u53F0\u6821\u9A8C\u3002`));
  findings.push(item2("warning", "LOCAL_DOCTOR_LIMIT", "\u672C\u5730 Doctor \u53EA\u68C0\u67E5\u53D1\u5E03\u7ED3\u6784\u548C\u660E\u663E\u6CC4\u6F0F\uFF1B\u5E73\u53F0\u4ECD\u4F1A\u91CD\u65B0\u89E3\u5305\u3001\u626B\u63CF\u5E76\u5728\u9694\u79BB\u73AF\u5883\u4E2D\u9A8C\u8BC1\u3002"));
  return result2(projectRoot, findings);
}
async function inspectCoursewareProject2(root) {
  const contract = await inspectCoursewareProject(root);
  const runtime = await inspectStaticWebProject(path4.join(path4.resolve(root), "dist"));
  const findings = [...contract.findings, ...runtime.findings.map((value) => ({ ...value, path: value.path ? `dist/${value.path}` : "dist" }))];
  const summary = { errors: findings.filter((value) => value.severity === "error").length, warnings: findings.filter((value) => value.severity === "warning").length, info: findings.filter((value) => value.severity === "info").length };
  return { ...contract, ok: summary.errors === 0, summary, findings };
}
var submitCoursewareProject2 = (root, options = {}) => submitCoursewareProject(root, { ...options, inspect: inspectCoursewareProject2 });
var coursewareSubmissionStatus2 = (root, options = {}) => coursewareSubmissionStatus(root, options);
var publishCoursewareSubmission2 = (root, options = {}) => publishCoursewareSubmission(root, options);

// extensions/harness/src/credential-store.mjs
import { spawn } from "node:child_process";
var SERVICE = { protocol: "https", host: "credentials.gamehub.local", username: "gamehub-session" };
var TOKEN = /^[A-Za-z0-9_-]{32,512}$/;
var inputFor = (extra) => `${Object.entries({ ...SERVICE, ...extra }).map(([key, value]) => `${key}=${value}`).join("\n")}

`;
var parseOutput = (output) => Object.fromEntries(output.split(/\r?\n/).filter(Boolean).map((line) => {
  const split = line.indexOf("=");
  return split < 1 ? [line, ""] : [line.slice(0, split), line.slice(split + 1)];
}));
var validateTokens = (tokens) => {
  if (!tokens || !TOKEN.test(tokens.accessToken ?? "") || !TOKEN.test(tokens.refreshToken ?? "")) throw Object.assign(new Error("Credential payload is invalid."), { code: "CREDENTIAL_PAYLOAD_INVALID" });
  const serialized = JSON.stringify(tokens);
  if (Buffer.byteLength(serialized) > 8192) throw Object.assign(new Error("Credential payload is too large."), { code: "CREDENTIAL_PAYLOAD_INVALID" });
  return serialized;
};
async function runCredentialManager(action, input = "") {
  const args2 = action === "version" ? ["credential-manager", "--version"] : ["credential-manager", action];
  return new Promise((resolve, reject) => {
    const child = spawn("git", args2, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, GCM_NAMESPACE: "gamehub-harness", GCM_INTERACTIVE: "Never", GCM_PROVIDER: "generic", GCM_AUTODETECT_TIMEOUT: "-1" }
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(Object.assign(new Error("Credential Manager timed out."), { code: "CREDENTIAL_STORE_UNAVAILABLE" }));
    }, 5e3);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > 16384) child.kill();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stderr.length > 16384) child.kill();
    });
    child.once("error", (error) => finish(Object.assign(error, { code: "CREDENTIAL_STORE_UNAVAILABLE" })));
    child.once("close", (code) => code === 0 ? finish(null, stdout) : finish(Object.assign(new Error(stderr.trim() || `Credential Manager exited with ${code}.`), { code: "CREDENTIAL_STORE_UNAVAILABLE" })));
    child.stdin.end(input);
  });
}
async function createGcmCredentialStore({ run = runCredentialManager, platform = process.platform } = {}) {
  let available = true;
  try {
    await run("version");
  } catch {
    available = false;
  }
  const persistence = available ? {
    kind: "os-keychain",
    description: platform === "win32" ? "\u767B\u5F55\u51ED\u636E\u7531 Windows \u51ED\u636E\u7BA1\u7406\u5668\u4FDD\u62A4\u3002" : platform === "darwin" ? "\u767B\u5F55\u51ED\u636E\u7531 macOS \u94A5\u5319\u4E32\u4FDD\u62A4\u3002" : "\u767B\u5F55\u51ED\u636E\u7531\u7CFB\u7EDF\u51ED\u636E\u5E93\u4FDD\u62A4\u3002"
  } : { kind: "memory", description: "\u7CFB\u7EDF\u51ED\u636E\u5E93\u4E0D\u53EF\u7528\uFF0C\u51ED\u636E\u4EC5\u4FDD\u7559\u5230 Harness \u672C\u6B21\u8FD0\u884C\u7ED3\u675F\u3002" };
  const requireStore = () => {
    if (!available) throw Object.assign(new Error("System credential store is unavailable."), { code: "CREDENTIAL_STORE_UNAVAILABLE" });
  };
  return {
    available,
    persistence,
    async get() {
      requireStore();
      let output;
      try {
        output = await run("get", inputFor({}));
      } catch (error) {
        if (error.code === "CREDENTIAL_STORE_UNAVAILABLE") return null;
        throw error;
      }
      const result3 = parseOutput(output);
      if (!result3.password) return null;
      try {
        return JSON.parse(Buffer.from(result3.password, "base64url").toString("utf8"));
      } catch {
        throw Object.assign(new Error("Stored credentials are invalid."), { code: "CREDENTIAL_STORE_CORRUPT" });
      }
    },
    async set(tokens) {
      requireStore();
      const password = Buffer.from(validateTokens(tokens), "utf8").toString("base64url");
      await run("store", inputFor({ password }));
    },
    async clear() {
      requireStore();
      await run("erase", inputFor({}));
    }
  };
}

// scripts/submit-creator-package.mjs
var args = process.argv.slice(2);
var commands = /* @__PURE__ */ new Set(["submit", "status", "publish"]);
var command = commands.has(args[0]) ? args[0] : "submit";
var commandOffset = commands.has(args[0]) ? 1 : 0;
var valueFlags = /* @__PURE__ */ new Set(["--base-url", "--site-url", "--release-label"]);
var valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
};
var positional = args.slice(commandOffset).filter((value, index, values) => !value.startsWith("--") && !valueFlags.has(values[index - 1]));
async function exists(file) {
  try {
    return (await fs5.stat(file)).isFile();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
async function main() {
  const target = path5.resolve(positional[0] ?? ".");
  const baseUrl = new URL(valueAfter("--base-url") ?? process.env.GAMEHUB_API_BASE_URL ?? "https://mooyu.fun").origin;
  const siteUrl = new URL(valueAfter("--site-url") ?? baseUrl);
  const isCourseware = await exists(path5.join(target, "mooyu-courseware.json"));
  if (args.some((value) => /token|secret|key/iu.test(value))) throw new Error("\u63D0\u4EA4\u547D\u4EE4\u4E0D\u63A5\u53D7 token\u3001secret \u6216 key \u53C2\u6570\uFF1B\u8BF7\u5148\u5728\u58A8\u9C7C\u5DE5\u574A Agent \u5BBF\u4E3B\u4E2D\u767B\u5F55\u3002");
  if (!isCourseware && command !== "submit") throw new Error(`${command} \u76EE\u524D\u53EA\u9002\u7528\u4E8E\u5305\u542B mooyu-courseware.json \u7684\u4EA4\u4E92\u8BFE\u4EF6\u9879\u76EE\u3002`);
  const credentials = await createGcmCredentialStore();
  if (!credentials.available) throw new Error("\u7CFB\u7EDF\u51ED\u636E\u5E93\u4E0D\u53EF\u7528\u3002\u8BF7\u5728\u652F\u6301\u58A8\u9C7C\u5DE5\u574A\u5B89\u5168\u51ED\u636E\u6865\u7684 Agent \u5BBF\u4E3B\u4E2D\u767B\u5F55\u540E\u91CD\u8BD5\u3002");
  const apiClient = createApiClient({
    baseUrl,
    getAccessToken: async () => (await credentials.get())?.accessToken ?? null,
    getRefreshToken: async () => (await credentials.get())?.refreshToken ?? null,
    setTokens: (tokens) => credentials.set(tokens)
  });
  let existing = await credentials.get();
  if (!existing) {
    const challenge = (await apiClient.startGitHubDevice({ clientKind: "harness", deviceLabel: "\u58A8\u9C7C\u5DE5\u574A Agent Publisher" })).data;
    process.stderr.write(`\u9700\u8981\u767B\u5F55\u58A8\u9C7C\u5DE5\u574A\u3002\u8BF7\u6253\u5F00 ${challenge.verificationUri} \u5E76\u8F93\u5165\u4EE3\u7801 ${challenge.userCode}
`);
    const expiresAt = Date.parse(challenge.expiresAt);
    let retryAfter = Math.max(1, Number(challenge.intervalSeconds) || 5);
    while (!existing && Date.now() < expiresAt) {
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1e3));
      try {
        const status = (await apiClient.pollGitHubDevice(challenge.challengeId)).data;
        if (status.status === "complete" && status.tokens) {
          await credentials.set(status.tokens);
          existing = status.tokens;
        } else retryAfter = Math.max(1, Number(status.retryAfter) || retryAfter);
      } catch (error) {
        if (error?.status !== 429) throw error;
        retryAfter = Math.min(60, retryAfter + 5);
      }
    }
    if (!existing) throw new Error("GitHub \u8BBE\u5907\u6388\u6743\u5DF2\u8D85\u65F6\uFF0C\u8BF7\u91CD\u65B0\u6267\u884C\u63D0\u4EA4\u547D\u4EE4\u3002");
  }
  let output;
  if (isCourseware && command === "submit") {
    const submitted = await submitCoursewareProject2(target, { apiClient, platformUrl: baseUrl, releaseLabel: valueAfter("--release-label") ?? "courseware-draft" });
    output = { ok: true, type: "courseware", command, action: submitted.action, workId: submitted.workId, uploadId: submitted.upload.id, validationState: submitted.upload.state, publicationOutcome: submitted.upload.publicationOutcome ?? "pending", creatorUrl: new URL("/creator", siteUrl.origin).href };
  } else if (isCourseware && command === "status") {
    const status = await coursewareSubmissionStatus2(target, { apiClient, platformUrl: baseUrl });
    output = { ok: true, type: "courseware", command, workId: status.state.workId, uploadId: status.state.uploadId, releaseId: status.upload.releaseId ?? null, validationState: status.upload.state, publicationOutcome: status.upload.publicationOutcome ?? null, errorCode: status.upload.errorCode ?? null, readyToPublish: status.ready };
  } else if (isCourseware && command === "publish") {
    const published = await publishCoursewareSubmission2(target, { apiClient, platformUrl: baseUrl });
    output = { ok: true, type: "courseware", command, workId: published.work.id, releaseId: published.releaseId, targetKey: published.targetKey, status: "published", publicUrl: new URL(`/w/${published.work.id}`, siteUrl.origin).href };
  } else {
    const submitted = await submitCreatorPackage({ root: target, apiClient, platformOrigin: baseUrl });
    output = { ok: true, type: "creator-draft", command, action: submitted.action, draftId: submitted.draft.id, title: submitted.draft.title, revision: submitted.draft.revision, status: "draft", previewUrl: new URL(`/creator/drafts/${submitted.draft.id}`, siteUrl.origin).href };
  }
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}
`);
    return;
  }
  if (output.type === "courseware" && command === "submit") {
    console.log(output.action === "unchanged" ? "\u8BFE\u4EF6\u5185\u5BB9\u672A\u53D8\u5316\uFF0C\u6CBF\u7528\u73B0\u6709\u79C1\u6709\u63D0\u4EA4\u3002" : "\u8BFE\u4EF6\u5DF2\u7ECF\u63D0\u4EA4\u5230\u5E73\u53F0\u9A8C\u8BC1\u961F\u5217\u3002");
    console.log(`\u4F5C\u54C1 ID\uFF1A${output.workId}`);
    console.log(`\u4E0A\u4F20\u4EFB\u52A1\uFF1A${output.uploadId}`);
    console.log(`\u9A8C\u8BC1\u72B6\u6001\uFF1A${output.validationState}`);
    console.log("\u8FD9\u4E00\u6B65\u4E0D\u4F1A\u516C\u5F00\u53D1\u5E03\u3002\u9A8C\u8BC1\u5B8C\u6210\u540E\u5148\u8FD0\u884C status\uFF1B\u53EA\u6709\u4F60\u660E\u786E\u51B3\u5B9A\u516C\u5F00\u65F6\u624D\u8FD0\u884C publish\u3002");
  } else if (output.type === "courseware" && command === "status") {
    console.log(`\u9A8C\u8BC1\u72B6\u6001\uFF1A${output.validationState}`);
    console.log(`\u53D1\u5E03\u72B6\u6001\uFF1A${output.publicationOutcome ?? "pending"}`);
    if (output.errorCode) console.log(`\u5931\u8D25\u4EE3\u7801\uFF1A${output.errorCode}`);
    console.log(output.readyToPublish ? "\u5DF2\u901A\u8FC7\u9A8C\u8BC1\uFF0C\u53EF\u4EE5\u5728\u660E\u786E\u786E\u8BA4\u540E\u8FD0\u884C publish\u3002" : "\u5C1A\u4E0D\u53EF\u53D1\u5E03\uFF0C\u8BF7\u7B49\u5F85\u9A8C\u8BC1\u5B8C\u6210\u6216\u4FEE\u590D\u9A8C\u8BC1\u9519\u8BEF\u3002");
  } else if (output.type === "courseware" && command === "publish") {
    console.log("\u8BFE\u4EF6\u5DF2\u7ECF\u516C\u5F00\u53D1\u5E03\u3002");
    console.log(`\u4F5C\u54C1 ID\uFF1A${output.workId}`);
    console.log(`\u516C\u5F00\u5730\u5740\uFF1A${output.publicUrl}`);
  } else {
    const actionLabel = output.action === "updated" ? "\u5DF2\u66F4\u65B0\u5F85\u53D1\u5E03\u8349\u7A3F" : output.action === "unchanged" ? "\u5185\u5BB9\u672A\u53D8\u5316\uFF0C\u6CBF\u7528\u5F85\u53D1\u5E03\u8349\u7A3F" : "\u5DF2\u521B\u5EFA\u5F85\u53D1\u5E03\u8349\u7A3F";
    console.log(`${actionLabel}\uFF1A${output.title}`);
    console.log(`\u8349\u7A3F ID\uFF1A${output.draftId}`);
    console.log(`\u9884\u89C8\u5730\u5740\uFF1A${output.previewUrl}`);
    console.log("\u8FD9\u4E00\u6B65\u4E0D\u4F1A\u81EA\u52A8\u516C\u5F00\u53D1\u5E03\u3002\u8BF7\u5728\u5E73\u53F0\u9884\u89C8\u3001\u6784\u5EFA\u5E76\u786E\u8BA4\u53D1\u5E03\u3002");
  }
}
main().catch((error) => {
  const output = { ok: false, command, code: error?.code ?? "CREATOR_SUBMIT_FAILED", message: String(error?.message || error), ...error?.report ? { report: error.report } : {}, ...error?.details ? { details: error.details } : {} };
  if (args.includes("--json")) process.stderr.write(`${JSON.stringify(output, null, 2)}
`);
  else {
    console.error(`${command === "publish" ? "\u53D1\u5E03" : command === "status" ? "\u67E5\u8BE2" : "\u63D0\u4EA4"}\u5931\u8D25\uFF1A${output.message}`);
    for (const finding2 of error?.report?.findings?.filter((value) => value.severity === "error") ?? error?.details?.findings?.filter((value) => value.severity === "error") ?? []) console.error(`- ${finding2.message}`);
  }
  process.exitCode = 1;
});
