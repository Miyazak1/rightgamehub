// scripts/submit-creator-package.mjs
import path2 from "node:path";

// packages/platform-api-client/src/index.mjs
var ApiError = class extends Error {
  constructor({ code = "NETWORK_ERROR", message = "\u8BF7\u6C42\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002", status = 0, retryable = true, requestId = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.requestId = requestId;
  }
};
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
  async function request(path3, { method = "GET", body, rawBody, headers = {}, signal, auth = false, idempotent = false, allowRefresh = true, keepalive = false } = {}) {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new Error("timeout")), timeoutMs);
    const combined = globalThis.AbortSignal?.any ? AbortSignal.any([timeout.signal, ...signal ? [signal] : []]) : timeout.signal;
    const token = auth ? await getAccessToken() : null;
    try {
      const response = await fetchImpl(`${baseUrl}${path3}`, {
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
          return request(path3, { method, body, rawBody, headers, signal, auth, idempotent, allowRefresh: false, keepalive });
        }
        if (await refreshSession(signal)) return request(path3, { method, body, rawBody, headers, signal, auth, idempotent, allowRefresh: false, keepalive });
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new ApiError({ status: response.status, ...payload.error ?? {}, message: payload.error?.message ?? `\u8BF7\u6C42\u5931\u8D25 (${response.status})` });
      return { data: payload.data, etag: response.headers.get("etag") };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error?.name === "AbortError" || timeout.signal.aborted) throw new ApiError({ code: "REQUEST_TIMEOUT", message: "\u8FDE\u63A5\u8D85\u65F6\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\u540E\u91CD\u8BD5\u3002" });
      throw new ApiError({ message: "\u6682\u65F6\u65E0\u6CD5\u8FDE\u63A5 GameHub\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002" });
    } finally {
      clearTimeout(timer);
    }
  }
  async function authenticatedDownload(path3, options = {}) {
    const token = await getAccessToken();
    const response = await fetchImpl(`${baseUrl}${path3}`, { signal: options.signal, headers: { Accept: options.accept ?? "application/zip", ...token ? { Authorization: `Bearer ${token}` } : {} } });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new ApiError({ status: response.status, ...payload.error ?? {}, message: payload.error?.message ?? `\u4E0B\u8F7D\u5931\u8D25 (${response.status})` });
    }
    return { data: await response.blob(), digest: response.headers.get("digest") };
  }
  return {
    listWorks: ({ limit = 20, kind } = {}, options) => request(`/v1/works?limit=${limit}${kind ? `&kind=${encodeURIComponent(kind)}` : ""}`, options),
    getWork: (id, options) => request(`/v1/works/${encodeURIComponent(id)}`, options),
    getLaunch: (id, releaseId, options) => request(`/v1/works/${encodeURIComponent(id)}/launch${releaseId ? `?releaseId=${encodeURIComponent(releaseId)}` : ""}`, options),
    createGameShare: (workId, body, options) => request(`/v1/works/${encodeURIComponent(workId)}/game-shares`, { ...options, method: "POST", body, auth: true, idempotent: true }),
    getGameShare: (code, options) => request(`/v1/game-shares/${encodeURIComponent(code)}`, options),
    releaseDownloadUrl: (workId, releaseId) => `${baseUrl}/v1/works/${encodeURIComponent(workId)}/releases/${encodeURIComponent(releaseId)}/download`,
    trackAnalytics: (events, options) => request("/v1/analytics/events", { ...options, method: "POST", body: { events }, auth: true, keepalive: true }),
    getAdminAnalytics: (days = 7, options) => request(`/v1/admin/analytics?days=${encodeURIComponent(days)}`, { ...options, auth: true }),
    getCreatorAnalytics: (days = 30, options) => request(`/v1/creator/analytics?days=${encodeURIComponent(days)}`, { ...options, auth: true }),
    getAdminStorage: (options) => request("/v1/admin/storage", { ...options, auth: true }),
    createRealtimeTicket: (options) => request("/v1/realtime/tickets", { ...options, method: "POST", auth: true }),
    listMultiplayerModes: (workId, options) => request(`/v1/works/${encodeURIComponent(workId)}/multiplayer-modes`, options),
    createMultiplayerMode: (body, options) => request("/v1/admin/multiplayer/modes", { ...options, method: "POST", body, auth: true }),
    listMultiplayerRooms: (modeId, limit = 30, query = "", options) => request(`/v1/multiplayer/rooms?modeId=${encodeURIComponent(modeId)}&limit=${encodeURIComponent(limit)}${query ? `&query=${encodeURIComponent(query)}` : ""}`, options),
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
      const path3 = variant === "static" ? avatar?.staticUrl : avatar?.url;
      return path3 ? `${baseUrl}${path3}` : null;
    },
    listLibrary: (options) => request("/v1/me/library", { ...options, auth: true }),
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
    createCreatorFeedback: (workId, body, options) => request(`/v1/works/${encodeURIComponent(workId)}/feedback`, { ...options, method: "POST", body, auth: true }),
    listCreatorFeedback: (status = "all", options) => request(`/v1/creator/feedback?status=${encodeURIComponent(status)}`, { ...options, auth: true }),
    createCreatorFeedbackIssueDraft: (feedbackId, options) => request(`/v1/creator/feedback/${encodeURIComponent(feedbackId)}/issue-draft`, { ...options, method: "POST", auth: true }),
    updateCreatorFeedback: (feedbackId, body, options) => request(`/v1/creator/feedback/${encodeURIComponent(feedbackId)}`, { ...options, method: "PATCH", body, auth: true }),
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
    uploadWorkCover: (workId, file, options) => request(`/v1/creator/works/${encodeURIComponent(workId)}/cover`, { ...options, method: "PUT", rawBody: file, headers: { "Content-Type": file.type, ...options?.headers ?? {} }, auth: true }),
    listWorkReleases: (workId, options) => request(`/v1/creator/works/${encodeURIComponent(workId)}/releases`, { ...options, auth: true }),
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
    completeUpload: (uploadId, options) => request(`/v1/creator/uploads/${encodeURIComponent(uploadId)}/complete`, { ...options, method: "POST", auth: true, idempotent: true }),
    getUpload: (id, options) => request(`/v1/creator/uploads/${encodeURIComponent(id)}`, { ...options, auth: true })
  };
}

// packages/creator-tools/src/creator-package.mjs
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
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
var readJson = async (file) => JSON.parse(await fs.readFile(file, "utf8"));
var canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};
var digest = (value) => crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
var safePackagePath = (value) => typeof value === "string" && value.length > 0 && value.length <= 255 && !path.isAbsolute(value) && !value.includes("\\") && value.split("/").every((part) => part && part !== "." && part !== "..");
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
  if (!findings.some((finding) => finding.severity === "error")) findings.push(item("info", "BINGO_SOURCE_VALID", "Bingo \u7ED3\u6784\u5316\u6E90\u7801\u901A\u8FC7\u672C\u5730\u68C0\u67E5\u3002"));
}
async function inspectAndLoad(root) {
  const projectRoot = path.resolve(root);
  const findings = [];
  const manifestPath = path.join(projectRoot, "creator-manifest.json");
  let manifest;
  let content = null;
  let sourcePath = null;
  try {
    const stat = await fs.lstat(manifestPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error();
    manifest = await readJson(manifestPath);
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
    sourcePath = path.resolve(projectRoot, ...manifest.source.split("/"));
    if (!sourcePath.startsWith(`${projectRoot}${path.sep}`)) findings.push(item("error", "CREATOR_SOURCE_PATH_INVALID", "source \u4E0D\u80FD\u8D8A\u8FC7\u521B\u4F5C\u5305\u6839\u76EE\u5F55\u3002"));
    else try {
      const stat = await fs.lstat(sourcePath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 1024 * 1024) throw new Error("source \u6587\u4EF6\u5FC5\u987B\u662F 2 \u5B57\u8282\u81F3 1 MiB \u7684\u666E\u901A\u6587\u4EF6\u3002");
      content = await readJson(sourcePath);
      if (manifest.studio === "bingo") inspectBingoSource(content, findings);
    } catch (error) {
      findings.push(item("error", "CREATOR_SOURCE_INVALID", `\u65E0\u6CD5\u8BFB\u53D6\u7ED3\u6784\u5316\u6E90\u7801\uFF1A${error.message || "\u6587\u4EF6\u65E0\u6548"}`));
    }
  }
  if (!findings.some((finding) => finding.severity === "error")) findings.push(item("info", "CREATOR_PACKAGE_READY", "\u521B\u4F5C\u5305\u53EF\u4EE5\u63D0\u4EA4\u4E3A\u5E73\u53F0\u5F85\u53D1\u5E03\u8349\u7A3F\uFF1B\u672C\u62A5\u544A\u4E0D\u4EE3\u8868\u5DF2\u7ECF\u516C\u5F00\u53D1\u5E03\u3002"));
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
var statePathFor = (root) => path.join(root, ".gamehub", "draft.json");
var validState = (value) => value && value.format === CREATOR_DRAFT_STATE_FORMAT && value.version === CREATOR_DRAFT_STATE_VERSION && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value.draftId ?? "") && /^\d+$/u.test(value.revision ?? "") && /^[a-f0-9]{64}$/u.test(value.contentSha256 ?? "") && typeof value.platformOrigin === "string";
async function readDraftState(root) {
  const statePath = statePathFor(root);
  try {
    const stat = await fs.lstat(statePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 16 * 1024) throw new CreatorPackageError("CREATOR_STATE_INVALID", "\u672C\u5730\u8349\u7A3F\u72B6\u6001\u6587\u4EF6\u4E0D\u662F\u5B89\u5168\u7684\u666E\u901A\u6587\u4EF6\u3002");
    const state = await readJson(statePath);
    if (!validState(state)) throw new CreatorPackageError("CREATOR_STATE_INVALID", "\u672C\u5730\u8349\u7A3F\u72B6\u6001\u6587\u4EF6\u683C\u5F0F\u65E0\u6548\uFF1B\u4E3A\u907F\u514D\u91CD\u590D\u6216\u8986\u76D6\uFF0C\u63D0\u4EA4\u5DF2\u505C\u6B62\u3002");
    return state;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error instanceof CreatorPackageError) throw error;
    throw new CreatorPackageError("CREATOR_STATE_INVALID", `\u65E0\u6CD5\u8BFB\u53D6\u672C\u5730\u8349\u7A3F\u72B6\u6001\uFF1A${error.message || "\u6587\u4EF6\u65E0\u6548"}`);
  }
}
async function writeDraftState(root, state) {
  const stateDirectory = path.join(root, ".gamehub");
  try {
    const existing = await fs.lstat(stateDirectory).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) throw new CreatorPackageError("CREATOR_STATE_PATH_INVALID", ".gamehub \u5FC5\u987B\u662F\u521B\u4F5C\u5305\u5185\u7684\u666E\u901A\u76EE\u5F55\uFF0C\u4E0D\u80FD\u662F\u7B26\u53F7\u94FE\u63A5\u3002");
    if (!existing) await fs.mkdir(stateDirectory, { mode: 448 });
    const target = statePathFor(root);
    const current = await fs.lstat(target).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (current?.isSymbolicLink() || current && !current.isFile()) throw new CreatorPackageError("CREATOR_STATE_PATH_INVALID", "draft.json \u5FC5\u987B\u662F\u666E\u901A\u6587\u4EF6\uFF0C\u4E0D\u80FD\u662F\u7B26\u53F7\u94FE\u63A5\u3002");
    await fs.writeFile(target, `${JSON.stringify(state, null, 2)}
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
      const result2 = parseOutput(output);
      if (!result2.password) return null;
      try {
        return JSON.parse(Buffer.from(result2.password, "base64url").toString("utf8"));
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
var valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
};
async function main() {
  const target = args.find((value, index) => !value.startsWith("--") && (index === 0 || !["--base-url", "--site-url"].includes(args[index - 1]))) ?? ".";
  const baseUrl = new URL(valueAfter("--base-url") ?? process.env.GAMEHUB_API_BASE_URL ?? "https://mooyu.fun").origin;
  const siteUrl = new URL(valueAfter("--site-url") ?? baseUrl);
  if (args.some((value) => /token|secret|key/iu.test(value))) {
    throw new Error("\u63D0\u4EA4\u547D\u4EE4\u4E0D\u63A5\u53D7 token\u3001secret \u6216 key \u53C2\u6570\uFF1B\u8BF7\u5148\u5728 GameHub Agent \u5BBF\u4E3B\u4E2D\u767B\u5F55\u3002");
  }
  const credentials = await createGcmCredentialStore();
  if (!credentials.available) throw new Error("\u7CFB\u7EDF\u51ED\u636E\u5E93\u4E0D\u53EF\u7528\u3002\u8BF7\u5728\u652F\u6301 GameHub \u5B89\u5168\u51ED\u636E\u6865\u7684 Agent \u5BBF\u4E3B\u4E2D\u767B\u5F55\u540E\u91CD\u8BD5\u3002");
  const apiClient = createApiClient({
    baseUrl,
    getAccessToken: async () => (await credentials.get())?.accessToken ?? null,
    getRefreshToken: async () => (await credentials.get())?.refreshToken ?? null,
    setTokens: (tokens) => credentials.set(tokens)
  });
  let existing = await credentials.get();
  if (!existing) {
    const challenge = (await apiClient.startGitHubDevice({ clientKind: "harness", deviceLabel: "GameHub Agent Publisher" })).data;
    process.stderr.write(`\u9700\u8981\u767B\u5F55 GameHub\u3002\u8BF7\u6253\u5F00 ${challenge.verificationUri} \u5E76\u8F93\u5165\u4EE3\u7801 ${challenge.userCode}
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
  const submitted = await submitCreatorPackage({ root: path2.resolve(target), apiClient, platformOrigin: baseUrl });
  siteUrl.hash = `/creator/drafts/${submitted.draft.id}`;
  const output = {
    ok: true,
    draftId: submitted.draft.id,
    title: submitted.draft.title,
    revision: submitted.draft.revision,
    action: submitted.action,
    previewUrl: siteUrl.href,
    status: "draft"
  };
  if (args.includes("--json")) process.stdout.write(`${JSON.stringify(output, null, 2)}
`);
  else {
    const actionLabel = output.action === "updated" ? "\u5DF2\u66F4\u65B0\u5F85\u53D1\u5E03\u8349\u7A3F" : output.action === "unchanged" ? "\u5185\u5BB9\u672A\u53D8\u5316\uFF0C\u6CBF\u7528\u5F85\u53D1\u5E03\u8349\u7A3F" : "\u5DF2\u521B\u5EFA\u5F85\u53D1\u5E03\u8349\u7A3F";
    console.log(`${actionLabel}\uFF1A${output.title}`);
    console.log(`\u8349\u7A3F ID\uFF1A${output.draftId}`);
    console.log(`\u9884\u89C8\u5730\u5740\uFF1A${output.previewUrl}`);
    console.log("\u8FD9\u4E00\u6B65\u4E0D\u4F1A\u81EA\u52A8\u516C\u5F00\u53D1\u5E03\u3002\u8BF7\u5728\u5E73\u53F0\u9884\u89C8\u3001\u6784\u5EFA\u5E76\u786E\u8BA4\u53D1\u5E03\u3002");
  }
}
main().catch((error) => {
  const output = { ok: false, code: error?.code ?? "CREATOR_SUBMIT_FAILED", message: String(error?.message || error), ...error?.report ? { report: error.report } : {} };
  if (args.includes("--json")) process.stderr.write(`${JSON.stringify(output, null, 2)}
`);
  else {
    console.error(`\u63D0\u4EA4\u5931\u8D25\uFF1A${output.message}`);
    for (const finding of error?.report?.findings?.filter((value) => value.severity === "error") ?? []) console.error(`- ${finding.message}`);
  }
  process.exitCode = 1;
});
