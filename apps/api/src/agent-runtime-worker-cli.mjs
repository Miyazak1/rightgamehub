import pg from 'pg';
import { PostgresAgentRuntimeRepository } from './agent-runtime-repository.mjs';
import { createAgentRuntimeWorker, loadAgentRuntimeWorkerConfig } from './agent-runtime-worker.mjs';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const config = loadAgentRuntimeWorkerConfig();
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  application_name: 'gamehub-agent-runtime-worker',
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
});

try {
  if (process.argv.includes('--health')) {
    const row = (await pool.query(`SELECT status,last_seen_at>now()-($2*interval '1 second') AS fresh
      FROM agent_runtime_workers WHERE worker_id=$1`, [config.workerId, Math.max(config.heartbeatSeconds * 3, 30)])).rows[0];
    if (!row || !row.fresh || row.status === 'offline') process.exitCode = 1;
    else process.stdout.write(`${JSON.stringify({ status: 'ok', service: 'agent-runtime-worker', workerId: config.workerId, state: row.status })}\n`);
  } else {
    if (!config.enabled) throw new Error('AGENT_RUNTIME_WORKER_ENABLED must be true');
    // F1-2 intentionally starts without business handlers. F1-4 registers blog
    // adapters; future paper and tool workflows use the same route registry.
    const worker = createAgentRuntimeWorker({ repository: new PostgresAgentRuntimeRepository(pool), handlers: {}, ...config, logger: console });
    const stop = () => { void worker.stop(); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    await worker.start();
  }
} finally {
  await pool.end();
}
