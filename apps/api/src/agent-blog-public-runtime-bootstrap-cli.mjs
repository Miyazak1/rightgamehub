import pg from 'pg';
import { loadAgentBlogPublicRuntimeConfig } from './agent-blog-public-runtime-preflight.mjs';
import { PostgresAgentRuntimeRepository } from './agent-runtime-repository.mjs';
import { PostgresAgentProviderGatewayRepository } from './agent-provider-gateway-repository.mjs';
import { PostgresAgentToolGatewayRepository } from './agent-tool-gateway-repository.mjs';
import { PostgresAgentBlogPrivateCanaryBootstrapIdentityRepository } from './agent-blog-private-canary-bootstrap.mjs';
import { createAgentBlogPublicRuntimeBootstrap } from './agent-blog-public-runtime-bootstrap.mjs';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const config = loadAgentBlogPublicRuntimeConfig();
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000, application_name: 'gamehub-agent-blog-public-runtime-bootstrap',
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
});

try {
  const receipt = await createAgentBlogPublicRuntimeBootstrap({
    config,
    identityRepository: new PostgresAgentBlogPrivateCanaryBootstrapIdentityRepository(pool),
    runtimeRepository: new PostgresAgentRuntimeRepository(pool),
    toolRepository: new PostgresAgentToolGatewayRepository(pool),
    providerRepository: new PostgresAgentProviderGatewayRepository(pool),
  }).run();
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
} finally {
  await pool.end();
}
