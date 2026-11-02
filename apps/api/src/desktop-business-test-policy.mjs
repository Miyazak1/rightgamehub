const reject = () => { throw Error('DESKTOP_BUSINESS_TEST_CONFIGURATION_REJECTED'); };
export function desktopBusinessTestConfig(env) {
  if (env.DESKTOP_BUSINESS_TEST_INSTANCE !== 'isolated-business') reject();
  let database, redis, origin;
  try { database = new URL(env.DATABASE_URL); redis = new URL(env.REDIS_URL); origin = new URL(env.DESKTOP_BUSINESS_TEST_PUBLIC_ORIGIN); } catch { reject(); }
  if (database.protocol !== 'postgresql:' || database.hostname !== 'business-postgres' || database.port !== '5432' ||
    database.username !== 'desktop_business_test' || database.pathname !== '/desktop_business_test' ||
    !/^[a-f0-9]{64}$/.test(database.password) || database.search || database.hash ||
    redis.href !== 'redis://business-redis:6379' || origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' ||
    !origin.port || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash ||
    !/^[a-f0-9]{64}$/.test(env.OTP_HMAC_KEY ?? '')) reject();
  const runtimePort = Number(env.DESKTOP_BUSINESS_TEST_RUNTIME_PORT);
  if (!Number.isInteger(runtimePort) || runtimePort < 1024 || runtimePort > 65535 || runtimePort === Number(origin.port)) reject();
  // Fresh allowlisted configuration: no SMTP, OAuth secrets, provider keys,
  // object storage, production connection strings or worker configuration.
  return { publicOrigin: origin.origin, runtimePort, env: {
    NODE_ENV: 'production', API_HOST: '0.0.0.0', API_PORT: '3090',
    DATABASE_URL: database.href, REDIS_URL: redis.href, OTP_HMAC_KEY: env.OTP_HMAC_KEY,
    MAIL_PROVIDER: 'disabled', LOGIN_EMAIL_ALLOWLIST: 'desktop-reader@example.test',
    RUNTIME_DOMAIN: 'localhost', RUNTIME_SCHEME: 'http', RUNTIME_PUBLIC_PORT: String(runtimePort),
    REALTIME_PUBLIC_URL: 'wss://unused.invalid/v1/realtime',
    RUNTIME_ROOT: '/data/desktop-business/runtime', COVER_ROOT: '/data/desktop-business/covers',
    AVATAR_ROOT: '/data/desktop-business/avatars', GAME_SHARE_SITE_ORIGIN: origin.origin,
    GUESS_BAIKE_AUTOMATION_ENABLED: 'false', CLOUD_SAVE_ENABLED: 'false',
  } };
}
const uuid = '[a-f0-9-]{36}';
export function desktopBusinessTestRequestAllowed(method, rawUrl) {
  const pathname = rawUrl.split('?')[0];
  if (method === 'GET' || method === 'HEAD') return [
    /^\/(?:health|ready|ready-desktop-business|ready-desktop-auth)$/,
    /^\/v1\/works$/,
    new RegExp(`^/v1/works/${uuid}(?:/(?:cover|launch|remixes|timeline|claim|leaderboards))?$`),
    /^\/v1\/blog\/articles(?:\/[a-z0-9-]+)?$/,
    /^\/v1\/discovery\/campaigns(?:\/[a-z0-9-]+)?$/,
    /^\/v1\/profiles\/[a-z][a-z0-9-]{2,31}$/,
    new RegExp(`^/v1/users/${uuid}$`),
    /^\/v1\/me(?:\/devices|\/library(?:\/[a-f0-9-]{36})?)?$/,
    new RegExp(`^/v1/avatars/${uuid}$`),
  ].some(pattern => pattern.test(pathname));
  if (['PUT', 'DELETE'].includes(method)) return new RegExp(`^/v1/me/library/${uuid}$`).test(pathname);
  if (method === 'POST') return ['/v1/auth/email/challenges', '/v1/auth/email/verify', '/v1/auth/refresh',
    '/v1/auth/session', '/v1/auth/device/logout', '/v1/auth/devices/logout-others', '/v1/auth/devices/logout-all'].includes(pathname)
    || new RegExp(`^/v1/me/recent/${uuid}$`).test(pathname);
  return false;
}
export async function desktopBusinessTestGuard(request, reply) {
  reply.header('Cache-Control', 'no-store');
  if (!desktopBusinessTestRequestAllowed(request.method, request.url))
    return reply.code(404).send({ error: { code: 'DESKTOP_BUSINESS_TEST_ROUTE_DISABLED', message: 'This isolated instance does not enable this operation.' } });
}
