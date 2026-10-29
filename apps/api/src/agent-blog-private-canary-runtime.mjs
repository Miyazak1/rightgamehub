import crypto from 'node:crypto';
import pg from 'pg';
import { loadAgentBlogPrivateCanaryConfig,
  PostgresAgentBlogPrivateCanaryPreflightRepository } from './agent-blog-private-canary-preflight.mjs';
import { PostgresAgentBlogPrivateCanaryInputRepository,
  createAgentBlogPrivateCanaryManualRunner } from './agent-blog-private-canary-manual-run.mjs';
import { PostgresAgentRuntimeRepository } from './agent-runtime-repository.mjs';
import { createAgentRuntimeWorker } from './agent-runtime-worker.mjs';
import { createAgentRuntimePolicyService } from './agent-runtime-policy-service.mjs';
import { PostgresAgentToolGatewayRepository } from './agent-tool-gateway-repository.mjs';
import { createAgentToolGateway } from './agent-tool-gateway.mjs';
import { GITHUB_REPOSITORY_SEARCH_TOOL, createGitHubRepositorySearchAdapter,
  validateGitHubRepositorySearchInput,
  validateGitHubRepositorySearchOutput } from './agent-github-repository-search-tool.mjs';
import { GITHUB_REPOSITORY_READ_TOOL, createGitHubRepositoryReadAdapter,
  validateGitHubRepositoryReadInput,
  validateGitHubRepositoryReadOutput } from './agent-github-repository-tool.mjs';
import { GITHUB_REPOSITORY_MATERIALS_TOOL, createGitHubRepositoryMaterialsAdapter,
  validateGitHubRepositoryMaterialsInput,
  validateGitHubRepositoryMaterialsOutput } from './agent-github-repository-materials-tool.mjs';
import { ARXIV_PAPER_READ_TOOL, createArxivPaperReadAdapter, validateArxivPaperReadInput,
  validateArxivPaperReadOutput } from './agent-arxiv-paper-tool.mjs';
import { PostgresAgentProviderGatewayRepository } from './agent-provider-gateway-repository.mjs';
import { createAgentProviderGateway } from './agent-provider-gateway.mjs';
import { createAgentDeepSeekProviderAdapter } from './agent-deepseek-provider-adapter.mjs';
import { createAgentSecretVault } from './agent-secret-vault.mjs';
import { BLOG_DISCOVERY_RESPONSE_SCHEMAS, createAgentBlogAutonomousCandidateDiscoveryHandlers,
  createAgentBlogAutonomousDiscoveryCanary } from './agent-blog-candidate-discovery.mjs';
import { BLOG_FOUNDATION_RESPONSE_SCHEMAS } from './agent-blog-foundation-generation.mjs';
import { PostgresAgentRuntimeStageArtifactRepository } from './agent-runtime-stage-artifact-repository.mjs';
import { PostgresAgentBlogFoundationDraftRepository } from './agent-blog-foundation-draft-repository.mjs';
import { createAgentBlogFoundationDraftGateway } from './agent-blog-foundation-draft.mjs';
import { createAgentBlogFoundationShadowHandlers } from './agent-blog-foundation-shadow.mjs';
import { createAgentBlogCandidateDraftHandoffCanary } from './agent-blog-candidate-handoff.mjs';
import { PostgresAgentBlogCanaryAcceptanceRepository,
  createAgentBlogCanaryAcceptanceService } from './agent-blog-canary-acceptance.mjs';
import { createAgentBlogPrivateCanarySupervisor } from './agent-blog-private-canary-supervisor.mjs';
import { PostgresAgentResearchEvidenceRepository } from './agent-research-evidence-repository.mjs';
import { normalizeGitHubResearchToken } from './agent-github-research-runtime.mjs';
import { PAPER_SEMANTIC_RESPONSE_SCHEMAS } from './agent-paper-semantic-contracts.mjs';
import { createPaperSemanticCanary } from './agent-paper-semantic-workflow.mjs';
import { PostgresAgentPaperSemanticRepository,
  createAgentPaperSemanticGateway } from './agent-paper-semantic-repository.mjs';
import { createAgentPaperSemanticHandlers } from './agent-paper-semantic-runtime.mjs';
import { createAgentPaperResearchExecutionHandlers,
  createPaperResearchExecutionCanary } from './agent-paper-research-execution.mjs';
import { createAgentPaperResearchOperationsService } from './agent-paper-research-operations.mjs';
import { createConfiguredMailer } from './mailer.mjs';

export function createAgentBlogPrivateCanaryRuntime({ env = process.env, applicationName,
  pool: suppliedPool } = {}) {
  if (!env.DATABASE_URL && !suppliedPool) throw new Error('DATABASE_URL is required');
  if (!env.AGENT_SECRET_ENCRYPTION_KEY) throw new Error('AGENT_SECRET_ENCRYPTION_KEY is required');
  const config = loadAgentBlogPrivateCanaryConfig(env);
  if (!config.enabled) throw new Error('AGENT_BLOG_PRIVATE_CANARY_DISABLED');
  const githubResearchToken = normalizeGitHubResearchToken(env.AGENT_GITHUB_RESEARCH_TOKEN);
  const ownsPool = !suppliedPool;
  const pool = suppliedPool ?? new pg.Pool({
    connectionString: env.DATABASE_URL, max: 3, connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000, application_name: applicationName ?? 'gamehub-agent-blog-private-canary',
    ssl: env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
  });
  const runtimeRepository = new PostgresAgentRuntimeRepository(pool);
  const policyService = createAgentRuntimePolicyService({ pool });
  const arxivEnabled = typeof env.AGENT_ARXIV_CONTACT_EMAIL === 'string'
    && env.AGENT_ARXIV_CONTACT_EMAIL.trim().length > 0;
  const toolGateway = createAgentToolGateway({
    runtimeRepository, toolRepository: new PostgresAgentToolGatewayRepository(pool), policyService,
    adapters: {
      [`${GITHUB_REPOSITORY_SEARCH_TOOL.toolKey}@${GITHUB_REPOSITORY_SEARCH_TOOL.contractVersion}`]:
        createGitHubRepositorySearchAdapter({ token: githubResearchToken }),
      [`${GITHUB_REPOSITORY_READ_TOOL.toolKey}@${GITHUB_REPOSITORY_READ_TOOL.contractVersion}`]:
        createGitHubRepositoryReadAdapter({ token: githubResearchToken }),
      [`${GITHUB_REPOSITORY_MATERIALS_TOOL.toolKey}@${GITHUB_REPOSITORY_MATERIALS_TOOL.contractVersion}`]:
        createGitHubRepositoryMaterialsAdapter({ token: githubResearchToken }),
      ...(arxivEnabled ? {
        [`${ARXIV_PAPER_READ_TOOL.toolKey}@${ARXIV_PAPER_READ_TOOL.contractVersion}`]:
          createArxivPaperReadAdapter({ contactEmail: env.AGENT_ARXIV_CONTACT_EMAIL }),
      } : {}),
    },
    inputSchemas: {
      'github.repository.search.input@1': validateGitHubRepositorySearchInput,
      'github.repository.read.input@1': validateGitHubRepositoryReadInput,
      'github.repository.materials.read.input@1': validateGitHubRepositoryMaterialsInput,
      ...(arxivEnabled ? { 'paper.arxiv.read.input@1': validateArxivPaperReadInput } : {}),
    },
    outputSchemas: {
      'github.repository.search.output@1': validateGitHubRepositorySearchOutput,
      'github.repository.read.output@1': validateGitHubRepositoryReadOutput,
      'github.repository.materials.read.output@1': validateGitHubRepositoryMaterialsOutput,
      ...(arxivEnabled ? { 'paper.arxiv.read.output@2': validateArxivPaperReadOutput } : {}),
    },
  });
  const providerGateway = createAgentProviderGateway({
    runtimeRepository, governanceRepository: new PostgresAgentProviderGatewayRepository(pool), policyService,
    secretVault: createAgentSecretVault({ masterKey: env.AGENT_SECRET_ENCRYPTION_KEY }),
    adapters: { deepseek: createAgentDeepSeekProviderAdapter() },
    responseSchemas: { ...BLOG_DISCOVERY_RESPONSE_SCHEMAS, ...BLOG_FOUNDATION_RESPONSE_SCHEMAS,
      ...PAPER_SEMANTIC_RESPONSE_SCHEMAS },
  });
  const artifactRepository = new PostgresAgentRuntimeStageArtifactRepository(pool);
  const paperSemanticRepository = new PostgresAgentPaperSemanticRepository(pool);
  const paperSemanticGateway = createAgentPaperSemanticGateway({ runtimeRepository, policyService,
    repository: paperSemanticRepository });
  const paperSemanticHandlers = createAgentPaperSemanticHandlers({ repository: paperSemanticRepository,
    providerGateway, artifactRepository, semanticGateway: paperSemanticGateway });
  const discoveryHandlers = createAgentBlogAutonomousCandidateDiscoveryHandlers({
    providerGateway, toolGateway, artifactRepository,
  });
  const draftGateway = createAgentBlogFoundationDraftGateway({ runtimeRepository,
    draftRepository: new PostgresAgentBlogFoundationDraftRepository(pool,
      { requireResearchEvidence: true }), policyService });
  const researchEvidenceRepository = new PostgresAgentResearchEvidenceRepository(pool);
  const draftHandlers = createAgentBlogFoundationShadowHandlers({
    toolGateway, providerGateway, artifactRepository, draftGateway,
    researchEvidenceRepository,
  });
  const paperResearchHandlers = createAgentPaperResearchExecutionHandlers({
    pool, toolGateway, evidenceRepository: researchEvidenceRepository, semanticHandlers: paperSemanticHandlers,
  });
  const worker = (requestId, runId, handlers, kind) => createAgentRuntimeWorker({
    repository: runtimeRepository, handlers, targetRunId: runId,
    workerId: `agent-blog-private-canary-${kind}-${requestId}`.slice(0, 120),
    instanceId: crypto.randomUUID(), leaseSeconds: 180, heartbeatSeconds: 30,
    pollMilliseconds: 1000, recoveryBatch: 1, outboxBatch: 25,
    metadata: { role: kind, agentUserId: config.agentUserId },
  });
  const runner = createAgentBlogPrivateCanaryManualRunner({
    config,
    preflightRepository: new PostgresAgentBlogPrivateCanaryPreflightRepository(pool),
    inputRepository: new PostgresAgentBlogPrivateCanaryInputRepository(pool),
    discoveryCanary: createAgentBlogAutonomousDiscoveryCanary({ runtimeRepository, enabled: true }),
    handoffCanary: createAgentBlogCandidateDraftHandoffCanary({
      runtimeRepository, artifactRepository, enabled: true,
    }),
    createDiscoveryWorker: (runId, requestId) => worker(requestId, runId, discoveryHandlers, 'discovery'),
    createDraftWorker: (runId, requestId) => worker(requestId, runId, draftHandlers, 'draft'),
  });
  const acceptanceService = createAgentBlogCanaryAcceptanceService({
    repository: new PostgresAgentBlogCanaryAcceptanceRepository(pool),
  });
  const supervisor = createAgentBlogPrivateCanarySupervisor({ runner, acceptanceService });
  const paperSemantic = Object.freeze({
    canary: createPaperSemanticCanary({ runtimeRepository, enabled: true }),
    createWorker: (runId, requestId) => worker(requestId, runId, paperSemanticHandlers, 'paper-semantic'),
  });
  const paperResearch = Object.freeze({
    canary: createPaperResearchExecutionCanary({ runtimeRepository, enabled: true }),
    createWorker: (runId = null, requestId = crypto.randomUUID()) =>
      worker(requestId, runId, paperResearchHandlers, 'paper-research'),
  });
  const paperResearchOperations=createAgentPaperResearchOperationsService({pool,runtimeRepository,
    authorizeOperator:async()=>false,notificationSender:createConfiguredMailer({
      mailProvider:env.MAIL_PROVIDER?.trim().toLowerCase()||'disabled',
      resendApiKey:env.RESEND_API_KEY?.trim()||null,mailFrom:env.MAIL_FROM?.trim()||null,
    })});
  return Object.freeze({ config, pool, acceptanceService, supervisor, paperSemantic, paperResearch,paperResearchOperations,
    close: async () => { if (ownsPool) await pool.end(); } });
}
