import pg from 'pg';
import { loadAgentBlogPrivateCanaryConfig, PostgresAgentBlogPrivateCanaryPreflightRepository,
  runAgentBlogPrivateCanaryPreflight } from './agent-blog-private-canary-preflight.mjs';
import { PostgresAgentRuntimeRepository } from './agent-runtime-repository.mjs';
import { PostgresAgentProviderGatewayRepository } from './agent-provider-gateway-repository.mjs';
import { PostgresAgentToolGatewayRepository } from './agent-tool-gateway-repository.mjs';
import { createAgentBlogPrivateCanaryBootstrap,
  PostgresAgentBlogPrivateCanaryBootstrapIdentityRepository } from './agent-blog-private-canary-bootstrap.mjs';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const config = loadAgentBlogPrivateCanaryConfig();
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  application_name: 'gamehub-agent-blog-private-canary-bootstrap',
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
});

try {
  const receipt = await createAgentBlogPrivateCanaryBootstrap({
    config,
    identityRepository: new PostgresAgentBlogPrivateCanaryBootstrapIdentityRepository(pool),
    runtimeRepository: new PostgresAgentRuntimeRepository(pool),
    toolRepository: new PostgresAgentToolGatewayRepository(pool),
    providerRepository: new PostgresAgentProviderGatewayRepository(pool),
  }).run();
  const preflight = await runAgentBlogPrivateCanaryPreflight({
    repository: new PostgresAgentBlogPrivateCanaryPreflightRepository(pool), config,
  });
  process.stdout.write(`${JSON.stringify({ ...receipt, preflight })}\n`);
  if (!preflight.ready) process.exitCode = 1;
} finally {
  await pool.end();
}
