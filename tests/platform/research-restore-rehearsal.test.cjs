const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');

test('research restore rehearsal is local-only, non-destructive and verifies rows plus schema', () => {
  const script = fs.readFileSync(path.join(root, 'scripts/rehearse-research-database-restore.mjs'), 'utf8');
  assert.match(script, /GAMEHUB_RESEARCH_DATABASE_URL/u);
  assert.match(script, /\['127\.0\.0\.1', 'localhost'\]/u);
  assert.match(script, /gamehub_\[a-z0-9_\]\+_test/u);
  assert.match(script, /pg_export_snapshot/u);
  assert.match(script, /--format=custom/u);
  assert.match(script, /pg_restore', '--list'/u);
  assert.match(script, /sha256sum/u);
  assert.match(script, /tool_research_provider_billing_reconciliations/u);
  assert.match(script, /sourceFingerprint\) !== JSON\.stringify\(restoredFingerprint/u);
  assert.match(script, /missing_current_contracts/u);
  assert.match(script, /cross_account_billing_snapshots/u);
  assert.doesNotMatch(script, /dropdb|DROP DATABASE|--clean/u);
});

test('research recovery runbook records bounded promises and an executable rehearsal', () => {
  const runbook = fs.readFileSync(path.join(root, 'docs/change-radar-recovery-runbook.zh-CN.md'), 'utf8');
  assert.match(runbook, /npm run research:restore-rehearsal/u);
  assert.match(runbook, /RPO 24 小时/u);
  assert.match(runbook, /RTO 4 小时/u);
  assert.match(runbook, /不能证明/u);
  assert.match(runbook, /不要在生产库/u);
  assert.match(runbook, /tool_research_/u);
});

test('production backup validates the custom dump before publishing its final name', () => {
  const backup = fs.readFileSync(path.join(root, 'deploy/backup.sh'), 'utf8');
  const dumpAt = backup.indexOf('database.dump.partial');
  const verifyAt = backup.indexOf('pg_restore --list');
  const publishAt = backup.indexOf('mv -- "$TARGET/database.dump.partial" "$TARGET/database.dump"');
  assert.ok(dumpAt >= 0 && verifyAt > dumpAt && publishAt > verifyAt);
  assert.match(backup, /sha256sum "\$TARGET"\/\*/u);
});
