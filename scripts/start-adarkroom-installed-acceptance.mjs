import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRuntime } from '../apps/api/src/runtime.mjs';
import { LocalRuntimeStore } from '../apps/api/src/local-runtime-store.mjs';
import { mimeFor, WEB_POLICY_VERSION } from '../apps/api/src/web-package-policy.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const stateRoot = path.join(root, '.runtime/adarkroom-installed');
const extensionPackage = JSON.parse(await fs.readFile(path.join(root, 'extensions/vscode/package.json'), 'utf8'));
const databaseUrl = process.env.GAMEHUB_ADR_DATABASE_URL;
const parsed = new URL(databaseUrl ?? 'http://missing');
if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) ||
    !['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.pathname.endsWith('_test')) {
  throw new Error('Use a dedicated loopback PostgreSQL database ending in _test.');
}
await fs.mkdir(stateRoot, { recursive: true });
const emails = ['adr-a@gamehub.test', 'adr-b@gamehub.test'];
const mailboxPath = path.join(stateRoot, 'mailbox.json');
const mailbox = {};
await fs.writeFile(mailboxPath, '{}\n', { mode: 0o600 });
const runtime = createRuntime({
  // Deliberately do not inherit production environment or OAuth/mail credentials.
  env: {
    NODE_ENV: 'test', CLOUD_SAVE_ENABLED: 'true', DATABASE_URL: databaseUrl, OTP_HMAC_KEY: crypto.randomBytes(32).toString('hex'),
    API_HOST: '127.0.0.1', API_PORT: '3086', RUNTIME_DOMAIN: 'localhost',
    RUNTIME_SCHEME: 'http', RUNTIME_PORT: '3092', RUNTIME_PUBLIC_PORT: '3092',
    TRUST_EDITOR_WEBVIEWS: 'true', CORS_ORIGINS: 'http://127.0.0.1:3086,http://localhost:3086',
    LOGIN_EMAIL_ALLOWLIST: emails.join(','), REDIS_URL: 'redis://127.0.0.1:55440',
    QUARANTINE_ROOT: path.join(stateRoot, 'quarantine'), RUNTIME_ROOT: path.join(stateRoot, 'published'),
    VALIDATOR_ROOT: path.join(stateRoot, 'validator'), AVATAR_ROOT: path.join(stateRoot, 'avatars'),
    COVER_ROOT: path.join(stateRoot, 'covers'),
  },
  loadTrustedRules: false,
  mailer: { async sendVerificationCode(message) {
    mailbox[message.email] = { code: message.code, expiresAt: message.expiresAt };
    const temp = mailboxPath + '.' + crypto.randomUUID() + '.tmp';
    await fs.writeFile(temp, JSON.stringify(mailbox, null, 2), { mode: 0o600 });
    await fs.rename(temp, mailboxPath);
  } },
});
// Local acceptance fault switch; production runtime never installs this hook.
const networkFaultPath = path.join(stateRoot, 'network-fault.json');
await fs.writeFile(networkFaultPath, JSON.stringify({ offline: false }));
runtime.app.addHook('onRequest', async (request, reply) => {
  if (!/^\/v1\/(?:game-sessions(?:[/?]|$)|me\/game-saves\/)/.test(request.url)) return;
  const fault = JSON.parse(await fs.readFile(networkFaultPath, 'utf8').catch(() => '{}'));
  if (fault.offline) return reply.code(503).send({ error: { code: 'API_UNAVAILABLE', message: 'Installed acceptance: simulated save-service outage.', retryable: true } });
});
try {
  await runtime.migrations.apply();
  const pool = runtime.database.pool;
  const userIds = [];
  for (const [i, email] of emails.entries()) {
    let id = (await pool.query("SELECT user_id FROM auth_identities WHERE provider='email' AND subject=$1", [email])).rows[0]?.user_id;
    if (!id) {
      id = crypto.randomUUID();
      await pool.query("INSERT INTO users(id,display_name) VALUES($1,$2)", [id, 'ADR Test ' + (i ? 'B' : 'A')]);
      await pool.query("INSERT INTO auth_identities(id,user_id,provider,subject) VALUES($1,$2,'email',$3)", [crypto.randomUUID(), id, email]);
    }
    userIds.push(id);
  }
  const previous = JSON.parse(await fs.readFile(path.join(stateRoot, 'session.json'), 'utf8').catch(() => '{}'));
  const previousWork = /^[a-f0-9-]{36}$/.test(previous.workId ?? '') ? (await pool.query(
    "SELECT id FROM works WHERE id=$1 AND owner_user_id=$2 AND title='A Dark Room 安装版验收' AND state='published'",
    [previous.workId, userIds[0]])).rows[0] : null;
  const workId = previousWork?.id ?? crypto.randomUUID(), releaseId = crypto.randomUUID(), uploadId = crypto.randomUUID();
  const directory = path.join(root, '.runtime/adarkroom-web'), assets = {};
  async function walk(dir, prefix = '') {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), name + '/');
      else {
        const bytes = await fs.readFile(path.join(dir, entry.name));
        assets[name] = { size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), mime: mimeFor(name) };
      }
    }
  }
  await walk(directory);
  const report = { entry: 'index.html', policyVersion: WEB_POLICY_VERSION, approvedCapabilities: ['cloudSave'],
    fileCount: Object.keys(assets).length, totalBytes: Object.values(assets).reduce((n, a) => n + a.size, 0), assets };
  // Fixture publication only: the public ZIP validator continues to reject cloudSave.
  const published = await new LocalRuntimeStore(runtime.config.runtimeRoot).publishAttempt({
    releaseId, attemptId: crypto.randomUUID(), sourceDirectory: directory, report,
  });
  const zip = await fs.readFile(path.join(root, 'artifacts/adarkroom-cloud-save-internal.zip'));
  const digest = crypto.createHash('sha256').update(zip).digest('hex');
  const connection = await pool.connect();
  try {
    await connection.query('BEGIN');
    await connection.query("INSERT INTO works(id,owner_user_id,title,description,instructions,kind,state,visibility,first_published_at) VALUES($1,$2,'A Dark Room 安装版验收','仅供本机验收，邮箱登录后继续冒险。','点火开始；保存栏显示云端确认后再退出。','game','published','public',now()) ON CONFLICT (id) DO NOTHING", [workId, userIds[0]]);
    await connection.query("INSERT INTO work_targets(work_id,target_key,state) VALUES($1,'web','published') ON CONFLICT (work_id,target_key) DO NOTHING", [workId]);
    await connection.query("INSERT INTO upload_jobs(id,owner_user_id,work_id,target_key,package_type,file_name,state,declared_bytes,actual_bytes,declared_sha256,object_key,reserved_bytes,expires_at,release_label) VALUES($1,$2,$3,'web','web_zip','adr-internal.zip','succeeded',$4,$4,$5,$6,0,now()+interval '1 day','Installed acceptance')",
      [uploadId, userIds[0], workId, zip.length, digest, 'adr-installed/' + uploadId]);
    await connection.query("INSERT INTO releases(id,work_id,target_key,label,package_type,validation_state,serving_state,approved_capabilities,upload_job_id,entry_path,asset_prefix,asset_manifest_sha256,asset_count,expanded_bytes) VALUES($1,$2,'web','Installed acceptance','web_zip','ready','enabled',$3,$4,'index.html',$5,$6,$7,$8)",
      [releaseId, workId, JSON.stringify(['cloudSave']), uploadId, published.prefix, published.manifestSha256, report.fileCount, report.totalBytes]);
    await connection.query("UPDATE work_targets SET current_release_id=$2 WHERE work_id=$1 AND target_key='web'", [workId, releaseId]);
    await connection.query("INSERT INTO game_release_service_scopes(work_id,release_id,channel,status,namespaces,approved_by,reason) VALUES($1,$2,'production','active',$3,$4,'loopback installed acceptance only')",
      [workId, releaseId, JSON.stringify({ default: { readSchema: { min: 1, max: 1 }, writeSchema: 1 } }), userIds[0]]);
    await connection.query("INSERT INTO game_save_policies(id,work_id,namespace,status,approved_by,reason) VALUES($1,$2,'default','active',$3,'loopback installed acceptance only') ON CONFLICT (work_id,namespace) DO NOTHING", [crypto.randomUUID(), workId, userIds[0]]);
    await connection.query('COMMIT');
  } catch (error) { await connection.query('ROLLBACK'); throw error; }
  finally { connection.release(); }

  // Real catalog lookup and auth; only this disposable fixture opts into the closed capability.
  const normalLaunch = runtime.catalogService.launch.bind(runtime.catalogService);
  runtime.catalogService.launch = async (...args) => {
    const descriptor = await normalLaunch(...args);
    if (descriptor.workId === workId && descriptor.releaseId === releaseId) descriptor.capabilities.cloudSave = true;
    return descriptor;
  };
  const require = createRequire(new URL('../extensions/harness/package.json', import.meta.url));
  const { build } = await import(pathToFileURL(require.resolve('esbuild')).href);
  const clientRoot = path.join(stateRoot, 'web');
  await fs.mkdir(clientRoot, { recursive: true });
  await build({
    absWorkingDir: root, entryPoints: ['apps/web/src/main.jsx'], outfile: path.join(clientRoot, 'app.js'),
    bundle: true, format: 'iife', platform: 'browser', target: ['chrome110'], loader: { '.png': 'dataurl' },
    nodePaths: [path.join(root, 'extensions/harness/node_modules'), path.join(root, 'packages/platform-client/node_modules')],
    define: { 'import.meta.env.DEV': 'false', 'import.meta.env.VITE_RUNTIME_DOMAIN': '"localhost"' }, logLevel: 'silent',
  });
  runtime.app.get('/', async (_request, reply) => reply.type('text/html').send('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GameHub 安装版存档验收</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>'));
  for (const [name, type] of [['app.js', 'text/javascript'], ['app.css', 'text/css']]) {
    const bytes = await fs.readFile(path.join(clientRoot, name));
    runtime.app.get('/' + name, async (_request, reply) => reply.type(type).send(bytes));
  }
  const profilePath = path.join(stateRoot, 'cursor-profile'), extensionsPath = path.join(stateRoot, 'cursor-extensions');
  await fs.mkdir(path.join(profilePath, 'User'), { recursive: true });
  await fs.mkdir(extensionsPath, { recursive: true });
  await fs.writeFile(path.join(profilePath, 'User/settings.json'), JSON.stringify({
    'gamehub.apiUrl': 'http://127.0.0.1:3086', 'gamehub.browserUrl': 'http://127.0.0.1:3086/',
    'gamehub.autoUpdate': false, 'workbench.startupEditor': 'none', 'window.title': 'GameHub ADR 安装版验收',
    'extensions.autoUpdate': false, 'extensions.autoCheckUpdates': false,
  }, null, 2));
  await runtime.app.listen({ host: '127.0.0.1', port: 3086 });
  await runtime.runtimeEdgeApp.listen({ host: '127.0.0.1', port: 3092 });
  await fs.writeFile(path.join(stateRoot, 'session.json'), JSON.stringify({
    workId, releaseId, userIds, emails, url: 'http://127.0.0.1:3086/', mailboxPath, profilePath, extensionsPath,
    vsixPath: path.join(root, 'artifacts/' + extensionPackage.name + '-' + extensionPackage.version + '.vsix'),
  }, null, 2));
  console.log('Installed acceptance ready on http://127.0.0.1:3086; runtime 3092. Real email auth, catalog, grants, API and PostgreSQL; fixture-only capability approval.');
  console.log('Disposable test emails: ' + emails.join(', ') + '. OTP mailbox: ' + mailboxPath);
  let stopping = false;
  async function stop() {
    if (stopping) return; stopping = true;
    await runtime.runtimeEdgeApp.close(); await runtime.app.close();
  }
  process.once('SIGINT', () => stop().then(() => process.exit(0)));
  process.once('SIGTERM', () => stop().then(() => process.exit(0)));
} catch (error) {
  console.error('Installed acceptance startup failed:', error.message);
  await runtime.runtimeEdgeApp.close().catch(() => {});
  await runtime.app.close().catch(() => {});
  throw error;
}
