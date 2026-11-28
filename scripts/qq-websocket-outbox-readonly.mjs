// Classify the existing release gate's outbox blockers; never change its decision.
import { OUTBOX_WINDOW_SQL } from './agent-server-cutover.mjs';
import { wsWindowReadonlyCommand } from './qq-websocket-window-readonly.mjs';

export function outboxClassificationSQL(windowSQL) {
  const prefix = "SELECT json_build_object('total',count(*),'retainedCompleted',count(*) FILTER (WHERE ";
  const offset = windowSQL.indexOf(' FROM agent_runtime_outbox o');
  if (!windowSQL.startsWith(prefix) || offset < 0 || !windowSQL.slice(0, offset).endsWith('))')) {
    throw Error('EXACT_OUTBOX_GATE_REQUIRED');
  }
  const retained = windowSQL.slice(prefix.length, offset - 2);
  const source = windowSQL.slice(offset);
  if (!retained.startsWith('COALESCE(') || !retained.endsWith(',false)')
    || /;|\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO|VACUUM|ANALYZE|SET|RESET)\b/i.test(windowSQL)) {
    throw Error('EXACT_OUTBOX_GATE_REQUIRED');
  }
  return `SELECT json_build_object(
    'checkedAt',statement_timestamp(),'total',COALESCE(sum(n),0),
    'retainedCompleted',COALESCE(sum(n) FILTER (WHERE shape->>'legacyRetained'='true'),0),
    'blocking',COALESCE(sum(n) FILTER (WHERE shape->>'legacyRetained'='false'),0),
    'classificationGroups',count(*),'groupsTruncated',count(*)>80,
    'groups',COALESCE(jsonb_agg(shape||jsonb_build_object('count',n,'oldestCreatedAt',oldest,'newestCreatedAt',newest) ORDER BY rank) FILTER (WHERE rank<=80),'[]'::jsonb))
  FROM (SELECT grouped.*,row_number() OVER (ORDER BY shape->>'legacyRetained',n DESC,shape::text) AS rank
    FROM (SELECT shape,count(*) AS n,min(created_at) AS oldest,max(created_at) AS newest
      FROM (SELECT o.created_at,jsonb_build_object(
        'legacyRetained',${retained},
        'aggregateType',o.aggregate_type,'eventType',o.event_type,'eventState',o.status,
        'attempts',o.attempts,'maxAttempts',o.max_attempts,
        'eventLeasePresent',o.lease_token IS NOT NULL OR o.lease_until IS NOT NULL,
        'deliveredAtPresent',o.delivered_at IS NOT NULL,
        'stagePresent',s.id IS NOT NULL,'stageState',s.status,'stageKey',s.stage_key,
        'stageLeasePresent',s.lease_token IS NOT NULL OR s.lease_until IS NOT NULL,
        'runPresent',r.id IS NOT NULL,'runState',r.status,'workflowKey',r.workflow_key,
        'runFinished',r.finished_at IS NOT NULL,
        'legacyWorkflow',COALESCE(r.workflow_key IN ('blog.project.discovery-shadow','blog.project.single'),false),
        'payloadStageMatches',COALESCE(o.payload_json->>'stageId'=s.id::text,false),
        'payloadRunMatches',COALESCE(o.payload_json->>'runId'=r.id::text,false),
        'payloadStageKeyMatches',COALESCE(o.payload_json->>'stageKey'=s.stage_key,false)) AS shape
        ${source}) classified GROUP BY shape) grouped) ranked`;
}

export function collectOutboxClassification(reader, database, windowSQL, emit = console.log) {
  const proof = JSON.parse(reader.sql(database, outboxClassificationSQL(windowSQL)));
  const validCount = n => Number.isSafeInteger(n) && n >= 0;
  if (!proof || typeof proof !== 'object'
    || ![proof.total, proof.retainedCompleted, proof.blocking, proof.classificationGroups].every(validCount)
    || proof.total !== proof.retainedCompleted + proof.blocking
    || !Array.isArray(proof.groups) || proof.groups.length > 80
    || proof.groupsTruncated !== (proof.classificationGroups > 80)
    || proof.groups.length !== Math.min(proof.classificationGroups, 80)
    || proof.groups.some(g => !validCount(g.count) || g.count === 0 || typeof g.legacyRetained !== 'boolean')
    || (!proof.groupsTruncated && (proof.groups.reduce((sum, g) => sum + g.count, 0) !== proof.total
      || proof.groups.filter(g => g.legacyRetained).reduce((sum, g) => sum + g.count, 0) !== proof.retainedCompleted))) {
    throw Error('INVALID_OUTBOX_CLASSIFICATION');
  }
  emit(JSON.stringify({ section: 'outboxSummary', ...Object.fromEntries(Object.entries(proof).filter(([key]) => key !== 'groups')) }));
  for (const group of proof.groups) emit(JSON.stringify({ section: 'outboxGroup', ...group }));
  const result = {
    result: 'QQ_WEBSOCKET_OUTBOX_CLASSIFICATION_READONLY_COMPLETE',
    atomicOutboxSnapshot: true, releaseGateChanged: false, releaseWindowApproved: false,
    eventsModified: false, eventsDispatched: false, tasksRetried: false,
    servicesRestarted: false, configurationWritten: false, locksModified: false,
    qqLoginOrQrRequested: false, rawMessagesOrCredentialsPrinted: false,
  };
  emit(JSON.stringify(result));
  return { ...proof, ...result };
}

export function wsOutboxReadonlyCommand() {
  const command = wsWindowReadonlyCommand();
  const start = command.indexOf('function collectWSWindow(');
  const end = command.lastIndexOf('\nNODE\n');
  if (start < 0 || end < start) throw Error('EXACT_WINDOW_COMMAND_REQUIRED');
  return command.slice(0, start) + outboxClassificationSQL.toString() + '\n'
    + collectOutboxClassification.toString()
    + "\ntry { collectOutboxClassification(reader,databases.api,OUTBOX_WINDOW_SQL); }"
    + "\ncatch(e) { console.log(JSON.stringify({result:'QQ_WEBSOCKET_OUTBOX_CLASSIFICATION_READ_FAILED',code:/^[A-Z0-9_]+$/.test(e.message??'')?e.message:'READ_FAILED',eventsModified:false,servicesRestarted:false,tasksRetried:false}));process.exitCode=1; }"
    + command.slice(end);
}

export const CURRENT_OUTBOX_CLASSIFICATION_SQL = outboxClassificationSQL(OUTBOX_WINDOW_SQL);
