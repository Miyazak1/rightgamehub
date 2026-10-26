import pg from 'pg';
import { loadAgentBlogPublicRuntimeConfig, PostgresAgentBlogPublicRuntimePreflightRepository,
  runAgentBlogPublicRuntimePreflight } from './agent-blog-public-runtime-preflight.mjs';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const config = loadAgentBlogPublicRuntimeConfig();
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000, application_name: 'gamehub-agent-blog-public-runtime-preflight',
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
});

try {
  const result = await runAgentBlogPublicRuntimePreflight({
    repository: new PostgresAgentBlogPublicRuntimePreflightRepository(pool), config,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ready) process.exitCode = 1;
} finally {
  await pool.end();
}
