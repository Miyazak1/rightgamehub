// QQ gateway-only update: retain proven terminal stage notifications unchanged.
// This is not a dispatch, replay, cleanup, or general runtime cutover policy.
export const WS_OUTBOX_RETAINED_PREDICATE = `COALESCE(
  o.aggregate_type='stage' AND o.event_type='stage.available'
  AND o.status='pending' AND o.attempts=0 AND o.delivered_at IS NULL
  AND o.lease_until IS NULL AND o.lease_token IS NULL
  AND s.finished_at IS NOT NULL AND s.finished_at<=now()
  AND s.lease_until IS NULL AND s.lease_token IS NULL AND s.leased_by IS NULL
  AND s.attempt_started_at IS NULL
  AND r.finished_at IS NOT NULL AND r.finished_at<=now()
  AND o.payload_json->>'stageId'=s.id::text
  AND o.payload_json->>'runId'=r.id::text
  AND o.payload_json->>'stageKey'=s.stage_key
  AND (
    (r.workflow_key IN ('blog.project.discovery-shadow','blog.project.single')
      AND s.status='succeeded' AND r.status='succeeded')
    OR (r.workflow_key='agent.conversation.turn' AND s.stage_key='respond'
      AND s.status='succeeded' AND r.status='succeeded')
    OR (r.workflow_key='agent.github.search' AND s.stage_key IN ('plan','search','gather','verify')
      AND s.status IN ('succeeded','failed') AND r.status IN ('succeeded','failed')
      AND (r.status='failed' OR s.status='succeeded'))
  ),false)`;

export const WS_OUTBOX_WINDOW_SQL = `SELECT json_build_object('total',count(*),'retainedCompleted',count(*) FILTER (WHERE ${WS_OUTBOX_RETAINED_PREDICATE})) FROM agent_runtime_outbox o LEFT JOIN agent_run_stages s ON o.aggregate_type='stage' AND s.id=o.aggregate_id LEFT JOIN agent_runs r ON r.id=s.run_id WHERE o.status<>'delivered'`;
