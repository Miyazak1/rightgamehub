import { readFile, mkdir, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// Runtime error logs are independent of access logs. Drop query strings at
// encoding time, including malformed/encoded/repeated OAuth parameters.
const errorLogPolicy = `
  # mooyu-desktop-auth-log-filter begin
  log default {
    format filter {
      wrap json
      fields {
        request>uri regexp "[?].*" "?[redacted]"
        request>headers>Referer delete
        request>headers>Authorization delete
        request>headers>Cookie delete
      }
    }
  }
  # mooyu-desktop-auth-log-filter end
`;

export function desktopAuthCaddyfile(source, domain) {
  if (typeof source !== 'string' || !source.trim()) throw Error('CADDY_SOURCE_REQUIRED');
  if (!/^desktop-test\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain) || domain.length > 253) throw Error('DESKTOP_TEST_DOMAIN_INVALID');
  if (source.includes(domain) || source.includes('# mooyu-desktop-auth-test begin')) throw Error('DESKTOP_TEST_SITE_ALREADY_PRESENT');
  if (/^\s*import(?:\s|$)/m.test(source)) throw Error('CADDY_IMPORTED_CONFIG_REQUIRES_REVIEW');
  // Do not silently replace operator-configured log outputs or encoders.
  if (/^\s*log(?:\s|$)/m.test(source)) throw Error('CADDY_CUSTOM_LOGGING_REQUIRES_REVIEW');
  const global = /^(?:\uFEFF)?(?:(?:[ \t]*(?:#[^\r\n]*)?\r?\n))*[ \t]*\{(?=\s|$)/.exec(source);
  const protectedSource = global
    ? source.slice(0, global[0].length) + errorLogPolicy + source.slice(global[0].length)
    : `{${errorLogPolicy}}\n` + source;
  // Reuse the gateway's existing AliDNS credentials; do not copy them into the
  // test API environment, generated files, or desktop application.
  return protectedSource + `\n\n# mooyu-desktop-auth-test begin\n${domain} {\n  tls {\n    dns alidns {\n      access_key_id {env.ALIYUN_ACCESS_KEY_ID}\n      access_key_secret {env.ALIYUN_ACCESS_KEY_SECRET}\n    }\n  }\n  header {\n    Cache-Control "no-store"\n    X-Robots-Tag "noindex, nofollow"\n    Referrer-Policy "no-referrer"\n  }\n  # Runtime errors use the global query/header filter above.\n  reverse_proxy desktop-auth-test-api:3090 {\n    transport http {\n      dial_timeout 3s\n      response_header_timeout 20s\n    }\n  }\n}\n# mooyu-desktop-auth-test end\n`;
}

export async function prepareDesktopAuthCaddy({ sourceFile, outputDirectory, domain }) {
  if (!path.isAbsolute(sourceFile) || !path.isAbsolute(outputDirectory)) throw Error('CADDY_ABSOLUTE_PATH_REQUIRED');
  const source = await readFile(sourceFile, 'utf8');
  const combined = desktopAuthCaddyfile(source, domain);
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  if ((await readdir(outputDirectory)).length) throw Error('CADDY_OUTPUT_NOT_EMPTY');
  await writeFile(path.join(outputDirectory, 'Caddyfile'), combined, { flag: 'wx', mode: 0o600 });
  const sha256 = value => createHash('sha256').update(value).digest('hex');
  const manifest = { domain, upstream: 'desktop-auth-test-api:3090', sourceSha256: sha256(source), preparedSha256: sha256(combined), applied: false };
  await writeFile(path.join(outputDirectory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [sourceFile, outputDirectory, domain, ...extra] = process.argv.slice(2);
  if (!sourceFile || !outputDirectory || !domain || extra.length) throw Error('Usage: node scripts/prepare-desktop-auth-caddy.mjs ABSOLUTE_CURRENT_CADDYFILE ABSOLUTE_EMPTY_OUTPUT_DIRECTORY desktop-test.example.org');
  console.log(JSON.stringify(await prepareDesktopAuthCaddy({ sourceFile, outputDirectory, domain })));
}
