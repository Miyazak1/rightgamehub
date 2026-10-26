import crypto from 'node:crypto';
import pg from 'pg';
import { loadAgentBlogPublicRuntimeConfig,
  PostgresAgentBlogPublicRuntimePreflightRepository } from './agent-blog-public-runtime-preflight.mjs';
import { createAgentBlogPublicRuntimeManualRunner } from './agent-blog-public-runtime-manual-run.mjs';
import { PostgresAgentBlogPrivateCanaryInputRepository } from './agent-blog-private-canary-manual-run.mjs';
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
import { PostgresAgentBlogFoundationPublicationRepository } from './agent-blog-foundation-publication-repository.mjs';
import { createAgentBlogFoundationPublicationGateway } from './agent-blog-foundation-publication.mjs';
import { createAgentBlogFoundationPublicHandlers } from './agent-blog-foundation-shadow.mjs';
import { createAgentBlogCandidatePublicHandoff } from './agent-blog-candidate-handoff.mjs';

export function createAgentBlogPublicRuntime({ env = process.env, applicationName,
  pool: suppliedPool } = {}) {
  if (!env.DATABASE_URL && !suppliedPool) throw new Error('DATABASE_URL is required');
  if (!env.AGENT_SECRET_ENCRYPTION_KEY) throw new Error('AGENT_SECRET_ENCRYPTION_KEY is required');
  const config = loadAgentBlogPublicRuntimeConfig(env);
  if (!config.enabled) throw new Error('AGENT_BLOG_PUBLIC_RUNTIME_DISABLED');
  const ownsPool = !suppliedPool;
  const pool = suppliedPool ?? new pg.Pool({
    connectionString: env.DATABASE_URL, max: 3, connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000, application_name: applicationName ?? 'gamehub-agent-blog-public-runtime',
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
  const publicationGateway = createAgentBlogFoundationPublicationGateway({ runtimeRepository,
    publicationRepository: new PostgresAgentBlogFoundationPublicationRepository(pool), policyService });
  const publicationHandlers = createAgentBlogFoundationPublicHandlers({
    toolGateway, providerGateway, artifactRepository, draftGateway, publicationGateway,
  });
  const worker = (requestId, runId, handlers, kind) => createAgentRuntimeWorker({
    repository: runtimeRepository, handlers, targetRunId: runId,
    workerId: `agent-blog-public-${kind}-${requestId}`.slice(0, 120),
    instanceId: crypto.randomUUID(), leaseSeconds: 180, heartbeatSeconds: 30,
    pollMilliseconds: 1000, recoveryBatch: 1, outboxBatch: 25,
  });
  const runner = createAgentBlogPublicRuntimeManualRunner({
    config,
    preflightRepository: new PostgresAgentBlogPublicRuntimePreflightRepository(pool),
    inputRepository: new PostgresAgentBlogPrivateCanaryInputRepository(pool),
    discoveryCanary: createAgentBlogAutonomousDiscoveryCanary({ runtimeRepository, enabled: true }),
    publicHandoff: createAgentBlogCandidatePublicHandoff({
      runtimeRepository, artifactRepository, enabled: true,
    }),
    createDiscoveryWorker: (runId, requestId) => worker(requestId, runId, discoveryHandlers, 'discovery'),
    createPublicationWorker: (runId, requestId) => worker(requestId, runId, publicationHandlers, 'publication'),
  });
  return Object.freeze({ config, pool, runner,
    close: async () => { if (ownsPool) await pool.end(); } });
}
