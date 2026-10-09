export class ApiError extends Error {
  constructor({ code = 'NETWORK_ERROR', message = '请求失败，请稍后重试。', status = 0, retryable = true, requestId = null } = {}) {
    super(message); this.name = 'ApiError'; this.code = code; this.status = status; this.retryable = retryable; this.requestId = requestId;
  }
}

const randomKey = () => globalThis.crypto?.randomUUID?.() ?? `gh-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function createApiClient({ baseUrl = '', fetchImpl = globalThis.fetch, getAccessToken = () => null, getRefreshToken = () => null, setTokens = () => {}, timeoutMs = 15000, xhrFactory = () => new XMLHttpRequest() } = {}) {
  let refreshPromise = null;
  const refreshSession = signal => {
    if (!refreshPromise) {
      refreshPromise = (async () => {
        const refreshToken = await getRefreshToken();
        if (!refreshToken) return false;
        const refreshed = await request('/v1/auth/refresh', { method: 'POST', body: { refreshToken }, signal, allowRefresh: false });
        await setTokens(refreshed.data);
        return true;
      })().finally(() => { refreshPromise = null; });
    }
    return refreshPromise;
  };
  async function request(path, { method = 'GET', body, rawBody, headers = {}, signal, auth = false, idempotent = false, allowRefresh = true, keepalive = false } = {}) {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new Error('timeout')), timeoutMs);
    const combined = globalThis.AbortSignal?.any ? AbortSignal.any([timeout.signal, ...(signal ? [signal] : [])]) : timeout.signal;
    const token = auth ? await getAccessToken() : null;
    try {
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
          return request(path, { method, body, rawBody, headers, signal, auth, idempotent, allowRefresh: false, keepalive });
        }
        if (await refreshSession(signal)) return request(path, { method, body, rawBody, headers, signal, auth, idempotent, allowRefresh: false, keepalive });
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new ApiError({ status: response.status, ...(payload.error ?? {}), message: payload.error?.message ?? `请求失败 (${response.status})` });
      return { data: payload.data, etag: response.headers.get('etag') };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error?.name === 'AbortError' || timeout.signal.aborted) throw new ApiError({ code: 'REQUEST_TIMEOUT', message: '连接超时，请检查网络后重试。' });
      throw new ApiError({ message: '暂时无法连接 GameHub，请稍后重试。' });
    } finally { clearTimeout(timer); }
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
    listWorks: ({ limit = 20, kind } = {}, options) => request(`/v1/works?limit=${limit}${kind ? `&kind=${encodeURIComponent(kind)}` : ''}`, options),
    getWork: (id, options) => request(`/v1/works/${encodeURIComponent(id)}`, options),
    getLaunch: (id, releaseId, options) => request(`/v1/works/${encodeURIComponent(id)}/launch${releaseId ? `?releaseId=${encodeURIComponent(releaseId)}` : ''}`, options),
    createGameShare: (workId, body, options) => request(`/v1/works/${encodeURIComponent(workId)}/game-shares`, { ...options, method: 'POST',body,auth: true,idempotent: true }),
    getGameShare: (code, options) => request(`/v1/game-shares/${encodeURIComponent(code)}`, options),
    releaseDownloadUrl: (workId, releaseId) => `${baseUrl}/v1/works/${encodeURIComponent(workId)}/releases/${encodeURIComponent(releaseId)}/download`,
    trackAnalytics: (events, options) => request('/v1/analytics/events', { ...options, method: 'POST', body: { events }, auth: true, keepalive: true }),
    getAdminAnalytics: (days = 7, options) => request(`/v1/admin/analytics?days=${encodeURIComponent(days)}`, { ...options, auth: true }),
    getCreatorAnalytics: (days = 30, options) => request(`/v1/creator/analytics?days=${encodeURIComponent(days)}`, { ...options, auth: true }),
    getAdminStorage: options => request('/v1/admin/storage', { ...options, auth: true }),
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
    getCreatorApplication: options => request('/v1/me/creator-application', { ...options, auth: true }),
    applyForCreator: (statement, options) => request('/v1/me/creator-application', { ...options, method: 'POST', body: { statement }, auth: true }),
    listCreatorApplications: (status = 'pending', options) => request(`/v1/admin/creator-applications?status=${encodeURIComponent(status)}`, { ...options, auth: true }),
    decideCreatorApplication: (applicationId, body, options) => request(`/v1/admin/creator-applications/${encodeURIComponent(applicationId)}/decision`, { ...options, method: 'POST', body, auth: true }),
    updateProfile: (body, options) => request('/v1/me', { ...options, method: 'PATCH', body, auth: true }),
    selectAvatar: (presetKey, options) => request('/v1/me/avatar', { ...options, method: 'PATCH', body: { presetKey }, auth: true }),
    uploadAvatar: (file, options) => request('/v1/me/avatar', { ...options, method: 'PUT', rawBody: file, headers: { 'Content-Type': file.type, ...(options?.headers ?? {}) }, auth: true }),
    avatarUrl: (avatar, variant = 'animated') => { const path = variant === 'static' ? avatar?.staticUrl : avatar?.url; return path ? `${baseUrl}${path}` : null; },
    listLibrary: options => request('/v1/me/library', { ...options, auth: true }),
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
    createCreatorFeedback: (workId, body, options) => request(`/v1/works/${encodeURIComponent(workId)}/feedback`, { ...options, method: 'POST', body, auth: true }),
    listCreatorFeedback: (status = 'all', options) => request(`/v1/creator/feedback?status=${encodeURIComponent(status)}`, { ...options, auth: true }),
    createCreatorFeedbackIssueDraft: (feedbackId, options) => request(`/v1/creator/feedback/${encodeURIComponent(feedbackId)}/issue-draft`, { ...options, method: 'POST', auth: true }),
    updateCreatorFeedback: (feedbackId, body, options) => request(`/v1/creator/feedback/${encodeURIComponent(feedbackId)}`, { ...options, method: 'PATCH', body, auth: true }),
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
    uploadWorkCover: (workId, file, options) => request(`/v1/creator/works/${encodeURIComponent(workId)}/cover`, { ...options, method: 'PUT', rawBody: file, headers: { 'Content-Type': file.type, ...(options?.headers ?? {}) }, auth: true }),
    listWorkReleases: (workId, options) => request(`/v1/creator/works/${encodeURIComponent(workId)}/releases`, { ...options, auth: true }),
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
    completeUpload: (uploadId, options) => request(`/v1/creator/uploads/${encodeURIComponent(uploadId)}/complete`, { ...options, method: 'POST', auth: true, idempotent: true }),
    getUpload: (id, options) => request(`/v1/creator/uploads/${encodeURIComponent(id)}`, { ...options, auth: true }),
  };
}
