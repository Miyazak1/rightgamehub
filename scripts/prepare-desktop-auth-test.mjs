import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { desktopAuthTestConfig } from '../apps/api/src/desktop-auth-test-policy.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.length > 2) throw new Error('Usage: node scripts/prepare-desktop-auth-test.mjs [output.env] [public-origin]');
const output = path.resolve(root, args[0] || '.runtime/desktop-auth-test/instance.env');
if (!output.startsWith(path.join(root, '.runtime') + path.sep)) throw new Error('Output must be inside this checkout .runtime directory');
const publicOrigin = args[1] || 'http://127.0.0.1:39090';
const password = randomBytes(32).toString('hex');
const otp = randomBytes(32).toString('hex');
const settings = desktopAuthTestConfig({ DESKTOP_AUTH_TEST_INSTANCE: 'isolated-auth-only',
  DATABASE_URL: `postgresql://desktop_auth_test:${password}@auth-postgres:5432/desktop_auth_test`,
  REDIS_URL: 'redis://auth-redis:6379', OTP_HMAC_KEY: otp,
  DESKTOP_AUTH_TEST_PUBLIC_ORIGIN: publicOrigin });
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `# Isolated test instance only. Never copy production credentials here.\nDESKTOP_AUTH_TEST_PUBLIC_ORIGIN=${settings.publicOrigin}\nDESKTOP_AUTH_TEST_PORT=39090\nDESKTOP_AUTH_TEST_DB_PASSWORD=${password}\nDESKTOP_AUTH_TEST_OTP_HMAC_KEY=${otp}\nDESKTOP_AUTH_TEST_GITHUB_CLIENT_ID=\nDESKTOP_AUTH_TEST_GITHUB_CLIENT_SECRET=\nDESKTOP_AUTH_TEST_GITHUB_CALLBACK_URL=\n`, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ prepared: true, configFile: output, githubConfigured: false,
  deployed: false, note: 'Credentials were written only to the ignored configuration file; existing files are never overwritten.' }));
