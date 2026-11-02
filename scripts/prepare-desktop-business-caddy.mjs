import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { desktopAuthCaddyfile } from './prepare-desktop-auth-caddy.mjs';
import { isolatedBusinessOrigins } from '../packages/contracts/src/isolated-business-origins.mjs';

export function desktopBusinessCaddyfile(source, api, runtime) {
  const origins = isolatedBusinessOrigins(api, runtime), domain = new URL(origins.apiOrigin).hostname;
  if (source.includes('mooyu-desktop-business-test') || source.includes(origins.domain)) throw Error('BUSINESS_SITE_ALREADY_PRESENT');
  let prepared;
  const marker = '# mooyu-desktop-auth-test begin';
  if (source.includes(marker)) {
    // Only upgrade the exact previous generated block. Unknown hand edits need review.
    const start = source.indexOf(marker), endMarker = '# mooyu-desktop-auth-test end';
    const end = source.indexOf(endMarker, start);
    if (end < 0 || source.indexOf(marker, start + 1) >= 0) throw Error('CADDY_AUTH_BASELINE_REQUIRES_REVIEW');
    const canonical = desktopAuthCaddyfile('baseline.invalid { respond 404 }\n', domain);
    const oldBlock = canonical.slice(canonical.indexOf(marker)).trim();
    const filter = text => /# mooyu-desktop-auth-log-filter begin[\s\S]*?# mooyu-desktop-auth-log-filter end/.exec(text)?.[0];
    if (source.slice(start, end + endMarker.length).trim() !== oldBlock ||
      filter(source) !== filter(canonical) || (source.match(/^\s*log(?:\s|$)/gm) ?? []).length !== 1 ||
      /^\s*import(?:\s|$)/m.test(source)) throw Error('CADDY_AUTH_BASELINE_REQUIRES_REVIEW');
    prepared = source.slice(0, start) + oldBlock.replace('desktop-auth-test-api:3090', 'desktop-business-test-api:3090') + source.slice(end + endMarker.length);
  } else {
    prepared = desktopAuthCaddyfile(source, domain).replace('desktop-auth-test-api:3090', 'desktop-business-test-api:3090');
  }
  return prepared + `
# mooyu-desktop-business-test begin
*.${origins.domain} {
  tls {
    dns alidns {
      access_key_id {env.ALIYUN_ACCESS_KEY_ID}
      access_key_secret {env.ALIYUN_ACCESS_KEY_SECRET}
    }
  }
  header {
    X-Robots-Tag "noindex, nofollow"
    Referrer-Policy "no-referrer"
    -Set-Cookie
  }
  @release {
    expression \`{host}.matches('^r-[a-f0-9]{32}[.]${origins.domain.replaceAll('.', '[.]')}$')\`
    method GET HEAD
  }
  handle @release {
    reverse_proxy desktop-business-test-api:3092 {
      header_up -Authorization
      header_up -Cookie
      transport http {
        dial_timeout 3s
        response_header_timeout 20s
      }
    }
  }
  handle {
    respond "Runtime host or method denied" 403
  }
}
# mooyu-desktop-business-test end
`;
}
export async function prepareDesktopBusinessCaddy({ sourceFile, outputDirectory, api, runtime }) {
  if (!path.isAbsolute(sourceFile) || !path.isAbsolute(outputDirectory)) throw Error('CADDY_ABSOLUTE_PATH_REQUIRED');
  const source = await fs.readFile(sourceFile, 'utf8'), prepared = desktopBusinessCaddyfile(source, api, runtime);
  await fs.mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  if ((await fs.readdir(outputDirectory)).length) throw Error('CADDY_OUTPUT_NOT_EMPTY');
  const hash = value => createHash('sha256').update(value).digest('hex');
  const manifest = { api, runtime, sourceSha256: hash(source), preparedSha256: hash(prepared), applied: false };
  await fs.writeFile(path.join(outputDirectory, 'Caddyfile'), prepared, { flag: 'wx', mode: 0o600 });
  await fs.writeFile(path.join(outputDirectory, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
  return manifest;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [sourceFile, outputDirectory, api, runtime, ...extra] = process.argv.slice(2);
  if (!sourceFile || !outputDirectory || !api || !runtime || extra.length) throw Error('Usage: prepare-desktop-business-caddy.mjs ABS_SOURCE ABS_EMPTY_OUTPUT HTTPS_API HTTPS_RUNTIME');
  console.log(JSON.stringify(await prepareDesktopBusinessCaddy({ sourceFile, outputDirectory, api, runtime })));
}
