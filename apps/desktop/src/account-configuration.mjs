import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { localBusinessRuntime } from './runtime-policy.mjs';
import { PRODUCTION_API_ORIGIN, PRODUCTION_RUNTIME } from './production-configuration.mjs';

const fail = code => { throw Object.assign(new Error(code), { code }); };
export function accountOrigin(value, environment = 'local-test') {
  if (!['local-test', 'isolated-test', 'production'].includes(environment)) fail('DESKTOP_ACCOUNT_ENVIRONMENT_INVALID');
  if (environment === 'production') {
    if (value !== PRODUCTION_API_ORIGIN) fail('DESKTOP_ACCOUNT_ORIGIN_INVALID');
    return PRODUCTION_API_ORIGIN;
  }
  if (value == null || value === '') return null;
  let url; try { url = new URL(value); } catch { fail('DESKTOP_ACCOUNT_ORIGIN_INVALID'); }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) fail('DESKTOP_ACCOUNT_ORIGIN_INVALID');
  if (environment === 'local-test') {
    if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)) fail('DESKTOP_ACCOUNT_ORIGIN_INVALID');
  } else if (environment === 'isolated-test') {
    if (url.protocol !== 'https:' || ['mooyu.fun', 'www.mooyu.fun'].includes(url.hostname.replace(/\.$/, ''))) fail('DESKTOP_ACCOUNT_ORIGIN_INVALID');
  } else fail('DESKTOP_ACCOUNT_ENVIRONMENT_INVALID');
  return url.origin;
}

export function isolatedAccountProfile(base, origin) {
  const normalized = accountOrigin(origin, 'isolated-test');
  if (!path.isAbsolute(base) || !normalized) fail('DESKTOP_PROFILE_PATH_INVALID');
  // Keep nested Chromium paths usable on Windows; the full origin binding below
  // still rejects accidental reuse even in the event of a hash-prefix collision.
  const id = createHash('sha256').update('isolated-test:' + normalized).digest('hex').slice(0, 24);
  return path.join(base, 'test-' + id);
}

export function productionAccountProfile(base) {
  if (!path.isAbsolute(base)) fail('DESKTOP_PROFILE_PATH_INVALID');
  return path.join(base, 'production-' + createHash('sha256').update(PRODUCTION_API_ORIGIN).digest('hex').slice(0,24));
}

// Bind before Chromium or DPAPI reads anything from this profile. Never adopt a
// populated, unbound directory, nor retarget a profile to another server.
export function bindIsolatedAccountProfileSync(directory, origin, environment = 'isolated-test') {
  const normalized = accountOrigin(origin, environment);
  if (!path.isAbsolute(directory) || !normalized) fail('DESKTOP_PROFILE_PATH_INVALID');
  const expected = { schemaVersion: 1, environment, origin: normalized };
  const file = path.join(directory, 'account-server.json');
  fs.mkdirSync(directory, { recursive: true });
  const check = () => {
    let saved; try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { fail('DESKTOP_PROFILE_SERVER_MISMATCH'); }
    if (saved.schemaVersion !== expected.schemaVersion || saved.environment !== expected.environment || saved.origin !== expected.origin) fail('DESKTOP_PROFILE_SERVER_MISMATCH');
  };
  const entries = fs.readdirSync(directory);
  if (entries.includes('account-server.json')) return check();
  if (entries.length) fail('DESKTOP_PROFILE_NOT_ISOLATED');
  try { fs.writeFileSync(file, JSON.stringify(expected, null, 2), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; check(); }
}

export function prepareDesktopAccountProfileSync(directory, origin, environment) {
  if (environment === 'isolated-test' || environment === 'production') return bindIsolatedAccountProfileSync(directory, origin, environment);
  try { fs.readFileSync(path.join(directory, 'account-server.json')); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  fail('DESKTOP_PROFILE_SERVER_MISMATCH');
}

export async function bindIsolatedAccountProfile(directory, origin) { return bindIsolatedAccountProfileSync(directory, origin); }
export async function prepareDesktopAccountProfile(directory, origin, environment) { return prepareDesktopAccountProfileSync(directory, origin, environment); }

export function desktopAccountLaunchOptions(args, root) {
  const allowed = new Set(['--account-api', '--test-account-api', '--production-api', '--profile-root', '--test-runtime-origin']);
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.has(args[i]) || !args[i + 1] || values[args[i]] !== undefined) fail('DESKTOP_LAUNCH_OPTIONS_INVALID');
    values[args[i]] = args[i + 1];
  }
  if (['--account-api','--test-account-api','--production-api'].filter(key=>values[key]).length > 1 || values['--production-api'] && values['--test-runtime-origin']) fail('DESKTOP_LAUNCH_OPTIONS_INVALID');
  const accountEnvironment = values['--production-api'] ? 'production' : values['--test-account-api'] ? 'isolated-test' : 'local-test';
  const accountApiOrigin = accountOrigin(values['--production-api'] || values['--test-account-api'] || values['--account-api'], accountEnvironment);
  let businessRuntime = accountEnvironment === 'production' ? PRODUCTION_RUNTIME : null;
  if (values['--test-runtime-origin']) {
    let runtime; try { runtime = new URL(values['--test-runtime-origin']); } catch { fail('DESKTOP_RUNTIME_DENIED'); }
    if (!['http:', 'https:'].includes(runtime.protocol) || runtime.username || runtime.password ||
      runtime.pathname !== '/' || runtime.search || runtime.hash) fail('DESKTOP_RUNTIME_DENIED');
    businessRuntime = localBusinessRuntime({ scheme: runtime.protocol.slice(0, -1), domain: runtime.hostname,
      port: Number(runtime.port || (runtime.protocol === 'https:' ? 443 : 80)) }, accountApiOrigin);
  }
  const base = values['--profile-root'] ?? path.join(root, '.runtime/desktop-shell', accountEnvironment !== 'local-test' ? 'profiles' : 'profile');
  if (!path.isAbsolute(base)) fail('DESKTOP_PROFILE_PATH_INVALID');
  return { accountApiOrigin, accountEnvironment,
    profileRoot: accountEnvironment === 'production' ? productionAccountProfile(base) : accountEnvironment === 'isolated-test' ? isolatedAccountProfile(base, accountApiOrigin) : base,
    dedicatedConfig: Boolean(values['--profile-root'] || accountEnvironment !== 'local-test'), ...(businessRuntime ? { businessRuntime } : {}) };
}
