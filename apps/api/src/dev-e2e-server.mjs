import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRuntime } from './runtime.mjs';

const projectRoot = path.resolve(import.meta.dirname, '../../..');
const mailboxPath = path.resolve(projectRoot, process.env.DEV_MAILBOX_PATH ?? '.runtime/platform/dev-mailbox.json');
const creatorEmail = (process.env.DEV_CREATOR_EMAIL ?? 'creator@gamehub.local').trim().toLowerCase();
const env = {
  ...process.env,
  NODE_ENV: 'development',
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://gamehub:local-gamehub-only@127.0.0.1:54329/gamehub',
  OTP_HMAC_KEY: process.env.OTP_HMAC_KEY ?? 'gamehub-local-e2e-otp-key-2026-only',
  API_HOST: '127.0.0.1', API_PORT: process.env.API_PORT ?? '3090',
  CORS_ORIGINS: process.env.CORS_ORIGINS ?? 'http://127.0.0.1:3081,http://127.0.0.1:4173',
  RUNTIME_DOMAIN: 'localhost', RUNTIME_SCHEME: 'http',
  RUNTIME_PORT: process.env.RUNTIME_PORT ?? '3092', RUNTIME_PUBLIC_PORT: process.env.RUNTIME_PUBLIC_PORT ?? '3092',
  QUARANTINE_ROOT: path.resolve(projectRoot, '.runtime/platform/e2e/quarantine'),
  AVATAR_ROOT: path.resolve(import.meta.dirname, '../.runtime/e2e/avatars'),
  RUNTIME_ROOT: path.resolve(projectRoot, '.runtime/platform/e2e/published'),
  VALIDATOR_ROOT: path.resolve(projectRoot, '.runtime/platform/e2e/validator'),
};

if (!/^127\.0\.0\.1$/.test(env.API_HOST) || env.NODE_ENV !== 'development') throw new Error('The E2E server is restricted to loopback development use.');

await fs.mkdir(path.dirname(mailboxPath), { recursive: true });
await fs.writeFile(mailboxPath, JSON.stringify({ ready: true, email: creatorEmail, code: null }, null, 2), { mode: 0o600 });
const mailer = {
  async sendVerificationCode({ email, code, expiresAt }) {
    const temporary = `${mailboxPath}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify({ ready: true, email, code, expiresAt: expiresAt.toISOString(), receivedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
    await fs.rename(temporary, mailboxPath);
  },
};

const runtime = createRuntime({ env, mailer });
await runtime.migrations.apply();
await runtime.guessBaikeService.seedBuiltIns();
const seedId = '00000000-0000-4000-8000-000000000019';
const seedIdentityId = '00000000-0000-4000-8000-000000000020';
await runtime.database.pool.query('BEGIN');
try {
  let userId = (await runtime.database.pool.query("SELECT user_id FROM auth_identities WHERE provider='email' AND subject=$1", [creatorEmail])).rows[0]?.user_id;
  if (!userId) {
    userId = seedId;
    await runtime.database.pool.query("INSERT INTO users(id,display_name,role,can_publish) VALUES ($1,'GameHub E2E Creator','admin',true) ON CONFLICT (id) DO UPDATE SET role='admin',can_publish=true", [userId]);
    await runtime.database.pool.query("INSERT INTO auth_identities(id,user_id,provider,subject) VALUES ($1,$2,'email',$3) ON CONFLICT (provider,subject) DO NOTHING", [seedIdentityId, userId, creatorEmail]);
    await runtime.database.pool.query('INSERT INTO creator_usage(user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [userId]);
  } else await runtime.database.pool.query("UPDATE users SET role='admin',can_publish=true,updated_at=now() WHERE id=$1", [userId]);
  await runtime.database.pool.query('COMMIT');
} catch (error) {
  await runtime.database.pool.query('ROLLBACK');
  throw error;
}

await runtime.app.listen({ host: runtime.config.host, port: runtime.config.port });
await runtime.runtimeEdgeApp.listen({ host: runtime.config.host, port: runtime.config.runtimePort });
runtime.guessBaikeAutomation.start();

let workerBusy = false;
const tick = async () => {
  if (workerBusy) return;
  workerBusy = true;
  try { await runtime.validationWorker.runOnce(); }
  catch (error) { process.stderr.write(`GameHub validator: ${error.code ?? 'VALIDATION_FAILED'}\n`); }
  finally { workerBusy = false; }
};
const worker = setInterval(tick, 500);
worker.unref();
process.stdout.write(`GameHub E2E API ready at http://${runtime.config.host}:${runtime.config.port}; runtime edge ${runtime.config.runtimePort}; mailbox ${mailboxPath}\n`);

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true; clearInterval(worker);
  await runtime.runtimeEdgeApp.close().catch(() => {});
  await runtime.app.close().catch(() => {});
};
process.once('SIGINT', () => stop().finally(() => process.exit(0)));
process.once('SIGTERM', () => stop().finally(() => process.exit(0)));
