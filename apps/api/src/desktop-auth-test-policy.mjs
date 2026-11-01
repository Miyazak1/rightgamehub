const fail = () => { throw new Error('DESKTOP_AUTH_TEST_CONFIGURATION_REJECTED'); };

export function desktopAuthTestConfig(env) {
  if (env.DESKTOP_AUTH_TEST_INSTANCE !== 'isolated-auth-only') fail();
  let database, redis, origin;
  try {
    database = new URL(env.DATABASE_URL);
    redis = new URL(env.REDIS_URL);
    origin = new URL(env.DESKTOP_AUTH_TEST_PUBLIC_ORIGIN);
  } catch { fail(); }
  if (database.protocol !== 'postgresql:' || database.hostname !== 'auth-postgres' ||
      database.port !== '5432' || database.username !== 'desktop_auth_test' ||
      database.pathname !== '/desktop_auth_test' || !database.password || database.search || database.hash) fail();
  if (redis.href !== 'redis://auth-redis:6379') fail();
  const local = origin.protocol === 'http:' && origin.hostname === '127.0.0.1';
  if ((!local && origin.protocol !== 'https:') || origin.username || origin.password ||
      origin.pathname !== '/' || origin.search || origin.hash ||
      ['mooyu.fun', 'www.mooyu.fun'].includes(origin.hostname.replace(/\.$/, ''))) fail();
  const values = [env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET, env.GITHUB_CALLBACK_URL].map(v => v?.trim() || '');
  if (values.some(Boolean) && (!values.every(Boolean) ||
      values[2] !== `${origin.origin}/v1/auth/github/web/callback`)) fail();
  if (!/^[a-f0-9]{64}$/.test(env.OTP_HMAC_KEY || '')) fail();
  // Construct a fresh environment, never inherit cloud/provider/storage credentials.
  return {
    env: {
      NODE_ENV: 'production', API_HOST: '0.0.0.0', API_PORT: '3090',
      DATABASE_URL: database.href, REDIS_URL: redis.href, OTP_HMAC_KEY: env.OTP_HMAC_KEY,
      GITHUB_CLIENT_ID: values[0], GITHUB_CLIENT_SECRET: values[1], GITHUB_CALLBACK_URL: values[2],
      MAIL_PROVIDER: 'disabled', GUESS_BAIKE_AUTOMATION_ENABLED: 'false',
      CLOUD_SAVE_ENABLED: 'false', AVATAR_ROOT: '/data/avatars',
      REALTIME_PUBLIC_URL: 'wss://unused.invalid/v1/realtime', GAME_SHARE_SITE_ORIGIN: origin.origin,
    },
    publicOrigin: origin.origin, githubConfigured: values.every(Boolean),
  };
}

export function desktopAuthTestRequestAllowed(method, url) {
  const pathname = url.split('?')[0];
  if (method === 'GET' && ['/health', '/ready-desktop-auth', '/v1/me', '/v1/me/devices', '/v1/auth/github/web/callback'].includes(pathname)) return true;
  if (method === 'PATCH' && ['/v1/me', '/v1/me/avatar'].includes(pathname)) return true;
  if (method === 'DELETE' && /^\/v1\/me\/devices\/[a-f0-9-]{36}$/.test(pathname)) return true;
  if (method === 'GET' && /^\/v1\/avatars\/[a-f0-9-]{36}$/.test(pathname)) return true;
  if (method !== 'POST') return false;
  return ['/v1/auth/email/challenges', '/v1/auth/email/verify', '/v1/auth/github/web',
    '/v1/auth/refresh', '/v1/auth/session', '/v1/auth/device/logout',
    '/v1/auth/devices/logout-others', '/v1/auth/devices/logout-all'].includes(pathname) ||
    /^\/v1\/auth\/github\/web\/[a-f0-9-]{36}\/poll$/.test(pathname);
}

export async function desktopAuthTestGuard(request, reply) {
  reply.header('Cache-Control', 'no-store');
  if (!desktopAuthTestRequestAllowed(request.method, request.url)) {
    return reply.code(404).send({ error: { code: 'DESKTOP_AUTH_TEST_ROUTE_DISABLED', message: 'This instance only serves account testing.' } });
  }
}
