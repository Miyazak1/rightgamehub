import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { OUTBOX_WINDOW_SQL } from '../../scripts/agent-server-cutover.mjs';
import { outboxClassificationSQL, collectOutboxClassification, wsOutboxReadonlyCommand } from '../../scripts/qq-websocket-outbox-readonly.mjs';

test('classification reuses the exact gate predicate and performs one SELECT with bounded output', () => {
  const sql = outboxClassificationSQL(OUTBOX_WINDOW_SQL);
  assert(sql.startsWith('SELECT '));
  assert(!/;|\b(?:UPDATE|INSERT|DELETE|CREATE|ALTER|DROP|COPY|CALL|SET)\b/i.test(sql));
  assert(sql.includes("AND r.workflow_key IN ('blog.project.discovery-shadow','blog.project.single')"));
  assert(sql.includes("'payloadRunMatches',COALESCE(o.payload_json->>'runId'=r.id::text,false)"));
  assert(sql.includes('FILTER (WHERE rank<=80)'));
  assert(!sql.includes('last_error_message'));
  for (const invalid of ['', 'SELECT 1', OUTBOX_WINDOW_SQL + ';DELETE FROM x']) {
    assert.throws(() => outboxClassificationSQL(invalid), /EXACT_OUTBOX_GATE_REQUIRED/);
  }
  let reads = 0;
  const output = [];
  const result = collectOutboxClassification({ sql: (_db, query) => {
    reads++; assert.equal(query, sql);
    return JSON.stringify({ total: 139, retainedCompleted: 70, blocking: 69,
      classificationGroups: 2, groupsTruncated: false,
      groups: [{ count: 69, legacyRetained: false }, { count: 70, legacyRetained: true }] });
  } }, {}, OUTBOX_WINDOW_SQL, value => output.push(JSON.parse(value)));
  assert.equal(reads, 1); assert.equal(output.length, 4);
  assert.equal(result.blocking, 69); assert.equal(result.releaseWindowApproved, false);
  assert.equal(result.eventsDispatched, false); assert.equal(result.locksModified, false);
});

test('incomplete or inconsistent evidence fails closed', () => {
  for (const proof of [null, {}, { total: 1, retainedCompleted: 1, blocking: 1 },
    { total: 2, retainedCompleted: 1, blocking: 1, classificationGroups: 1,
      groupsTruncated: false, groups: [{ count: 1, legacyRetained: false }] }]) {
    assert.throws(() => collectOutboxClassification({ sql: () => JSON.stringify(proof) }, {}, OUTBOX_WINDOW_SQL, () => {}));
  }
});

test('generated server command parses and does not invoke a service or data mutation', () => {
  const command = wsOutboxReadonlyCommand();
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
  assert.equal(spawnSync(bash, ['-n'], { input: command, encoding: 'utf8' }).status, 0);
  const body = command.split("<<'NODE'\n")[1].split('\nNODE\n')[0];
  assert.equal(spawnSync(process.execPath, ['--input-type=module', '--check'], { input: body, encoding: 'utf8' }).status, 0);
  assert(!command.includes('function collectWSWindow('));
  assert(!/docker (?:stop|restart|compose)|MOOYU_QQ_WEBSOCKET_AUTH|flock|mkdir/.test(command));
  assert(command.includes('sha256sum --check SHA256SUMS'));
});
