import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isolatedBusinessOrigins } from '../packages/contracts/src/isolated-business-origins.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const [relative, api, runtime, ...extra] = process.argv.slice(2);
if (!relative || extra.length) throw Error('Usage: prepare-desktop-business-remote.mjs .runtime/ENV_FILE HTTPS_API HTTPS_RUNTIME');
const origins = isolatedBusinessOrigins(api, runtime);
const file = path.resolve(root, relative), inside = path.relative(path.join(root, '.runtime'), file);
if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) throw Error('OUTPUT_MUST_BE_INSIDE_RUNTIME');
await fs.mkdir(path.dirname(file), { recursive: true });
await fs.writeFile(file, `DESKTOP_BUSINESS_TEST_MODE=remote-https
DESKTOP_BUSINESS_TEST_PORT=39190
DESKTOP_BUSINESS_TEST_PUBLIC_ORIGIN=${origins.apiOrigin}
DESKTOP_BUSINESS_TEST_RUNTIME_ORIGIN=${origins.runtimeOrigin}
DESKTOP_BUSINESS_TEST_RUNTIME_PORT=443
DESKTOP_BUSINESS_TEST_DB_PASSWORD=${crypto.randomBytes(32).toString('hex')}
DESKTOP_BUSINESS_TEST_OTP_HMAC_KEY=${crypto.randomBytes(32).toString('hex')}
DESKTOP_BUSINESS_TEST_IMAGE=mooyu-desktop-business-test:local
DESKTOP_BUSINESS_INGRESS_NETWORK=mooyu-desktop-business-test-ingress
DESKTOP_BUSINESS_TEST_GITHUB_CLIENT_ID=
DESKTOP_BUSINESS_TEST_GITHUB_CLIENT_SECRET=
DESKTOP_BUSINESS_TEST_GITHUB_CALLBACK_URL=
`, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ prepared: true, configFile: file, ...origins, deployed: false, githubConfigured: false }));
