import crypto from 'node:crypto';
import { parseTrustedRulesKeys } from '@gamehub/rules-sdk';

const integer = (value, fallback, name, min, max) => {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return parsed;
};
const boolean = (value, fallback, name) => {
  if (value === undefined) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false`);
};

export function loadConfig(env = process.env, { allowMissingDatabase = false, allowWeakOtpKey = false } = {}) {
  const nodeEnv = env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) throw new Error('NODE_ENV must be development, test or production');
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!allowMissingDatabase && !databaseUrl) throw new Error('DATABASE_URL is required');
  const otpHmacKey = env.OTP_HMAC_KEY ?? '';
  if (!allowWeakOtpKey && Buffer.byteLength(otpHmacKey, 'utf8') < 32) throw new Error('OTP_HMAC_KEY must contain at least 32 UTF-8 bytes');
  const runtimeDomain = (env.RUNTIME_DOMAIN ?? 'gamehubusercontent.example').toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(runtimeDomain) && runtimeDomain !== 'localhost') throw new Error('RUNTIME_DOMAIN must be a DNS hostname');
  const runtimeScheme = env.RUNTIME_SCHEME ?? 'https';
  if (!['http', 'https'].includes(runtimeScheme)) throw new Error('RUNTIME_SCHEME must be http or https');
  const corsOrigins = (env.CORS_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean);
  const loginEmailAllowlist = (env.LOGIN_EMAIL_ALLOWLIST ?? '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  for (const origin of corsOrigins) {
    let parsed;
    try { parsed = new URL(origin); } catch { throw new Error('CORS_ORIGINS must contain valid origins'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) throw new Error('CORS_ORIGINS must contain HTTP origins without paths');
  }
  const githubClientId = env.GITHUB_CLIENT_ID?.trim() || null;
  const githubClientSecret = env.GITHUB_CLIENT_SECRET?.trim() || null;
  const githubCallbackUrl = env.GITHUB_CALLBACK_URL?.trim() || null;
  const mailProvider = env.MAIL_PROVIDER?.trim().toLowerCase() || 'disabled';
  if (!['disabled', 'resend'].includes(mailProvider)) throw new Error('MAIL_PROVIDER must be disabled or resend');
  if ((githubClientSecret || githubCallbackUrl) && !githubClientId) throw new Error('GITHUB_CLIENT_ID is required when GitHub web OAuth is configured');
  if (githubClientSecret && !githubCallbackUrl) throw new Error('GITHUB_CALLBACK_URL is required when GITHUB_CLIENT_SECRET is configured');
  if (githubCallbackUrl) {
    let parsed;
    try { parsed = new URL(githubCallbackUrl); } catch { throw new Error('GITHUB_CALLBACK_URL must be a valid HTTP URL'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('GITHUB_CALLBACK_URL must be a valid HTTP URL');
  }
  const githubSourceImportEnabled = boolean(env.GITHUB_SOURCE_IMPORT_ENABLED, false, 'GITHUB_SOURCE_IMPORT_ENABLED');
  const githubAppId = env.GITHUB_APP_ID?.trim() || null;
  const githubAppPrivateKey = env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, '\n').trim() || null;
  const githubAppWebhookSecret = env.GITHUB_APP_WEBHOOK_SECRET ?? '';
  const githubAppSlug = env.GITHUB_APP_SLUG?.trim() || null;
  const githubAppCallbackUrl = env.GITHUB_APP_CALLBACK_URL?.trim() || null;
  const githubAppClientId = env.GITHUB_APP_CLIENT_ID?.trim() || null;
  if (githubSourceImportEnabled) {
    if (!/^\d+$/.test(githubAppId ?? '')) throw new Error('GITHUB_APP_ID is required when GitHub source import is enabled');
    if (!githubAppPrivateKey) throw new Error('GITHUB_APP_PRIVATE_KEY is required when GitHub source import is enabled');
    try { crypto.createPrivateKey(githubAppPrivateKey); } catch { throw new Error('GITHUB_APP_PRIVATE_KEY must be a valid private key'); }
    if (Buffer.byteLength(githubAppWebhookSecret, 'utf8') < 32) throw new Error('GITHUB_APP_WEBHOOK_SECRET must contain at least 32 UTF-8 bytes');
    if (!/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/.test(githubAppSlug ?? '')) throw new Error('GITHUB_APP_SLUG is required and must be a valid GitHub App slug');
    let parsed;
    try { parsed = new URL(githubAppCallbackUrl); } catch { throw new Error('GITHUB_APP_CALLBACK_URL must be a valid HTTP URL'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('GITHUB_APP_CALLBACK_URL must be a valid HTTP URL');
    if (nodeEnv === 'production' && parsed.protocol !== 'https:') throw new Error('GITHUB_APP_CALLBACK_URL must use HTTPS in production');
  }
  const sourceBuildEnabled = boolean(env.SOURCE_BUILD_ENABLED, false, 'SOURCE_BUILD_ENABLED');
  if (sourceBuildEnabled && !githubSourceImportEnabled) throw new Error('GITHUB_SOURCE_IMPORT_ENABLED must be true when source builds are enabled');
  const sourceBuilderExecutionMode = env.SOURCE_BUILDER_EXECUTION_MODE?.trim() || (nodeEnv === 'production' ? 'isolated' : 'local');
  if (!['local', 'isolated'].includes(sourceBuilderExecutionMode)) throw new Error('SOURCE_BUILDER_EXECUTION_MODE must be local or isolated');
  if (nodeEnv === 'production' && sourceBuildEnabled && sourceBuilderExecutionMode !== 'isolated') throw new Error('SOURCE_BUILDER_EXECUTION_MODE must be isolated in production');
  const sourceBuilderImageDigest = env.SOURCE_BUILDER_IMAGE_DIGEST?.trim() || (nodeEnv === 'production' ? '' : 'development-unpinned');
  if (sourceBuildEnabled && nodeEnv === 'production' && !/^sha256:[a-f0-9]{64}$/.test(sourceBuilderImageDigest)) throw new Error('SOURCE_BUILDER_IMAGE_DIGEST must be a pinned sha256 digest in production');
  const ruleBuildEnabled = boolean(env.RULE_BUILD_ENABLED, false, 'RULE_BUILD_ENABLED');
  const ruleBuilderExecutionMode = env.RULE_BUILDER_EXECUTION_MODE?.trim() || (nodeEnv === 'production' ? 'isolated' : 'local');
  if (!['local','isolated'].includes(ruleBuilderExecutionMode)) throw new Error('RULE_BUILDER_EXECUTION_MODE must be local or isolated');
  if (nodeEnv === 'production' && ruleBuildEnabled && ruleBuilderExecutionMode !== 'isolated') throw new Error('RULE_BUILDER_EXECUTION_MODE must be isolated in production');
  const ruleBuilderImageDigest = env.RULE_BUILDER_IMAGE_DIGEST?.trim() || (nodeEnv === 'production' ? '' : 'development-unpinned');
  if (ruleBuildEnabled && nodeEnv === 'production' && !/^sha256:[a-f0-9]{64}$/.test(ruleBuilderImageDigest)) throw new Error('RULE_BUILDER_IMAGE_DIGEST must be a pinned sha256 digest in production');
  const redisUrl = env.REDIS_URL?.trim() || 'redis://127.0.0.1:6379';
  const validatorExecutionMode = env.VALIDATOR_EXECUTION_MODE?.trim() || (nodeEnv === 'production' ? 'isolated' : 'local');
  if (!['local', 'isolated'].includes(validatorExecutionMode)) throw new Error('VALIDATOR_EXECUTION_MODE must be local or isolated');
  if (nodeEnv === 'production' && validatorExecutionMode !== 'isolated') throw new Error('VALIDATOR_EXECUTION_MODE must be isolated in production');
  const storageWarnPercent = integer(env.STORAGE_WARN_PERCENT, 70, 'STORAGE_WARN_PERCENT', 1, 98);
  const storageBlockPercent = integer(env.STORAGE_BLOCK_PERCENT, 85, 'STORAGE_BLOCK_PERCENT', 2, 99);
  if (storageWarnPercent >= storageBlockPercent) throw new Error('STORAGE_WARN_PERCENT must be lower than STORAGE_BLOCK_PERCENT');
  const objectStorageProvider = env.OBJECT_STORAGE_PROVIDER?.trim() || 'local';
  if (!['local', 'aliyun-oss'].includes(objectStorageProvider)) throw new Error('OBJECT_STORAGE_PROVIDER must be local or aliyun-oss');
  const ossRegion = env.OSS_REGION?.trim() || '';
  const ossEndpoint = env.OSS_ENDPOINT?.trim() || '';
  const ossBucket = env.OSS_BUCKET?.trim() || '';
  const ossEcsRoleName = env.OSS_ECS_ROLE_NAME?.trim() || '';
  if (objectStorageProvider === 'aliyun-oss') {
    if (!/^oss-[a-z0-9-]+$/.test(ossRegion)) throw new Error('OSS_REGION must use the OSS region form, for example oss-ap-southeast-1');
    let endpoint;
    try { endpoint = new URL(ossEndpoint); } catch { throw new Error('OSS_ENDPOINT must be a valid HTTPS URL'); }
    if (endpoint.protocol !== 'https:' || endpoint.pathname !== '/' || endpoint.search || endpoint.hash) throw new Error('OSS_ENDPOINT must be an HTTPS origin without a path, query, or fragment');
    if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(ossBucket)) throw new Error('OSS_BUCKET is invalid');
    if (!/^[A-Za-z0-9.@_-]{1,64}$/.test(ossEcsRoleName)) throw new Error('OSS_ECS_ROLE_NAME is invalid');
  }
  const rulesManifestPath = env.RULES_MANIFEST_PATH?.trim() || null;
  const rulesAllowUnsigned = boolean(env.RULES_ALLOW_UNSIGNED, false, 'RULES_ALLOW_UNSIGNED');
  if (nodeEnv === 'production' && rulesAllowUnsigned) throw new Error('RULES_ALLOW_UNSIGNED cannot be enabled in production');
  const rulesTrustedKeys = parseTrustedRulesKeys(env.RULES_TRUSTED_KEYS_JSON);
  let realtimePublicUrl;
  try { realtimePublicUrl = new URL(env.REALTIME_PUBLIC_URL?.trim() || 'ws://127.0.0.1:3093/v1/realtime'); }
  catch { throw new Error('REALTIME_PUBLIC_URL must be a valid WebSocket URL'); }
  if (!['ws:', 'wss:'].includes(realtimePublicUrl.protocol)) throw new Error('REALTIME_PUBLIC_URL must use ws or wss');
  if (nodeEnv === 'production' && realtimePublicUrl.protocol !== 'wss:') throw new Error('REALTIME_PUBLIC_URL must use wss in production');
  return Object.freeze({
    nodeEnv,
    host: env.API_HOST ?? '127.0.0.1',
    port: integer(env.API_PORT, 3090, 'API_PORT', 1, 65535),
    databaseUrl: databaseUrl ?? '',
    databaseSsl: env.DATABASE_SSL === 'true',
    otpHmacKey,
    roomCodeHmacKey: env.ROOM_CODE_HMAC_KEY?.trim() || otpHmacKey,
    githubClientId,
    githubClientSecret,
    githubCallbackUrl,
    githubSourceImportEnabled,
    githubAppId,
    githubAppPrivateKey,
    githubAppWebhookSecret: githubAppWebhookSecret || null,
    githubAppSlug,
    githubAppCallbackUrl,
    githubAppClientId,
    sourceBuildEnabled,
    sourceBuilderRoot: env.SOURCE_BUILDER_ROOT ?? '.runtime/platform/builder',
    sourceBuildWorkingRoot: env.SOURCE_BUILD_WORKING_ROOT ?? '.runtime/platform/source-worker',
    sourceBuilderExecutionMode,
    sourceBuilderImageDigest,
    ruleBuildEnabled,
    ruleBuilderRoot: env.RULE_BUILDER_ROOT ?? '.runtime/platform/rule-builder',
    ruleBuildWorkingRoot: env.RULE_BUILD_WORKING_ROOT ?? '.runtime/platform/rule-worker',
    ruleBuilderExecutionMode,
    ruleBuilderImageDigest,
    mailProvider,
    resendApiKey: env.RESEND_API_KEY?.trim() || null,
    mailFrom: env.MAIL_FROM?.trim() || null,
    requestBodyLimit: integer(env.REQUEST_BODY_LIMIT, 64 * 1024, 'REQUEST_BODY_LIMIT', 1024, 1024 * 1024),
    quarantineRoot: env.QUARANTINE_ROOT ?? '.runtime/platform/quarantine',
    avatarRoot: env.AVATAR_ROOT ?? '.runtime/platform/avatars',
    coverRoot: env.COVER_ROOT ?? '.runtime/platform/covers',
    runtimeRoot: env.RUNTIME_ROOT ?? '.runtime/platform/published',
    validatorRoot: env.VALIDATOR_ROOT ?? '.runtime/platform/validator',
    validatorExecutionMode,
    storageWarnPercent,
    storageBlockPercent,
    storageMonitorIntervalSeconds: integer(env.STORAGE_MONITOR_INTERVAL_SECONDS, 60, 'STORAGE_MONITOR_INTERVAL_SECONDS', 30, 3600),
    objectStorageProvider,
    ossRegion: ossRegion || null,
    ossEndpoint: ossEndpoint || null,
    ossBucket: ossBucket || null,
    ossEcsRoleName: ossEcsRoleName || null,
    runtimePort: integer(env.RUNTIME_PORT, 3092, 'RUNTIME_PORT', 1, 65535),
    runtimeDomain,
    runtimeScheme,
    runtimePublicPort: env.RUNTIME_PUBLIC_PORT ? integer(env.RUNTIME_PUBLIC_PORT, 443, 'RUNTIME_PUBLIC_PORT', 1, 65535) : null,
    corsOrigins: Object.freeze(corsOrigins),
    loginEmailAllowlist: Object.freeze(loginEmailAllowlist),
    trustEditorWebviews: boolean(env.TRUST_EDITOR_WEBVIEWS, false, 'TRUST_EDITOR_WEBVIEWS'),
    redisUrl,
    rulesManifestPath,
    rulesAllowUnsigned,
    rulesTrustedKeys,
    realtimePublicUrl: realtimePublicUrl.toString(),
    realtimeTicketTtlSeconds: integer(env.REALTIME_TICKET_TTL_SECONDS, 30, 'REALTIME_TICKET_TTL_SECONDS', 5, 120),
    guessBaikeAutomationEnabled: boolean(env.GUESS_BAIKE_AUTOMATION_ENABLED, nodeEnv !== 'test', 'GUESS_BAIKE_AUTOMATION_ENABLED'),
    guessBaikeAutomationIntervalMinutes: integer(env.GUESS_BAIKE_AUTOMATION_INTERVAL_MINUTES, 360, 'GUESS_BAIKE_AUTOMATION_INTERVAL_MINUTES', 15, 1440),
    guessBaikeAutomationBatchSize: integer(env.GUESS_BAIKE_AUTOMATION_BATCH_SIZE, 20, 'GUESS_BAIKE_AUTOMATION_BATCH_SIZE', 1, 20),
    guessBaikeScheduleDays: integer(env.GUESS_BAIKE_SCHEDULE_DAYS, 14, 'GUESS_BAIKE_SCHEDULE_DAYS', 3, 60),
    guessBaikeWikipediaUserAgent: env.GUESS_BAIKE_WIKIPEDIA_USER_AGENT?.trim() || 'GameHub-GuessBaikeBot/0.3 (https://mooyu.fun/; automated daily puzzle) Node.js',
  });
}
