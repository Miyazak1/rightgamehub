const integer = (value, fallback, name, min, max) => {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return parsed;
};

export function loadRealtimeConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) throw new Error('NODE_ENV must be development, test or production');
  const redisUrl = env.REDIS_URL?.trim();
  if (!redisUrl) throw new Error('REDIS_URL is required');
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const allowedOrigins = (env.REALTIME_ALLOWED_ORIGINS ?? env.CORS_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean);
  for (const origin of allowedOrigins) {
    let parsed;
    try { parsed = new URL(origin); } catch { throw new Error('REALTIME_ALLOWED_ORIGINS must contain valid origins'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) throw new Error('REALTIME_ALLOWED_ORIGINS must contain HTTP origins without paths');
  }
  return Object.freeze({
    nodeEnv,
    host: env.REALTIME_HOST ?? '127.0.0.1',
    port: integer(env.REALTIME_PORT, 3093, 'REALTIME_PORT', 1, 65535),
    redisUrl,
    databaseUrl,
    databaseSsl: env.DATABASE_SSL === 'true',
    allowedOrigins: Object.freeze(allowedOrigins),
    trustEditorWebviews: env.TRUST_EDITOR_WEBVIEWS === 'true',
    heartbeatIntervalMs: integer(env.REALTIME_HEARTBEAT_INTERVAL_MS, 20_000, 'REALTIME_HEARTBEAT_INTERVAL_MS', 5_000, 60_000),
    reconnectGraceMs: integer(env.REALTIME_RECONNECT_GRACE_MS, 120_000, 'REALTIME_RECONNECT_GRACE_MS', 15_000, 600_000),
    matchTimeoutSweepMs: integer(env.REALTIME_MATCH_TIMEOUT_SWEEP_MS, 1_000, 'REALTIME_MATCH_TIMEOUT_SWEEP_MS', 250, 10_000),
    matchTimeoutBatchSize: integer(env.REALTIME_MATCH_TIMEOUT_BATCH_SIZE, 50, 'REALTIME_MATCH_TIMEOUT_BATCH_SIZE', 1, 500),
  });
}
