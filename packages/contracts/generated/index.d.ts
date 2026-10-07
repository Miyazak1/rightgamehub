// Generated from src/schema.mjs. Do not edit by hand.

export type WorkKind = "game" | "creative" | "tool";
export type WorkState = "draft" | "published" | "withdrawn" | "suspended";
export type Visibility = "private" | "public";
export type TargetKey = "web" | "windows-x64" | "windows-x86" | "windows-arm64";
export type PackageType = "web_zip" | "windows_portable_zip" | "windows_standalone_exe" | "windows_installer_exe";
export type UploadState = "created" | "receiving" | "uploaded" | "queued" | "validating" | "scanning" | "succeeded" | "failed" | "expired" | "review_required";
export type PublicationOutcome = "pending" | "published" | "draft" | "skipped_newer_intent" | "blocked";
export type ReleaseValidationState = "processing" | "scanning" | "ready" | "failed" | "review_required";
export type ReleaseServingState = "disabled" | "enabled" | "revoked";
export type SourceBuildState = "queued" | "preparing" | "building" | "packaging" | "validating" | "ready" | "failed" | "superseded";

export type UIntString = `${number}`;
export type UUID = string;

export type SaveHealthQuery = { afterWorkId?: string };
export type SavePolicyParams = { policyId: string };
export type SavePolicyControl = { id: string; workId: string; namespace: string; status: "draft" | "review" | "active" | "retired"; writesPaused: boolean; version: string; schemaMin: number; schemaMax: number; maxSlots: number; maxDocumentBytes: number; maxLiveBytes: number; maxHistoryBytes: number; historyVersions: number; historyDays: number };
export type SaveTraffic = { channel: "production" | "preview"; operation: "read" | "write" | "delete" | "restore" | "receipt"; requests: number; successes: number; errors: Array<{ code: string; count: number }>; p50MsUpperBound: number | null; p95MsUpperBound: number | null; p99MsUpperBound: number | null };
export type SaveHealthWork = { workId: string; title: string; policies: Array<SavePolicyControl>; usage: Array<{ channel: "production" | "preview"; liveSlots: number; liveBytes: string; historyBytes: string; lastReconciledAt: string | null }>; traffic: Array<SaveTraffic> };
export type SaveHealthPage = { items: Array<SaveHealthWork>; nextAfterWorkId: string | null; windowHours: 24 };
export type SaveCapacityControl = { retainedBytes: string; maxPayloadBytes: string; writesPaused: boolean; version: string };
export type SaveCapacityOverview = { retainedBytes: string; maxPayloadBytes: string; writesPaused: boolean; version: string; databaseBytes: string; saveTableBytes: string; diskFreeBytes: string | null; storage: { required: boolean; allowed: boolean; code: string; observedAt: string | null; totalBytes: string | null; walBytes: string | null }; maintenance: { lastTickAt: string; lastRunAt: string | null; status: "ok" | "idle" | "busy" | "error"; code: string; errorScopes: number } | null; telemetryDropped: number };
export type SavePolicyPauseRequest = { operationId: string; reason: string; expectedVersion: string; writesPaused: boolean };
export type SaveCapacityRequest = { operationId: string; reason: string; expectedVersion: string; writesPaused: boolean; maxPayloadBytes: number };
export type SaveMaintenanceCursor = { userId: string; channel: "production" | "preview" };
export type SaveMaintenanceRequest = { operationId: string; reason: string; mode: "inspect" | "repair" | "cleanup"; after?: { userId: string; channel: "production" | "preview" } };
export type SaveMaintenanceResult = { scopes: number; mismatchScopes: number; repairedScopes: number; purgedPayloads: number; sampledPayloads: number; invalidPayloads: number; missingCurrentPayloads: number; next: SaveMaintenanceCursor | null };
export type SaveAdminAuditPage = { items: Array<{ id: string; actorUserId: string; action: "policy_pause" | "capacity" | "inspect" | "repair" | "cleanup"; workId: string | null; reason: string; requestId: string; beforeState: Record<string, unknown>; result: Record<string, unknown>; createdAt: string }> };
export interface ErrorResponse { error: { code: string; message: string; requestId: UUID; retryable: boolean; details: Record<string, unknown> } }
export interface Profile { id: UUID; displayName: string; role: "user" | "admin"; canPublish: boolean }
export interface GameSaveWriteReceiptRequest { schemaVersion: number; contentType: "application/json" | "application/octet-stream"; sha256: string }
export interface GameSaveWriteReceipt { result: GameSaveWriteResult | null }
export interface SaveLibraryQuery { afterSlotId?: UUID }
export interface SaveLibrarySlotParams { slotId: UUID }
export interface SaveLibraryRevisionParams extends SaveLibrarySlotParams { revisionId: UUID }
export interface SaveLibraryHistoryQuery { beforeRevision?: UIntString }
export interface SaveLibrarySlot extends GameSaveMetadata { slotId: UUID; workId: UUID; workTitle: string; channel: "production" | "preview" }
export interface SaveLibraryPage { items: SaveLibrarySlot[]; nextAfterSlotId: UUID | null }
export interface SaveLibraryHistory extends GameSaveHistory { slot: SaveLibrarySlot }
export interface GameSaveParams { workId: UUID }
export interface GameSaveSlotParams extends GameSaveParams { slotKey: string }
export interface GameSaveQuery { namespace: string }
export interface GameSaveHistoryQuery extends GameSaveQuery { beforeRevision?: UIntString }
export interface RestoreGameSaveRequest { revisionId: UUID }
export interface GameSaveMetadata { slot: string; namespace: string; revisionId: UUID; revision: UIntString; etag: string; schemaVersion: number | null; contentType: "application/json" | "application/octet-stream" | null; contentEncoding: "identity"; sha256: string | null; bytes: number; updatedAt: string; deleted: boolean; restoredFromRevisionId: UUID | null }
export interface GameSaveWriteResult extends GameSaveMetadata { historyDegraded: boolean; durability: "cloud" }
export interface GameSaveHistory { items: Array<GameSaveMetadata & { payloadAvailable: boolean }>; nextBeforeRevision: UIntString | null }
export interface GameSavePolicy { writesPaused: boolean; namespace: string; status: "active" | "retired"; maxSlots: number; maxDocumentBytes: number; maxLiveBytes: number; maxHistoryBytes: number; historyVersions: number; historyDays: number; schemaMin: number; schemaMax: number; contentTypes: Array<"application/json" | "application/octet-stream"> }
export interface CreateGameSessionRequest { workId: UUID; releaseId: UUID; channel: "production" | "preview"; launchNonce: UUID }
export interface GameSession { gameSessionId: string; expiresAt: string; capabilities: Array<"identity" | "multiplayer" | "cloudSave" | "competition"> }
export interface GameSessionStatus { active: true; expiresAt: string; capabilities: GameSession["capabilities"] }
export interface GameSessionRevocation { revoked: true }
export interface RealtimeTicket { ticket: string; websocketUrl: string; expiresAt: string; protocol: "gamehub.realtime.v1" }
export interface MultiplayerRoomSettings { turnSeconds?: number; spectators?: boolean; reconnectGraceSeconds?: number }
export interface MultiplayerMode { id: UUID; workId: UUID; key: string; name: string; authority: "platform_authoritative" | "external_authoritative" | "relay_unverified"; minPlayers: number; maxPlayers: number; rulesetVersion: string; config: MultiplayerRoomSettings; enabled: boolean }
export interface MultiplayerRoomMember { userId: UUID; displayName: string; seat: number; role: "player" | "spectator"; ready: boolean; connectionState: "online" | "offline" | "grace"; joinedAt: string }
export interface MultiplayerRoom { id: UUID; modeId: UUID; ownerUserId: UUID; locator: string; visibility: "public" | "private" | "invite_only"; status: "open" | "starting" | "in_match" | "closed"; capacity: number; settings: MultiplayerRoomSettings; revision: UIntString; expiresAt: string; createdAt: string; members: MultiplayerRoomMember[] }
export interface MultiplayerInvite { code: string; expiresAt: string }
export interface MultiplayerMatchPlayer { userId: UUID; displayName: string; seat: number; team: number | null; result: "win" | "loss" | "draw" | "none" | null }
export interface MultiplayerMatch { id: UUID; roomId: UUID | null; modeId: UUID; rulesetVersion: string; status: "pending" | "active" | "finishing" | "completed" | "aborted"; revision: UIntString; nextEventSeq: UIntString; turnUserId: UUID | null; turnDeadlineAt: string | null; startedAt: string | null; endedAt: string | null; terminationReason: "normal" | "resignation" | "timeout" | "disconnect" | "admin_abort" | "adapter_error" | null; result: Record<string, unknown> | null; players: MultiplayerMatchPlayer[]; publicState: Record<string, unknown> | null }
export interface MultiplayerMatchEvent { seq: UIntString; type: string; actorUserId: UUID | null; commandId: UUID | null; payload: Record<string, unknown>; stateHash: string; createdAt: string }
export interface MultiplayerReplay { match: MultiplayerMatch; events: MultiplayerMatchEvent[] }
export interface MultiplayerAdminOverview { rooms: Record<string, number>; matches: Record<string, number>; overdueMatches: number; matchesCreated24h: number; matchesCompleted24h: number; matchesAborted24h: number }
export interface MultiplayerAbortResult { match: MultiplayerMatch; event: MultiplayerMatchEvent }
export interface MultiplayerAdminEvent { id: UUID; actorUserId: UUID; actorDisplayName: string; matchId: UUID; action: "abort"; reason: string; beforeState: Record<string, unknown>; afterState: Record<string, unknown>; createdAt: string }
export interface WorkTarget { targetKey: TargetKey; state: WorkState; currentReleaseId: UUID | null; revision: UIntString }
export interface Work { id: UUID; ownerUserId: UUID; title: string; description: string; instructions: string; kind: WorkKind; state: WorkState; visibility: Visibility; revision: UIntString; firstPublishedAt: string | null; coverUrl: string | null; estimatedMinutes: number; tags: string[]; agentLabel: string | null; repositoryUrl: string | null; licenseSpdx: string | null; creatorDisplayName: string | null; creatorHandle: string | null; playCount: number; saveCount: number; targets: WorkTarget[] }
export interface ReleaseSummary { id: UUID; targetKey: TargetKey; label: string; packageType: PackageType; validationState: ReleaseValidationState; servingState: ReleaseServingState; createdAt: string }
export interface SourceBuildJob { id: UUID; workId: UUID; revisionId: UUID; commitSha: string; treeSha: string; templateKey: "static-v1"; templateVersion: "1"; config: Record<string, unknown>; configSha256: string; builderImageDigest: string; releaseLabel: string; state: SourceBuildState; errorCode: string | null; artifactSha256: string | null; artifactBytes: UIntString | null; uploadId: UUID | null; releaseId: UUID | null; createdAt: string; startedAt: string | null; completedAt: string | null; updatedAt: string }
export interface UploadJob { id: UUID; workId: UUID; targetKey: TargetKey; packageType: PackageType; state: UploadState; publicationOutcome: PublicationOutcome; declaredBytes: UIntString; actualBytes: UIntString | null; createdAt: string; expiresAt: string; errorCode: string | null }
export interface LaunchDescriptor { apiVersion: 1; workId: UUID; releaseId: UUID; releaseLabel: string; entryUrl: string; runtimeOrigin: string; playerProtocol: { min: number; max: number }; capabilities: { fullscreen: boolean; pointerLock: boolean; multiplayer: boolean; cloudSave?: boolean; competition?: boolean } }
export interface ContentReport { id: UUID; workId: UUID; workTitle: string; reporterUserId: UUID; category: "unsafe" | "malware" | "harassment" | "copyright" | "other"; details: string; status: "open" | "resolved" | "dismissed"; resolutionAction: "suspend" | "dismiss" | null; resolutionNote: string | null; createdAt: string; resolvedAt: string | null }
export interface ContributionIdentity { id: UUID; handle: string; displayName: string }
export interface ContributionTask { id: UUID; workId: UUID; workTitle: string; feedbackId: UUID | null; title: string; description: string; difficulty: "starter" | "intermediate" | "advanced"; skills: string[]; status: "draft" | "open" | "claimed" | "submitted" | "completed" | "closed"; repositoryUrl: string | null; issueUrl: string | null; submissionUrl: string | null; submissionNote: string; author: ContributionIdentity; claimant: ContributionIdentity | null; publishedAt: string | null; claimedAt: string | null; submittedAt: string | null; completedAt: string | null; createdAt: string; updatedAt: string }
export interface PublicProfileContribution { taskId: UUID; title: string; workId: UUID; workTitle: string; repositoryUrl: string | null; issueUrl: string | null; submissionUrl: string; completedAt: string }
export interface ModerationAuditEvent { id: UUID; reportId: UUID; workId: UUID; workTitle: string; actorUserId: UUID; action: "suspend" | "dismiss"; reason: string; beforeState: Record<string, unknown>; afterState: Record<string, unknown>; createdAt: string }
export interface AccountAvatar { kind: "preset" | "upload"; presetKey: "cat" | "robot" | "sprout" | "fox" | "ghost" | "wizard" | null; url: string | null; staticUrl: string | null; mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp" | null; animated: boolean }
export interface SocialProfile { id: UUID; handle: string; displayName: string; bio: string; visibility: "public" | "followers" | "private"; avatar: AccountAvatar; followerCount: number; followingCount: number; isFollowing: boolean; isMe: boolean }
export interface PublicProfileLink { kind: "github" | "website" | "portfolio" | "bilibili" | "other"; label: string; url: string }
export interface PublicGitHubRepository { id: UUID; owner: string; name: string; url: string }
export interface PublicProfileActivity { type: "work_published" | "guess_baike_completed"; occurredAt: string; title: string; workId: UUID | null }
export interface PublicProfileBadge { key: string; name: string; description: string }
export interface PublicProfileAchievements { totalDays: number; longestStreak: number; completedChallenges: number; challengeWins: number; bestDailyRank: number | null; latestDailyRank: number | null; latestRankDate: string | null; badges: PublicProfileBadge[] }
export interface PublicUserProfile { id: UUID; handle: string; displayName: string; headline: string; about: string; visibility: "public" | "followers" | "private"; libraryVisibility: "public" | "followers" | "private"; libraryVisible: boolean; collaborationStatus: "not_looking" | "open_to_collaboration" | "available_for_hire"; skills: string[]; activityVisibility: "public" | "followers" | "private"; activityVisible: boolean; activity: PublicProfileActivity[]; achievementsVisibility: "public" | "followers" | "private"; achievementsVisible: boolean; achievements: PublicProfileAchievements | null; creator: boolean; role: "user" | "admin"; joinedAt: string; avatar: AccountAvatar; followerCount: number; followingCount: number; isFollowing: boolean; isMe: boolean; links: PublicProfileLink[]; githubRepositories: PublicGitHubRepository[]; contributions: PublicProfileContribution[]; featuredWorks: Work[]; works: Work[]; library: Work[] }
export interface UpdatePublicProfileRequest { handle: string; headline: string; about: string; visibility: "public" | "followers" | "private"; libraryVisibility?: "public" | "followers" | "private"; collaborationStatus?: "not_looking" | "open_to_collaboration" | "available_for_hire"; skills?: string[]; activityVisibility?: "public" | "followers" | "private"; achievementsVisibility?: "public" | "followers" | "private"; links: PublicProfileLink[]; featuredWorkIds: UUID[]; githubRepositoryIds?: UUID[] }
export type GuessBaikeReaction = "gg" | "spark" | "wow" | "coffee";
export interface GuessBaikeLeaderboardEntry { rank: number; player: SocialProfile; guessedCount: number; elapsedSeconds: number; hints: number; completedAt: string; reactions: Partial<Record<GuessBaikeReaction, number>>; myReaction: GuessBaikeReaction | null }
export interface GuessBaikePuzzle { id: string; title: string; aliases: string[]; category: string; sourceKind: string; sourceTitle: string; sourceUrl: string; sourceRevision: number; sourceUpdatedAt: string; license: string; introHanCount: number; content: string }
export interface GuessBaikeAdminPuzzle extends GuessBaikePuzzle { status: "ready" | "disabled"; qualityReason: string | null; scheduledDates: string[] }
export interface GuessBaikeSchedule { date: string; puzzleId: string }
export interface GuessBaikeAutomationRun { id: UUID; status: "running" | "succeeded" | "failed"; startedAt: string; finishedAt: string | null; fetchedCount: number; acceptedCount: number; scheduledCount: number; errorCode: string | null; errorMessage: string | null }
export interface GuessBaikeAutomationStatus { enabled: boolean; running: boolean; intervalMinutes: number; batchSize: number; scheduleDays: number; readyCount: number; scheduledCount: number; lastRun: GuessBaikeAutomationRun | null }
export interface SocialNotification { id: UUID; type: "follow" | "reaction" | "challenge_complete"; actor: SocialProfile; puzzleDate: string | null; reaction: GuessBaikeReaction | null; challengeCode: string | null; outcome: "win" | "loss" | "draw" | null; read: boolean; createdAt: string }
export interface GuessBaikeChallenge { code: string; puzzleDate: string; expiresAt: string }
export interface GuessBaikeChallengeDetail extends GuessBaikeChallenge { creator: SocialProfile; score: { guessedCount: number; elapsedSeconds: number; hints: number }; status: "open" | "accepted" | "completed"; acceptedByMe: boolean }
export interface GuessBaikeChallengeState { accepted: boolean; completed: boolean; outcome: "win" | "loss" | "draw" | null }
export interface GuessBaikeChallengeComparison { outcome: "win" | "loss" | "draw"; creator: { guessedCount: number; elapsedSeconds: number; hints: number }; participant: { guessedCount: number; elapsedSeconds: number; hints: number } }
export interface GuessBaikeChallengeHistory extends GuessBaikeChallenge { role: "creator" | "participant"; status: "pending" | "completed" | "expired"; outcome: "win" | "loss" | "draw" | null; opponent: SocialProfile | null; myScore: { guessedCount: number; elapsedSeconds: number; hints: number }; opponentScore: { guessedCount: number; elapsedSeconds: number; hints: number } | null }
export interface RetentionBadge { key: "first_break" | "streak_3" | "streak_7" | "challenger" | "duel_winner"; name: string; description: string; unlocked: boolean }
export interface PlayerRetention { currentStreak: number; longestStreak: number; totalDays: number; completedChallenges: number; badges: RetentionBadge[] }
export interface NotificationPreferences { follow: boolean; reaction: boolean; challenge: boolean }

