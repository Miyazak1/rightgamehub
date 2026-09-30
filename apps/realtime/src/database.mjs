import pg from 'pg';

const { Pool } = pg;

export function createRealtimeDatabase({ databaseUrl, databaseSsl = false } = {}) {
  if (!databaseUrl) throw new TypeError('databaseUrl is required');
  const pool = new Pool({ connectionString: databaseUrl, ssl: databaseSsl ? { rejectUnauthorized: true } : false, max: 10 });
  return Object.freeze({
    pool,
    async ping() { const result = await pool.query('SELECT 1 AS ok'); return result.rows[0]?.ok === 1; },
    async close() { await pool.end(); },
  });
}
