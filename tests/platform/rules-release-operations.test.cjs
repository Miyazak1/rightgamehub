const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname,'../..');

test('production rules release operation is isolated, digest-gated and rollback-capable', t => {
  const scriptPath = path.join(root,'deploy/rules-release.sh');
  const script = fs.readFileSync(scriptPath,'utf8');
  const compose = fs.readFileSync(path.join(root,'deploy/compose.prod.yml'),'utf8');
  const operator = compose.slice(compose.indexOf('\n  rules-operator:'),compose.indexOf('\n  worker:'));
  assert.match(operator,/profiles: \[rules-operations\]/u);
  assert.match(operator,/dockerfile: deploy\/Dockerfile\.rules-operator/u);
  assert.match(operator,/network_mode: none/u);
  assert.match(operator,/read_only: true/u);
  assert.match(operator,/cap_drop: \[ALL\]/u);
  assert.match(operator,/\.\.\/rules:\/data\/rules/u);
  assert.doesNotMatch(operator,/(DATABASE_URL|REDIS_URL|RULES_TRUSTED_KEYS_JSON|private)/iu);
  assert.match(script,/RULES_TRUSTED_KEYS_JSON must never contain a private key/u);
  assert.match(script,/restart_and_verify "\$new_digest"/u);
  assert.match(script,/read_rules_sha api 3090/u);
  assert.match(script,/read_rules_sha realtime 3093/u);
  assert.match(script,/restoring the previous release/u);
  assert.match(script,/restart_and_verify "\$old_digest"/u);
  assert.match(script,/if \[ "\$COMMAND" = "rollback" \]/u);
  assert.match(script,/Another rules release operation is active/u);
  assert.match(script,/Invalid immutable release pointer/u);
  assert.match(script,/already current and verified/u);
  const checked = spawnSync('sh',['-n',scriptPath],{ encoding: 'utf8' });
  if (checked.error?.code === 'ENOENT') t.skip('POSIX shell is not installed on this development host');
  else assert.equal(checked.status,0,checked.stderr);
});

test('production backup and ignore policy cover generated immutable rule releases', () => {
  const backup = fs.readFileSync(path.join(root,'deploy/backup.sh'),'utf8');
  const ignore = fs.readFileSync(path.join(root,'.gitignore'),'utf8');
  assert.match(backup,/rules-current\.tar\.gz/u);
  assert.match(ignore,/rules\/releases\//u);
  assert.match(ignore,/rules\/current/u);
  assert.match(ignore,/rules\/previous/u);
  const attributes = fs.readFileSync(path.join(root,'.gitattributes'),'utf8');
  assert.match(attributes,/rules\/\*\*\/\*\.cjs -text/u);
});
