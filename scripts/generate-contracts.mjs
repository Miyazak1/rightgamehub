import {competitionSchemas} from '../packages/contracts/src/competition-schema.mjs';
import {saveOperationsSchemas} from '../packages/contracts/src/save-operations-schema.mjs';
import {communitySchemas} from '../packages/contracts/src/community-schema.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createOpenApiDocument, enums, operations, schemas } from '../packages/contracts/src/schema.mjs';

const root = path.resolve(import.meta.dirname, '..');
const outputDir = path.join(root, 'packages', 'contracts', 'generated');
const openApiPath = path.join(outputDir, 'openapi.json');
const typesPath = path.join(outputDir, 'index.d.ts');

function validateSource() {
  assert.equal(new Set(operations.map(item => item.operationId)).size, operations.length, 'operationId must be unique');
  for (const [name, schema] of Object.entries(schemas)) {
    assert.equal(schema.type, 'object', `${name} must be a strict object schema`);
    assert.equal(schema.additionalProperties, false, `${name} must reject unknown fields`);
  }
  for (const operation of operations) {
    if (operation.request) assert.ok(schemas[operation.request], `missing request schema ${operation.request}`);
    if (!operation.binaryResponse) assert.ok(schemas[operation.response], `missing response schema ${operation.response}`);
  }
}

function operationSchemaType(s) {
  if(s.type==='object'&&s.additionalProperties&&typeof s.additionalProperties==='object')return 'Record<string, '+operationSchemaType(s.additionalProperties)+'>';
  if(s.$ref)return s.$ref.split('/').at(-1);
  if(s.oneOf)return s.oneOf.map(operationSchemaType).join(' | ');
  if(s.const!==undefined)return JSON.stringify(s.const);
  if(s.enum)return s.enum.map(v=>JSON.stringify(v)).join(' | ');
  if(s.type==='object')return s.additionalProperties===true?'Record<string, unknown>':'{ '+Object.entries(s.properties).map(([k,v])=>k+(s.required?.includes(k)?'':'?')+': '+operationSchemaType(v)).join('; ')+' }';
  if(s.type==='array')return 'Array<'+operationSchemaType(s.items)+'>';
  return s.type==='integer'?'number':s.type;
}
function generateTypes() {
  const lines = [
    '// Generated from src/schema.mjs. Do not edit by hand.',
    '',
  ];
  for (const [name, values] of Object.entries(enums)) {
    lines.push(`export type ${name} = ${values.map(value => JSON.stringify(value)).join(' | ')};`);
  }
  lines.push('', 'export type UIntString = `${number}`;', 'export type UUID = string;', '');
  for(const [name,schema] of Object.entries(saveOperationsSchemas)) lines.push('export type '+name+' = '+operationSchemaType(schema)+';');
  for(const [name,schema] of Object.entries(communitySchemas)) lines.push('export type '+name+' = '+operationSchemaType(schema)+';');
  for(const [name,schema] of Object.entries(competitionSchemas)) lines.push('export type '+name+' = '+operationSchemaType(schema)+';');
  for(const name of ['WorkLeaderboardEntry','WorkLeaderboard']) lines.push('export type '+name+' = '+operationSchemaType(schemas[name])+';');
  lines.push('export interface ErrorResponse { error: { code: string; message: string; requestId: UUID; retryable: boolean; details: Record<string, unknown> } }');
  lines.push('export interface Profile { id: UUID; displayName: string; role: "user" | "admin"; canPublish: boolean }');
  lines.push('export interface GameSaveWriteReceiptRequest { schemaVersion: number; contentType: "application/json" | "application/octet-stream"; sha256: string }');
  lines.push('export interface GameSaveWriteReceipt { result: GameSaveWriteResult | null }');
  lines.push('export interface SaveLibraryQuery { afterSlotId?: UUID }');
  lines.push('export interface SaveLibrarySlotParams { slotId: UUID }');
  lines.push('export interface SaveLibraryRevisionParams extends SaveLibrarySlotParams { revisionId: UUID }');
  lines.push('export interface SaveLibraryHistoryQuery { beforeRevision?: UIntString }');
  lines.push('export interface SaveLibrarySlot extends GameSaveMetadata { slotId: UUID; workId: UUID; workTitle: string; channel: "production" | "preview" }');
  lines.push('export interface SaveLibraryPage { items: SaveLibrarySlot[]; nextAfterSlotId: UUID | null }');
  lines.push('export interface SaveLibraryHistory extends GameSaveHistory { slot: SaveLibrarySlot }');
  lines.push("export interface GameSaveParams { workId: UUID }");
  lines.push("export interface GameSaveSlotParams extends GameSaveParams { slotKey: string }");
  lines.push("export interface GameSaveQuery { namespace: string }");
  lines.push("export interface GameSaveHistoryQuery extends GameSaveQuery { beforeRevision?: UIntString }");
  lines.push("export interface RestoreGameSaveRequest { revisionId: UUID }");
  lines.push("export interface GameSaveMetadata { slot: string; namespace: string; revisionId: UUID; revision: UIntString; etag: string; schemaVersion: number | null; contentType: \"application/json\" | \"application/octet-stream\" | null; contentEncoding: \"identity\"; sha256: string | null; bytes: number; updatedAt: string; deleted: boolean; restoredFromRevisionId: UUID | null }");
  lines.push("export interface GameSaveWriteResult extends GameSaveMetadata { historyDegraded: boolean; durability: \"cloud\" }");
  lines.push("export interface GameSaveHistory { items: Array<GameSaveMetadata & { payloadAvailable: boolean }>; nextBeforeRevision: UIntString | null }");
  lines.push("export interface GameSavePolicy { writesPaused: boolean; namespace: string; status: \"active\" | \"retired\"; maxSlots: number; maxDocumentBytes: number; maxLiveBytes: number; maxHistoryBytes: number; historyVersions: number; historyDays: number; schemaMin: number; schemaMax: number; contentTypes: Array<\"application/json\" | \"application/octet-stream\"> }");
  lines.push('export interface CreateGameSessionRequest { workId: UUID; releaseId: UUID; channel: "production" | "preview"; launchNonce: UUID }');
  lines.push('export interface GameSession { gameSessionId: string; expiresAt: string; capabilities: Array<"identity" | "multiplayer" | "cloudSave" | "competition"> }');
  lines.push('export interface GameSessionStatus { active: true; expiresAt: string; capabilities: GameSession["capabilities"] }');
  lines.push('export interface GameSessionRevocation { revoked: true }');
  lines.push('export interface RealtimeTicket { ticket: string; websocketUrl: string; expiresAt: string; protocol: "gamehub.realtime.v1" }');
  lines.push('export interface MultiplayerRoomSettings { turnSeconds?: number; spectators?: boolean; reconnectGraceSeconds?: number }');
  lines.push('export interface MultiplayerMode { id: UUID; workId: UUID; key: string; name: string; authority: "platform_authoritative" | "external_authoritative" | "relay_unverified"; minPlayers: number; maxPlayers: number; rulesetVersion: string; config: MultiplayerRoomSettings; enabled: boolean }');
  lines.push('export interface MultiplayerRoomMember { userId: UUID; displayName: string; seat: number; role: "player" | "spectator"; ready: boolean; connectionState: "online" | "offline" | "grace"; joinedAt: string }');
  lines.push('export interface MultiplayerRoom { id: UUID; modeId: UUID; ownerUserId: UUID; locator: string; visibility: "public" | "private" | "invite_only"; status: "open" | "starting" | "in_match" | "closed"; capacity: number; settings: MultiplayerRoomSettings; revision: UIntString; expiresAt: string; createdAt: string; members: MultiplayerRoomMember[] }');
  lines.push('export interface MultiplayerInvite { code: string; expiresAt: string }');
  lines.push('export interface MultiplayerMatchPlayer { userId: UUID; displayName: string; seat: number; team: number | null; result: "win" | "loss" | "draw" | "none" | null }');
  lines.push('export interface MultiplayerMatch { id: UUID; roomId: UUID | null; modeId: UUID; rulesetVersion: string; status: "pending" | "active" | "finishing" | "completed" | "aborted"; revision: UIntString; nextEventSeq: UIntString; turnUserId: UUID | null; turnDeadlineAt: string | null; startedAt: string | null; endedAt: string | null; terminationReason: "normal" | "resignation" | "timeout" | "disconnect" | "admin_abort" | "adapter_error" | null; result: Record<string, unknown> | null; players: MultiplayerMatchPlayer[]; publicState: Record<string, unknown> | null }');
  lines.push('export interface MultiplayerMatchEvent { seq: UIntString; type: string; actorUserId: UUID | null; commandId: UUID | null; payload: Record<string, unknown>; stateHash: string; createdAt: string }');
  lines.push('export interface MultiplayerReplay { match: MultiplayerMatch; events: MultiplayerMatchEvent[] }');
  lines.push('export interface MultiplayerAdminOverview { rooms: Record<string, number>; matches: Record<string, number>; overdueMatches: number; matchesCreated24h: number; matchesCompleted24h: number; matchesAborted24h: number }');
  lines.push('export interface MultiplayerAbortResult { match: MultiplayerMatch; event: MultiplayerMatchEvent }');
  lines.push('export interface MultiplayerAdminEvent { id: UUID; actorUserId: UUID; actorDisplayName: string; matchId: UUID; action: "abort"; reason: string; beforeState: Record<string, unknown>; afterState: Record<string, unknown>; createdAt: string }');
  lines.push('export interface WorkTarget { targetKey: TargetKey; state: WorkState; currentReleaseId: UUID | null; revision: UIntString }');
  lines.push('export interface Work { id: UUID; ownerUserId: UUID; title: string; description: string; instructions: string; kind: WorkKind; state: WorkState; visibility: Visibility; revision: UIntString; firstPublishedAt: string | null; coverUrl: string | null; estimatedMinutes: number; tags: string[]; agentLabel: string | null; repositoryUrl: string | null; licenseSpdx: string | null; creatorDisplayName: string | null; creatorHandle: string | null; playCount: number; saveCount: number; targets: WorkTarget[] }');
  lines.push('export interface ReleaseSummary { id: UUID; targetKey: TargetKey; label: string; packageType: PackageType; validationState: ReleaseValidationState; servingState: ReleaseServingState; createdAt: string }');
  lines.push('export interface SourceBuildJob { id: UUID; workId: UUID; revisionId: UUID; commitSha: string; treeSha: string; templateKey: "static-v1"; templateVersion: "1"; config: Record<string, unknown>; configSha256: string; builderImageDigest: string; releaseLabel: string; state: SourceBuildState; errorCode: string | null; artifactSha256: string | null; artifactBytes: UIntString | null; uploadId: UUID | null; releaseId: UUID | null; createdAt: string; startedAt: string | null; completedAt: string | null; updatedAt: string }');
  lines.push('export interface UploadJob { id: UUID; workId: UUID; targetKey: TargetKey; packageType: PackageType; state: UploadState; publicationOutcome: PublicationOutcome; declaredBytes: UIntString; actualBytes: UIntString | null; createdAt: string; expiresAt: string; errorCode: string | null }');
  lines.push('export interface LaunchDescriptor { apiVersion: 1; workId: UUID; releaseId: UUID; releaseLabel: string; entryUrl: string; runtimeOrigin: string; playerProtocol: { min: number; max: number }; capabilities: { fullscreen: boolean; pointerLock: boolean; multiplayer: boolean; cloudSave?: boolean; competition?: boolean } }');
  lines.push('export interface ContentReport { id: UUID; workId: UUID; workTitle: string; reporterUserId: UUID; category: "unsafe" | "malware" | "harassment" | "copyright" | "other"; details: string; status: "open" | "resolved" | "dismissed"; resolutionAction: "suspend" | "dismiss" | null; resolutionNote: string | null; createdAt: string; resolvedAt: string | null }');
  lines.push('export interface ContributionIdentity { id: UUID; handle: string; displayName: string }');
  lines.push('export interface ContributionTask { version: number; reviewReason: string; workAvailable: boolean; claimExpiresAt: string | null; resolvedRelease: { id: UUID; label: string; available: boolean } | null; id: UUID; workId: UUID; workTitle: string; feedbackId: UUID | null; title: string; description: string; difficulty: "starter" | "intermediate" | "advanced"; skills: string[]; status: "draft" | "open" | "claimed" | "submitted" | "completed" | "closed"; repositoryUrl: string | null; issueUrl: string | null; submissionUrl: string | null; submissionNote: string; author: ContributionIdentity; claimant: ContributionIdentity | null; publishedAt: string | null; claimedAt: string | null; submittedAt: string | null; completedAt: string | null; createdAt: string; updatedAt: string }');
  lines.push('export interface ContributionEvent { id: UUID; action: string; details: Record<string, unknown>; createdAt: string }');
  lines.push('export interface ContributionTaskDetail extends ContributionTask { events: ContributionEvent[]; releases: { id: UUID; label: string; target: string }[] }');
  lines.push('export interface ContributionNotifications { unread: number; items: (ContributionEvent & { taskId: UUID; title: string; read: boolean })[] }');
  lines.push('export interface PublicProfileContribution { taskId: UUID; title: string; workId: UUID; workTitle: string; repositoryUrl: string | null; issueUrl: string | null; submissionUrl: string; completedAt: string }');
  lines.push('export interface ModerationAuditEvent { id: UUID; reportId: UUID; workId: UUID; workTitle: string; actorUserId: UUID; action: "suspend" | "dismiss"; reason: string; beforeState: Record<string, unknown>; afterState: Record<string, unknown>; createdAt: string }');
  lines.push('export interface AccountAvatar { kind: "preset" | "upload"; presetKey: "cat" | "robot" | "sprout" | "fox" | "ghost" | "wizard" | null; url: string | null; staticUrl: string | null; mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp" | null; animated: boolean }');
  lines.push('export interface SocialProfile { id: UUID; handle: string; displayName: string; bio: string; visibility: "public" | "followers" | "private"; avatar: AccountAvatar; followerCount: number; followingCount: number; isFollowing: boolean; isMe: boolean }');
  lines.push('export interface PublicProfileLink { kind: "github" | "website" | "portfolio" | "bilibili" | "other"; label: string; url: string }');
  lines.push('export interface PublicGitHubRepository { id: UUID; owner: string; name: string; url: string }');
  lines.push('export interface PublicProfileActivity { type: "work_published" | "guess_baike_completed"; occurredAt: string; title: string; workId: UUID | null }');
  lines.push('export interface PublicProfileBadge { key: string; name: string; description: string }');
  lines.push('export interface PublicProfileAchievements { totalDays: number; longestStreak: number; completedChallenges: number; challengeWins: number; bestDailyRank: number | null; latestDailyRank: number | null; latestRankDate: string | null; badges: PublicProfileBadge[] }');
  lines.push('export interface PublicUserProfile { id: UUID; handle: string; displayName: string; headline: string; about: string; visibility: "public" | "followers" | "private"; libraryVisibility: "public" | "followers" | "private"; libraryVisible: boolean; collaborationStatus: "not_looking" | "open_to_collaboration" | "available_for_hire"; skills: string[]; activityVisibility: "public" | "followers" | "private"; activityVisible: boolean; activity: PublicProfileActivity[]; achievementsVisibility: "public" | "followers" | "private"; achievementsVisible: boolean; achievements: PublicProfileAchievements | null; creator: boolean; role: "user" | "admin"; joinedAt: string; avatar: AccountAvatar; followerCount: number; followingCount: number; isFollowing: boolean; isMe: boolean; links: PublicProfileLink[]; githubRepositories: PublicGitHubRepository[]; contributions: PublicProfileContribution[]; featuredWorks: Work[]; works: Work[]; library: Work[] }');
  lines.push('export interface UpdatePublicProfileRequest { handle: string; headline: string; about: string; visibility: "public" | "followers" | "private"; libraryVisibility?: "public" | "followers" | "private"; collaborationStatus?: "not_looking" | "open_to_collaboration" | "available_for_hire"; skills?: string[]; activityVisibility?: "public" | "followers" | "private"; achievementsVisibility?: "public" | "followers" | "private"; links: PublicProfileLink[]; featuredWorkIds: UUID[]; githubRepositoryIds?: UUID[] }');
  lines.push('export type GuessBaikeReaction = "gg" | "spark" | "wow" | "coffee";');
  lines.push('export interface GuessBaikeLeaderboardEntry { rank: number; player: SocialProfile; guessedCount: number; elapsedSeconds: number; hints: number; completedAt: string; reactions: Partial<Record<GuessBaikeReaction, number>>; myReaction: GuessBaikeReaction | null }');
  lines.push('export interface GuessBaikePuzzle { id: string; title: string; aliases: string[]; category: string; sourceKind: string; sourceTitle: string; sourceUrl: string; sourceRevision: number; sourceUpdatedAt: string; license: string; introHanCount: number; content: string }');
  lines.push('export interface GuessBaikeAdminPuzzle extends GuessBaikePuzzle { status: "ready" | "disabled"; qualityReason: string | null; scheduledDates: string[] }');
  lines.push('export interface GuessBaikeSchedule { date: string; puzzleId: string }');
  lines.push('export interface GuessBaikeAutomationRun { id: UUID; status: "running" | "succeeded" | "failed"; startedAt: string; finishedAt: string | null; fetchedCount: number; acceptedCount: number; scheduledCount: number; errorCode: string | null; errorMessage: string | null }');
  lines.push('export interface GuessBaikeAutomationStatus { enabled: boolean; running: boolean; intervalMinutes: number; batchSize: number; scheduleDays: number; readyCount: number; scheduledCount: number; lastRun: GuessBaikeAutomationRun | null }');
  lines.push('export interface SocialNotification { id: UUID; type: "follow" | "reaction" | "challenge_complete"; actor: SocialProfile; puzzleDate: string | null; reaction: GuessBaikeReaction | null; challengeCode: string | null; outcome: "win" | "loss" | "draw" | null; read: boolean; createdAt: string }');
  lines.push('export interface GuessBaikeChallenge { code: string; puzzleDate: string; expiresAt: string }');
  lines.push('export interface GuessBaikeChallengeDetail extends GuessBaikeChallenge { creator: SocialProfile; score: { guessedCount: number; elapsedSeconds: number; hints: number }; status: "open" | "accepted" | "completed"; acceptedByMe: boolean }');
  lines.push('export interface GuessBaikeChallengeState { accepted: boolean; completed: boolean; outcome: "win" | "loss" | "draw" | null }');
  lines.push('export interface GuessBaikeChallengeComparison { outcome: "win" | "loss" | "draw"; creator: { guessedCount: number; elapsedSeconds: number; hints: number }; participant: { guessedCount: number; elapsedSeconds: number; hints: number } }');
  lines.push('export interface GuessBaikeChallengeHistory extends GuessBaikeChallenge { role: "creator" | "participant"; status: "pending" | "completed" | "expired"; outcome: "win" | "loss" | "draw" | null; opponent: SocialProfile | null; myScore: { guessedCount: number; elapsedSeconds: number; hints: number }; opponentScore: { guessedCount: number; elapsedSeconds: number; hints: number } | null }');
  lines.push('export interface RetentionBadge { key: "first_break" | "streak_3" | "streak_7" | "challenger" | "duel_winner"; name: string; description: string; unlocked: boolean }');
  lines.push('export interface PlayerRetention { currentStreak: number; longestStreak: number; totalDays: number; completedChallenges: number; badges: RetentionBadge[] }');
  lines.push('export interface NotificationPreferences { follow: boolean; reaction: boolean; challenge: boolean }');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

validateSource();
const openApi = `${JSON.stringify(createOpenApiDocument(), null, 2)}\n`;
const types = generateTypes();
const normalizeLineEndings = value => value.replace(/\r\n/gu, '\n');

await fs.mkdir(outputDir, { recursive: true });
if (process.argv.includes('--check')) {
  const [existingOpenApi, existingTypes] = await Promise.all([
    fs.readFile(openApiPath, 'utf8'), fs.readFile(typesPath, 'utf8'),
  ]);
  assert.equal(normalizeLineEndings(existingOpenApi), openApi, 'generated openapi.json is stale; run npm run contracts:generate');
  assert.equal(normalizeLineEndings(existingTypes), types, 'generated index.d.ts is stale; run npm run contracts:generate');
  process.stdout.write('Contract artifacts are current.\n');
} else {
  await Promise.all([fs.writeFile(openApiPath, openApi), fs.writeFile(typesPath, types)]);
  process.stdout.write('Generated GameHub OpenAPI and TypeScript declarations.\n');
}
