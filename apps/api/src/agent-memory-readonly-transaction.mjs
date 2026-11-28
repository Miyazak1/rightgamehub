import { memoryFail } from './agent-memory-readonly-contracts.mjs';

// Only fixed repository SELECTs reach this facade; no arbitrary SQL API exists.
export function agentMemorySelectClient(client) {
  return Object.freeze({ async query(text, values = []) {
    if (typeof text !== 'string' || !/^\s*SELECT\b/i.test(text)
      || /;|--|\/\*|\b(?:INSERT|UPDATE|DELETE|MERGE|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE|COPY|CALL|INTO|nextval|setval|set_config|pg_notify|pg_advisory\w*|pg_sleep|lo_\w*)\b|\bFOR\s+(?:UPDATE|SHARE|KEY|NO)\b/i.test(text)) memoryFail('AGENT_MEMORY_SELECT_REQUIRED');
    return client.query(text, values);
  } });
}

export async function withAgentMemoryReadOnly(pool, action) {
  const client = await pool.connect(); let discard = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='8000ms'");
    await client.query("SET LOCAL lock_timeout='1000ms'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='15000ms'");
    const ro = agentMemorySelectClient(client);
    if ((await ro.query("SELECT current_setting('transaction_read_only') AS read_only")).rows[0]?.read_only !== 'on') memoryFail('AGENT_MEMORY_READ_ONLY_REQUIRED', 503);
    const result = await action(ro);
    await client.query('COMMIT'); return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { discard = true; }
    throw error;
  } finally { client.release(discard); }
}
