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

export function createAgentBlogPrivateCanaryRuntime({ env = process.env, applicationName,
  pool: suppliedPool } = {}) {
  if (!env.DATABASE_URL && !suppliedPool) throw new Error('DATABASE_URL is required');
  if (!env.AGENT_SECRET_ENCRYPTION_KEY) throw new Error('AGENT_SECRET_ENCRYPTION_KEY is required');
  const config = loadAgentBlogPrivateCanaryConfig(env);
  if (!config.enabled) throw new Error('AGENT_BLOG_PRIVATE_CANARY_DISABLED');
  const ownsPool = !suppliedPool;
  const pool = suppliedPool ?? new pg.Pool({
    connectionString: env.DATABASE_URL, max: 3, connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000, application_name: applicationName ?? 'gamehub-agent-blog-private-canary',
    ssl: env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
  });
  const runtimeRepository = new PostgresAgentRuntimeRepository(pool);
  const policyService = createAgentRuntimePolicyService({ pool });
  const toolGateway = createAgentToolGateway({
    runtimeRepository, toolRepository: new PostgresAgentToolGatewayRepository(pool), policyService,
    adapters: {
      [`${GITHUB_REPOSITORY_SEARCH_TOOL.toolKey}@${GITHUB_REPOSITORY_SEARCH_TOOL.contractVersion}`]:
        createGitHubRepositorySearchAdapter(),
      [`${GITHUB_REPOSITORY_READ_TOOL.toolKey}@${GITHUB_REPOSITORY_READ_TOOL.contractVersion}`]:
        createGitHubRepositoryReadAdapter(),
    },
    inputSchemas: {
      'github.repository.search.input@1': validateGitHubRepositorySearchInput,
      'github.repository.read.input@1': validateGitHubRepositoryReadInput,
    },
    outputSchemas: {
      'github.repository.search.output@1': validateGitHubRepositorySearchOutput,
      'github.repository.read.output@1': validateGitHubRepositoryReadOutput,
    },
  });
  const providerGateway = createAgentProviderGateway({
    runtimeRepository, governanceRepository: new PostgresAgentProviderGatewayRepository(pool), policyService,
    secretVault: createAgentSecretVault({ masterKey: env.AGENT_SECRET_ENCRYPTION_KEY }),
    adapters: { deepseek: createAgentDeepSeekProviderAdapter() },
    responseSchemas: { ...BLOG_DISCOVERY_RESPONSE_SCHEMAS, ...BLOG_FOUNDATION_RESPONSE_SCHEMAS },
  });
  const artifactRepository = new PostgresAgentRuntimeStageArtifactRepository(pool);
  const discoveryHandlers = createAgentBlogAutonomousCandidateDiscoveryHandlers({
    providerGateway, toolGateway, artifactRepository,
  });
  const draftGateway = createAgentBlogFoundationDraftGateway({ runtimeRepository,
    draftRepository: new PostgresAgentBlogFoundationDraftRepository(pool), policyService });
  const draftHandlers = createAgentBlogFoundationShadowHandlers({
    toolGateway, providerGateway, artifactRepository, draftGateway,
  });
  const worker = (requestId, runId, handlers, kind) => createAgentRuntimeWorker({
    repository: runtimeRepository, handlers, targetRunId: runId,
    workerId: `agent-blog-private-canary-${kind}-${requestId}`.slice(0, 120),
    instanceId: crypto.randomUUID(), leaseSeconds: 180, heartbeatSeconds: 30,
    pollMilliseconds: 1000, recoveryBatch: 1, outboxBatch: 25,
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
  return Object.freeze({ config, pool, acceptanceService, supervisor,
    close: async () => { if (ownsPool) await pool.end(); } });
}
