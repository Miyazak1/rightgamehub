import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createDatabase } from '../apps/api/src/database.mjs';
import { migrationStatus } from '../apps/api/src/migrations.mjs';
import { PostgresResearchTopicRepository, createResearchTopicService } from '../apps/api/src/research-topic-service.mjs';
import { summary } from './save-mixed-load-support.mjs';
import { evaluateResearchCapacity } from './research-capacity-gate.mjs';

const flags = new Set(process.argv.slice(2));
if ([...flags].some(flag => flag !== '--smoke')) throw new Error('UNKNOWN_ARGUMENT');
const smoke = flags.has('--smoke');
const databaseUrl = new URL(process.env.GAMEHUB_RESEARCH_DATABASE_URL ?? 'http://missing');
if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)
  || !['127.0.0.1', 'localhost'].includes(databaseUrl.hostname)
  || !/^gamehub_[a-z0-9_]+_test$/.test(databaseUrl.pathname.slice(1))) {
  throw new Error('Use an explicit dedicated loopback gamehub_*_test database.');
}

const root = path.resolve(import.meta.dirname, '..');
const runId = new Date().toISOString().replace(/[-:.TZ]/g, '') + '_' + crypto.randomBytes(3).toString('hex');
const output = path.join(root, '.runtime', 'research-capacity', runId);
await fs.mkdir(output, { recursive: true, mode: 0o700 });
const target = smoke
  ? { accounts: 2, topicsPerAccount: 3, runsPerTopic: 5, eventsPerRun: 4 }
  : { accounts: 10, topicsPerAccount: 10, runsPerTopic: 90, eventsPerRun: 5 };
target.topics = target.accounts * target.topicsPerAccount;
target.runs = target.topics * target.runsPerTopic;
target.sourceVersions = target.runs;
target.events = target.runs * target.eventsPerRun;
target.evidence = target.events;
const thresholds = {
  listTopicsP95Ms: 150,
  listRunsP95Ms: 150,
  listEvidenceP95Ms: 250,
  operationsSummaryP95Ms: 350,
  storageAssessmentP95Ms: 500,
  schedulerClaimP95Ms: 250,
  maxGrowthBytes: smoke ? 64 * 1024 * 1024 : 512 * 1024 * 1024,
};
const report = {
  schemaVersion: 1,
  at: new Date().toISOString(),
  smoke,
  productionReady: false,
  target,
  thresholds,
  coverage: ['PostgreSQL research ledger growth', 'topic/run/evidence/storage-assessment read latency', 'fair scheduler claim and completion', 'account isolation', 'referential integrity'],
  excluded: ['API/TLS latency', 'external Search/Fetch/Researcher calls', 'production disk and network', 'concurrent backup', '14-day soak', 'offsite object storage'],
  errors: [],
};
const database = createDatabase({ databaseUrl: databaseUrl.href, databaseSsl: false });
const pool = database.pool;
const uuid = () => crypto.randomUUID();
const digest = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const contract = { questions: ['fixture'], methods: ['trend-v1'], sourcePolicy: { allowedTypes: ['http'], minAuthorityTier: 'unknown', requirePrimaryForCritical: true }, schedule: { cadence: 'manual', timezone: 'UTC' }, budget: { maxSearchQueriesPerRun: 0, maxDocumentsPerRun: 20, maxDeepResearchJobsPerRun: 0, maxBillableRequestsPerMonth: 0, maxProviderCostUsdMicrosPerMonth: 0 }, notifications: { minimumImportance: 'important' }, reviewPolicy: { maxAcceptedAgeDays: 30 }, retention: { sourceVersionsDays: 365 } };
const insertRows = async (client, table, columns, rows, batchSize = 250) => {
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize), values = [];
    const placeholders = batch.map(row => '(' + row.map(value => { values.push(value); return '$' + values.length; }).join(',') + ')').join(',');
    await client.query(`INSERT INTO ${table}(${columns.join(',')}) VALUES ${placeholders}`, values);
  }
};
const timed = async (samples, action) => {
  const start = performance.now();
  const value = await action();
  samples.push(performance.now() - start);
  return value;
};

try {
  const migrations = await migrationStatus(pool, path.join(root, 'apps/api/migrations'));
  report.migrations = migrations;
  if (!migrations.ready || migrations.expected !== 104) throw new Error('Apply all 104 migrations before running the capacity harness.');
  const existingFixture = Number((await pool.query(`SELECT count(*) FROM tool_research_topics WHERE title LIKE 'Capacity %'`)).rows[0].count);
  if (existingFixture !== 0) throw new Error('Use a fresh dedicated test database; a prior capacity fixture is present.');
  const beforeBytes = Number((await pool.query('SELECT pg_database_size(current_database())::text AS bytes')).rows[0].bytes);
  const client = await pool.connect();
  const actors = [], topics = [];
  try {
    await client.query('BEGIN');
    for (let accountIndex = 0; accountIndex < target.accounts; accountIndex += 1) {
      const userId = uuid(); actors.push({ userId });
      await client.query('INSERT INTO users(id,display_name) VALUES($1,$2)', [userId, `research-capacity-${runId}-${accountIndex}`]);
      for (let topicIndex = 0; topicIndex < target.topicsPerAccount; topicIndex += 1) {
        const topicId = uuid(), sourceId = uuid();
        topics.push({ id: topicId, userId, sourceId, accountIndex, topicIndex });
        await client.query(`INSERT INTO tool_research_topics(id,user_id,title,objective,status,current_contract_version,created_at,updated_at)
          VALUES($1,$2,$3,$4,'active',1,now()-interval '90 days',now())`, [topicId, userId, `Capacity ${accountIndex}-${topicIndex}`, 'Synthetic local capacity fixture; never a production research result.']);
        await client.query(`INSERT INTO tool_research_topic_contracts(topic_id,version,contract_json,content_sha256,created_at)
          VALUES($1,1,$2,$3,now()-interval '90 days')`, [topicId, contract, digest(JSON.stringify(contract))]);
        await client.query(`INSERT INTO tool_research_sources(id,user_id,canonical_url,source_type,publisher,authority_tier,status)
          VALUES($1,$2,$3,'http','Synthetic fixture','unknown','tracked')`, [sourceId, userId, `https://capacity.invalid/${runId}/${accountIndex}/${topicIndex}`]);
        await client.query(`INSERT INTO tool_research_topic_sources(topic_id,source_id,added_reason,added_by,pinned,status)
          VALUES($1,$2,'Synthetic local capacity fixture','import',false,'tracked')`, [topicId, sourceId]);
      }
    }
    const runs = [], versions = [], evidence = [], events = [], eventEvidence = [];
    for (const topic of topics) for (let runIndex = 0; runIndex < target.runsPerTopic; runIndex += 1) {
      const id = uuid(), versionId = uuid(), ageDays = target.runsPerTopic - 1 - runIndex;
      runs.push([id, topic.id, 1, 'scheduled', 'completed', '{}', new Date(Date.now() - ageDays * 86400000), new Date(Date.now() - ageDays * 86400000)]);
      versions.push([versionId, topic.sourceId, new Date(Date.now() - ageDays * 86400000), digest(`${topic.id}:version:${runIndex}`), digest(`${topic.id}:normalized:${runIndex}`), JSON.stringify({ kind: 'web-page', fixture: true }), 'text/plain', JSON.stringify({ protocol: 'capacity-fixture-v1' })]);
      for (let eventIndex = 0; eventIndex < target.eventsPerRun; eventIndex += 1) {
        const evidenceId = uuid(), eventId = uuid(), quote = `Synthetic evidence ${topic.id} ${runIndex} ${eventIndex}`;
        evidence.push([evidenceId, versionId, JSON.stringify({ kind: 'fixture', index: eventIndex }), quote, digest(quote), 'structured-fact']);
        events.push([eventId, topic.id, versionId, `fixture-${eventIndex}`, digest(`${topic.id}:${runIndex}:${eventIndex}`), `Synthetic event ${runIndex}-${eventIndex}`, new Date(Date.now() - ageDays * 86400000), 'routine', 0.5, 'candidate', id]);
        eventEvidence.push([eventId, evidenceId, 'supports']);
      }
    }
    await insertRows(client, 'tool_research_runs', ['id','topic_id','contract_version','trigger_kind','status','result_summary','window_start_at','created_at'], runs);
    await insertRows(client, 'tool_research_source_versions', ['id','source_id','fetched_at','content_hash','normalized_hash','locator','content_type','fetch_receipt'], versions);
    await insertRows(client, 'tool_research_evidence', ['id','source_version_id','locator','quote_text','quote_hash','evidence_kind'], evidence);
    await insertRows(client, 'tool_research_events', ['id','topic_id','origin_version_id','event_type','external_key','title','detected_at','importance','confidence','status','run_id'], events);
    await insertRows(client, 'tool_research_event_evidence', ['event_id','evidence_id','stance'], eventEvidence);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }

  const repository = new PostgresResearchTopicRepository(pool, { providerPrices: {}, monthlyBudget: {} });
  const service = createResearchTopicService({ repository, maxActiveRunsPerAccount: 1, maxActiveRunsGlobal: target.accounts });
  const sampleCount = smoke ? 6 : 100;
  const latency = { listTopics: [], listRuns: [], listEvidence: [], operationsSummary: [], storageAssessment: [], schedulerClaim: [] };
  for (let index = 0; index < sampleCount; index += 1) {
    const topic = topics[index % topics.length], actor = { userId: topic.userId };
    const listed = await timed(latency.listTopics, () => service.list(actor));
    if (listed.length !== target.topicsPerAccount) throw new Error('Account topic list cardinality changed.');
    await timed(latency.listRuns, () => service.listRuns(actor, topic.id, { limit: 30 }));
    await timed(latency.listEvidence, () => service.listEvidence(actor, topic.id, { limit: 50 }));
    await timed(latency.operationsSummary, () => service.getOperationsSummary(actor, topic.id, { days: 365 }));
    const storageAssessment = await timed(latency.storageAssessment, () => service.getStorageAssessment(actor, topic.id));
    if (storageAssessment.inventory.versions !== target.runsPerTopic || storageAssessment.retention.previewOnly !== true) throw new Error('Storage assessment cardinality or safety contract changed.');
  }
  for (const topic of topics) await repository.enqueueManual(topic.userId, topic.id, uuid());
  let completed = 0;
  for (;;) {
    const run = await timed(latency.schedulerClaim, () => repository.claimQueued('research-capacity-' + runId, 120, 1, target.accounts));
    if (!run) break;
    await repository.completeRun(run.id, 'research-capacity-' + runId, { status: 'no_change', resultSummary: { schemaVersion: 'radar-observation-v1' } });
    completed += 1;
  }
  const afterBytes = Number((await pool.query('SELECT pg_database_size(current_database())::text AS bytes')).rows[0].bytes);
  const counts = (await pool.query(`SELECT
    (SELECT count(*)::int FROM tool_research_topics WHERE title LIKE 'Capacity %') AS topics,
    (SELECT count(*)::int FROM tool_research_runs r JOIN tool_research_topics t ON t.id=r.topic_id WHERE t.title LIKE 'Capacity %' AND r.trigger_kind='scheduled') AS runs,
    (SELECT count(*)::int FROM tool_research_source_versions v JOIN tool_research_sources s ON s.id=v.source_id WHERE s.publisher='Synthetic fixture') AS source_versions,
    (SELECT count(*)::int FROM tool_research_events e JOIN tool_research_topics t ON t.id=e.topic_id WHERE t.title LIKE 'Capacity %') AS events,
    (SELECT count(*)::int FROM tool_research_evidence e JOIN tool_research_source_versions v ON v.id=e.source_version_id JOIN tool_research_sources s ON s.id=v.source_id WHERE s.publisher='Synthetic fixture') AS evidence`)).rows[0];
  report.actual = {
    accounts: actors.length,
    topics: Number(counts.topics),
    runs: Number(counts.runs),
    sourceVersions: Number(counts.source_versions),
    events: Number(counts.events),
    evidence: Number(counts.evidence),
  };
  report.latency = Object.fromEntries(Object.entries(latency).map(([key, values]) => [key, summary(values)]));
  report.scheduler = { queued: topics.length, completed, remaining: Number((await pool.query(`SELECT count(*) FROM tool_research_runs r JOIN tool_research_topics t ON t.id=r.topic_id WHERE t.title LIKE 'Capacity %' AND r.status='queued'`)).rows[0].count) };
  const otherActor = actors[1] ?? { userId: uuid() }, firstTopic = topics[0];
  report.invariants = {
    crossAccountVisibleTopics: (await service.list(otherActor)).filter(item => item.id === firstTopic.id).length,
    crossAccountEvidence: await service.listEvidence(otherActor, firstTopic.id, { limit: 1 }).then(() => 1, error => error?.code === 'RESEARCH_TOPIC_NOT_FOUND' ? 0 : 1),
    orphanContracts: Number((await pool.query(`SELECT count(*) FROM tool_research_topics t LEFT JOIN tool_research_topic_contracts c ON c.topic_id=t.id AND c.version=t.current_contract_version WHERE t.title LIKE 'Capacity %' AND c.topic_id IS NULL`)).rows[0].count),
    orphanEvents: Number((await pool.query(`SELECT count(*) FROM tool_research_events e LEFT JOIN tool_research_source_versions v ON v.id=e.origin_version_id LEFT JOIN tool_research_runs r ON r.id=e.run_id WHERE (v.id IS NULL OR r.id IS NULL) AND e.title LIKE 'Synthetic event %'`)).rows[0].count),
    orphanEvidenceLinks: Number((await pool.query(`SELECT count(*) FROM tool_research_event_evidence ee LEFT JOIN tool_research_events e ON e.id=ee.event_id LEFT JOIN tool_research_evidence v ON v.id=ee.evidence_id WHERE e.id IS NULL OR v.id IS NULL`)).rows[0].count),
    externalActions: Number((await pool.query(`SELECT count(*) FROM tool_research_run_actions a JOIN tool_research_runs r ON r.id=a.run_id JOIN tool_research_topics t ON t.id=r.topic_id WHERE t.title LIKE 'Capacity %'`)).rows[0].count),
  };
  report.storage = { beforeBytes, afterBytes, growthBytes: afterBytes - beforeBytes, bytesPerEvent: target.events ? Math.round((afterBytes - beforeBytes) / target.events) : null };
  Object.assign(report, evaluateResearchCapacity(report));
  if (!report.localGatePassed) process.exitCode = 1;
} catch (error) {
  report.errors.push(String(error?.code || error?.message || error));
  report.localGatePassed = false;
  report.qualification = 'failed';
  process.exitCode = 1;
} finally {
  await database.close();
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  process.stdout.write(JSON.stringify({ event: 'result', localGatePassed: report.localGatePassed, productionReady: false, qualification: report.qualification, report: path.join(output, 'report.json') }) + '\n');
}
