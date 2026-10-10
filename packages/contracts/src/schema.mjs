import {competitionSchemas,competitionRoutes} from './competition-schema.mjs';
import {saveOperationsSchemas,saveOperationsRoutes} from './save-operations-schema.mjs';
import {communitySchemas,communityRoutes} from './community-schema.mjs';
const stringEnum = values => ({ type: 'string', enum: values });
const object = (properties, required = Object.keys(properties)) => ({
  type: 'object', additionalProperties: false, properties, required,
});

export const enums = Object.freeze({
  WorkKind: ['game', 'creative', 'tool'],
  WorkState: ['draft', 'published', 'withdrawn', 'suspended'],
  Visibility: ['private', 'public'],
  TargetKey: ['web', 'windows-x64', 'windows-x86', 'windows-arm64'],
  PackageType: ['web_zip', 'windows_portable_zip', 'windows_standalone_exe', 'windows_installer_exe'],
  UploadState: ['created', 'receiving', 'uploaded', 'queued', 'validating', 'scanning', 'succeeded', 'failed', 'expired', 'review_required'],
  PublicationOutcome: ['pending', 'published', 'draft', 'skipped_newer_intent', 'blocked'],
  ReleaseValidationState: ['processing', 'scanning', 'ready', 'failed', 'review_required'],
  ReleaseServingState: ['disabled', 'enabled', 'revoked'],
  SourceBuildState: ['queued', 'preparing', 'building', 'packaging', 'validating', 'ready', 'failed', 'superseded'],
  CreatorStudio: ['bingo', 'puzzle', 'story', 'world'],
  CreatorDraftStatus: ['active', 'archived', 'published'],
  ProjectClaimStatus: ['publisher','unclaimed','pending','verified','rejected','cancelled','disputed','suspended','revoked'],
});

const id = { type: 'string', format: 'uuid' };
const workKey = { type: 'string', pattern: '^(?:gamehub-[a-z0-9-]{1,100}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$' };
const dateTime = { type: 'string', format: 'date-time' };
const nullableDateTime = { oneOf: [dateTime, { type: 'null' }] };
const uintString = { type: 'string', pattern: '^(0|[1-9][0-9]*)$' };
const sha256 = { type: 'string', pattern: '^[a-f0-9]{64}$' };

const saveName = { type: 'string', pattern: '^(?!_gamehub[.])[a-z0-9._-]{1,64}$' };
const nullable = schema => ({ oneOf: [schema, { type: 'null' }] });
const saveMetadata = {
  slot: saveName, namespace: saveName, revisionId: id, revision: uintString,
  etag: { type: 'string' }, schemaVersion: nullable({type:'integer',minimum:1}),
  contentType: nullable(stringEnum(['application/json','application/octet-stream'])),
  contentEncoding: {type:'string',const:'identity'}, sha256: nullable(sha256), bytes: {type:'integer',minimum:0,maximum:1048576},
  updatedAt: dateTime, deleted: {type:'boolean'}, restoredFromRevisionId: nullable(id),
};

const contributionTaskProperties = {
    id, workId: id, workTitle: { type: 'string', minLength: 1, maxLength: 120 }, feedbackId: { oneOf: [id,{ type: 'null' }] },
    title: { type: 'string', minLength: 5, maxLength: 160 }, description: { type: 'string', minLength: 20, maxLength: 4000 },
    difficulty: stringEnum(['starter','intermediate','advanced']), skills: { type: 'array', maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 30 } },
    status: stringEnum(['draft','open','claimed','submitted','completed','closed']), version:{type:'integer',minimum:1}, reviewReason:{type:'string',maxLength:2000}, workAvailable:{type:'boolean'}, claimExpiresAt:{oneOf:[dateTime,{type:'null'}]}, resolvedRelease:{oneOf:[object({id,label:{type:'string'},available:{type:'boolean'}}),{type:'null'}]},
    repositoryUrl: { oneOf: [{ type: 'string', maxLength: 2048 },{ type: 'null' }] }, issueUrl: { oneOf: [{ type: 'string', maxLength: 2048 },{ type: 'null' }] },
    submissionUrl: { oneOf: [{ type: 'string', maxLength: 2048 },{ type: 'null' }] }, submissionNote: { type: 'string', maxLength: 2000 },
    author: { $ref: '#/components/schemas/ContributionIdentity' }, claimant: { oneOf: [{ $ref: '#/components/schemas/ContributionIdentity' },{ type: 'null' }] },
    publishedAt: { oneOf: [dateTime,{ type: 'null' }] }, claimedAt: { oneOf: [dateTime,{ type: 'null' }] }, submittedAt: { oneOf: [dateTime,{ type: 'null' }] }, completedAt: { oneOf: [dateTime,{ type: 'null' }] },
    createdAt: dateTime, updatedAt: dateTime,
  };

export const schemas = Object.freeze({
  ...saveOperationsSchemas,
  ...communitySchemas,
  ...competitionSchemas,
  SaveLibraryQuery: object({afterSlotId:id},[]),
  SaveLibrarySlotParams: object({slotId:id}),
  SaveLibraryRevisionParams: object({slotId:id,revisionId:id}),
  SaveLibraryHistoryQuery: object({beforeRevision:{type:'string',pattern:'^[1-9][0-9]{0,18}$'}},[]),
  SaveLibrarySlot: object({...saveMetadata,slotId:id,workId:id,workTitle:{type:'string'},channel:stringEnum(['production','preview'])}),
  SaveLibraryPage: object({items:{type:'array',maxItems:50,items:{$ref:'#/components/schemas/SaveLibrarySlot'}},nextAfterSlotId:nullable(id)}),
  SaveLibraryHistory: object({slot:{$ref:'#/components/schemas/SaveLibrarySlot'},items:{type:'array',maxItems:50,items:object({...saveMetadata,payloadAvailable:{type:'boolean'}})},nextBeforeRevision:nullable(uintString)}),
  GameSaveParams: object({workId:id}),
  GameSaveSlotParams: object({workId:id,slotKey:saveName}),
  GameSaveQuery: object({namespace:saveName}),
  GameSaveHistoryQuery: object({namespace:saveName,beforeRevision:{type:'string',pattern:'^[1-9][0-9]{0,18}$'}},['namespace']),
  RestoreGameSaveRequest: object({revisionId:id}),
  GameSaveWriteReceiptRequest: object({schemaVersion:{type:'integer',minimum:1,maximum:2147483647},contentType:stringEnum(['application/json','application/octet-stream']),sha256}),
  GameSaveWriteReceipt: object({result:nullable(object({...saveMetadata,historyDegraded:{type:'boolean'},durability:{type:'string',const:'cloud'}}))}),
  GameSaveMetadata: object(saveMetadata),
  GameSaveWriteResult: object({...saveMetadata,historyDegraded:{type:'boolean'},durability:{type:'string',const:'cloud'}}),
  GameSaveHistory: object({items:{type:'array',maxItems:50,items:object({...saveMetadata,payloadAvailable:{type:'boolean'}})},nextBeforeRevision:nullable(uintString)}),
  GameSavePolicy: object({
    namespace:saveName,status:stringEnum(['active','retired']),writesPaused:{type:'boolean'},maxSlots:{type:'integer'},maxDocumentBytes:{type:'integer'},
    maxLiveBytes:{type:'integer'},maxHistoryBytes:{type:'integer'},historyVersions:{type:'integer'},historyDays:{type:'integer'},
    schemaMin:{type:'integer'},schemaMax:{type:'integer'},contentTypes:{type:'array',items:stringEnum(['application/json','application/octet-stream'])},
  }),

  ErrorResponse: object({
    error: object({
      code: { type: 'string', minLength: 1, maxLength: 80 },
      message: { type: 'string', minLength: 1, maxLength: 500 },
      requestId: id,
      retryable: { type: 'boolean' },
      details: { type: 'object', additionalProperties: true },
    }),
  }),
  EmailChallengeRequest: object({
    email: { type: 'string', format: 'email', maxLength: 320 },
    clientKind: stringEnum(['harness', 'vscode', 'cursor', 'browser']),
  }),
  EmailChallenge: object({ challengeId: id, expiresAt: dateTime, resendAfter: dateTime }),
  VerifyEmailRequest: object({
    challengeId: id,
    code: { type: 'string', pattern: '^[0-9]{6}$' },
    deviceLabel: { type: 'string', minLength: 1, maxLength: 120 },
  }),
  GitHubDeviceStartRequest: object({
    clientKind: stringEnum(['harness', 'vscode', 'cursor', 'browser']),
    deviceLabel: { type: 'string', minLength: 1, maxLength: 120 },
  }),
  GitHubDeviceChallenge: object({
    challengeId: id,
    userCode: { type: 'string', minLength: 4, maxLength: 32 },
    verificationUri: { type: 'string', const: 'https://github.com/login/device' },
    expiresAt: dateTime,
    intervalSeconds: { type: 'integer', minimum: 1, maximum: 60 },
  }),
  Profile: object({
    id,
    displayName: { type: 'string', minLength: 1, maxLength: 120 },
    role: stringEnum(['user', 'admin']),
    canPublish: { type: 'boolean' },
  }),
  AccountIdentity: object({
    provider: stringEnum(['email', 'github']),
    label: { type: 'string', minLength: 1, maxLength: 320 },
    linkedAt: dateTime,
  }),
  AccountAvatar: object({
    kind: stringEnum(['preset', 'upload']),
    presetKey: { oneOf: [stringEnum(['cat', 'robot', 'sprout', 'fox', 'ghost', 'wizard']), { type: 'null' }] },
    url: { oneOf: [{ type: 'string', pattern: '^/v1/avatars/' }, { type: 'null' }] },
    staticUrl: { oneOf: [{ type: 'string', pattern: '^/v1/avatars/' }, { type: 'null' }] },
    mediaType: { oneOf: [stringEnum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']), { type: 'null' }] },
    animated: { type: 'boolean' },
  }),
  AccountProfile: object({
    id,
    profileHandle: { type: 'string', pattern: '^[a-z][a-z0-9-]{2,31}$' },
    displayName: { type: 'string', minLength: 1, maxLength: 40 },
    role: stringEnum(['user', 'admin']),
    canPublish: { type: 'boolean' },
    createdAt: dateTime,
    avatar: { $ref: '#/components/schemas/AccountAvatar' },
    linkedAccounts: { type: 'array', items: { $ref: '#/components/schemas/AccountIdentity' }, maxItems: 8 },
  }),
  UpdateProfileRequest: object({ displayName: { type: 'string', minLength: 1, maxLength: 40 } }),
  SelectAvatarRequest: object({ presetKey: stringEnum(['cat', 'robot', 'sprout', 'fox', 'ghost', 'wizard']) }),
  AuthTokens: object({
    accessToken: { type: 'string', minLength: 32 }, accessExpiresAt: dateTime,
    refreshToken: { type: 'string', minLength: 32 }, refreshExpiresAt: dateTime,
    grantId: id, profile: { $ref: '#/components/schemas/Profile' },
  }),
  GameShareParams: object({code:{type:'string',pattern:'^[A-Za-z0-9_-]{32}$'}}),
  CreateGameShareRequest: object({title:{type:'string',minLength:1,maxLength:120},payload:{type:'object',additionalProperties:true}}),
  GameShareLink: object({code:{type:'string',pattern:'^[A-Za-z0-9_-]{32}$'},url:{type:'string',format:'uri'},expiresAt:dateTime}),
  CurrentGameShare: object({code:{type:'string',pattern:'^[A-Za-z0-9_-]{32}$'},title:{type:'string'},payload:{type:'object',additionalProperties:true},workId:id,releaseId:id,expiresAt:dateTime}),
  CreateGameSessionRequest: object({ workId: id, releaseId: id, channel: stringEnum(['production','preview']), launchNonce: id }),
  GameSession: object({
    gameSessionId: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' }, expiresAt: dateTime,
    capabilities: { type: 'array', items: stringEnum(['identity','multiplayer','cloudSave','competition','fileExport','shareLinks']), uniqueItems: true },
  }),
  GameSessionStatus: object({
    active: { type: 'boolean', const: true }, expiresAt: dateTime,
    capabilities: { type: 'array', items: stringEnum(['identity','multiplayer','cloudSave','competition','fileExport','shareLinks']), uniqueItems: true },
  }),
  GameSessionRevocation: object({ revoked: { type: 'boolean', const: true } }),
  RealtimeTicket: object({
    ticket: { type: 'string', minLength: 32, maxLength: 128 },
    websocketUrl: { type: 'string', pattern: '^wss?://' },
    expiresAt: dateTime,
    protocol: { type: 'string', const: 'gamehub.realtime.v1' },
  }),
  MultiplayerRoomSettings: object({
    turnSeconds: { type: 'integer', minimum: 10, maximum: 3600 },
    spectators: { type: 'boolean' },
    reconnectGraceSeconds: { type: 'integer', minimum: 15, maximum: 600 },
  }, []),
  MultiplayerMode: object({
    id, workId: id, key: { type: 'string' }, name: { type: 'string' },
    authority: stringEnum(['platform_authoritative','external_authoritative','relay_unverified']),
    minPlayers: { type: 'integer', minimum: 2, maximum: 8 }, maxPlayers: { type: 'integer', minimum: 2, maximum: 8 },
    rulesetVersion: { type: 'string' }, config: { $ref: '#/components/schemas/MultiplayerRoomSettings' }, enabled: { type: 'boolean' },
  }),
  MultiplayerRoomMember: object({
    userId: id, displayName: { type: 'string' }, seat: { type: 'integer', minimum: 0, maximum: 7 }, role: stringEnum(['player','spectator']),
    ready: { type: 'boolean' }, connectionState: stringEnum(['online','offline','grace']), joinedAt: dateTime,
  }),
  MultiplayerRoom: object({
    id, modeId: id, ownerUserId: id, locator: { type: 'string', pattern: '^[A-F0-9]{8}$' }, visibility: stringEnum(['public','private','invite_only']), status: stringEnum(['open','starting','in_match','closed']),
    capacity: { type: 'integer', minimum: 2, maximum: 8 }, settings: { $ref: '#/components/schemas/MultiplayerRoomSettings' }, revision: uintString,
    expiresAt: dateTime, createdAt: dateTime, members: { type: 'array', maxItems: 8, items: { $ref: '#/components/schemas/MultiplayerRoomMember' } },
  }),
  MultiplayerRoomCreated: object({
    id, modeId: id, ownerUserId: id, locator: { type: 'string', pattern: '^[A-F0-9]{8}$' }, visibility: stringEnum(['public','private','invite_only']), status: stringEnum(['open','starting','in_match','closed']),
    capacity: { type: 'integer', minimum: 2, maximum: 8 }, settings: { $ref: '#/components/schemas/MultiplayerRoomSettings' }, revision: uintString,
    expiresAt: dateTime, createdAt: dateTime, members: { type: 'array', maxItems: 8, items: { $ref: '#/components/schemas/MultiplayerRoomMember' } },
    joinCode: { oneOf: [{ type: 'string', pattern: '^[A-Za-z0-9_-]{12}$' }, { type: 'null' }] },
  }),
  CreateMultiplayerModeRequest: object({
    workId: id, key: { type: 'string', pattern: '^[a-z][a-z0-9_]{1,63}$' }, name: { type: 'string', minLength: 1, maxLength: 80 },
    authority: stringEnum(['platform_authoritative','external_authoritative','relay_unverified']), minPlayers: { type: 'integer', minimum: 2, maximum: 8 }, maxPlayers: { type: 'integer', minimum: 2, maximum: 8 },
    rulesetVersion: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' }, config: { $ref: '#/components/schemas/MultiplayerRoomSettings' },
  }, ['workId','key','name','authority','minPlayers','maxPlayers','rulesetVersion']),
  CreateMultiplayerRoomRequest: object({
    modeId: id, visibility: stringEnum(['public','invite_only']), capacity: { type: 'integer', minimum: 2, maximum: 8 }, settings: { $ref: '#/components/schemas/MultiplayerRoomSettings' },
  }, ['modeId','visibility','capacity']),
  JoinMultiplayerRoomRequest: object({ joinCode: { type: 'string', pattern: '^[A-HJ-NP-Za-hj-np-z2-9]{5}-?[A-HJ-NP-Za-hj-np-z2-9]{5}$' }, modeId: id }, []),
  MultiplayerInvite: object({ code: { type: 'string', pattern: '^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$' }, expiresAt: dateTime }),
  SetMultiplayerReadyRequest: object({ ready: { type: 'boolean' } }),
  MultiplayerMatchPlayer: object({
    userId: id, displayName: { type: 'string' }, seat: { type: 'integer', minimum: 0, maximum: 7 },
    team: { oneOf: [{ type: 'integer' }, { type: 'null' }] }, result: { oneOf: [stringEnum(['win','loss','draw','none']), { type: 'null' }] },
  }),
  MultiplayerMatch: object({
    id, roomId: { oneOf: [id, { type: 'null' }] }, modeId: id, rulesetVersion: { type: 'string' },
    status: stringEnum(['pending','active','finishing','completed','aborted']), revision: uintString, nextEventSeq: uintString,
    turnUserId: { oneOf: [id, { type: 'null' }] }, turnDeadlineAt: nullableDateTime, startedAt: nullableDateTime, endedAt: nullableDateTime,
    terminationReason: { oneOf: [stringEnum(['normal','resignation','timeout','disconnect','admin_abort','adapter_error']), { type: 'null' }] },
    result: { oneOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
    players: { type: 'array', minItems: 2, maxItems: 8, items: { $ref: '#/components/schemas/MultiplayerMatchPlayer' } },
    publicState: { oneOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
  }),
  MultiplayerMatchEvent: object({
    seq: uintString, type: { type: 'string' }, actorUserId: { oneOf: [id, { type: 'null' }] }, commandId: { oneOf: [id, { type: 'null' }] },
    payload: { type: 'object', additionalProperties: true }, stateHash: { type: 'string', pattern: '^[a-f0-9]{64}$' }, createdAt: dateTime,
  }),
  MultiplayerReplay: object({
    match: { $ref: '#/components/schemas/MultiplayerMatch' },
    events: { type: 'array',maxItems: 10000,items: { $ref: '#/components/schemas/MultiplayerMatchEvent' } },
  }),
  MultiplayerAdminOverview: object({
    rooms: { type: 'object',additionalProperties: { type: 'integer',minimum: 0 } },
    matches: { type: 'object',additionalProperties: { type: 'integer',minimum: 0 } },
    overdueMatches: { type: 'integer',minimum: 0 },matchesCreated24h: { type: 'integer',minimum: 0 },
    matchesCompleted24h: { type: 'integer',minimum: 0 },matchesAborted24h: { type: 'integer',minimum: 0 },
  }),
  AbortMultiplayerMatchRequest: object({ reason: { type: 'string',minLength: 1,maxLength: 1000 } }),
  MultiplayerAbortResult: object({
    match: { $ref: '#/components/schemas/MultiplayerMatch' },event: { $ref: '#/components/schemas/MultiplayerMatchEvent' },
  }),
  MultiplayerAdminEvent: object({
    id,actorUserId: id,actorDisplayName: { type: 'string' },matchId: id,action: stringEnum(['abort']),reason: { type: 'string' },
    beforeState: { type: 'object',additionalProperties: true },afterState: { type: 'object',additionalProperties: true },createdAt: dateTime,
  }),
  CreateMultiplayerRuleSubmissionRequest: object({
    modeKey: { type: 'string',pattern: '^[a-z][a-z0-9_]{1,63}$' },modeName: { type: 'string',minLength: 1,maxLength: 80 },rulesetVersion: { type: 'string',pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' },
    minPlayers: { type: 'integer',minimum: 2,maximum: 8 },maxPlayers: { type: 'integer',minimum: 2,maximum: 8 },modeConfig: { $ref: '#/components/schemas/MultiplayerRoomSettings' },
    fileName: { type: 'string',minLength: 1,maxLength: 255,pattern: '^[^\\\\/\\u0000]+\\.zip$' },declaredBytes: uintString,sha256,
    creatorSubmission: { type: 'object',additionalProperties: true },doctorReport: { type: 'object',additionalProperties: true },
  }, ['modeKey','modeName','rulesetVersion','minPlayers','maxPlayers','fileName','declaredBytes','sha256','creatorSubmission','doctorReport']),
  MultiplayerRuleBuild: object({
    id,state: stringEnum(['queued','preparing','building','ready','failed']),builderImageDigest: { type: 'string' },sourceSha256: sha256,
    artifactSha256: { oneOf: [sha256,{ type: 'null' }] },artifactBytes: { oneOf: [uintString,{ type: 'null' }] },report: { oneOf: [{ type: 'object',additionalProperties: true },{ type: 'null' }] },
    errorCode: { oneOf: [{ type: 'string' },{ type: 'null' }] },createdAt: dateTime,startedAt: nullableDateTime,completedAt: nullableDateTime,
  }),
  MultiplayerRuleSubmission: object({
    id,workId: id,workTitle: { oneOf: [{ type: 'string' },{ type: 'null' }] },ownerUserId: id,ownerDisplayName: { oneOf: [{ type: 'string' },{ type: 'null' }] },
    modeKey: { type: 'string' },modeName: { type: 'string' },rulesetVersion: { type: 'string' },minPlayers: { type: 'integer' },maxPlayers: { type: 'integer' },
    state: stringEnum(['created','receiving','uploaded','submitted','in_review','changes_requested','approved_for_build','rejected','expired','failed']),sourceFileName: { type: 'string' },declaredBytes: uintString,
    actualBytes: { oneOf: [uintString,{ type: 'null' }] },sourceSha256: sha256,errorCode: { oneOf: [{ type: 'string' },{ type: 'null' }] },reviewNote: { oneOf: [{ type: 'string' },{ type: 'null' }] },
    submittedAt: nullableDateTime,reviewedAt: nullableDateTime,createdAt: dateTime,updatedAt: dateTime,doctorSummary: { oneOf: [{ type: 'object',additionalProperties: true },{ type: 'null' }] },
    build: { oneOf: [{ $ref: '#/components/schemas/MultiplayerRuleBuild' },{ type: 'null' }] },
  }),
  MultiplayerRuleUploadGrant: object({ submissionId: id,token: { type: 'string',minLength: 32 },expiresAt: dateTime }),
  MultiplayerRuleReviewRequest: object({ action: stringEnum(['start','request_changes','approve_for_build','reject']),note: { type: 'string',minLength: 1,maxLength: 2000 } }, ['action']),
  GitHubDevicePoll: object({
    status: stringEnum(['pending', 'complete']),
    retryAfter: { type: 'integer', minimum: 0, maximum: 120 },
    tokens: { oneOf: [{ $ref: '#/components/schemas/AuthTokens' }, { type: 'null' }] },
  }),
  GitHubWebStartRequest: object({
    clientKind: stringEnum(['harness', 'vscode', 'cursor', 'browser']),
    deviceLabel: { type: 'string', minLength: 1, maxLength: 120 },
  }),
  GitHubWebChallenge: object({
    challengeId: id,
    authorizeUrl: { type: 'string', format: 'uri', pattern: '^https://github\\.com/login/oauth/authorize' },
    expiresAt: dateTime,
    intervalSeconds: { type: 'integer', minimum: 1, maximum: 60 },
  }),
  GitHubWebPoll: object({
    status: stringEnum(['pending', 'complete']),
    retryAfter: { type: 'integer', minimum: 0, maximum: 120 },
    tokens: { oneOf: [{ $ref: '#/components/schemas/AuthTokens' }, { type: 'null' }] },
  }),
  RefreshRequest: object({ refreshToken: { type: 'string', minLength: 32 } }),
  DeviceSession: object({
    id,
    deviceLabel: { type: 'string', minLength: 1, maxLength: 120 },
    clientKind: stringEnum(['harness', 'vscode', 'cursor', 'browser']),
    authenticatedAt: dateTime,
    lastSeenAt: dateTime,
    expiresAt: dateTime,
    current: { type: 'boolean' },
  }),
  RevokeSessionsResponse: object({ revokedCount: { type: 'integer', minimum: 0 } }),
  CreateWorkRequest: object({
    title: { type: 'string', minLength: 1, maxLength: 120 },
    description: { type: 'string', maxLength: 4000 },
    kind: stringEnum(enums.WorkKind),
    attributionKind:stringEnum(['publisher','community_catalog']),
    instructions: { type: 'string', maxLength: 4000 },
    estimatedMinutes: { type: 'integer', minimum: 1, maximum: 30 },
    tags: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 20 }, maxItems: 6, uniqueItems: true },
    agentLabel: { oneOf: [{ type: 'string', minLength: 1, maxLength: 40 }, { type: 'null' }] },
    repositoryUrl: { oneOf: [{ type: 'string', pattern: '^https://github\\.com/[^/\\s]+/[^/\\s]+/?$' }, { type: 'null' }] },
    licenseSpdx: { oneOf: [{ type: 'string', minLength: 1, maxLength: 40 }, { type: 'null' }] },
  }, ['title', 'description', 'kind']),
  UpdateWorkRequest: object({
    title: { type: 'string', minLength: 1, maxLength: 120 },
    description: { type: 'string', maxLength: 4000 },
    instructions: { type: 'string', maxLength: 4000 },
    estimatedMinutes: { type: 'integer', minimum: 1, maximum: 30 },
    tags: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 20 }, maxItems: 6, uniqueItems: true },
    agentLabel: { oneOf: [{ type: 'string', minLength: 1, maxLength: 40 }, { type: 'null' }] },
    repositoryUrl: { oneOf: [{ type: 'string', pattern: '^https://github\\.com/[^/\\s]+/[^/\\s]+/?$' }, { type: 'null' }] },
    licenseSpdx: { oneOf: [{ type: 'string', minLength: 1, maxLength: 40 }, { type: 'null' }] },
  }, []),
  WorkTarget: object({
    targetKey: stringEnum(enums.TargetKey),
    state: stringEnum(enums.WorkState),
    currentReleaseId: { oneOf: [id, { type: 'null' }] },
    revision: uintString,
  }),
  Work: object({
    id: workKey, ownerUserId: id,
    title: { type: 'string', minLength: 1, maxLength: 120 },
    description: { type: 'string', maxLength: 4000 },
    instructions: { type: 'string', maxLength: 4000 },
    kind: stringEnum(enums.WorkKind), state: stringEnum(enums.WorkState),
    visibility: stringEnum(enums.Visibility), revision: uintString,
    firstPublishedAt: { oneOf: [dateTime, { type: 'null' }] },
    coverUrl: { oneOf: [{ type: 'string', pattern: '^/v1/works/' }, { type: 'null' }] },
    estimatedMinutes: { type: 'integer', minimum: 1, maximum: 30 },
    tags: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 20 }, maxItems: 6 },
    agentLabel: { oneOf: [{ type: 'string', minLength: 1, maxLength: 40 }, { type: 'null' }] },
    repositoryUrl: { oneOf: [{ type: 'string', format: 'uri' }, { type: 'null' }] },
    licenseSpdx: { oneOf: [{ type: 'string', minLength: 1, maxLength: 40 }, { type: 'null' }] },
    creatorDisplayName: { oneOf: [{ type: 'string', minLength: 1, maxLength: 120 }, { type: 'null' }] },
    creatorHandle: { oneOf: [{ type: 'string', pattern: '^[a-z][a-z0-9-]{2,31}$' }, { type: 'null' }] },
    playCount: { type: 'integer', minimum: 0 },
    saveCount: { type: 'integer', minimum: 0 },
    targets: { type: 'array', items: { $ref: '#/components/schemas/WorkTarget' }, maxItems: 8 },
  }),
  PublicProjectClaim: object({
    workId: workKey, ingestionMethod:stringEnum(['platform','zip_upload','github_import']), attributionKind:stringEnum(['publisher','community_catalog']), eligible: {type:'boolean'}, status: stringEnum(enums.ProjectClaimStatus),
    relationship: nullable(stringEnum(['owner','maintainer'])), claimantDisplayName: nullable({type:'string',minLength:1,maxLength:120}),
    claimantHandle: nullable({type:'string',pattern:'^[a-z][a-z0-9-]{2,31}$'}), verifiedAt: nullableDateTime,
  }),
  ProjectClaim: object({
    id, workId:id, workTitle:{type:'string',minLength:1,maxLength:120}, claimantUserId:id,
    claimantDisplayName:{type:'string',minLength:1,maxLength:120}, claimantHandle:nullable({type:'string',pattern:'^[a-z][a-z0-9-]{2,31}$'}),
    relationship:stringEnum(['owner','maintainer']), status:stringEnum(enums.ProjectClaimStatus.filter(value=>!['publisher','unclaimed'].includes(value))),
    evidenceType:stringEnum(['github','website','storefront','other']), evidenceUrl:nullable({type:'string',format:'uri'}), repositoryId:nullable(uintString), repositoryUrl:nullable({type:'string',format:'uri'}), applicantNote:{type:'string',maxLength:1000}, decisionNote:{type:'string',maxLength:2000},
    submittedAt:dateTime, decidedAt:nullableDateTime, verifiedAt:nullableDateTime, suspendedAt:nullableDateTime, revokedAt:nullableDateTime,
    updatedAt:dateTime, version:uintString,
  }),
  CreateProjectClaimRequest: object({
    evidenceType:stringEnum(['github','website','storefront','other']), connectionId:id, repositoryId:{type:'string',pattern:'^[1-9][0-9]*$'}, evidenceUrl:{type:'string',format:'uri',maxLength:2048}, relationship:stringEnum(['owner','maintainer']), note:{type:'string',maxLength:1000},
  },['evidenceType','relationship']),
  ProjectClaimDecisionRequest: object({ action:stringEnum(['approve','reject','dispute','suspend','restore','revoke']), note:{type:'string',minLength:3,maxLength:2000} }),
  CreateCreatorDraftRequest: object({
    studio: stringEnum(enums.CreatorStudio), schemaVersion: { type: 'integer', minimum: 1, maximum: 1000 },
    title: { type: 'string', minLength: 1, maxLength: 120 }, content: { type: 'object', additionalProperties: true, maxProperties: 5000 },
  }, ['studio','title','content']),
  UpdateCreatorDraftRequest: object({
    schemaVersion: { type: 'integer', minimum: 1, maximum: 1000 }, title: { type: 'string', minLength: 1, maxLength: 120 },
    content: { type: 'object', additionalProperties: true, maxProperties: 5000 },
  }, []),
  CreatorDraftSummary: object({
    id, studio: stringEnum(enums.CreatorStudio), schemaVersion: { type: 'integer', minimum: 1 }, title: { type: 'string' },
    status: stringEnum(enums.CreatorDraftStatus), workId: { oneOf: [id,{ type: 'null' }] }, revision: uintString, createdAt: dateTime, updatedAt: dateTime,
  }),
  CreatorDraft: object({
    id, studio: stringEnum(enums.CreatorStudio), schemaVersion: { type: 'integer', minimum: 1 }, title: { type: 'string' },
    status: stringEnum(enums.CreatorDraftStatus), content: { type: 'object', additionalProperties: true },
    workId: { oneOf: [id,{ type: 'null' }] }, revision: uintString, createdAt: dateTime, updatedAt: dateTime,
  }),
  CreatorDraftPreview: object({
    draftId: id, revision: uintString, html: { type: 'string', minLength: 1, maxLength: 1048576 },
  }),
  CreateCreatorDraftBuildRequest: object({ releaseLabel: { type: 'string', minLength: 1, maxLength: 64 } }),
  CreatorDraftBuild: object({
    draft: { $ref: '#/components/schemas/CreatorDraft' }, workId: id, upload: { $ref: '#/components/schemas/UploadJob' },
    artifactSha256: sha256, artifactBytes: uintString,
  }),
  GitHubSourceInstallStart: object({ installUrl: { type: 'string', pattern: '^https://github\\.com/apps/' }, expiresAt: dateTime }),
  GitHubSourceInstallCompleteRequest: object({ state: { type: 'string', minLength: 32, maxLength: 128 }, installationId: uintString }),
  GitHubSourceConnection: object({
    id, installationId: uintString, accountId: uintString, accountLogin: { type: 'string', minLength: 1, maxLength: 255 },
    accountType: stringEnum(['User','Organization']), repositorySelection: stringEnum(['all','selected']),
    status: stringEnum(['active','suspended','revoked']), createdAt: dateTime, updatedAt: dateTime,
  }),
  GitHubSourceRepository: object({
    id, connectionId: id, repositoryId: uintString, nodeId: { type: 'string' }, owner: { type: 'string' }, name: { type: 'string' },
    defaultBranch: { type: 'string' }, visibility: stringEnum(['public','private','internal']), htmlUrl: { type: 'string', pattern: '^https://github\\.com/' },
    accessState: stringEnum(['active','removed','connection_suspended','connection_revoked']), lastSeenAt: dateTime,
  }),
  GitHubImportPreviewRequest: object({ connectionId: id, repositoryId: uintString }),
  GitHubLicenseEvidence: object({
    status: stringEnum(['recognized','missing','unknown','conflict']),
    spdx: { oneOf: [{ type: 'string', minLength: 1, maxLength: 80 }, { type: 'null' }] },
    path: { oneOf: [{ type: 'string', minLength: 1, maxLength: 512 }, { type: 'null' }] },
    sha256: { oneOf: [sha256, { type: 'null' }] },
  }),
  GitHubImportPreview: object({
    importId: id, workId: { oneOf: [id, { type: 'null' }] }, repository: { type: 'object', additionalProperties: true },
    commitSha: { type: 'string', pattern: '^[a-f0-9]{40}$' }, treeSha: { type: 'string', pattern: '^[a-f0-9]{40}$' },
    readmeExcerpt: { type: 'string', maxLength: 12000 }, readmeSha256: { oneOf: [sha256, { type: 'null' }] },
    license: { $ref: '#/components/schemas/GitHubLicenseEvidence' }, staticSignals: { type: 'object', additionalProperties: { type: 'boolean' } }, createdAt: dateTime,
  }),
  CreateGitHubDraftRequest: object({
    importId: id, title: { type: 'string', minLength: 1, maxLength: 120 }, description: { type: 'string', maxLength: 4000 }, kind: stringEnum(enums.WorkKind),
    attributionKind:stringEnum(['publisher','community_catalog']),
  }, ['importId','title']),
  WorkSource: object({
    workId: id, provider: { type: 'string', const: 'github' }, repositoryId: uintString, repositoryNodeId: { type: 'string' },
    visibility: stringEnum(['public','private','internal']), owner: { type: 'string' }, name: { type: 'string' }, repositoryUrl: { type: 'string', pattern: '^https://github\\.com/' },
    defaultBranch: { type: 'string' }, commitSha: { type: 'string', pattern: '^[a-f0-9]{40}$' }, treeSha: { type: 'string', pattern: '^[a-f0-9]{40}$' },
    status: stringEnum(['active','access_lost','suspended','revoked']), provenance: { type: 'object', additionalProperties: true }, createdAt: dateTime, updatedAt: dateTime,
  }),
  GitHubImportedDraft: object({ work: { $ref: '#/components/schemas/Work' }, source: { $ref: '#/components/schemas/WorkSource' } }),
  GitHubWebhookAccepted: object({ accepted: { type: 'boolean' }, replay: { type: 'boolean' } }),
  GitHubSourceAdminOverview: object({
    activeConnections: { type: 'integer', minimum: 0 }, activeRepositories: { type: 'integer', minimum: 0 },
    imports24h: { type: 'integer', minimum: 0 }, failedWebhooks24h: { type: 'integer', minimum: 0 },
  }),
  GitHubSourceAuditEvent: object({
    id, actorUserId: { oneOf: [id,{ type: 'null' }] }, connectionId: { oneOf: [id,{ type: 'null' }] },
    importId: { oneOf: [id,{ type: 'null' }] }, workId: { oneOf: [id,{ type: 'null' }] }, action: { type: 'string' },
    details: { type: 'object', additionalProperties: true }, createdAt: dateTime,
  }),
  CreateSourceBuildRequest: object({
    templateKey: { type: 'string', const: 'static-v1' }, templateVersion: { type: 'string', const: '1' },
    subdirectory: { type: 'string', maxLength: 255 }, releaseLabel: { type: 'string', minLength: 1, maxLength: 64 },
  }, ['templateKey','releaseLabel']),
  SourceBuildJob: object({
    id, workId: id, revisionId: id, commitSha: { type: 'string', pattern: '^[a-f0-9]{40}$' }, treeSha: { type: 'string', pattern: '^[a-f0-9]{40}$' },
    templateKey: { type: 'string', const: 'static-v1' }, templateVersion: { type: 'string', const: '1' }, config: { type: 'object', additionalProperties: true },
    configSha256: sha256, builderImageDigest: { type: 'string' }, releaseLabel: { type: 'string' }, state: stringEnum(enums.SourceBuildState),
    errorCode: { oneOf: [{ type: 'string' },{ type: 'null' }] }, artifactSha256: { oneOf: [sha256,{ type: 'null' }] }, artifactBytes: { oneOf: [uintString,{ type: 'null' }] },
    uploadId: { oneOf: [id,{ type: 'null' }] }, releaseId: { oneOf: [id,{ type: 'null' }] }, createdAt: dateTime, startedAt: nullableDateTime, completedAt: nullableDateTime, updatedAt: dateTime,
  }),
  ReleaseSummary: object({
    id,
    targetKey: stringEnum(enums.TargetKey),
    label: { type: 'string', minLength: 1, maxLength: 64 },
    packageType: stringEnum(enums.PackageType),
    validationState: stringEnum(enums.ReleaseValidationState),
    servingState: stringEnum(enums.ReleaseServingState),
    createdAt: dateTime,
  }),
  CreateUploadRequest: object({
    fileName: { type: 'string', minLength: 1, maxLength: 255 },
    declaredBytes: uintString, sha256,
    releaseLabel: { type: 'string', minLength: 1, maxLength: 64 },
    autoPublish: { type: 'boolean' },
    targetKey: stringEnum(enums.TargetKey), packageType: stringEnum(enums.PackageType),
  }),
  UploadJob: object({
    id, workId: id, targetKey: stringEnum(enums.TargetKey), packageType: stringEnum(enums.PackageType),
    state: stringEnum(enums.UploadState), publicationOutcome: stringEnum(enums.PublicationOutcome),
    declaredBytes: uintString,
    actualBytes: { oneOf: [uintString, { type: 'null' }] },
    createdAt: dateTime, expiresAt: dateTime,
    errorCode: { oneOf: [{ type: 'string', maxLength: 80 }, { type: 'null' }] },
  }),
  UploadGrant: object({
    uploadId: id, token: { type: 'string', minLength: 32 }, expiresAt: dateTime,
  }),
  LaunchDescriptor: object({
    apiVersion: { type: 'integer', const: 1 }, workId: workKey, releaseId: id,
    releaseLabel: { type: 'string', minLength: 1, maxLength: 64 },
    entryUrl: { type: 'string', format: 'uri' }, runtimeOrigin: { type: 'string', format: 'uri' },
    playerProtocol: object({ min: { type: 'integer', minimum: 1 }, max: { type: 'integer', minimum: 1 } }),
    capabilities: object({ fullscreen: { type: 'boolean' }, pointerLock: { type: 'boolean' }, multiplayer: { type: 'boolean' }, localSave: { type: 'boolean' }, cloudSave: { type: 'boolean' }, competition: { type: 'boolean' }, fileExport: { type: 'boolean' }, shareLinks: { type: 'boolean' } }, ['fullscreen', 'pointerLock', 'multiplayer']),
  }),
  LibraryState: object({
    workId: workKey,
    savedAt: { oneOf: [dateTime, { type: 'null' }] },
    lastPlayedAt: { oneOf: [dateTime, { type: 'null' }] },
    playCount: { type: 'integer', minimum: 0 },
  }),
  LibraryItem: object({
    workId: workKey,
    savedAt: { oneOf: [dateTime, { type: 'null' }] },
    lastPlayedAt: { oneOf: [dateTime, { type: 'null' }] },
    playCount: { type: 'integer', minimum: 0 },
    work: { $ref: '#/components/schemas/Work' },
  }),
  GuessBaikePuzzle: object({
    id: { type: 'string', minLength: 1, maxLength: 120 }, title: { type: 'string', minLength: 1, maxLength: 120 },
    aliases: { type: 'array', items: { type: 'string', maxLength: 120 }, maxItems: 20 }, category: { type: 'string', minLength: 1, maxLength: 80 },
    sourceKind: { type: 'string' }, sourceTitle: { type: 'string' }, sourceUrl: { type: 'string', format: 'uri' }, sourceRevision: { type: 'integer', minimum: 1 },
    sourceUpdatedAt: dateTime, license: { type: 'string' }, introHanCount: { type: 'integer', minimum: 1 }, content: { type: 'string', minLength: 1 },
  }),
  GuessBaikeDaily: object({ date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, schemaVersion: { type: 'integer', minimum: 1 }, generatedAt: dateTime, puzzle: { $ref: '#/components/schemas/GuessBaikePuzzle' } }),
  GuessBaikeAdminPuzzle: object({
    id: { type: 'string' }, title: { type: 'string' }, aliases: { type: 'array', items: { type: 'string' } }, category: { type: 'string' }, sourceKind: { type: 'string' }, sourceTitle: { type: 'string' }, sourceUrl: { type: 'string' }, sourceRevision: { type: 'integer' }, sourceUpdatedAt: dateTime, license: { type: 'string' }, introHanCount: { type: 'integer' }, content: { type: 'string' },
    status: stringEnum(['ready','disabled']), qualityReason: { oneOf: [{ type: 'string' }, { type: 'null' }] }, scheduledDates: { type: 'array', items: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } },
  }),
  GuessBaikePuzzleStatusRequest: object({ status: stringEnum(['ready','disabled']) }),
  GuessBaikeScheduleRequest: object({ date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, puzzleId: { type: 'string' } }),
  GuessBaikeSchedule: object({ date: { type: 'string' }, puzzleId: { type: 'string' } }),
  GuessBaikeAutomationRun: object({
    id, status: stringEnum(['running','succeeded','failed']), startedAt: dateTime, finishedAt: { oneOf: [dateTime,{ type: 'null' }] },
    fetchedCount: { type: 'integer', minimum: 0 }, acceptedCount: { type: 'integer', minimum: 0 }, scheduledCount: { type: 'integer', minimum: 0 },
    errorCode: { oneOf: [{ type: 'string' },{ type: 'null' }] }, errorMessage: { oneOf: [{ type: 'string' },{ type: 'null' }] },
  }),
  GuessBaikeAutomationStatus: object({
    enabled: { type: 'boolean' }, running: { type: 'boolean' }, intervalMinutes: { type: 'integer', minimum: 1 }, batchSize: { type: 'integer', minimum: 1 },
    scheduleDays: { type: 'integer', minimum: 1 }, readyCount: { type: 'integer', minimum: 0 }, scheduledCount: { type: 'integer', minimum: 0 },
    lastRun: { oneOf: [{ $ref: '#/components/schemas/GuessBaikeAutomationRun' },{ type: 'null' }] },
  }),
  GuessBaikeResultRequest: object({
    puzzleDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, puzzleId: { type: 'string', minLength: 1, maxLength: 120 },
    guessedCount: { type: 'integer', minimum: 0, maximum: 500 }, elapsedSeconds: { type: 'integer', minimum: 0, maximum: 86400 }, hints: { type: 'integer', minimum: 0, maximum: 2 },
  }),
  SaveResultResponse: object({ saved: { type: 'boolean' } }),
  SocialProfile: object({
    id, handle: { type: 'string', pattern: '^[a-z][a-z0-9-]{2,31}$' }, displayName: { type: 'string', minLength: 1, maxLength: 120 }, bio: { type: 'string', maxLength: 160 },
    visibility: stringEnum(['public','followers','private']), avatar: { $ref: '#/components/schemas/AccountAvatar' },
    followerCount: { type: 'integer', minimum: 0 }, followingCount: { type: 'integer', minimum: 0 },
    isFollowing: { type: 'boolean' }, isMe: { type: 'boolean' },
  }),
  UpdateSocialProfileRequest: object({ bio: { type: 'string', maxLength: 160 }, visibility: stringEnum(['public','followers','private']) }),
  PublicProfileLink: object({
    kind: stringEnum(['github','website','portfolio','bilibili','other']),
    label: { type: 'string', minLength: 1, maxLength: 40 }, url: { type: 'string', pattern: '^https://' },
  }),
  PublicGitHubRepository: object({ id, owner: { type: 'string', minLength: 1, maxLength: 255 }, name: { type: 'string', minLength: 1, maxLength: 255 }, url: { type: 'string', pattern: '^https://github\\.com/' } }),
  PublicProfileActivity: object({
    type: stringEnum(['work_published','guess_baike_completed']), occurredAt: dateTime,
    title: { type: 'string', minLength: 1, maxLength: 160 }, workId: { oneOf: [id,{ type: 'null' }] },
  }),
  PublicProfileBadge: object({ key: { type: 'string', minLength: 1, maxLength: 60 }, name: { type: 'string', minLength: 1, maxLength: 60 }, description: { type: 'string', minLength: 1, maxLength: 160 } }),
  PublicProfileAchievements: object({
    totalDays: { type: 'integer', minimum: 0 }, longestStreak: { type: 'integer', minimum: 0 }, completedChallenges: { type: 'integer', minimum: 0 }, challengeWins: { type: 'integer', minimum: 0 },
    bestDailyRank: { oneOf: [{ type: 'integer', minimum: 1 },{ type: 'null' }] }, latestDailyRank: { oneOf: [{ type: 'integer', minimum: 1 },{ type: 'null' }] },
    latestRankDate: { oneOf: [{ type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },{ type: 'null' }] }, badges: { type: 'array', maxItems: 10, items: { $ref: '#/components/schemas/PublicProfileBadge' } },
  }),
  PublicUserProfile: object({
    id, handle: { type: 'string', pattern: '^[a-z][a-z0-9-]{2,31}$' }, displayName: { type: 'string', minLength: 1, maxLength: 120 },
    headline: { type: 'string', maxLength: 160 }, about: { type: 'string', maxLength: 2000 }, visibility: stringEnum(['public','followers','private']),
    libraryVisibility: stringEnum(['public','followers','private']), libraryVisible: { type: 'boolean' },
    collaborationStatus: stringEnum(['not_looking','open_to_collaboration','available_for_hire']), skills: { type: 'array', maxItems: 12, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 30 } },
    activityVisibility: stringEnum(['public','followers','private']), activityVisible: { type: 'boolean' }, activity: { type: 'array', maxItems: 12, items: { $ref: '#/components/schemas/PublicProfileActivity' } },
    achievementsVisibility: stringEnum(['public','followers','private']), achievementsVisible: { type: 'boolean' }, achievements: { oneOf: [{ $ref: '#/components/schemas/PublicProfileAchievements' },{ type: 'null' }] },
    creator: { type: 'boolean' }, role: stringEnum(['user','admin']), joinedAt: dateTime, avatar: { $ref: '#/components/schemas/AccountAvatar' },
    followerCount: { type: 'integer', minimum: 0 }, followingCount: { type: 'integer', minimum: 0 }, isFollowing: { type: 'boolean' }, isMe: { type: 'boolean' },
    links: { type: 'array', maxItems: 5, items: { $ref: '#/components/schemas/PublicProfileLink' } },
    githubRepositories: { type: 'array', maxItems: 6, items: { $ref: '#/components/schemas/PublicGitHubRepository' } },
    contributions: { type: 'array', maxItems: 20, items: { $ref: '#/components/schemas/PublicProfileContribution' } },
    featuredWorks: { type: 'array', maxItems: 6, items: { $ref: '#/components/schemas/Work' } },
    works: { type: 'array', maxItems: 100, items: { $ref: '#/components/schemas/Work' } },
    library: { type: 'array', maxItems: 100, items: { $ref: '#/components/schemas/Work' } },
  }),
  UpdatePublicProfileRequest: object({
    handle: { type: 'string', pattern: '^[a-z][a-z0-9-]{2,31}$' }, headline: { type: 'string', maxLength: 160 }, about: { type: 'string', maxLength: 2000 },
    visibility: stringEnum(['public','followers','private']), libraryVisibility: stringEnum(['public','followers','private']),
    collaborationStatus: stringEnum(['not_looking','open_to_collaboration','available_for_hire']), skills: { type: 'array', maxItems: 12, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 30 } },
    activityVisibility: stringEnum(['public','followers','private']), achievementsVisibility: stringEnum(['public','followers','private']), links: { type: 'array', maxItems: 5, items: { $ref: '#/components/schemas/PublicProfileLink' } },
    featuredWorkIds: { type: 'array', maxItems: 6, uniqueItems: true, items: id }, githubRepositoryIds: { type: 'array', maxItems: 6, uniqueItems: true, items: id },
  }, ['handle','headline','about','visibility','links','featuredWorkIds']),
  FollowState: object({ following: { type: 'boolean' } }),
  BlockState: object({ blocked: { type: 'boolean' } }),
  WorkLeaderboardEntry: object({
    rank:{oneOf:[{type:'integer',minimum:1},{type:'null'}]},
    player:object({id,displayName:{type:'string'},isMe:{type:'boolean'},avatar:{$ref:'#/components/schemas/AccountAvatar'}}),
    scores:{type:'object',additionalProperties:{type:'number'}},completedAt:dateTime,
  }),
  WorkLeaderboard: object({
    workId:workKey,boardId:{type:'string'},title:{type:'string'},date:{type:'string',format:'date'},timeZone:{type:'string'},
    puzzleId:{oneOf:[{type:'string'},{type:'null'}]},verification:stringEnum(['client_reported']),
    metrics:{type:'array',items:object({key:{type:'string'},label:{type:'string'},unit:{type:'string'},direction:stringEnum(['asc','desc'])})},
    entries:{type:'array',maxItems:50,items:{$ref:'#/components/schemas/WorkLeaderboardEntry'}},
    myEntry:{oneOf:[{$ref:'#/components/schemas/WorkLeaderboardEntry'},{type:'null'}]},
    total:{type:'integer',minimum:0},offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:50},hasMore:{type:'boolean'},
  }),
  GuessBaikeLeaderboardEntry: object({
    rank: { type: 'integer', minimum: 1 }, player: { $ref: '#/components/schemas/SocialProfile' },
    guessedCount: { type: 'integer', minimum: 0, maximum: 500 }, elapsedSeconds: { type: 'integer', minimum: 0, maximum: 86400 },
    hints: { type: 'integer', minimum: 0, maximum: 2 }, completedAt: dateTime,
    reactions: object({ gg: { type: 'integer', minimum: 0 }, spark: { type: 'integer', minimum: 0 }, wow: { type: 'integer', minimum: 0 }, coffee: { type: 'integer', minimum: 0 } }, []),
    myReaction: { oneOf: [stringEnum(['gg','spark','wow','coffee']), { type: 'null' }] },
  }),
  GuessBaikeReactionRequest: object({ puzzleDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, reaction: stringEnum(['gg','spark','wow','coffee']) }),
  GuessBaikeReactionDeleteRequest: object({ puzzleDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } }),
  GuessBaikeReactionState: object({ reaction: { oneOf: [stringEnum(['gg','spark','wow','coffee']), { type: 'null' }] } }),
  SocialNotification: object({
    id, type: stringEnum(['follow','reaction','challenge_complete']), actor: { $ref: '#/components/schemas/SocialProfile' },
    puzzleDate: { oneOf: [{ type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, { type: 'null' }] },
    reaction: { oneOf: [stringEnum(['gg','spark','wow','coffee']), { type: 'null' }] },
    challengeCode: { oneOf: [{ type: 'string', pattern: '^[A-Za-z0-9_-]{10,24}$' }, { type: 'null' }] },
    outcome: { oneOf: [stringEnum(['win','loss','draw']), { type: 'null' }] }, read: { type: 'boolean' }, createdAt: dateTime,
  }),
  NotificationReadState: object({ updated: { type: 'integer', minimum: 0 } }),
  CreateGuessBaikeChallengeRequest: object({ puzzleDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } }),
  GuessBaikeChallenge: object({ code: { type: 'string', pattern: '^[A-Za-z0-9_-]{10,24}$' }, puzzleDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, expiresAt: dateTime }),
  GuessBaikeChallengeDetail: object({
    code: { type: 'string', pattern: '^[A-Za-z0-9_-]{10,24}$' }, puzzleDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, expiresAt: dateTime,
    creator: { $ref: '#/components/schemas/SocialProfile' },
    score: object({ guessedCount: { type: 'integer', minimum: 0 }, elapsedSeconds: { type: 'integer', minimum: 0 }, hints: { type: 'integer', minimum: 0, maximum: 2 } }),
    status: stringEnum(['open','accepted','completed']), acceptedByMe: { type: 'boolean' },
  }),
  GuessBaikeChallengeState: object({ accepted: { type: 'boolean' }, completed: { type: 'boolean' }, outcome: { oneOf: [stringEnum(['win','loss','draw']), { type: 'null' }] } }),
  GuessBaikeChallengeComparison: object({
    outcome: stringEnum(['win','loss','draw']),
    creator: object({ guessedCount: { type: 'integer', minimum: 0 }, elapsedSeconds: { type: 'integer', minimum: 0 }, hints: { type: 'integer', minimum: 0, maximum: 2 } }),
    participant: object({ guessedCount: { type: 'integer', minimum: 0 }, elapsedSeconds: { type: 'integer', minimum: 0 }, hints: { type: 'integer', minimum: 0, maximum: 2 } }),
  }),
  GuessBaikeChallengeHistory: object({
    code: { type: 'string' }, puzzleDate: { type: 'string' }, expiresAt: dateTime, role: stringEnum(['creator','participant']),
    status: stringEnum(['pending','completed','expired']), outcome: { oneOf: [stringEnum(['win','loss','draw']), { type: 'null' }] },
    opponent: { oneOf: [{ $ref: '#/components/schemas/SocialProfile' }, { type: 'null' }] },
    myScore: object({ guessedCount: { type: 'integer' }, elapsedSeconds: { type: 'integer' }, hints: { type: 'integer' } }),
    opponentScore: { oneOf: [object({ guessedCount: { type: 'integer' }, elapsedSeconds: { type: 'integer' }, hints: { type: 'integer' } }), { type: 'null' }] },
  }),
  RetentionBadge: object({ key: stringEnum(['first_break','streak_3','streak_7','challenger','duel_winner']), name: { type: 'string' }, description: { type: 'string' }, unlocked: { type: 'boolean' } }),
  PlayerRetention: object({
    currentStreak: { type: 'integer', minimum: 0 }, longestStreak: { type: 'integer', minimum: 0 }, totalDays: { type: 'integer', minimum: 0 }, completedChallenges: { type: 'integer', minimum: 0 },
    badges: { type: 'array', items: { $ref: '#/components/schemas/RetentionBadge' }, maxItems: 10 },
  }),
  NotificationPreferences: object({ follow: { type: 'boolean' }, reaction: { type: 'boolean' }, challenge: { type: 'boolean' } }),
  CreateContentReportRequest: object({
    category: stringEnum(['unsafe','malware','harassment','copyright','other']),
    details: { type: 'string', maxLength: 1000 },
  }, ['category']),
  ContentReport: object({
    id, workId: id, workTitle: { type: 'string', minLength: 1, maxLength: 120 }, reporterUserId: id,
    category: stringEnum(['unsafe','malware','harassment','copyright','other']),
    details: { type: 'string', maxLength: 1000 }, status: stringEnum(['open','resolved','dismissed']),
    resolutionAction: { oneOf: [stringEnum(['suspend','dismiss']), { type: 'null' }] },
    resolutionNote: { oneOf: [{ type: 'string', maxLength: 1000 }, { type: 'null' }] },
    createdAt: dateTime, resolvedAt: { oneOf: [dateTime, { type: 'null' }] },
  }),
  CreateCreatorFeedbackRequest: object({
    category: stringEnum(['bug','idea','compatibility','other']),
    summary: { type: 'string', minLength: 5, maxLength: 160 },
    details: { type: 'string', minLength: 10, maxLength: 2000 },
    reproductionSteps: { type: 'string', maxLength: 2000 },
    environment: { type: 'string', maxLength: 500 },
  }, ['category','summary','details']),
  CreatorFeedback: object({
    id, workId: id, workTitle: { type: 'string', minLength: 1, maxLength: 120 },
    category: stringEnum(['bug','idea','compatibility','other']),
    summary: { type: 'string', minLength: 5, maxLength: 160 }, details: { type: 'string', minLength: 10, maxLength: 2000 },
    reproductionSteps: { type: 'string', maxLength: 2000 }, environment: { type: 'string', maxLength: 500 },
    status: stringEnum(['new','reviewed','archived','issue_drafted','issue_linked','resolved']), contributionTaskId: { oneOf:[id,{type:'null'}] },
    issueUrl: { oneOf: [{ type: 'string', maxLength: 2048 }, { type: 'null' }] },
    repositoryUrl: { oneOf: [{ type: 'string', maxLength: 2048 }, { type: 'null' }] },
    createdAt: dateTime, updatedAt: dateTime,
  }),
  CreatorFeedbackIssueDraft: object({
    feedbackId: id, title: { type: 'string', minLength: 1, maxLength: 200 }, body: { type: 'string', minLength: 1, maxLength: 10000 },
    markdown: { type: 'string', minLength: 1, maxLength: 11000 },
    repositoryUrl: { oneOf: [{ type: 'string', maxLength: 2048 }, { type: 'null' }] },
    createUrl: { oneOf: [{ type: 'string', maxLength: 16000 }, { type: 'null' }] },
  }),
  UpdateCreatorFeedbackRequest: object({
    action: stringEnum(['review','archive','reopen','link_issue']), issueUrl: { type: 'string', minLength: 1, maxLength: 2048 },
  }, ['action']),
  ContributionIdentity: object({ id, handle: { type: 'string', pattern: '^[a-z][a-z0-9-]{2,31}$' }, displayName: { type: 'string', minLength: 1, maxLength: 120 } }),
  CreateContributionTaskRequest: object({
    title: { type: 'string', minLength: 5, maxLength: 160 }, description: { type: 'string', minLength: 20, maxLength: 4000 },
    difficulty: stringEnum(['starter','intermediate','advanced']),
    skills: { type: 'array', maxItems: 8, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 30 } },
  }),
  ContributionTask: object(contributionTaskProperties),
  ContributionTaskDetail: object({...contributionTaskProperties,events:{type:'array',maxItems:100,items:{$ref:'#/components/schemas/ContributionEvent'}},releases:{type:'array',maxItems:20,items:object({id,label:{type:'string'},target:{type:'string'}})}}),
  UpdateContributionTaskRequest: object({
    action:stringEnum(['edit','publish','close','reopen','complete','request_changes','link_issue','link_release']),expectedVersion:{type:'integer',minimum:1},issueUrl:{type:'string',minLength:1,maxLength:2048},reason:{type:'string',maxLength:2000},releaseId:{oneOf:[id,{type:'null'}]},title:{type:'string',minLength:5,maxLength:160},description:{type:'string',minLength:20,maxLength:4000},difficulty:stringEnum(['starter','intermediate','advanced']),skills:{type:'array',maxItems:8,uniqueItems:true,items:{type:'string',minLength:1,maxLength:30}},
  },['action','expectedVersion']),
  ContributionSubmissionRequest: object({ url: { type: 'string', minLength: 1, maxLength: 2048 }, note: { type: 'string', minLength: 5, maxLength: 2000 }, expectedVersion:{type:'integer',minimum:1} }, ['url','note']),

  ContributionEvent: object({id,action:{type:'string'},details:{type:'object',additionalProperties:true},createdAt:dateTime}),
  ContributionNotifications: object({unread:{type:'integer',minimum:0},items:{type:'array',items:object({id,taskId:id,title:{type:'string'},action:{type:'string'},details:{type:'object',additionalProperties:true},read:{type:'boolean'},createdAt:dateTime})}}),
  ContributionIssueDraft: object({
    taskId: id, title: { type: 'string', minLength: 1, maxLength: 200 }, body: { type: 'string', minLength: 1, maxLength: 10000 },
    repositoryUrl: { oneOf: [{ type: 'string', maxLength: 2048 },{ type: 'null' }] }, createUrl: { oneOf: [{ type: 'string', maxLength: 16000 },{ type: 'null' }] },
  }),
  PublicProfileContribution: object({
    taskId: id, title: { type: 'string', minLength: 5, maxLength: 160 }, workId: id, workTitle: { type: 'string', minLength: 1, maxLength: 120 },
    repositoryUrl: { oneOf: [{ type: 'string', maxLength: 2048 },{ type: 'null' }] }, issueUrl: { oneOf: [{ type: 'string', maxLength: 2048 },{ type: 'null' }] },
    submissionUrl: { type: 'string', minLength: 1, maxLength: 2048 }, completedAt: dateTime,
  }),
  ModerationDecisionRequest: object({ action: stringEnum(['suspend','dismiss']), note: { type: 'string', minLength: 1, maxLength: 1000 } }),
  ModerationAuditEvent: object({
    id, reportId: id, workId: id, workTitle: { type: 'string', minLength: 1, maxLength: 120 }, actorUserId: id,
    action: stringEnum(['suspend','dismiss']), reason: { type: 'string', minLength: 1, maxLength: 1000 },
    beforeState: { type: 'object', additionalProperties: true }, afterState: { type: 'object', additionalProperties: true }, createdAt: dateTime,
  }),
  AnalyticsEventsRequest: object({
    events: { type: 'array', minItems: 1, maxItems: 20, items: object({
      type: stringEnum(['page_view','session_ping','work_view','download_start','download_complete','game_start','game_end']),
      anonymousId: id, sessionId: id,
      hostKind: stringEnum(['browser','cursor','vscode','code','harness','codex','claude','opencode','unknown']),
      route: stringEnum(['discover','library','social','creator','admin','work','play','auth','settings','unknown']),
      workId: workKey, releaseId: id, durationMs: { type: 'integer', minimum: 0, maximum: 600000 }, occurredAt: dateTime,
    }, ['type','anonymousId','sessionId','hostKind','occurredAt']) },
  }),
  AnalyticsAccepted: object({ accepted: { type: 'integer', minimum: 1, maximum: 20 } }),
  AdminAnalyticsOverview: object({
    range: object({ days: { type: 'integer', enum: [7,30,90] }, since: dateTime, until: dateTime }),
    totals: object(Object.fromEntries(['totalUsers','newUsers','activeAccounts','publishedWorks','recordedPlays','librarySaves','uploads','uploadSuccesses','uploadFailures','visitors','pageViews','workViews','downloadStarts','downloadCompletes','gameStarts','siteDurationMs','gameDurationMs'].map(key => [key, { type: 'integer', minimum: 0 }]))),
    daily: { type: 'array', items: object({ day: { type: 'string', format: 'date' }, visitors: { type: 'integer', minimum: 0 }, pageViews: { type: 'integer', minimum: 0 }, downloads: { type: 'integer', minimum: 0 }, gameStarts: { type: 'integer', minimum: 0 }, newUsers: { type: 'integer', minimum: 0 } }) },
    hosts: { type: 'array', items: object({ hostKind: { type: 'string' }, visitors: { type: 'integer', minimum: 0 }, pageViews: { type: 'integer', minimum: 0 } }) },
    works: { type: 'array', items: object({ workId: workKey, title: { type: 'string' }, views: { type: 'integer', minimum: 0 }, starts: { type: 'integer', minimum: 0 }, downloads: { type: 'integer', minimum: 0 } }) },
    measurement: object({ timeZone: { type: 'string' }, siteDuration: { type: 'string' }, browserDownloads: { type: 'string' }, managedDownloads: { type: 'string' } }),
  }),
  CreatorAnalyticsOverview: object({
    range: object({ days: { type: 'integer', enum: [7,30,90] }, since: dateTime, until: dateTime }),
    totals: object(Object.fromEntries(['views','starts','engagedSessions','repeatPlayers','saves','builds','successfulBuilds','engagementRate','buildSuccessRate'].map(key => [key, { type: 'integer', minimum: 0 }]))),
    daily: { type: 'array', items: object({ day: { type: 'string', format: 'date' }, views: { type: 'integer', minimum: 0 }, starts: { type: 'integer', minimum: 0 }, engagedSessions: { type: 'integer', minimum: 0 } }) },
    works: { type: 'array', items: object({ workId: workKey, title: { type: 'string' }, state: stringEnum(enums.WorkState), views: { type: 'integer', minimum: 0 }, starts: { type: 'integer', minimum: 0 }, engagedSessions: { type: 'integer', minimum: 0 }, repeatPlayers: { type: 'integer', minimum: 0 }, saves: { type: 'integer', minimum: 0 }, builds: { type: 'integer', minimum: 0 }, successfulBuilds: { type: 'integer', minimum: 0 } }) },
    measurement: object({ timeZone: { type: 'string' }, repeatPlayer: { type: 'string' }, saves: { type: 'string' }, engagementRate: { type: 'string' } }),
  }),
  StorageCapacityOverview: object({
    checkedAt: dateTime,
    level: stringEnum(['healthy','warning','blocked','unavailable']),
    acceptingUploads: { type: 'boolean' },
    usedPercent: { type: 'number', minimum: 0, maximum: 100 },
    thresholds: object({ warnPercent: { type: 'integer', minimum: 1, maximum: 98 }, blockPercent: { type: 'integer', minimum: 2, maximum: 99 } }),
    stores: { type: 'array', items: {
      oneOf: [
        object({
          id: stringEnum(['quarantine','validator','runtime','avatars','covers']), available: { const: true }, level: stringEnum(['healthy','warning','blocked']),
          totalBytes: uintString, availableBytes: uintString, usedBytes: uintString,
          usedPercent: { type: 'number', minimum: 0, maximum: 100 }, projectedUsedPercent: { type: 'number', minimum: 0, maximum: 100 },
          reservedBytes: uintString, logicalBytes: { oneOf: [uintString,{ type: 'null' }] },
        }),
        object({ id: stringEnum(['quarantine','validator','runtime','avatars','covers']), available: { const: false }, level: { const: 'unavailable' }, errorCode: { type: 'string', minLength: 1, maxLength: 80 } }),
      ],
    } },
    lastCleanup: object({ at: nullableDateTime, filesRemoved: { type: 'integer', minimum: 0 }, bytesReclaimed: { type: 'integer', minimum: 0 } }),
  }),
});

const json = schema => ({ 'application/json': { schema } });
const response = (schema, description = 'Success') => ({ description, content: json(schema) });
const errorResponses = {
  '400': response({ $ref: '#/components/schemas/ErrorResponse' }, 'Invalid request'),
  '401': response({ $ref: '#/components/schemas/ErrorResponse' }, 'Authentication required'),
  '403': response({ $ref: '#/components/schemas/ErrorResponse' }, 'Forbidden'),
  '409': response({ $ref: '#/components/schemas/ErrorResponse' }, 'State conflict'),
  '429': response({ $ref: '#/components/schemas/ErrorResponse' }, 'Rate limited'),
};

export const operations = Object.freeze([
  ...saveOperationsRoutes,
  ...communityRoutes,
  ...competitionRoutes,
  {method:'get',path:'/v1/me/save-library',operationId:'listSaveLibrary',auth:'bearer',saveLibrary:true,saveLibraryPage:true,response:'SaveLibraryPage'},
  {method:'get',path:'/v1/me/save-library/{slotId}/history',operationId:'getSaveLibraryHistory',auth:'bearer',saveLibrary:true,pathId:'slotId',saveHistory:true,response:'SaveLibraryHistory'},
  {method:'get',path:'/v1/me/save-library/{slotId}/revisions/{revisionId}/content',operationId:'readSaveLibraryRevision',auth:'bearer',saveLibrary:true,pathId:'slotId',saveRevision:true,saveContent:true,response:'GameSaveMetadata'},
  {method:'post',path:'/v1/me/save-library/{slotId}/restore',operationId:'restoreSaveLibraryRevision',auth:'bearer',saveLibrary:true,pathId:'slotId',saveMutation:true,request:'RestoreGameSaveRequest',response:'GameSaveWriteResult'},
  {method:'post',path:'/v1/me/game-saves/{workId}/slots/{slotKey}/write-receipt',operationId:'getGameSaveWriteReceipt',auth:'bearer',gameSession:true,pathId:'workId',saveScope:true,saveSlot:true,saveMutation:true,saveCreateCondition:true,request:'GameSaveWriteReceiptRequest',response:'GameSaveWriteReceipt'},
  {"method":"get","path":"/v1/works/{workId}/save-policy","operationId":"getGameSavePolicy","response":"GameSavePolicy","auth":"bearer","gameSession":true,"pathId":"workId","saveScope":true},
  {"method":"get","path":"/v1/me/game-saves/{workId}/slots","operationId":"listGameSaves","response":"GameSaveMetadata","auth":"bearer","gameSession":true,"pathId":"workId","saveScope":true,"responseArray":true},
  {"method":"get","path":"/v1/me/game-saves/{workId}/slots/{slotKey}/metadata","operationId":"getGameSaveMetadata","response":"GameSaveMetadata","auth":"bearer","gameSession":true,"pathId":"workId","saveScope":true,"saveSlot":true},
  {"method":"get","path":"/v1/me/game-saves/{workId}/slots/{slotKey}/content","operationId":"readGameSave","response":"GameSaveMetadata","auth":"bearer","gameSession":true,"pathId":"workId","saveScope":true,"saveSlot":true,"saveContent":true},
  {"method":"put","path":"/v1/me/game-saves/{workId}/slots/{slotKey}","operationId":"writeGameSave","response":"GameSaveWriteResult","auth":"bearer","gameSession":true,"pathId":"workId","saveScope":true,"saveSlot":true,"saveMutation":true,"saveBody":true},
  {"method":"delete","path":"/v1/me/game-saves/{workId}/slots/{slotKey}","operationId":"deleteGameSave","response":"GameSaveWriteResult","auth":"bearer","gameSession":true,"pathId":"workId","saveScope":true,"saveSlot":true,"saveMutation":true},
  {"method":"get","path":"/v1/me/game-saves/{workId}/slots/{slotKey}/history","operationId":"listGameSaveHistory","response":"GameSaveHistory","auth":"bearer","gameSession":true,"pathId":"workId","saveScope":true,"saveSlot":true,"saveHistory":true},
  {"method":"post","path":"/v1/me/game-saves/{workId}/slots/{slotKey}/restore","operationId":"restoreGameSave","response":"GameSaveWriteResult","auth":"bearer","gameSession":true,"pathId":"workId","saveScope":true,"saveSlot":true,"saveMutation":true,"request":"RestoreGameSaveRequest"},

  {method:'post',path:'/v1/game-shares',operationId:'createGameShare',auth:'bearer',gameSession:true,request:'CreateGameShareRequest',response:'GameShareLink',successStatus:'201'},
  {method:'get',path:'/v1/game-shares/{code}',operationId:'getGameShare',auth:'anonymous',pathShareCode:true,response:'CurrentGameShare'},
  {method:'delete',path:'/v1/game-shares/{code}',operationId:'revokeGameShare',auth:'bearer',pathShareCode:true,response:'GameSessionRevocation'},
  { method: 'post', path: '/v1/game-sessions', operationId: 'createGameSession', auth: 'bearer', request: 'CreateGameSessionRequest', response: 'GameSession', successStatus: '201' },
  { method: 'get', path: '/v1/game-sessions/current', operationId: 'getGameSession', auth: 'bearer', response: 'GameSessionStatus', gameSession: true },
  { method: 'delete', path: '/v1/game-sessions/current', operationId: 'revokeGameSession', auth: 'bearer', response: 'GameSessionRevocation', gameSession: true },
  { method: 'post', path: '/v1/auth/email/challenges', operationId: 'createEmailChallenge', auth: 'anonymous', request: 'EmailChallengeRequest', response: 'EmailChallenge' },
  { method: 'post', path: '/v1/auth/email/verify', operationId: 'verifyEmailChallenge', auth: 'anonymous', request: 'VerifyEmailRequest', response: 'AuthTokens' },
  { method: 'post', path: '/v1/auth/github/device', operationId: 'startGitHubDevice', auth: 'anonymous', request: 'GitHubDeviceStartRequest', response: 'GitHubDeviceChallenge' },
  { method: 'post', path: '/v1/auth/github/device/{challengeId}/poll', operationId: 'pollGitHubDevice', auth: 'anonymous', response: 'GitHubDevicePoll', pathId: 'challengeId' },
  { method: 'post', path: '/v1/auth/github/web', operationId: 'startGitHubWeb', auth: 'anonymous', request: 'GitHubWebStartRequest', response: 'GitHubWebChallenge' },
  { method: 'post', path: '/v1/auth/github/web/{challengeId}/poll', operationId: 'pollGitHubWeb', auth: 'anonymous', response: 'GitHubWebPoll', pathId: 'challengeId' },
  { method: 'post', path: '/v1/auth/refresh', operationId: 'refreshDeviceGrant', auth: 'anonymous', request: 'RefreshRequest', response: 'AuthTokens' },
  { method: 'post', path: '/v1/realtime/tickets', operationId: 'createRealtimeTicket', auth: 'bearer', response: 'RealtimeTicket' },
  { method: 'get', path: '/v1/works/{workId}/multiplayer-modes', operationId: 'listMultiplayerModes', auth: 'anonymous', response: 'MultiplayerMode', responseArray: true, pathWorkKey: true },
  { method: 'post', path: '/v1/admin/multiplayer/modes', operationId: 'createMultiplayerMode', auth: 'bearer', request: 'CreateMultiplayerModeRequest', response: 'MultiplayerMode' },
  { method: 'get', path: '/v1/multiplayer/rooms', operationId: 'listMultiplayerRooms', auth: 'anonymous', response: 'MultiplayerRoom', responseArray: true, queryMultiplayerRooms: true },
  { method: 'post', path: '/v1/multiplayer/rooms', operationId: 'createMultiplayerRoom', auth: 'bearer', request: 'CreateMultiplayerRoomRequest', response: 'MultiplayerRoomCreated', idempotent: true },
  { method: 'get', path: '/v1/multiplayer/rooms/{roomId}', operationId: 'getMultiplayerRoom', auth: 'bearer', response: 'MultiplayerRoom', pathRoomId: true },
  { method: 'post', path: '/v1/multiplayer/rooms/{roomId}/join', operationId: 'joinMultiplayerRoom', auth: 'bearer', request: 'JoinMultiplayerRoomRequest', response: 'MultiplayerRoom', pathRoomId: true },
  { method: 'post', path: '/v1/multiplayer/rooms/{roomId}/invite', operationId: 'createMultiplayerInvite', auth: 'bearer', response: 'MultiplayerInvite', pathRoomId: true },
  { method: 'post', path: '/v1/multiplayer/rooms/{roomId}/leave', operationId: 'leaveMultiplayerRoom', auth: 'bearer', response: 'MultiplayerRoom', pathRoomId: true },
  { method: 'post', path: '/v1/multiplayer/rooms/{roomId}/ready', operationId: 'setMultiplayerReady', auth: 'bearer', request: 'SetMultiplayerReadyRequest', response: 'MultiplayerRoom', pathRoomId: true },
  { method: 'post', path: '/v1/multiplayer/rooms/{roomId}/start', operationId: 'startMultiplayerRoom', auth: 'bearer', response: 'MultiplayerMatch', pathRoomId: true, idempotent: true },
  { method: 'get', path: '/v1/multiplayer/matches/{matchId}', operationId: 'getMultiplayerMatch', auth: 'bearer', response: 'MultiplayerMatch', pathMatchId: true },
  { method: 'get', path: '/v1/multiplayer/matches/{matchId}/events', operationId: 'listMultiplayerMatchEvents', auth: 'bearer', response: 'MultiplayerMatchEvent', responseArray: true, pathMatchId: true, queryMatchEvents: true },
  { method: 'get', path: '/v1/multiplayer/matches/{matchId}/replay', operationId: 'getMultiplayerReplay', auth: 'bearer', response: 'MultiplayerReplay', pathMatchId: true },
  { method: 'get', path: '/v1/admin/multiplayer/overview', operationId: 'getAdminMultiplayerOverview', auth: 'bearer', response: 'MultiplayerAdminOverview' },
  { method: 'get', path: '/v1/admin/multiplayer/matches', operationId: 'listAdminMultiplayerMatches', auth: 'bearer', response: 'MultiplayerMatch', responseArray: true, queryAdminMatches: true },
  { method: 'post', path: '/v1/admin/multiplayer/matches/{matchId}/abort', operationId: 'abortAdminMultiplayerMatch', auth: 'bearer', request: 'AbortMultiplayerMatchRequest', response: 'MultiplayerAbortResult', pathMatchId: true },
  { method: 'get', path: '/v1/admin/multiplayer/audit', operationId: 'listAdminMultiplayerAudit', auth: 'bearer', response: 'MultiplayerAdminEvent', responseArray: true, queryLimit: true },
  { method: 'post', path: '/v1/creator/works/{workId}/multiplayer-rule-submissions', operationId: 'createMultiplayerRuleSubmission', auth: 'bearer', request: 'CreateMultiplayerRuleSubmissionRequest', response: 'MultiplayerRuleSubmission', pathId: 'workId', idempotent: true },
  { method: 'get', path: '/v1/creator/works/{workId}/multiplayer-rule-submissions', operationId: 'listMultiplayerRuleSubmissions', auth: 'bearer', response: 'MultiplayerRuleSubmission', responseArray: true, pathId: 'workId' },
  { method: 'get', path: '/v1/creator/multiplayer-rule-submissions/{submissionId}', operationId: 'getMultiplayerRuleSubmission', auth: 'bearer', response: 'MultiplayerRuleSubmission', pathId: 'submissionId' },
  { method: 'post', path: '/v1/creator/multiplayer-rule-submissions/{submissionId}/grant', operationId: 'createMultiplayerRuleUploadGrant', auth: 'bearer', response: 'MultiplayerRuleUploadGrant', pathId: 'submissionId' },
  { method: 'put', path: '/v1/creator/multiplayer-rule-submissions/{submissionId}/package', operationId: 'uploadMultiplayerRulePackage', auth: 'upload', response: 'MultiplayerRuleSubmission', pathId: 'submissionId', rawBody: true },
  { method: 'post', path: '/v1/creator/multiplayer-rule-submissions/{submissionId}/submit', operationId: 'submitMultiplayerRuleSubmission', auth: 'bearer', response: 'MultiplayerRuleSubmission', pathId: 'submissionId', idempotent: true },
  { method: 'get', path: '/v1/admin/multiplayer/rule-submissions', operationId: 'listAdminMultiplayerRuleSubmissions', auth: 'bearer', response: 'MultiplayerRuleSubmission', responseArray: true, queryRuleSubmissions: true },
  { method: 'get', path: '/v1/admin/multiplayer/rule-submissions/{submissionId}', operationId: 'getAdminMultiplayerRuleSubmission', auth: 'bearer', response: 'MultiplayerRuleSubmission', pathId: 'submissionId' },
  { method: 'get', path: '/v1/admin/multiplayer/rule-submissions/{submissionId}/package', operationId: 'downloadAdminMultiplayerRulePackage', auth: 'bearer', response: 'MultiplayerRuleSubmission', pathId: 'submissionId', zipResponse: true },
  { method: 'get', path: '/v1/admin/multiplayer/rule-builds/{buildId}/package', operationId: 'downloadAdminMultiplayerRuleBuild', auth: 'bearer', response: 'MultiplayerRuleBuild', pathBuildId: true, ruleBundleResponse: true },
  { method: 'post', path: '/v1/admin/multiplayer/rule-submissions/{submissionId}/review', operationId: 'reviewAdminMultiplayerRuleSubmission', auth: 'bearer', request: 'MultiplayerRuleReviewRequest', response: 'MultiplayerRuleSubmission', pathId: 'submissionId' },
  { method: 'post', path: '/v1/auth/device/logout', operationId: 'logoutDeviceGrant', auth: 'bearer', response: 'Profile' },
  { method: 'post', path: '/v1/auth/devices/logout-others', operationId: 'logoutOtherDeviceGrants', auth: 'bearer', response: 'RevokeSessionsResponse' },
  { method: 'post', path: '/v1/auth/devices/logout-all', operationId: 'logoutAllDeviceGrants', auth: 'bearer', response: 'RevokeSessionsResponse' },
  { method: 'get', path: '/v1/me', operationId: 'getProfile', auth: 'bearer', response: 'AccountProfile' },
  { method: 'get', path: '/v1/me/devices', operationId: 'listDeviceGrants', auth: 'bearer', response: 'DeviceSession', responseArray: true },
  { method: 'delete', path: '/v1/me/devices/{grantId}', operationId: 'revokeDeviceGrant', auth: 'bearer', response: 'RevokeSessionsResponse', pathId: 'grantId' },
  { method: 'patch', path: '/v1/me', operationId: 'updateProfile', auth: 'bearer', request: 'UpdateProfileRequest', response: 'AccountProfile' },
  { method: 'patch', path: '/v1/me/avatar', operationId: 'selectAvatar', auth: 'bearer', request: 'SelectAvatarRequest', response: 'AccountProfile' },
  { method: 'put', path: '/v1/me/avatar', operationId: 'uploadAvatar', auth: 'bearer', response: 'AccountProfile', avatarBody: true },
  { method: 'get', path: '/v1/me/library', operationId: 'listLibrary', auth: 'bearer', response: 'LibraryItem', responseArray: true,queryLibrary:true },
  { method: 'get', path: '/v1/me/library/{workId}', operationId: 'getLibraryState', auth: 'bearer', response: 'LibraryState', pathWorkKey: true },
  { method: 'put', path: '/v1/me/library/{workId}', operationId: 'saveToLibrary', auth: 'bearer', response: 'LibraryState', pathWorkKey: true },
  { method: 'delete', path: '/v1/me/library/{workId}', operationId: 'removeFromLibrary', auth: 'bearer', response: 'LibraryState', pathWorkKey: true },
  { method: 'post', path: '/v1/me/recent/{workId}', operationId: 'recordPlay', auth: 'bearer', response: 'LibraryState', pathWorkKey: true },
  { method: 'get', path: '/v1/games/guess-baike/daily', operationId: 'getGuessBaikeDaily', auth: 'anonymous', response: 'GuessBaikeDaily' },
  { method: 'post', path: '/v1/games/guess-baike/results', operationId: 'saveGuessBaikeResult', auth: 'bearer', request: 'GuessBaikeResultRequest', response: 'SaveResultResponse' },
  { method: 'get', path: '/v1/admin/games/guess-baike/puzzles', operationId: 'listAdminGuessBaikePuzzles', auth: 'bearer', response: 'GuessBaikeAdminPuzzle', responseArray: true },
  { method: 'get', path: '/v1/admin/games/guess-baike/automation', operationId: 'getGuessBaikeAutomationStatus', auth: 'bearer', response: 'GuessBaikeAutomationStatus' },
  { method: 'patch', path: '/v1/admin/games/guess-baike/puzzles/{puzzleId}', operationId: 'updateAdminGuessBaikePuzzle', auth: 'bearer', request: 'GuessBaikePuzzleStatusRequest', response: 'GuessBaikeAdminPuzzle', pathPuzzleId: true },
  { method: 'put', path: '/v1/admin/games/guess-baike/schedule', operationId: 'scheduleGuessBaikePuzzle', auth: 'bearer', request: 'GuessBaikeScheduleRequest', response: 'GuessBaikeSchedule' },
  { method: 'get', path: '/v1/me/social', operationId: 'getSocialProfile', auth: 'bearer', response: 'SocialProfile' },
  { method: 'patch', path: '/v1/me/social', operationId: 'updateSocialProfile', auth: 'bearer', request: 'UpdateSocialProfileRequest', response: 'SocialProfile' },
  { method: 'get', path: '/v1/profiles/{handle}', operationId: 'getPublicUserProfile', auth: 'anonymous', response: 'PublicUserProfile', pathHandle: true },
  { method: 'patch', path: '/v1/me/public-profile', operationId: 'updatePublicUserProfile', auth: 'bearer', request: 'UpdatePublicProfileRequest', response: 'PublicUserProfile' },
  { method: 'get', path: '/v1/users/{userId}', operationId: 'getPublicProfile', auth: 'bearer', response: 'SocialProfile', pathId: 'userId' },
  { method: 'put', path: '/v1/users/{userId}/follow', operationId: 'followUser', auth: 'bearer', response: 'SocialProfile', pathId: 'userId' },
  { method: 'delete', path: '/v1/users/{userId}/follow', operationId: 'unfollowUser', auth: 'bearer', response: 'FollowState', pathId: 'userId' },
  { method: 'put', path: '/v1/users/{userId}/block', operationId: 'blockUser', auth: 'bearer', response: 'BlockState', pathId: 'userId' },
  { method: 'delete', path: '/v1/users/{userId}/block', operationId: 'unblockUser', auth: 'bearer', response: 'BlockState', pathId: 'userId' },
  { method: 'get', path: '/v1/games/guess-baike/leaderboard', operationId: 'getGuessBaikeLeaderboard', auth: 'bearer', response: 'GuessBaikeLeaderboardEntry', responseArray: true, queryLeaderboard: true },
  { method: 'put', path: '/v1/games/guess-baike/reactions/{userId}', operationId: 'reactToGuessBaikeResult', auth: 'bearer', request: 'GuessBaikeReactionRequest', response: 'GuessBaikeReactionState', pathId: 'userId' },
  { method: 'delete', path: '/v1/games/guess-baike/reactions/{userId}', operationId: 'removeGuessBaikeReaction', auth: 'bearer', request: 'GuessBaikeReactionDeleteRequest', response: 'GuessBaikeReactionState', pathId: 'userId' },
  { method: 'get', path: '/v1/me/notifications', operationId: 'listSocialNotifications', auth: 'bearer', response: 'SocialNotification', responseArray: true },
  { method: 'post', path: '/v1/me/notifications/read', operationId: 'markSocialNotificationsRead', auth: 'bearer', response: 'NotificationReadState' },
  { method: 'post', path: '/v1/games/guess-baike/challenges', operationId: 'createGuessBaikeChallenge', auth: 'bearer', request: 'CreateGuessBaikeChallengeRequest', response: 'GuessBaikeChallenge' },
  { method: 'get', path: '/v1/challenges/{code}', operationId: 'getGuessBaikeChallenge', auth: 'bearer', response: 'GuessBaikeChallengeDetail', pathCode: true },
  { method: 'post', path: '/v1/challenges/{code}/accept', operationId: 'acceptGuessBaikeChallenge', auth: 'bearer', response: 'GuessBaikeChallengeState', pathCode: true },
  { method: 'post', path: '/v1/challenges/{code}/complete', operationId: 'completeGuessBaikeChallenge', auth: 'bearer', response: 'GuessBaikeChallengeComparison', pathCode: true },
  { method: 'get', path: '/v1/me/challenges', operationId: 'listGuessBaikeChallenges', auth: 'bearer', response: 'GuessBaikeChallengeHistory', responseArray: true },
  { method: 'get', path: '/v1/me/retention', operationId: 'getPlayerRetention', auth: 'bearer', response: 'PlayerRetention' },
  { method: 'get', path: '/v1/me/notification-preferences', operationId: 'getNotificationPreferences', auth: 'bearer', response: 'NotificationPreferences' },
  { method: 'put', path: '/v1/me/notification-preferences', operationId: 'updateNotificationPreferences', auth: 'bearer', request: 'NotificationPreferences', response: 'NotificationPreferences' },
  { method: 'get', path: '/v1/works', operationId: 'listWorks', auth: 'anonymous', response: 'Work', responseArray: true, queryCatalog:true },
  { method:'get',path:'/v1/works/{workId}/leaderboard',operationId:'getWorkLeaderboard',auth:'optional',response:'WorkLeaderboard',pathWorkKey:true,queryWorkLeaderboard:true },
  { method: 'get', path: '/v1/works/{workId}', operationId: 'getWork', auth: 'anonymous', response: 'Work', pathWorkKey: true },
  { method: 'get', path: '/v1/works/{workId}/claim', operationId: 'getPublicProjectClaim', auth: 'optional', response: 'PublicProjectClaim', pathWorkKey: true },
  { method: 'post', path: '/v1/works/{workId}/claims', operationId: 'createProjectClaim', auth: 'bearer', request: 'CreateProjectClaimRequest', response: 'ProjectClaim', pathId: 'workId', successStatus: '201' },
  { method: 'get', path: '/v1/me/project-claims', operationId: 'listMyProjectClaims', auth: 'bearer', response: 'ProjectClaim', responseArray: true, queryProjectClaims: true },
  { method: 'post', path: '/v1/project-claims/{claimId}/cancel', operationId: 'cancelProjectClaim', auth: 'bearer', response: 'ProjectClaim', pathId: 'claimId' },
  { method: 'get', path: '/v1/admin/project-claims', operationId: 'listAdminProjectClaims', auth: 'bearer', response: 'ProjectClaim', responseArray: true, queryProjectClaims: true },
  { method: 'post', path: '/v1/admin/project-claims/{claimId}/decision', operationId: 'decideProjectClaim', auth: 'bearer', request: 'ProjectClaimDecisionRequest', response: 'ProjectClaim', pathId: 'claimId' },
  { method: 'get', path: '/v1/works/{workId}/launch', operationId: 'getWorkLaunch', auth: 'anonymous', response: 'LaunchDescriptor', pathWorkKey: true, queryReleaseId: true },
  { method: 'post', path: '/v1/works/{workId}/reports', operationId: 'createContentReport', auth: 'bearer', request: 'CreateContentReportRequest', response: 'ContentReport', pathWorkKey: true },
  { method: 'post', path: '/v1/works/{workId}/feedback', operationId: 'createCreatorFeedback', auth: 'bearer', request: 'CreateCreatorFeedbackRequest', response: 'CreatorFeedback', pathWorkKey: true },
  { method: 'get', path: '/v1/creator/feedback', operationId: 'listCreatorFeedback', auth: 'bearer', response: 'CreatorFeedback', responseArray: true },
  { method: 'post', path: '/v1/creator/feedback/{feedbackId}/issue-draft', operationId: 'createCreatorFeedbackIssueDraft', auth: 'bearer', response: 'CreatorFeedbackIssueDraft', pathId: 'feedbackId' },
  { method: 'patch', path: '/v1/creator/feedback/{feedbackId}', operationId: 'updateCreatorFeedback', auth: 'bearer', request: 'UpdateCreatorFeedbackRequest', response: 'CreatorFeedback', pathId: 'feedbackId' },
  { method: 'post', path: '/v1/creator/feedback/{feedbackId}/contribution-task', operationId: 'createContributionTaskFromFeedback', auth: 'bearer', request: 'CreateContributionTaskRequest', response: 'ContributionTask', pathId: 'feedbackId', successStatus: '201' },
  { method: 'get', path: '/v1/creator/contribution-tasks', operationId: 'listCreatorContributionTasks', auth: 'bearer', response: 'ContributionTask', responseArray: true, queryLimit: true, queryOffset:true },
  { method: 'patch', path: '/v1/creator/contribution-tasks/{taskId}', operationId: 'updateCreatorContributionTask', auth: 'bearer', request: 'UpdateContributionTaskRequest', response: 'ContributionTask', pathId: 'taskId' },
  { method: 'post', path: '/v1/creator/contribution-tasks/{taskId}/issue-draft', operationId: 'createContributionIssueDraft', auth: 'bearer', response: 'ContributionIssueDraft', pathId: 'taskId' },
  { method:'get',path:'/v1/contribution-tasks/{taskId}',operationId:'getContributionTask',auth:'anonymous',response:'ContributionTaskDetail',pathId:'taskId' },
  { method:'post',path:'/v1/contribution-tasks/{taskId}/renew',operationId:'renewContributionTask',auth:'bearer',response:'ContributionTask',pathId:'taskId' },
  { method:'post',path:'/v1/contribution-tasks/{taskId}/withdraw',operationId:'withdrawContributionTask',auth:'bearer',response:'ContributionTask',pathId:'taskId' },
  { method:'get',path:'/v1/contribution-notifications',operationId:'listContributionNotifications',auth:'bearer',response:'ContributionNotifications',queryLimit:true,queryOffset:true },
  { method:'post',path:'/v1/contribution-notifications/{taskId}/read',operationId:'readContributionNotification',auth:'bearer',response:'NotificationReadState',pathId:'taskId' },
  { method: 'get', path: '/v1/contribution-tasks', operationId: 'listContributionTasks', auth: 'anonymous', response: 'ContributionTask', responseArray: true, queryContributionTasks: true },
  { method: 'post', path: '/v1/contribution-tasks/{taskId}/claim', operationId: 'claimContributionTask', auth: 'bearer', response: 'ContributionTask', pathId: 'taskId' },
  { method: 'post', path: '/v1/contribution-tasks/{taskId}/release', operationId: 'releaseContributionTask', auth: 'bearer', response: 'ContributionTask', pathId: 'taskId' },
  { method: 'post', path: '/v1/contribution-tasks/{taskId}/submission', operationId: 'submitContributionTask', auth: 'bearer', request: 'ContributionSubmissionRequest', response: 'ContributionTask', pathId: 'taskId' },
  { method: 'get', path: '/v1/admin/reports', operationId: 'listContentReports', auth: 'bearer', response: 'ContentReport', responseArray: true },
  { method: 'post', path: '/v1/admin/reports/{reportId}/decision', operationId: 'decideContentReport', auth: 'bearer', request: 'ModerationDecisionRequest', response: 'ContentReport', pathId: 'reportId' },
  { method: 'get', path: '/v1/admin/audit', operationId: 'listModerationAudit', auth: 'bearer', response: 'ModerationAuditEvent', responseArray: true },
  { method: 'post', path: '/v1/analytics/events', operationId: 'recordAnalyticsEvents', auth: 'anonymous', request: 'AnalyticsEventsRequest', response: 'AnalyticsAccepted', successStatus: '202' },
  { method: 'get', path: '/v1/admin/analytics', operationId: 'getAdminAnalytics', auth: 'bearer', response: 'AdminAnalyticsOverview', queryAnalyticsDays: true },
  { method: 'get', path: '/v1/creator/analytics', operationId: 'getCreatorAnalytics', auth: 'bearer', response: 'CreatorAnalyticsOverview', queryAnalyticsDays: true, analyticsDefaultDays: 30 },
  { method: 'get', path: '/v1/admin/storage', operationId: 'getAdminStorage', auth: 'bearer', response: 'StorageCapacityOverview' },
  { method: 'get', path: '/v1/creator/works', operationId: 'listCreatorWorks', auth: 'bearer', response: 'Work', responseArray: true },
  { method: 'get', path: '/v1/creator/drafts', operationId: 'listCreatorDrafts', auth: 'bearer', response: 'CreatorDraftSummary', responseArray: true, queryCreatorStudio: true },
  { method: 'post', path: '/v1/creator/drafts', operationId: 'createCreatorDraft', auth: 'bearer', request: 'CreateCreatorDraftRequest', response: 'CreatorDraft', idempotent: true },
  { method: 'get', path: '/v1/creator/drafts/{draftId}', operationId: 'getCreatorDraft', auth: 'bearer', response: 'CreatorDraft', pathId: 'draftId' },
  { method: 'get', path: '/v1/creator/drafts/{draftId}/preview', operationId: 'previewCreatorDraft', auth: 'bearer', response: 'CreatorDraftPreview', pathId: 'draftId' },
  { method: 'put', path: '/v1/creator/drafts/{draftId}', operationId: 'updateCreatorDraft', auth: 'bearer', request: 'UpdateCreatorDraftRequest', response: 'CreatorDraft', pathId: 'draftId', idempotent: true, ifMatch: true },
  { method: 'post', path: '/v1/creator/drafts/{draftId}/builds', operationId: 'buildCreatorDraft', auth: 'bearer', request: 'CreateCreatorDraftBuildRequest', response: 'CreatorDraftBuild', pathId: 'draftId', idempotent: true, ifMatch: true, successStatus: '202' },
  { method: 'post', path: '/v1/creator/source-connections/github/install', operationId: 'startGitHubSourceInstall', auth: 'bearer', response: 'GitHubSourceInstallStart' },
  { method: 'post', path: '/v1/creator/source-connections/github/complete', operationId: 'completeGitHubSourceInstall', auth: 'bearer', request: 'GitHubSourceInstallCompleteRequest', response: 'GitHubSourceConnection' },
  { method: 'get', path: '/v1/creator/source-connections', operationId: 'listGitHubSourceConnections', auth: 'bearer', response: 'GitHubSourceConnection', responseArray: true },
  { method: 'delete', path: '/v1/creator/source-connections/{connectionId}', operationId: 'disconnectGitHubSourceConnection', auth: 'bearer', response: 'GitHubSourceConnection', pathId: 'connectionId' },
  { method: 'get', path: '/v1/creator/source-connections/{connectionId}/repositories', operationId: 'listGitHubSourceRepositories', auth: 'bearer', response: 'GitHubSourceRepository', responseArray: true, pathId: 'connectionId' },
  { method: 'post', path: '/v1/creator/source-imports/preview', operationId: 'previewGitHubSourceImport', auth: 'bearer', request: 'GitHubImportPreviewRequest', response: 'GitHubImportPreview' },
  { method: 'post', path: '/v1/creator/source-imports/drafts', operationId: 'createGitHubImportedDraft', auth: 'bearer', request: 'CreateGitHubDraftRequest', response: 'GitHubImportedDraft', idempotent: true },
  { method: 'get', path: '/v1/creator/works/{workId}/source', operationId: 'getWorkSource', auth: 'bearer', response: 'WorkSource', pathId: 'workId' },
  { method: 'post', path: '/v1/webhooks/github', operationId: 'acceptGitHubWebhook', auth: 'anonymous', response: 'GitHubWebhookAccepted', webhookBody: true },
  { method: 'get', path: '/v1/admin/source-imports/overview', operationId: 'getGitHubSourceAdminOverview', auth: 'bearer', response: 'GitHubSourceAdminOverview' },
  { method: 'get', path: '/v1/admin/source-imports/audit', operationId: 'listGitHubSourceAudit', auth: 'bearer', response: 'GitHubSourceAuditEvent', responseArray: true, queryLimit: true },
  { method: 'post', path: '/v1/creator/works/{workId}/builds', operationId: 'createSourceBuild', auth: 'bearer', request: 'CreateSourceBuildRequest', response: 'SourceBuildJob', pathId: 'workId', idempotent: true, successStatus: '202' },
  { method: 'get', path: '/v1/creator/works/{workId}/builds', operationId: 'listSourceBuilds', auth: 'bearer', response: 'SourceBuildJob', responseArray: true, pathId: 'workId' },
  { method: 'get', path: '/v1/creator/works/{workId}/builds/{buildId}', operationId: 'getSourceBuild', auth: 'bearer', response: 'SourceBuildJob', pathId: 'workId', pathBuildId: true },
  { method: 'post', path: '/v1/creator/works/{workId}/builds/{buildId}/publish', operationId: 'publishSourceBuild', auth: 'bearer', response: 'SourceBuildJob', pathId: 'workId', pathBuildId: true },
  { method: 'post', path: '/v1/creator/works', operationId: 'createWork', auth: 'bearer', request: 'CreateWorkRequest', response: 'Work', idempotent: true },
  { method: 'patch', path: '/v1/creator/works/{workId}', operationId: 'updateWork', auth: 'bearer', request: 'UpdateWorkRequest', response: 'Work', pathId: 'workId', idempotent: true, ifMatch: true },
  { method: 'put', path: '/v1/creator/works/{workId}/cover', operationId: 'uploadWorkCover', auth: 'bearer', response: 'Work', pathId: 'workId', coverBody: true },
  { method: 'get', path: '/v1/creator/works/{workId}/releases', operationId: 'listWorkReleases', auth: 'bearer', response: 'ReleaseSummary', responseArray: true, pathId: 'workId' },
  { method: 'post', path: '/v1/creator/works/{workId}/withdraw', operationId: 'withdrawWork', auth: 'bearer', response: 'Work', pathId: 'workId', idempotent: true, ifMatch: true },
  { method: 'post', path: '/v1/creator/works/{workId}/uploads', operationId: 'createUpload', auth: 'bearer', request: 'CreateUploadRequest', response: 'UploadJob', pathId: 'workId', idempotent: true },
  { method: 'post', path: '/v1/creator/uploads/{uploadId}/grant', operationId: 'createUploadGrant', auth: 'bearer', response: 'UploadGrant', pathId: 'uploadId' },
  { method: 'put', path: '/v1/creator/uploads/{uploadId}/content', operationId: 'uploadContent', auth: 'upload', response: 'UploadJob', pathId: 'uploadId', rawBody: true },
  { method: 'post', path: '/v1/creator/uploads/{uploadId}/complete', operationId: 'completeUpload', auth: 'bearer', response: 'UploadJob', pathId: 'uploadId', idempotent: true },
  { method: 'get', path: '/v1/creator/uploads/{uploadId}', operationId: 'getUpload', auth: 'bearer', response: 'UploadJob', pathId: 'uploadId' },
  { method: 'get', path: '/v1/works/{workId}/cover', operationId: 'getWorkCover', auth: 'anonymous', pathId: 'workId', binaryResponse: true },
]);

export function createOpenApiDocument() {
  const paths = {};
  for (const operation of operations) {
    const parameters = [...(operation.parameters ?? [])];
    if (operation.saveHealthPage) parameters.push({name:'afterWorkId',in:'query',required:false,schema:id});
    if (operation.saveLibraryPage) parameters.push({name:'afterSlotId',in:'query',required:false,schema:id});
    if (operation.saveRevision) parameters.push({name:'revisionId',in:'path',required:true,schema:id});
    if (operation.saveScope) parameters.push({ name:'namespace',in:'query',required:true,schema:saveName });
    if (operation.saveSlot) parameters.push({ name:'slotKey',in:'path',required:true,schema:saveName });
    if (operation.saveHistory) parameters.push({ name:'beforeRevision',in:'query',required:false,schema:{type:'string',pattern:'^[1-9][0-9]{0,18}$'} });
    if (operation.saveMutation) parameters.push(
      { name:'Idempotency-Key',in:'header',required:true,schema:id },
      { name:'If-Match',in:'header',required:!operation.saveBody&&!operation.saveCreateCondition,schema:{type:'string'},description:'One exact strong ETag. For creation use If-None-Match instead.' },
      ...(operation.saveBody||operation.saveCreateCondition?[{name:'If-None-Match',in:'header',required:false,schema:{type:'string',const:'*'},description:'Creation only; mutually exclusive with If-Match.'}]:[]),
    );
    if (operation.saveContent) parameters.push({name:'If-Match',in:'header',required:false,schema:{type:'string'},description:'Download only the metadata revision already read; returns 412 if it changed.'});
    if (operation.saveBody) parameters.push(
      {name:'X-GameHub-Save-Schema',in:'header',required:true,schema:{type:'integer',minimum:1,maximum:2147483647}},
      {name:'X-Content-SHA256',in:'header',required:true,schema:sha256},
      {name:'Content-Encoding',in:'header',required:false,schema:{type:'string',const:'identity'}},
    );
    if (operation.pathId) parameters.push({ name: operation.pathId, in: 'path', required: true, schema: id });
    if (operation.pathHandle) parameters.push({ name: 'handle', in: 'path', required: true, schema: { type: 'string', pattern: '^[a-z][a-z0-9-]{2,31}$' } });
    if (operation.pathShareCode) parameters.push({name:'code',in:'path',required:true,schema:{type:'string',pattern:'^[A-Za-z0-9_-]{32}$'}});
    if (operation.pathCode) parameters.push({ name: 'code', in: 'path', required: true, schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{10,24}$' } });
      if (operation.pathPuzzleId) parameters.push({ name: 'puzzleId', in: 'path', required: true, schema: { type: 'string', minLength: 1, maxLength: 120 } });
    if (operation.pathWorkKey) parameters.push({ name: 'workId', in: 'path', required: true, schema: workKey });
    if (operation.pathRoomId) parameters.push({ name: 'roomId', in: 'path', required: true, schema: id });
    if (operation.pathBuildId) parameters.push({ name: 'buildId', in: 'path', required: true, schema: id });
    if (operation.pathJobId) parameters.push({ name: 'jobId', in: 'path', required: true, schema: id });
    if (operation.pathToken) parameters.push({ name: 'token', in: 'path', required: true, schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{32}$' } });
    if (operation.gameSession) parameters.push({ name: 'X-GameHub-Session', in: 'header', required: true, schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' } });
    if (operation.idempotent) parameters.push({ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 16, maxLength: 128 } });
    if (operation.ifMatch) parameters.push({ name: 'If-Match', in: 'header', required: true, schema: { type: 'string', minLength: 8, maxLength: 200 } });
    if (operation.queryReleaseId) parameters.push({ name: 'releaseId', in: 'query', required: false, schema: id });
    if (operation.queryProjectClaims) parameters.push(
      {name:'status',in:'query',required:false,schema:{type:'string',enum:['all','pending','verified','rejected','cancelled','disputed','suspended','revoked']}},
      {name:'limit',in:'query',required:false,schema:{type:'integer',minimum:1,maximum:100}}
    );
    if (operation.queryLibrary) parameters.push({name:'limit',in:'query',required:false,schema:{type:'integer',minimum:1,maximum:100}},{name:'recent',in:'query',required:false,schema:{type:'boolean'}});
    if (operation.queryCatalog) parameters.push(
      {name:'limit',in:'query',required:false,schema:{type:'integer',minimum:1,maximum:50,default:20}},
      {name:'offset',in:'query',required:false,schema:{type:'integer',minimum:0,maximum:100000,default:0}},
      {name:'q',in:'query',required:false,schema:{type:'string',maxLength:100}},
      {name:'kind',in:'query',required:false,schema:{type:'string',enum:['game','creative','tool']}}
    );
    if (operation.queryCreatorStudio) parameters.push({ name: 'studio', in: 'query', required: false, schema: stringEnum(enums.CreatorStudio) });
    if (operation.queryAnalyticsDays) parameters.push({ name: 'days', in: 'query', required: false, schema: { type: 'integer', enum: [7,30,90], default: operation.analyticsDefaultDays ?? 7 } });
    if (operation.queryMultiplayerRooms) parameters.push(
      { name: 'modeId', in: 'query', required: true, schema: id },
      { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 50, default: 30 } },
      { name: 'query', in: 'query', required: false, schema: { type: 'string', maxLength: 80 } },
    );
    if (operation.queryMatchEvents) parameters.push(
      { name: 'afterSeq', in: 'query', required: false, schema: { type: 'integer', minimum: 0, default: 0 } },
      { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 } },
    );
    if (operation.queryAdminMatches) parameters.push(
      { name: 'status', in: 'query', required: false, schema: stringEnum(['all','pending','active','finishing','completed','aborted']) },
      { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
    );
    if (operation.queryRuleSubmissions) parameters.push(
      { name: 'state',in: 'query',required: false,schema: stringEnum(['queue','submitted','in_review','changes_requested','approved_for_build','rejected','failed']) },
      { name: 'limit',in: 'query',required: false,schema: { type: 'integer',minimum: 1,maximum: 100,default: 50 } },
    );
    if (operation.queryLimit) parameters.push({ name: 'limit', in: 'query', required: false, schema: { type: 'integer',minimum: 1,maximum: 100,default: 50 } });
    if (operation.queryOffset) parameters.push({name:'offset',in:'query',required:false,schema:{type:'integer',minimum:0,maximum:1000000,default:0}});
    if (operation.queryContributionTasks) parameters.push(
      {name:'offset',in:'query',required:false,schema:{type:'integer',minimum:0,maximum:1000000,default:0}},
      {name:'mine',in:'query',required:false,schema:{type:'boolean',default:false}},
      { name: 'status', in: 'query', required: false, schema: stringEnum(['all','open','claimed','submitted','completed','closed']) },
      { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
    );
    if (operation.queryLeaderboard) parameters.push(
      { name: 'date', in: 'query', required: true, schema: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } },
      { name: 'scope', in: 'query', required: true, schema: stringEnum(['global','following']) },
    );
    if(operation.queryWorkLeaderboard)parameters.push(
      {name:'date',in:'query',required:false,schema:{type:'string',format:'date'}},
      {name:'puzzleId',in:'query',required:false,schema:{type:'string',minLength:1,maxLength:120}},
      {name:'limit',in:'query',required:false,schema:{type:'integer',minimum:1,maximum:50,default:10}},
      {name:'offset',in:'query',required:false,schema:{type:'integer',minimum:0,maximum:100000,default:0}},
    );
    paths[operation.path] ??= {};
    paths[operation.path][operation.method] = {
      operationId: operation.operationId,
      tags: [operation.path.split('/')[2]],
      ...(operation.auth === 'optional' ? { security: [{ bearerAuth: [] }, {}] } : operation.auth === 'bearer' ? { security: [{ bearerAuth: [] }] } : operation.auth === 'upload' ? { security: [{ uploadGrant: [] }] } : { security: [] }),
      ...(parameters.length ? { parameters } : {}),
      ...(operation.communityImageBody ? { requestBody: { required: true, content: { 'application/octet-stream': { schema: { type: 'string', contentEncoding: 'binary', maxLength: 2097152 } } } } } : operation.saveBody ? {requestBody:{required:true,content:{'application/json':{schema:{type:'object',additionalProperties:true}},'application/octet-stream':{schema:{type:'string',contentEncoding:'binary',maxLength:1048576}}}}} : operation.request ? { requestBody: { required: true, content: json({ $ref: `#/components/schemas/${operation.request}` }) } } : operation.avatarBody ? { requestBody: { required: true, content: Object.fromEntries(['image/png','image/jpeg','image/gif','image/webp'].map(type => [type, { schema: { type: 'string', contentEncoding: 'binary', maxLength: 2097152 } }])) } } : operation.coverBody ? { requestBody: { required: true, content: Object.fromEntries(['image/png','image/jpeg','image/webp'].map(type => [type, { schema: { type: 'string', contentEncoding: 'binary', maxLength: 5242880 } }])) } } : operation.rawBody ? { requestBody: { required: true, content: { 'application/zip': { schema: { type: 'string', contentEncoding: 'binary' } }, 'application/x-zip-compressed': { schema: { type: 'string', contentEncoding: 'binary' } }, 'application/octet-stream': { schema: { type: 'string', contentEncoding: 'binary' } } } } } : operation.webhookBody ? { requestBody: { required: true, content: json({ type: 'object', additionalProperties: true }) } } : {}),
      responses: {
        [operation.successStatus ?? '200']: operation.saveContent ? {description:'Private save bytes; ETag and schema/digest headers describe the returned revision.',content:{'application/json':{schema:{type:'object',additionalProperties:true}},'application/octet-stream':{schema:{type:'string',contentEncoding:'binary'}}}} : operation.binaryResponse ? { description: 'Processed work cover.', content: { 'image/webp': { schema: { type: 'string', contentEncoding: 'binary' } } } } : operation.zipResponse ? { description: 'Quarantined rule source archive.',content: { 'application/zip': { schema: { type: 'string',contentEncoding: 'binary' } } } } : operation.ruleBundleResponse ? { description: 'Controlled rule bundle for offline signing.',content: { 'application/javascript': { schema: { type: 'string',contentEncoding: 'binary' } } } } : response(operation.responseArray
          ? object({ data: { type: 'array', items: { $ref: `#/components/schemas/${operation.response}` } } })
          : object({ data: { $ref: `#/components/schemas/${operation.response}` } })),
        ...errorResponses,
        ...(operation.saveScope || operation.saveLibrary ? Object.fromEntries([404,410,412,413,422,428,429,503].map(status=>[status,response({$ref:'#/components/schemas/ErrorResponse'})])) : {}),
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: { title: 'GameHub Platform API', version: '0.1.0', description: 'M1 contract baseline; implementation status is tracked separately.' },
    servers: [{ url: 'https://app.gamehub.example' }],
    paths,
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'opaque' }, uploadGrant: { type: 'apiKey', in: 'header', name: 'Authorization', description: 'Single-use `Upload <token>` grant scoped to one upload job.' } }, schemas },
  };
}
