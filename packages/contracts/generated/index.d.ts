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

export type UIntString = `${number}`;
export type UUID = string;

export interface ErrorResponse { error: { code: string; message: string; requestId: UUID; retryable: boolean; details: Record<string, unknown> } }
export interface Profile { id: UUID; displayName: string; role: "user" | "admin"; canPublish: boolean }
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
export interface Work { id: UUID; ownerUserId: UUID; title: string; description: string; instructions: string; kind: WorkKind; state: WorkState; visibility: Visibility; revision: UIntString; firstPublishedAt: string | null; coverUrl: string | null; estimatedMinutes: number; tags: string[]; agentLabel: string | null; repositoryUrl: string | null; licenseSpdx: string | null; creatorDisplayName: string | null; playCount: number; saveCount: number; targets: WorkTarget[] }
export interface ReleaseSummary { id: UUID; targetKey: TargetKey; label: string; packageType: PackageType; validationState: ReleaseValidationState; servingState: ReleaseServingState; createdAt: string }
export interface UploadJob { id: UUID; workId: UUID; targetKey: TargetKey; packageType: PackageType; state: UploadState; publicationOutcome: PublicationOutcome; declaredBytes: UIntString; actualBytes: UIntString | null; createdAt: string; expiresAt: string; errorCode: string | null }
export interface LaunchDescriptor { apiVersion: 1; workId: UUID; releaseId: UUID; releaseLabel: string; entryUrl: string; runtimeOrigin: string; playerProtocol: { min: number; max: number }; capabilities: { fullscreen: boolean; pointerLock: boolean } }
export interface ContentReport { id: UUID; workId: UUID; workTitle: string; reporterUserId: UUID; category: "unsafe" | "malware" | "harassment" | "copyright" | "other"; details: string; status: "open" | "resolved" | "dismissed"; resolutionAction: "suspend" | "dismiss" | null; resolutionNote: string | null; createdAt: string; resolvedAt: string | null }
export interface ModerationAuditEvent { id: UUID; reportId: UUID; workId: UUID; workTitle: string; actorUserId: UUID; action: "suspend" | "dismiss"; reason: string; beforeState: Record<string, unknown>; afterState: Record<string, unknown>; createdAt: string }
export interface AccountAvatar { kind: "preset" | "upload"; presetKey: "cat" | "robot" | "sprout" | "fox" | "ghost" | "wizard" | null; url: string | null; staticUrl: string | null; mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp" | null; animated: boolean }
export interface SocialProfile { id: UUID; displayName: string; bio: string; visibility: "public" | "followers" | "private"; avatar: AccountAvatar; followerCount: number; followingCount: number; isFollowing: boolean; isMe: boolean }
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

