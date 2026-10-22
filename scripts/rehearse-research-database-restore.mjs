import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createDatabase } from '../apps/api/src/database.mjs';

// A restore rehearsal must never point at a remote or production database. It
// creates a new randomly named database and deliberately does not overwrite,
// clean or drop either database.
const sourceUrl = new URL(process.env.GAMEHUB_RESEARCH_DATABASE_URL ?? 'http://missing');
const container = process.env.GAMEHUB_REHEARSAL_CONTAINER;
const source = sourceUrl.pathname.slice(1);
const user = decodeURIComponent(sourceUrl.username);
if (!['postgres:', 'postgresql:'].includes(sourceUrl.protocol)
  || !['127.0.0.1', 'localhost'].includes(sourceUrl.hostname)
  || !/^gamehub_[a-z0-9_]+_test$/.test(source)
  || !/^gamehub-[a-z0-9-]+-test$/.test(container ?? '')
  || !/^gamehub_[a-z0-9_]+$/.test(user)) {
  throw new Error('Use an explicit dedicated loopback gamehub_*_test database and gamehub-*-test container.');
}

const root = path.resolve(import.meta.dirname, '..', '.runtime', 'research-restore-rehearsals');
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '') + '_' + crypto.randomBytes(3).toString('hex');
const target = 'gamehub_research_restore_' + stamp + '_test';
const directory = path.join(root, stamp);
const artifact = path.join(directory, 'database.dump');
const dump = '/tmp/' + target + '.dump';
await fs.mkdir(directory, { recursive: true, mode: 0o700 });

const docker = args => execFileSync('docker', args, {
  windowsHide: true,
  encoding: 'utf8',
  maxBuffer: 8 * 1024 * 1024,
  stdio: ['ignore', 'pipe', 'pipe'],
});
const inspect = JSON.parse(docker(['inspect', container]))[0];
const mapped = inspect.NetworkSettings.Ports['5432/tcp'] ?? [];
if (!mapped.some(item => item.HostPort === (sourceUrl.port || '5432') && ['127.0.0.1', '::1'].includes(item.HostIp))) {
  throw new Error('Container is not the specified loopback database endpoint.');
}

const sourceDb = createDatabase({ databaseUrl: sourceUrl.href, databaseSsl: false });
const targetUrl = new URL(sourceUrl);
targetUrl.pathname = '/' + target;
const targetDb = createDatabase({ databaseUrl: targetUrl.href, databaseSsl: false });
const snapshot = await sourceDb.pool.connect();

const digestRows = rows => crypto.createHash('sha256').update(rows.map(row => JSON.stringify(row)).join('\n')).digest('hex');
const researchFingerprint = async client => {
  await client.query("SET TIME ZONE 'UTC'");
  const names = (await client.query(`SELECT tablename FROM pg_tables
    WHERE schemaname='public' AND (tablename LIKE 'tool_research_%' OR tablename='schema_migrations')
    ORDER BY tablename`)).rows.map(row => row.tablename);
  const tables = [];
  for (const name of names) {
    if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error('Unexpected table name.');
    const rows = (await client.query(`SELECT encode(sha256(convert_to(row_to_json(t)::text,'UTF8')),'hex') AS digest
      FROM "${name}" t ORDER BY digest`)).rows;
    tables.push({
      name,
      rows: rows.length,
      sha256: crypto.createHash('sha256').update(rows.map(row => row.digest).join('\n')).digest('hex'),
    });
  }
  const columns = (await client.query(`SELECT table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name LIKE 'tool_research_%'
    ORDER BY table_name,ordinal_position`)).rows;
  const constraints = (await client.query(`SELECT c.relname AS table_name,k.conname AS name,pg_get_constraintdef(k.oid,true) AS definition
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname LIKE 'tool_research_%'
    ORDER BY c.relname,k.conname`)).rows;
  const indexes = (await client.query(`SELECT tablename,indexname,indexdef FROM pg_indexes
    WHERE schemaname='public' AND tablename LIKE 'tool_research_%' ORDER BY tablename,indexname`)).rows;
  const triggers = (await client.query(`SELECT c.relname AS table_name,t.tgname AS name,pg_get_triggerdef(t.oid,true) AS definition
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname LIKE 'tool_research_%' AND NOT t.tgisinternal
    ORDER BY c.relname,t.tgname`)).rows;
  return {
    tables,
    schema: {
      columns: { count: columns.length, sha256: digestRows(columns) },
      constraints: { count: constraints.length, sha256: digestRows(constraints) },
      indexes: { count: indexes.length, sha256: digestRows(indexes) },
      triggers: { count: triggers.length, sha256: digestRows(triggers) },
    },
  };
};

const invariantQuery = `SELECT
  (SELECT count(*)::int FROM tool_research_topics t LEFT JOIN tool_research_topic_contracts c
    ON c.topic_id=t.id AND c.version=t.current_contract_version WHERE c.topic_id IS NULL) AS missing_current_contracts,
  (SELECT count(*)::int FROM tool_research_runs r LEFT JOIN tool_research_topic_contracts c
    ON c.topic_id=r.topic_id AND c.version=r.contract_version WHERE c.topic_id IS NULL) AS missing_run_contracts,
  (SELECT count(*)::int FROM tool_research_provider_billing_reconciliations b JOIN tool_research_topics t ON t.id=b.topic_id
    WHERE b.user_id<>t.user_id) AS cross_account_billing_snapshots,
  (SELECT count(*)::int FROM tool_research_provider_billing_reviews v JOIN tool_research_provider_billing_reconciliations b ON b.id=v.reconciliation_id
    WHERE v.actor_user_id<>b.user_id) AS cross_account_billing_reviews,
  (SELECT count(*)::int FROM tool_research_claims c LEFT JOIN tool_research_claim_revisions r
    ON r.claim_id=c.id AND r.revision=c.current_revision WHERE r.claim_id IS NULL) AS missing_current_claim_revisions`;

const started = Date.now();
let sourceFingerprint;
try {
  await snapshot.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const token = (await snapshot.query('SELECT pg_export_snapshot() AS token')).rows[0].token;
  sourceFingerprint = await researchFingerprint(snapshot);
  const migration = sourceFingerprint.tables.find(item => item.name === 'schema_migrations');
  const billing = sourceFingerprint.tables.find(item => item.name === 'tool_research_provider_billing_reconciliations');
  if (!migration || !billing) throw new Error('Apply all current migrations to the test source first.');
  docker(['exec', container, 'pg_dump', '-U', user, '-d', source, '--format=custom', '--snapshot=' + token, '--file=' + dump]);
  await snapshot.query('COMMIT');
  docker(['cp', container + ':' + dump, artifact]);
  await fs.chmod(artifact, 0o600);
  const backupMs = Date.now() - started;
  const backupSha256 = crypto.createHash('sha256').update(await fs.readFile(artifact)).digest('hex');
  docker(['exec', container, 'pg_restore', '--list', dump]);

  // createdb fails on collision; no clean/drop/overwrite path exists in this tool.
  docker(['exec', container, 'createdb', '-U', user, target]);
  const restoreStarted = Date.now();
  const restoreDump = '/tmp/' + target + '-from-backup.dump';
  docker(['cp', artifact, container + ':' + restoreDump]);
  if (docker(['exec', container, 'sha256sum', restoreDump]).split(/\s/)[0] !== backupSha256) {
    throw new Error('Copied backup digest mismatch.');
  }
  docker(['exec', container, 'pg_restore', '-U', user, '--dbname=' + target, '--exit-on-error', restoreDump]);
  const restoreMs = Date.now() - restoreStarted;
  const client = await targetDb.pool.connect();
  let restoredFingerprint;
  let invariants;
  try {
    restoredFingerprint = await researchFingerprint(client);
    invariants = (await client.query(invariantQuery)).rows[0];
  } finally {
    client.release();
  }
  if (JSON.stringify(sourceFingerprint) !== JSON.stringify(restoredFingerprint)) {
    throw new Error('Restored research row or schema fingerprints differ from the source snapshot.');
  }
  if (Object.values(invariants).some(value => value !== 0)) {
    throw new Error('Restored research invariants failed: ' + JSON.stringify(invariants));
  }
  const report = {
    verified: true,
    scope: 'research-ledger',
    at: new Date().toISOString(),
    sourceDatabase: source,
    restoredDatabase: target,
    backupSha256,
    backupBytes: (await fs.stat(artifact)).size,
    backupMs,
    restoreMs,
    totalMs: Date.now() - started,
    invariants,
    schema: restoredFingerprint.schema,
    tables: restoredFingerprint.tables,
    limitations: [
      'This local rehearsal does not prove offsite retention, production disk throughput, RPO or RTO.',
      'The restored database is intentionally retained for explicit operator inspection and cleanup.',
    ],
  };
  await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  await fs.writeFile(path.join(directory, 'SHA256SUMS'), backupSha256 + '  database.dump\n', { mode: 0o600 });
  console.log(JSON.stringify({ ...report, artifact, reportPath: path.join(directory, 'report.json') }, null, 2));
} catch (error) {
  await snapshot.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  snapshot.release();
  await sourceDb.close();
  await targetDb.close();
}
