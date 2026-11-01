import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { desktopAuthCaddyfile, prepareDesktopAuthCaddy } from '../../scripts/prepare-desktop-auth-caddy.mjs';

test('gateway preparation preserves all existing routes verbatim and appends only the test site', async () => {
  const source = await readFile(new URL('../../deploy/Caddyfile', import.meta.url), 'utf8');
  const result = desktopAuthCaddyfile(source, 'desktop-test.mooyu.fun');
  const withoutFilter = result.replace(/\n  # mooyu-desktop-auth-log-filter begin[\s\S]*?\n  # mooyu-desktop-auth-log-filter end\n/, '');
  assert.ok(withoutFilter.startsWith(source));
  const fragment = withoutFilter.slice(source.length);
  assert.match(result, /request>uri regexp/);
  assert.match(result, /request>headers>Referer delete/);
  assert.match(fragment, /reverse_proxy desktop-auth-test-api:3090/);
  assert.match(fragment, /dns alidns/);
  assert.doesNotMatch(fragment, /127\.0\.0\.1|reverse_proxy api:|postgres|client_secret|log\s*\{/i);
  assert.throws(() => desktopAuthCaddyfile(result, 'desktop-test.mooyu.fun'), /ALREADY_PRESENT/);
  for (const domain of ['mooyu.fun', 'www.mooyu.fun', 'https://desktop-test.mooyu.fun', 'desktop-test.mooyu.fun\n{', 'desktop-test.mooyu.fun:443', '*.mooyu.fun']) {
    assert.throws(() => desktopAuthCaddyfile(source, domain), /DOMAIN_INVALID/);
  }
});

test('custom log sinks require explicit review rather than bypassing the runtime filter', () => {
  assert.throws(() => desktopAuthCaddyfile('import /etc/caddy/extra/*\n', 'desktop-test.example.org'), /IMPORTED_CONFIG_REQUIRES_REVIEW/);
  for (const source of ['{\n log default {\n output stdout\n }\n}\nexample.test {}', 'example.test {\n log {\n output file /tmp/access.log\n }\n}']) {
    assert.throws(() => desktopAuthCaddyfile(source, 'desktop-test.example.org'), /CUSTOM_LOGGING_REQUIRES_REVIEW/);
  }
  const source = '# captured file\n\n{\n email test@example.org\n}\nhttp://main.example.org {\n respond "main"\n}\n';
  const result = desktopAuthCaddyfile(source, 'desktop-test.example.org');
  assert.match(result, /^# captured file\n\n\{\n  # mooyu-desktop-auth-log-filter/);
});

test('gateway artifacts refuse overwrite and leave the captured source intact', async t => {
  const parent = path.resolve(fileURLToPath(new URL('../../.runtime/desktop-auth-test/', import.meta.url)));
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, 'caddy-prepare-'));
  assert.ok(directory.startsWith(parent + path.sep)); t.after(() => rm(directory, { recursive: true, force: true }));
  const sourceFile = path.join(directory, 'original.Caddyfile');
  const source = 'http://example.test {\n respond "existing"\n}\n';
  await writeFile(sourceFile, source);
  const options = { sourceFile, outputDirectory: path.join(directory, 'prepared'), domain: 'desktop-test.example.org' };
  const manifest = await prepareDesktopAuthCaddy(options);
  assert.equal(manifest.applied, false);
  assert.equal(await readFile(sourceFile, 'utf8'), source);
  const before = await readFile(path.join(options.outputDirectory, 'Caddyfile'), 'utf8');
  await assert.rejects(prepareDesktopAuthCaddy(options), /NOT_EMPTY/);
  assert.equal(await readFile(path.join(options.outputDirectory, 'Caddyfile'), 'utf8'), before);
});
