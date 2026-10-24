import { AgentAccountError } from './agent-account-repository.mjs';

const fail = code => { throw new AgentAccountError(code); };
const uuid = value => {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value)) fail('AGENT_INPUT');
  return value;
};
const iso = value => value?.toISOString?.() ?? value ?? null;

export function createAgentRuntimeReadService({ pool, authorizeOperator }) {
  if (!pool || typeof authorizeOperator !== 'function') fail('AGENT_OPERATOR_PORT_REQUIRED');
  const scope = async (actor, agentUserId) => {
    const operatorId = uuid(actor?.userId);
    if (await authorizeOperator(structuredClone(actor)) !== true) fail('AGENT_OPERATOR_REQUIRED');
    const row = (await pool.query('SELECT user_id FROM agent_accounts WHERE user_id=$1 AND operator_user_id=$2', [uuid(agentUserId), operatorId])).rows[0];
    if (!row) fail('AGENT_NOT_FOUND');
    return row.user_id;
  };
  return {
    async listRuns(actor, agentUserId, limit = 30) {
      agentUserId = await scope(actor, agentUserId);
      limit = Math.min(100, Math.max(1, Number(limit) || 30));
      const rows = (await pool.query(`SELECT r.*,
          count(DISTINCT s.id)::int AS stage_count,
          count(DISTINCT s.id) FILTER (WHERE s.status IN ('succeeded','skipped'))::int AS completed_stage_count,
          count(DISTINCT a.id)::int AS action_count
        FROM agent_runs r LEFT JOIN agent_run_stages s ON s.run_id=r.id
        LEFT JOIN agent_run_actions a ON a.run_id=r.id
        WHERE r.agent_user_id=$1 GROUP BY r.id ORDER BY r.created_at DESC,r.id DESC LIMIT $2`, [agentUserId, limit])).rows;
      return rows.map(row => ({
        id: row.id, workflowKey: row.workflow_key, workflowVersion: row.workflow_version,
        triggerKind: row.trigger_kind, status: row.status, stageCount: row.stage_count,
        completedStageCount: row.completed_stage_count, actionCount: row.action_count,
        outputType: row.output_type, outputId: row.output_id, errorCode: row.error_code,
        queuedAt: iso(row.queued_at), startedAt: iso(row.started_at), finishedAt: iso(row.finished_at),
      }));
    },
    async timeline(actor, agentUserId, runId) {
      agentUserId = await scope(actor, agentUserId);
      runId = uuid(runId);
      const run = (await pool.query('SELECT * FROM agent_runs WHERE id=$1 AND agent_user_id=$2', [runId, agentUserId])).rows[0];
      if (!run) fail('AGENT_NOT_FOUND');
      const [stages, actions, events, reservations, providerCalls, toolCalls, toolArtifacts] = await Promise.all([
        pool.query('SELECT * FROM agent_run_stages WHERE run_id=$1 ORDER BY ordinal,id', [runId]),
        pool.query('SELECT * FROM agent_run_actions WHERE run_id=$1 ORDER BY created_at,id', [runId]),
        pool.query('SELECT * FROM agent_run_events WHERE run_id=$1 ORDER BY id', [runId]),
        pool.query('SELECT * FROM agent_budget_reservations WHERE run_id=$1 ORDER BY reserved_at,id', [runId]),
        pool.query(`SELECT call.* FROM agent_provider_calls call JOIN agent_run_actions action ON action.id=call.action_id
          WHERE action.run_id=$1 ORDER BY call.created_at,call.id`, [runId]),
        pool.query(`SELECT call.* FROM agent_tool_calls call JOIN agent_run_actions action ON action.id=call.action_id
          WHERE action.run_id=$1 ORDER BY call.created_at,call.id`, [runId]),
        pool.query(`SELECT artifact.id,artifact.tool_call_id,artifact.action_id,artifact.media_type,
            artifact.content_sha256,artifact.size_bytes,artifact.created_at
          FROM agent_tool_artifacts artifact JOIN agent_run_actions action ON action.id=artifact.action_id
          WHERE action.run_id=$1 ORDER BY artifact.created_at,artifact.id`, [runId]),
      ]);
      return {
        run: {
          id: run.id, workflowKey: run.workflow_key, workflowVersion: run.workflow_version,
          triggerKind: run.trigger_kind, status: run.status, behaviorProfileId: run.behavior_profile_id,
          policyProfileId: run.policy_profile_id, manifestSha256: run.manifest_sha256,
          outputType: run.output_type, outputId: run.output_id, errorCode: run.error_code,
          queuedAt: iso(run.queued_at), startedAt: iso(run.started_at), finishedAt: iso(run.finished_at),
        },
        stages: stages.rows.map(row => ({
          id: row.id, stageKey: row.stage_key, kind: row.kind, status: row.status,
          attempt: row.attempt, maxAttempts: row.max_attempts, leasedBy: row.leased_by,
          leaseUntil: iso(row.lease_until), errorCode: row.error_code,
          startedAt: iso(row.started_at), finishedAt: iso(row.finished_at),
        })),
        actions: actions.rows.map(row => ({
          id: row.id, stageId: row.stage_id, actionKey: row.action_key, actionKind: row.action_kind,
          capabilityKey: row.capability_key, riskLevel: row.risk_level, status: row.status,
          providerRequestId: row.provider_request_id, errorCode: row.error_code,
          preparedAt: iso(row.prepared_at), sentAt: iso(row.sent_at), acknowledgedAt: iso(row.acknowledged_at), finishedAt: iso(row.finished_at),
        })),
        events: events.rows.map(row => ({
          id: String(row.id), stageId: row.stage_id, actionId: row.action_id,
          eventType: row.event_type, actorKind: row.actor_kind, actorRef: row.actor_ref,
          payload: row.payload_json, createdAt: iso(row.created_at),
        })),
        budgetReservations: reservations.rows.map(row => ({
          id: row.id, actionId: row.action_id, provider: row.provider, modelId: row.model_id, status: row.status,
          reserved: { providerCalls: row.reserved_provider_calls, inputTokens: row.reserved_input_tokens,
            outputTokens: row.reserved_output_tokens, costMicrousd: Number(row.reserved_cost_microusd) },
          charged: { providerCalls: row.charged_provider_calls, inputTokens: row.charged_input_tokens,
            outputTokens: row.charged_output_tokens, costMicrousd: Number(row.charged_cost_microusd) },
          reservedAt: iso(row.reserved_at), settledAt: iso(row.settled_at), releasedAt: iso(row.released_at),
        })),
        providerCalls: providerCalls.rows.map(row => ({
          id: row.id, actionId: row.action_id, provider: row.provider, modelId: row.model_id,
          catalogVersion: row.catalog_version, status: row.status, providerRequestId: row.provider_request_id,
          usage: row.usage_json, errorCode: row.error_code, sendingAt: iso(row.sending_at),
          acknowledgedAt: iso(row.acknowledged_at), finishedAt: iso(row.finished_at),
        })),
        toolCalls: toolCalls.rows.map(row => ({
          id: row.id, actionId: row.action_id, toolKey: row.tool_key, contractVersion: row.contract_version,
          status: row.status, receiptId: row.receipt_id, responseSha256: row.response_sha256,
          usage: row.usage_json, errorCode: row.error_code, sendingAt: iso(row.sending_at),
          acknowledgedAt: iso(row.acknowledged_at), finishedAt: iso(row.finished_at),
        })),
        toolArtifacts: toolArtifacts.rows.map(row => ({
          id: row.id, toolCallId: row.tool_call_id, actionId: row.action_id, mediaType: row.media_type,
          contentSha256: row.content_sha256, sizeBytes: row.size_bytes, createdAt: iso(row.created_at),
        })),
      };
    },
  };
}
