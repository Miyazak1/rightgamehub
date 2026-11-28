import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { Cutover, OUTBOX_WINDOW_SQL } from '../../scripts/agent-server-cutover.mjs';
import { collectOutboxClassification } from '../../scripts/qq-websocket-outbox-readonly.mjs';
import { WS_OUTBOX_WINDOW_SQL } from '../../scripts/qq-websocket-window-policy.mjs';

test('real isolated PostgreSQL classifies retained, terminal, active, orphan and mismatched events without writes',
  { skip: process.env.QQ_OUTBOX_READONLY_DB_TEST !== '1' }, async () => {
    const owner = crypto.randomBytes(12).toString('hex');
    const name = 'qq-outbox-readonly-qa-' + owner;
    const label = 'right.qq.outbox.readonly.qa';
    const user = 'qa_outbox', database = 'qa_outbox';
    let created = false;
    const docker = (args, input) => {
      const result = spawnSync('docker', args, { input, encoding: 'utf8', timeout: 30000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
      assert.equal(result.status, 0, 'OWN_QA_CONTAINER_COMMAND_FAILED');
      return result.stdout.trim();
    };
    const fixtureSQL = sql => docker(['exec', '-i', name, 'psql', '-X', '-U', user, '-d', database, '-At', '-v', 'ON_ERROR_STOP=1'], sql);
    const reader = new Cutover(os.tmpdir());
    const db = { container: name, user, database };
    const read = () => collectOutboxClassification(reader, db, OUTBOX_WINDOW_SQL, () => {});
    const fingerprint = () => crypto.createHash('sha256').update(reader.sql(db,
      "SELECT json_build_array((SELECT json_agg(t ORDER BY id) FROM agent_runs t),(SELECT json_agg(t ORDER BY id) FROM agent_run_stages t),(SELECT json_agg(t ORDER BY id) FROM agent_runtime_outbox t))")).digest('hex');
    const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    let sequence = 0;
    const event = ({ workflow = 'agent.github.search', runState = 'succeeded', stageState = 'succeeded', attempts = 0,
      lease = false, mismatch = false, orphan = false } = {}) => {
      const id = uuid(++sequence), payload = JSON.stringify({ stageId: id, runId: mismatch ? uuid(999999) : id, stageKey: 'verify' });
      return `${orphan ? '' : `INSERT INTO agent_runs VALUES ('${id}','${runState}','${workflow}',${runState === 'running' ? 'NULL' : 'now()'});
        INSERT INTO agent_run_stages(id,run_id,status,stage_key,lease_token,lease_until) VALUES ('${id}','${id}','${stageState}','verify',NULL,NULL);`}
        INSERT INTO agent_runtime_outbox VALUES ('${id}','stage','${id}','stage.available','${payload}'::jsonb,
          '${lease ? 'dispatching' : 'pending'}',${attempts},25,${lease ? `'${id}'` : 'NULL'},${lease ? 'now()' : 'NULL'},NULL,now());`;
    };
    try {
      docker(['run', '-d', '--pull', 'never', '--name', name, '--label', label + '=' + owner,
        '--network', 'none', '--memory', '384m', '--tmpfs', '/var/lib/postgresql/data:rw',
        '-e', 'POSTGRES_USER=' + user, '-e', 'POSTGRES_DB=' + database,
        '-e', 'POSTGRES_PASSWORD=' + crypto.randomBytes(24).toString('hex'), 'postgres:17']);
      created = true;
      let ready = false;
      for (let n = 0; n < 60; n++) {
        if (spawnSync('docker', ['exec', name, 'pg_isready', '-U', user], { stdio: 'ignore', windowsHide: true }).status === 0) { ready = true; break; }
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      assert(ready, 'OWN_QA_DATABASE_NOT_READY');
      // Projection fixture only: these are the production column types used by the read query.
      fixtureSQL(`CREATE TABLE agent_runs(id uuid PRIMARY KEY,status text,workflow_key text,finished_at timestamptz);
        CREATE TABLE agent_run_stages(id uuid PRIMARY KEY,run_id uuid,status text,stage_key text,lease_token uuid,lease_until timestamptz);
        CREATE TABLE agent_runtime_outbox(id uuid PRIMARY KEY,aggregate_type text,aggregate_id uuid,event_type text,payload_json jsonb,
          status text,attempts integer,max_attempts integer,lease_token uuid,lease_until timestamptz,delivered_at timestamptz,created_at timestamptz);`);
      assert.equal(reader.sql(db, "SELECT current_setting('transaction_read_only')"), 'on');
      assert.equal(read().total, 0);
      const fixtures = [
        ...Array.from({ length: 70 }, () => event({ workflow: 'blog.project.single' })),
        ...Array.from({ length: 69 }, () => event()),
        event({ runState: 'failed', stageState: 'failed' }), event({ runState: 'running', stageState: 'queued' }),
        event({ attempts: 1 }), event({ lease: true, attempts: 1 }), event({ mismatch: true }), event({ orphan: true }),
      ];
      fixtureSQL(fixtures.join('\n'));
      const before = fingerprint(), proof = read();
      const legacy = JSON.parse(reader.sql(db, OUTBOX_WINDOW_SQL));
      assert.equal(proof.total, 145); assert.equal(proof.retainedCompleted, 70); assert.equal(proof.blocking, 75);
      assert.equal(proof.total, legacy.total); assert.equal(proof.retainedCompleted, legacy.retainedCompleted);
      assert.equal(proof.groups.find(g => g.workflowKey === 'agent.github.search' && g.runState === 'succeeded'
        && g.attempts === 0 && g.stagePresent && g.payloadRunMatches).count, 69);
      assert(proof.groups.some(g => !g.stagePresent)); assert(proof.groups.some(g => !g.payloadRunMatches && g.stagePresent));
      assert(proof.groups.some(g => g.eventLeasePresent)); assert(proof.groups.some(g => g.runState === 'running'));
      assert.equal(fingerprint(), before); assert.equal(proof.releaseWindowApproved, false);
      fixtureSQL('ALTER TABLE agent_run_stages ADD COLUMN finished_at timestamptz DEFAULT now(), ADD COLUMN leased_by text, ADD COLUMN attempt_started_at timestamptz');
      const policyRead = () => JSON.parse(reader.sql(db, WS_OUTBOX_WINDOW_SQL));
      const policyBefore = fingerprint();
      assert.deepEqual(policyRead(), { total: 145, retainedCompleted: 140 });
      assert.equal(fingerprint(), policyBefore);
      const rejected = [
        event({ workflow: 'unreviewed.workflow' }), event({ runState: 'uncertain' }),
        event({ stageState: 'failed' }),
      ];
      for (const change of ["stage_key='unreviewed'", 'finished_at=NULL',
        "lease_token=id,lease_until=now(),leased_by='fixture'", 'attempt_started_at=now()',
        "finished_at=now()+interval '1 day'"]) {
        rejected.push(event() + `UPDATE agent_run_stages SET ${change} WHERE id='${uuid(sequence)}';`);
      }
      rejected.push(event() + `UPDATE agent_runs SET finished_at=NULL WHERE id='${uuid(sequence)}';`);
      rejected.push(event() + `UPDATE agent_runtime_outbox SET event_type='run.available' WHERE id='${uuid(sequence)}';`);
      rejected.push(event() + `UPDATE agent_runtime_outbox SET delivered_at=now() WHERE id='${uuid(sequence)}';`);
      fixtureSQL(rejected.join('\n'));
      const rejectedBefore = fingerprint(), rejectedProof = policyRead();
      assert.equal(rejectedProof.total, 156); assert.equal(rejectedProof.retainedCompleted, 140);
      assert.equal(fingerprint(), rejectedBefore);
      fixtureSQL(Array.from({ length: 81 }, (_, i) => event({ workflow: 'qa.fixture-' + i })).join('\n'));
      const truncatedBefore = fingerprint(), truncated = read();
      assert.equal(truncated.total, 237); assert.equal(truncated.groups.length, 80);
      assert.equal(truncated.groupsTruncated, true); assert.equal(truncated.retainedCompleted, 70);
      assert.equal(fingerprint(), truncatedBefore);
    } finally {
      if (created) {
        const container = JSON.parse(docker(['inspect', name]))[0];
        assert.equal(container.Config.Labels[label], owner, 'OWN_QA_CONTAINER_REQUIRED');
        docker(['rm', '-f', name]);
      }
    }
  });
