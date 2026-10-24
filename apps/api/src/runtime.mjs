import {createCompetitionService} from './competition-service.mjs';
import {createSaveOperationsService} from './save-operations-service.mjs';
import {createSaveHealthMetrics} from './save-health-metrics.mjs';
import {createSaveLibraryService} from './save-library-service.mjs';
import path from 'node:path';
import { PostgresGameSaveRepository } from './game-save-repository.mjs';
import { createGameSaveService } from './game-save-service.mjs';
import { PostgresGameSessionRepository } from './game-session-repository.mjs';
import { createGameShareService } from './game-share-service.mjs';
import { createGameSessionService } from './game-session-service.mjs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';
import { createDatabase } from './database.mjs';
import { applyMigrations, migrationStatus } from './migrations.mjs';
import { PostgresAuthRepository } from './auth-repository.mjs';
import { createAuthService } from './auth-service.mjs';
import { createGitHubOAuthClient } from './github-oauth-client.mjs';
import { createApp } from './app.mjs';
import { CommunityService } from './community-service.mjs';
import { CommunityProjectService } from './community-project-service.mjs';
import { CommunityEventService, CommunityPartyService, CommunityExperienceService } from './community-activity-service.mjs';
import { CommunityMediaService } from './community-media-service.mjs';
import { CommunityMediaStore } from './community-media-store.mjs';
import { createCommunityImageRunner } from './community-image-runner.mjs';
import { PostgresWorkRepository } from './work-repository.mjs';
import { createWorkService } from './work-service.mjs';
import { PostgresUploadRepository } from './upload-repository.mjs';
import { createUploadService } from './upload-service.mjs';
import { LocalQuarantineStore } from './local-object-store.mjs';
import { LocalRuntimeStore } from './local-runtime-store.mjs';
import { LocalAvatarStore } from './local-avatar-store.mjs';
import { LocalCoverStore } from './local-cover-store.mjs';
import { createOssClientProvider } from './oss-client.mjs';
import { OssAvatarStore, OssCoverStore } from './oss-media-store.mjs';
import { OssRuntimeStore } from './oss-runtime-store.mjs';
import { PostgresValidationRepository } from './validation-repository.mjs';
import { createValidationWorker } from './validation-worker.mjs';
import { PostgresCatalogRepository } from './catalog-repository.mjs';
import { createCatalogService } from './catalog-service.mjs';
import { PostgresRuntimeEdgeRepository } from './runtime-edge-repository.mjs';
import { createRuntimeEdgeApp } from './runtime-edge-app.mjs';
import { PostgresEngagementRepository } from './engagement-repository.mjs';
import { createEngagementService } from './engagement-service.mjs';
import { createGuessBaikeService } from './guess-baike-service.mjs';
import { PostgresGuessBaikeRepository } from './guess-baike-repository.mjs';
import { createGuessBaikeAutomation } from './guess-baike-automation.mjs';
import { PostgresModerationRepository, createModerationService } from './moderation-service.mjs';
import { PostgresSocialRepository } from './social-repository.mjs';
import { createSocialService } from './social-service.mjs';
import { PostgresPublicProfileRepository } from './public-profile-repository.mjs';
import { createPublicProfileService } from './public-profile-service.mjs';
import { guessBaikeWork } from './built-in-works.mjs';
import { createConfiguredMailer } from './mailer.mjs';
import { PostgresAnalyticsRepository } from './analytics-repository.mjs';
import { createAnalyticsService } from './analytics-service.mjs';
import { PostgresCreatorFeedbackRepository, createCreatorFeedbackService } from './creator-feedback-service.mjs';
import { PostgresContributionTaskRepository, createContributionTaskService } from './contribution-task-service.mjs';
import { createRealtimeTicketService } from './realtime-ticket-service.mjs';
import { createRedisRealtimeTicketStore } from './redis-realtime-ticket-store.mjs';
import { PostgresMultiplayerRoomRepository } from './multiplayer-room-repository.mjs';
import { createMultiplayerRoomService } from './multiplayer-room-service.mjs';
import { PostgresMultiplayerMatchRepository } from './multiplayer-match-repository.mjs';
import { createMultiplayerMatchService } from './multiplayer-match-service.mjs';
import { createRulesRegistry, loadRulesRegistry } from '@gamehub/rules-sdk';
import { createRedisMatchPublisher } from './redis-match-publisher.mjs';
import { createWebValidationRunner } from './web-validation-runner.mjs';
import { createStorageCapacityService } from './storage-capacity-service.mjs';
import { createGitHubAppClient } from './github-app-client.mjs';
import { PostgresGitHubSourceRepository, createGitHubSourceService } from './github-source-service.mjs';
import { PostgresMultiplayerRuleSubmissionRepository } from './multiplayer-rule-submission-repository.mjs';
import { createMultiplayerRuleSubmissionService } from './multiplayer-rule-submission-service.mjs';
import { PostgresSourceBuildRepository } from './source-build-repository.mjs';
import { createSourceBuildService } from './source-build-service.mjs';
import { createSourceBuildRunner } from './source-build-runner.mjs';
import { createSourceBuildWorker } from './source-build-worker.mjs';
import { PostgresMultiplayerRuleBuildRepository } from './multiplayer-rule-build-repository.mjs';
import { createMultiplayerRuleBuildWorker } from './multiplayer-rule-build-worker.mjs';
import { createRuleBuildRunner } from './rule-build-runner.mjs';
import { PostgresCreatorDraftRepository } from './creator-draft-repository.mjs';
import { createCreatorDraftService } from './creator-draft-service.mjs';
import { PostgresProjectClaimRepository, createProjectClaimService } from './project-claim-service.mjs';
import { PostgresDevelopmentLogRepository, createDevelopmentLogService } from './development-log-service.mjs';
import { PostgresDiscoveryCampaignRepository, createDiscoveryCampaignService } from './discovery-campaign-service.mjs';
import { PostgresBlogRepository } from './blog-repository.mjs';
import { createBlogService } from './blog-service.mjs';
import {PostgresAgentAccountRepository} from './agent-account-repository.mjs';
import {createAgentAccountService} from './agent-account-service.mjs';
import {createAgentSecretVault} from './agent-secret-vault.mjs';
import {createDeepSeekAgentBlogWriter} from './agent-blog-writer.mjs';
import {PostgresAgentBlogAutomationRepository,createAgentBlogAutomation} from './agent-blog-automation.mjs';
import {PostgresAgentBlogFollowUpRepository,createAgentBlogFollowUpService} from './agent-blog-follow-up.mjs';
import {createAgentRuntimeReadService} from './agent-runtime-read-service.mjs';
import { PostgresAuthorOutreachRepository, createAuthorOutreachService } from './author-outreach-service.mjs';
import { createChangeRadarFetcher } from './change-radar-fetcher.mjs';
import { PostgresChangeRadarRepository, createChangeRadarService, createChangeRadarWorker } from './change-radar-service.mjs';
import { PostgresResearchTopicRepository, createResearchTopicService, createResearchTopicWorker } from './research-topic-service.mjs';
import { createResearchFeedAdapter } from './research-feed-adapter.mjs';
import { createGitHubReleaseAdapter } from './research-github-adapter.mjs';
import { createDeepSeekSearchAdapter } from './deepseek-search-adapter.mjs';
import { createDeepSeekFetchAdapter } from './deepseek-fetch-adapter.mjs';
import { createDeepSeekCandidateAssessmentAdapter } from './research-candidate-assessment-adapter.mjs';
import { PostgresResearcherCollaborationRepository, createResearcherCollaborationService } from './researcher-collaboration-service.mjs';

export const migrationDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

export function createRuntime({ env = process.env, mailer, loadTrustedRules = true } = {}) {
  const config = loadConfig(env);
  const database = createDatabase(config);
  const migrations = {
    apply: () => applyMigrations(database.pool, migrationDirectory),
    status: () => migrationStatus(database.pool, migrationDirectory),
  };
  const localAvatarStore = new LocalAvatarStore(config.avatarRoot);
  const localCoverStore = new LocalCoverStore(config.coverRoot);
  const localRuntimeStore = new LocalRuntimeStore(config.runtimeRoot);
  const getOssClient = config.objectStorageProvider === 'aliyun-oss'
    ? createOssClientProvider({
      region: config.ossRegion,
      endpoint: config.ossEndpoint,
      bucket: config.ossBucket,
      roleName: config.ossEcsRoleName,
    })
    : null;
  const avatarStore = getOssClient ? new OssAvatarStore({ getClient: getOssClient, fallback: localAvatarStore }) : localAvatarStore;
  const coverStore = getOssClient ? new OssCoverStore({ getClient: getOssClient, fallback: localCoverStore }) : localCoverStore;
  const runtimeStore = getOssClient ? new OssRuntimeStore({ getClient: getOssClient, fallback: localRuntimeStore }) : localRuntimeStore;
  const repository = new PostgresAuthRepository(database.pool, avatarStore);
  const safeMailer = mailer ?? createConfiguredMailer(config);
  const authService = createAuthService({
    repository,
    mailer: safeMailer,
    otpHmacKey: config.otpHmacKey,
    loginEmailAllowlist: config.loginEmailAllowlist,
    githubClient: createGitHubOAuthClient({ clientId: config.githubClientId, clientSecret: config.githubClientSecret, callbackUrl: config.githubCallbackUrl }),
  });
  const workService = createWorkService({ repository: new PostgresWorkRepository(database.pool, coverStore) });
  const githubClient = createGitHubAppClient({ appId: config.githubAppId, privateKey: config.githubAppPrivateKey, slug: config.githubAppSlug });
  const githubSourceService = createGitHubSourceService({
    repository: new PostgresGitHubSourceRepository(database.pool),
    githubClient,
    enabled: config.githubSourceImportEnabled,
    webhookSecret: config.githubAppWebhookSecret,
  });
  const projectClaimService = createProjectClaimService({ repository: new PostgresProjectClaimRepository(database.pool) });
  const authorOutreachService = createAuthorOutreachService({ repository: new PostgresAuthorOutreachRepository(database.pool),siteOrigin:config.gameShareSiteOrigin });
  const changeRadarService=createChangeRadarService({repository:new PostgresChangeRadarRepository(database.pool),fetchPage:createChangeRadarFetcher()});
  const changeRadarWorker=createChangeRadarWorker({service:changeRadarService});
  const researchHttpAdapter=createChangeRadarFetcher();
  const researchFeedAdapter=createResearchFeedAdapter({fetchText:researchHttpAdapter});
  const researchSearchAdapter=config.deepSeekSearchEnabled?createDeepSeekSearchAdapter({apiKey:config.deepSeekApiKey,timeoutMs:config.deepSeekSearchTimeoutMs,priceUsdMicrosPerRequest:config.deepSeekSearchPriceUsdMicrosPerRequest}):null;
  const researchPageAdapter=config.deepSeekFetchEnabled?createDeepSeekFetchAdapter({apiKey:config.deepSeekApiKey,timeoutMs:config.deepSeekFetchTimeoutMs,priceUsdMicrosPerRequest:config.deepSeekFetchPriceUsdMicrosPerRequest}):{provider:'direct-http',fetch:researchHttpAdapter};
  const researchCandidateAssessmentAdapter=config.researchCandidateAssessmentEnabled?createDeepSeekCandidateAssessmentAdapter({apiKey:config.deepSeekApiKey,model:config.researchCandidateAssessmentModel,timeoutMs:config.researchCandidateAssessmentTimeoutMs,priceUsdMicrosPerRequest:config.researchCandidateAssessmentPriceUsdMicrosPerRequest}):null;
  const researchBudgetLimits={accountBillableRequests:config.researchMaxBillableRequestsPerAccountMonth,accountCostUsdMicros:config.researchMaxProviderCostUsdMicrosPerAccountMonth,globalBillableRequests:config.researchMaxBillableRequestsGlobalMonth,globalCostUsdMicros:config.researchMaxProviderCostUsdMicrosGlobalMonth};
  const researchProviderPrices={'deepseek-search':config.deepSeekSearchPriceUsdMicrosPerRequest,'deepseek-fetch':config.deepSeekFetchPriceUsdMicrosPerRequest,'deepseek-candidate-assessor':config.researchCandidateAssessmentPriceUsdMicrosPerRequest};
  const researchProviderCircuit={failureThreshold:config.researchProviderCircuitFailureThreshold,windowSeconds:config.researchProviderCircuitWindowSeconds,cooldownSeconds:config.researchProviderCircuitCooldownSeconds,probeSeconds:config.researchProviderCircuitProbeSeconds};
  const researcherCollaborationService=createResearcherCollaborationService({repository:new PostgresResearcherCollaborationRepository(database.pool,{monthlyBudget:researchBudgetLimits,provider:config.researcherProvider,providerModel:config.researcherProviderModel,estimatedCostUsdMicrosPerJob:config.researcherEstimatedCostUsdMicrosPerJob,providerCircuit:researchProviderCircuit}),workerEnabled:config.researcherWorkerEnabled,defaultLeaseSeconds:config.researcherLeaseSeconds,maxActiveJobsPerAccount:config.researcherMaxActiveJobsPerAccount,maxActiveJobsGlobal:config.researcherMaxActiveJobsGlobal});
  const researchTopicService=createResearchTopicService({repository:new PostgresResearchTopicRepository(database.pool,{monthlyBudget:researchBudgetLimits,providerPrices:researchProviderPrices,providerCircuit:researchProviderCircuit,actionRecoveryGraceSeconds:config.researchActionRecoveryGraceSeconds}),feedAdapter:researchFeedAdapter,githubAdapter:createGitHubReleaseAdapter({feedAdapter:researchFeedAdapter}),searchAdapter:researchSearchAdapter,httpAdapter:researchPageAdapter,candidateAssessmentAdapter:researchCandidateAssessmentAdapter,candidateAssessmentMaxPerRun:config.researchCandidateAssessmentMaxPerRun,analysisDispatcher:runId=>researcherCollaborationService.queueAutomaticRunAnalysis(runId),maxActiveRunsPerAccount:config.researchTopicMaxActiveRunsPerAccount,maxActiveRunsGlobal:config.researchTopicMaxActiveRunsGlobal});
  const researchTopicWorker=createResearchTopicWorker({service:researchTopicService});
  const quarantineStore = new LocalQuarantineStore(config.quarantineRoot);
  const storageLogger = {
    info: event => process.stdout.write(`${JSON.stringify({ service: 'storage-capacity', ...event })}\n`),
    warn: event => process.stderr.write(`${JSON.stringify({ service: 'storage-capacity', ...event })}\n`),
  };
  const storageCapacityService = createStorageCapacityService({
    roots: {
      quarantine: config.quarantineRoot,
      validator: config.validatorRoot,
      runtime: config.runtimeRoot,
      avatars: config.avatarRoot,
      covers: config.coverRoot,
      ...(config.community.imagesEnabled ? {communityMedia:config.community.mediaRoot,communityProcessor:config.community.processorRoot} : {}),
    },
    warnPercent: config.storageWarnPercent,
    blockPercent: config.storageBlockPercent,
    monitorIntervalMs: config.storageMonitorIntervalSeconds * 1000,
    logger: storageLogger,
  });
  const uploadRepository = new PostgresUploadRepository(database.pool);
  const uploadService = createUploadService({
    repository: uploadRepository,
    objectStore: quarantineStore,
    storageCapacityService,
  });
  const creatorDraftService = createCreatorDraftService({
    repository: new PostgresCreatorDraftRepository(database.pool), workService, uploadService,
  });
  const validationWorker = createValidationWorker({
    repository: new PostgresValidationRepository(database.pool), quarantineStore,
    runtimeStore, validatorRoot: config.validatorRoot,
    validationRunner: createWebValidationRunner({
      mode: config.validatorExecutionMode,
      validatorRoot: config.validatorRoot,
      quarantineRoot: config.quarantineRoot,
    }),
  });
  const catalogService = createCatalogService({ repository: new PostgresCatalogRepository(database.pool), config, artifactStore: quarantineStore });
  const engagementService = createEngagementService({ repository: new PostgresEngagementRepository(database.pool), catalogService });
  const guessBaikeRepository = new PostgresGuessBaikeRepository(database.pool);
  const guessBaikeService = createGuessBaikeService({ repository: guessBaikeRepository });
  const guessBaikeAutomation = createGuessBaikeAutomation({
    repository: guessBaikeRepository, enabled: config.guessBaikeAutomationEnabled,
    intervalMinutes: config.guessBaikeAutomationIntervalMinutes, batchSize: config.guessBaikeAutomationBatchSize,
    scheduleDays: config.guessBaikeScheduleDays, userAgent: config.guessBaikeWikipediaUserAgent,
  });
  const moderationService = createModerationService({ repository: new PostgresModerationRepository(database.pool) });
  const socialService = createSocialService({ repository: new PostgresSocialRepository(database.pool) });
  const communityStore=new CommunityMediaStore(config.community.mediaRoot);
  const communityProjects=new CommunityProjectService({pool:database.pool});
  const communityEvents=new CommunityEventService({pool:database.pool});
  const publicProfileService = createPublicProfileService({ repository: new PostgresPublicProfileRepository(database.pool), builtInWorks: [guessBaikeWork] });
  const analyticsService = createAnalyticsService({ repository: new PostgresAnalyticsRepository(database.pool) });
  const creatorFeedbackService = createCreatorFeedbackService({ repository: new PostgresCreatorFeedbackRepository(database.pool) });
  const contributionTaskService = createContributionTaskService({ repository: new PostgresContributionTaskRepository(database.pool) });
  const developmentLogService = createDevelopmentLogService({ repository: new PostgresDevelopmentLogRepository(database.pool) });
  const discoveryCampaignService = createDiscoveryCampaignService({
    repository: new PostgresDiscoveryCampaignRepository(database.pool), catalogService, siteOrigin: config.gameShareSiteOrigin,
  });
  const blogService = createBlogService({ repository: new PostgresBlogRepository(database.pool) });
  const agentAccountService=createAgentAccountService({repository:new PostgresAgentAccountRepository(database.pool),authorizeOperator:async actor=>actor?.profile?.role==='admin'});
  const agentSecretVault=createAgentSecretVault({masterKey:config.agentSecretEncryptionKey});
  const agentBlogWriter=createDeepSeekAgentBlogWriter({timeoutMs:config.agentBlogProviderTimeoutMs});
  const agentBlogAutomation=createAgentBlogAutomation({repository:new PostgresAgentBlogAutomationRepository(database.pool),vault:agentSecretVault,writer:agentBlogWriter,pollMs:config.agentBlogPollSeconds*1000});
  const agentBlogFollowUpService=createAgentBlogFollowUpService({repository:new PostgresAgentBlogFollowUpRepository(database.pool),vault:agentSecretVault,writer:agentBlogWriter});
  const agentRuntimeReadService=createAgentRuntimeReadService({pool:database.pool,authorizeOperator:async actor=>actor?.profile?.role==='admin'});
  const realtimeTicketStore = createRedisRealtimeTicketStore({ url: config.redisUrl });
  const realtimeTicketService = createRealtimeTicketService({ store: realtimeTicketStore, websocketUrl: config.realtimePublicUrl, ttlSeconds: config.realtimeTicketTtlSeconds });
  const rulesRegistry = loadTrustedRules ? loadRulesRegistry({ manifestPath: config.rulesManifestPath,trustedKeys: config.rulesTrustedKeys,allowUnsigned: config.rulesAllowUnsigned }) : createRulesRegistry();
  const multiplayerRoomService = createMultiplayerRoomService({ repository: new PostgresMultiplayerRoomRepository(database.pool), roomCodeHmacKey: config.roomCodeHmacKey,rulesRegistry });
  const communityParties=new CommunityPartyService({pool:database.pool,multiplayerRoomService});
  const communityExperience=new CommunityExperienceService({pool:database.pool,events:communityEvents,parties:communityParties,projects:communityProjects});
  const communityService=new CommunityService({pool:database.pool,config:config.community,store:communityStore,projects:communityProjects,events:communityEvents,parties:communityParties,experience:communityExperience});
  const communityMediaService=new CommunityMediaService({
    service:communityService,store:communityStore,
    runner:createCommunityImageRunner({root:config.community.processorRoot,mediaRoot:config.community.mediaRoot,mode:config.community.executionMode}),
    capacity:bytes=>storageCapacityService.assertCanReserve({communityMedia:bytes,communityProcessor:2*bytes}),
  });
  const multiplayerMatchPublisher = createRedisMatchPublisher({ url: config.redisUrl });
  const multiplayerRoomPublisher = createRedisMatchPublisher({ url: config.redisUrl,channelKind: 'room' });
  const multiplayerMatchService = createMultiplayerMatchService({ repository: new PostgresMultiplayerMatchRepository(database.pool), rulesRegistry, publisher: multiplayerMatchPublisher,roomPublisher: multiplayerRoomPublisher });
  const multiplayerRuleSubmissionRepository = new PostgresMultiplayerRuleSubmissionRepository(database.pool);
  const multiplayerRuleSubmissionService = createMultiplayerRuleSubmissionService({ repository: multiplayerRuleSubmissionRepository,objectStore: quarantineStore,storageCapacityService,ruleBuildEnabled:config.ruleBuildEnabled,ruleBuilderImageDigest:config.ruleBuilderImageDigest });
  const multiplayerRuleBuildWorker = createMultiplayerRuleBuildWorker({ repository:new PostgresMultiplayerRuleBuildRepository(database.pool),buildRunner:createRuleBuildRunner({ mode:config.ruleBuilderExecutionMode,builderRoot:config.ruleBuilderRoot }),quarantineStore,workingRoot:config.ruleBuildWorkingRoot,enabled:config.ruleBuildEnabled,builderImageDigest:config.ruleBuilderImageDigest });
  const sourceBuildRepository = new PostgresSourceBuildRepository(database.pool);
  const sourceBuildService = createSourceBuildService({ repository:sourceBuildRepository,enabled:config.sourceBuildEnabled,builderImageDigest:config.sourceBuilderImageDigest });
  const sourceBuildWorker = createSourceBuildWorker({ repository:sourceBuildRepository,githubClient,buildRunner:createSourceBuildRunner({ mode:config.sourceBuilderExecutionMode,builderRoot:config.sourceBuilderRoot }),quarantineStore,storageCapacityService,uploadRepository,workingRoot:config.sourceBuildWorkingRoot,enabled:config.sourceBuildEnabled,builderImageDigest:config.sourceBuilderImageDigest });
  const gameSessionService = createGameSessionService({ cloudSaveEnabled: config.cloudSaveEnabled, repository: new PostgresGameSessionRepository(database.pool) });
  const gameShareService = createGameShareService({pool:database.pool,gameSessionService,siteOrigin:config.gameShareSiteOrigin});
  const competitionService = createCompetitionService({pool:database.pool,gameSessionService,socialService});
  const gameSaveRepository = config.cloudSaveEnabled ? new PostgresGameSaveRepository(database.pool,{storageProtection:config.saveStorageProtection}) : null;
  const saveMetrics=config.cloudSaveEnabled ? createSaveHealthMetrics({pool:database.pool}) : null;
  const saveOperationsService=config.cloudSaveEnabled ? createSaveOperationsService({repository:gameSaveRepository,metrics:saveMetrics}) : null;
  const gameSaveService = config.cloudSaveEnabled ? createGameSaveService({ repository: gameSaveRepository, gameSessionService, metrics:saveMetrics }) : null;
  const saveLibraryService = config.cloudSaveEnabled ? createSaveLibraryService({ repository: gameSaveRepository }) : null;
  const app = createApp({
    gameSaveService,
    saveLibraryService,
    saveOperationsService,
    gameSessionService,
    gameShareService,
    competitionService,
    config,
    database,
    migrations,
    authService,
    workService,
    creatorDraftService,
    githubSourceService,
    projectClaimService,
    authorOutreachService,
    changeRadarService,
    researchTopicService,
    researchTopicWorker,
    researcherCollaborationService,
    sourceBuildService,
    uploadService,
    catalogService,
    engagementService,
    guessBaikeService,
    guessBaikeAutomation,
    moderationService,
    socialService,
    communityService,
    communityMediaService,
    publicProfileService,
    analyticsService,
    creatorFeedbackService,
    contributionTaskService,
    developmentLogService,
    discoveryCampaignService,
    blogService,
    agentAccountService,
    agentBlogAutomation,
    agentBlogFollowUpService,
    agentRuntimeReadService,
    storageCapacityService,
    realtimeTicketService,
    rulesStatus: rulesRegistry.describe(),
    rulesRegistry,
    multiplayerRoomService,
    multiplayerMatchService,
    multiplayerRuleSubmissionService,
    logger: config.nodeEnv !== 'test',
  });
  const runtimeEdgeApp = createRuntimeEdgeApp({ repository: new PostgresRuntimeEdgeRepository(database.pool), objectStore: runtimeStore, runtimeDomain: config.runtimeDomain, logger: config.nodeEnv !== 'test' });
  app.addHook('onClose', async () => { agentBlogAutomation.stop(); changeRadarWorker.stop(); researchTopicWorker.stop(); await gameShareService.stop(); await saveMetrics?.close(); guessBaikeAutomation.stop(); storageCapacityService.stop(); await multiplayerMatchPublisher.close(); await multiplayerRoomPublisher.close(); await realtimeTicketStore.close(); await database.close(); });
  return {
    config,
    database,
    migrations,
    avatarStore,
    coverStore,
    authService,
    workService,
    creatorDraftService,
    githubSourceService,
    projectClaimService,
    authorOutreachService,
    changeRadarService,
    changeRadarWorker,
    researchTopicService,
    researchTopicWorker,
    researcherCollaborationService,
    sourceBuildService,
    sourceBuildWorker,
    multiplayerRuleBuildWorker,
    uploadService,
    validationWorker,
    catalogService,
    gameShareService,
    engagementService,
    guessBaikeService,
    guessBaikeAutomation,
    moderationService,
    socialService,
    communityService,
    communityMediaService,
    publicProfileService,
    analyticsService,
    creatorFeedbackService,
    contributionTaskService,
    developmentLogService,
    discoveryCampaignService,
    blogService,
    agentAccountService,
    agentBlogAutomation,
    agentRuntimeReadService,
    storageCapacityService,
    realtimeTicketService,
    rulesRegistry,
    multiplayerRoomService,
    multiplayerMatchService,
    multiplayerRuleSubmissionService,
    gameSessionService,
    competitionService,
    runtimeEdgeApp,
    gameSaveService,
    saveLibraryService,
    saveOperationsService,
    app,
  };
}
