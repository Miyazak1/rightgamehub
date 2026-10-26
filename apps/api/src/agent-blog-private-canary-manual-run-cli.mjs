import crypto from 'node:crypto';
import pg from 'pg';
import { loadAgentBlogPrivateCanaryConfig, PostgresAgentBlogPrivateCanaryPreflightRepository } from './agent-blog-private-canary-preflight.mjs';
import { PostgresAgentBlogPrivateCanaryInputRepository,
  createAgentBlogPrivateCanaryManualRunner } from './agent-blog-private-canary-manual-run.mjs';
import { PostgresAgentRuntimeRepository } from './agent-runtime-repository.mjs';
import { createAgentRuntimeWorker } from './agent-runtime-worker.mjs';
import { createAgentRuntimePolicyService } from './agent-runtime-policy-service.mjs';
import { PostgresAgentToolGatewayRepository } from './agent-tool-gateway-repository.mjs';
import { createAgentToolGateway } from './agent-tool-gateway.mjs';
import { GITHUB_REPOSITORY_SEARCH_TOOL, createGitHubRepositorySearchAdapter,
  validateGitHubRepositorySearchInput, validateGitHubRepositorySearchOutput } from './agent-github-repository-search-tool.mjs';
import { GITHUB_REPOSITORY_READ_TOOL, createGitHubRepositoryReadAdapter,
  validateGitHubRepositoryReadInput, validateGitHubRepositoryReadOutput } from './agent-github-repository-tool.mjs';
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

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
if (!process.env.AGENT_SECRET_ENCRYPTION_KEY) throw new Error('AGENT_SECRET_ENCRYPTION_KEY is required');
const config = loadAgentBlogPrivateCanaryConfig();
if (!config.enabled) throw new Error('AGENT_BLOG_PRIVATE_CANARY_DISABLED');
const requestId = process.env.AGENT_BLOG_PRIVATE_CANARY_REQUEST_ID?.trim() || crypto.randomUUID();
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000, application_name: 'gamehub-agent-blog-private-canary-manual',
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
});

try {
  const runtimeRepository = new PostgresAgentRuntimeRepository(pool);
  const policyService = createAgentRuntimePolicyService({ pool });
  const toolGateway = createAgentToolGateway({
    runtimeRepository, toolRepository: new PostgresAgentToolGatewayRepository(pool), policyService,
    adapters: {
      'research.github.repository.search@1': createGitHubRepositorySearchAdapter(),
      'research.github.repository.read@1': createGitHubRepositoryReadAdapter(),
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
    secretVault: createAgentSecretVault({ masterKey: process.env.AGENT_SECRET_ENCRYPTION_KEY }),
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
  const worker = (runId, handlers, kind) => createAgentRuntimeWorker({
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
    createDiscoveryWorker: runId => worker(runId, discoveryHandlers, 'discovery'),
    createDraftWorker: runId => worker(runId, draftHandlers, 'draft'),
  });
  const supervised = createAgentBlogPrivateCanarySupervisor({ runner,
    acceptanceService: createAgentBlogCanaryAcceptanceService({
      repository: new PostgresAgentBlogCanaryAcceptanceRepository(pool),
    }),
  });
  const result = await supervised.run({ requestId });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.acceptance.verdict !== 'passed') process.exitCode = 1;
} finally {
  await pool.end();
}
