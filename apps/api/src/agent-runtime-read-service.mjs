import { AgentAccountError } from './agent-account-repository.mjs';
import { AGENT_BLOG_CANARY_ACCEPTANCE_POLICY } from './agent-blog-canary-acceptance.mjs';

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
    async blogOverview(actor, agentUserId) {
      agentUserId = await scope(actor, agentUserId);
      const policy = AGENT_BLOG_CANARY_ACCEPTANCE_POLICY;
      const [reports, schedule] = await Promise.all([
        pool.query(`SELECT verdict,reason_codes,created_at FROM agent_blog_canary_acceptance_reports
          WHERE agent_user_id=$1 AND policy_version=$2 ORDER BY created_at DESC,id DESC LIMIT $3`,
        [agentUserId, policy.policyVersion, policy.requiredConsecutivePasses]),
        pool.query(`SELECT id,timezone,schedule_spec_json,enabled,next_fire_at,last_fire_at,misfire_policy,
            config_json,updated_at
          FROM agent_schedules WHERE agent_user_id=$1 AND workflow_key='blog.project.discovery-shadow'
          ORDER BY updated_at DESC,id DESC LIMIT 1`, [agentUserId]),
      ]);
      let consecutivePasses = 0;
      for (const report of reports.rows) {
        if (report.verdict !== 'passed') break;
        consecutivePasses += 1;
      }
      const scheduleRow = schedule.rows[0];
      return {
        schemaVersion: 'agent-blog-foundation-overview-v1',
        acceptance: {
          policyVersion: policy.policyVersion,
          consecutivePasses,
          requiredConsecutivePasses: policy.requiredConsecutivePasses,
          readyForShadowScheduleReview: consecutivePasses >= policy.requiredConsecutivePasses,
          automaticScheduleChange: false,
          recent: reports.rows.map(row => ({ verdict: row.verdict,
            reasonCodes: row.reason_codes ?? [], createdAt: iso(row.created_at) })),
        },
        schedule: scheduleRow ? {
          id: scheduleRow.id, timezone: scheduleRow.timezone,
          spec: scheduleRow.schedule_spec_json, enabled: scheduleRow.enabled,
          nextFireAt: iso(scheduleRow.next_fire_at), lastFireAt: iso(scheduleRow.last_fire_at),
          misfirePolicy: scheduleRow.misfire_policy,
          suspendedAt: iso(scheduleRow.config_json?.suspendedAt),
          suspensionReason: scheduleRow.config_json?.suspensionReason ?? null,
          updatedAt: iso(scheduleRow.updated_at),
        } : null,
      };
    },
    async listRuns(actor, agentUserId, limit = 30) {
      agentUserId = await scope(actor, agentUserId);
      limit = Math.min(100, Math.max(1, Number(limit) || 30));
      const rows = (await pool.query(`SELECT r.*,
          (SELECT count(*)::int FROM agent_run_stages s WHERE s.run_id=r.id) AS stage_count,
          (SELECT count(*)::int FROM agent_run_stages s
            WHERE s.run_id=r.id AND s.status IN ('succeeded','skipped')) AS completed_stage_count,
          (SELECT count(*)::int FROM agent_run_actions a WHERE a.run_id=r.id) AS action_count,
          draft.article_id,draft.revision_id,draft.created_at AS draft_created_at,
          article.slug AS article_slug,article.publication_state,
          revision.title AS article_title,
          incoming.source_run_id,
          outgoing.target_run_id,
          acceptance.policy_version AS acceptance_policy_version,
          acceptance.verdict AS acceptance_verdict,
          acceptance.reason_codes AS acceptance_reason_codes,
          acceptance.created_at AS acceptance_created_at
        FROM agent_runs r
        LEFT JOIN agent_blog_foundation_drafts draft ON draft.run_id=r.id
        LEFT JOIN blog_articles article ON article.id=draft.article_id
        LEFT JOIN blog_article_revisions revision ON revision.id=draft.revision_id
        LEFT JOIN LATERAL (
          SELECT handoff.source_run_id FROM agent_run_handoffs handoff
          WHERE handoff.target_run_id=r.id ORDER BY handoff.created_at DESC,handoff.id DESC LIMIT 1
        ) incoming ON true
        LEFT JOIN LATERAL (
          SELECT handoff.target_run_id FROM agent_run_handoffs handoff
          WHERE handoff.source_run_id=r.id ORDER BY handoff.created_at DESC,handoff.id DESC LIMIT 1
        ) outgoing ON true
        LEFT JOIN LATERAL (
          SELECT report.policy_version,report.verdict,report.reason_codes,report.created_at
          FROM agent_blog_canary_acceptance_reports report WHERE report.draft_run_id=r.id
          ORDER BY report.policy_version DESC,report.created_at DESC,report.id DESC LIMIT 1
        ) acceptance ON true
        WHERE r.agent_user_id=$1 ORDER BY r.created_at DESC,r.id DESC LIMIT $2`, [agentUserId, limit])).rows;
      return rows.map(row => ({
        id: row.id, workflowKey: row.workflow_key, workflowVersion: row.workflow_version,
        triggerKind: row.trigger_kind, status: row.status, stageCount: row.stage_count,
        completedStageCount: row.completed_stage_count, actionCount: row.action_count,
        outputType: row.output_type, outputId: row.output_id, errorCode: row.error_code,
        errorMessage: row.error_message,
        sourceRunId: row.source_run_id ?? null, targetRunId: row.target_run_id ?? null,
        foundationDraft: row.article_id ? {
          articleId: row.article_id, revisionId: row.revision_id, slug: row.article_slug,
          title: row.article_title, publicationState: row.publication_state,
          createdAt: iso(row.draft_created_at),
        } : null,
        acceptance: row.acceptance_verdict ? {
          policyVersion: row.acceptance_policy_version, verdict: row.acceptance_verdict,
          reasonCodes: row.acceptance_reason_codes ?? [], createdAt: iso(row.acceptance_created_at),
        } : null,
        queuedAt: iso(row.queued_at), startedAt: iso(row.started_at), finishedAt: iso(row.finished_at),
      }));
    },
    async timeline(actor, agentUserId, runId) {
      agentUserId = await scope(actor, agentUserId);
      runId = uuid(runId);
      const run = (await pool.query('SELECT * FROM agent_runs WHERE id=$1 AND agent_user_id=$2', [runId, agentUserId])).rows[0];
      if (!run) fail('AGENT_NOT_FOUND');
      const [stages, actions, events, reservations, providerCalls, providerOutputArtifacts, toolCalls, toolArtifacts,
        stageArtifacts, foundationDrafts, incomingHandoffs, outgoingHandoffs] = await Promise.all([
        pool.query('SELECT * FROM agent_run_stages WHERE run_id=$1 ORDER BY ordinal,id', [runId]),
        pool.query('SELECT * FROM agent_run_actions WHERE run_id=$1 ORDER BY created_at,id', [runId]),
        pool.query('SELECT * FROM agent_run_events WHERE run_id=$1 ORDER BY id', [runId]),
        pool.query('SELECT * FROM agent_budget_reservations WHERE run_id=$1 ORDER BY reserved_at,id', [runId]),
        pool.query(`SELECT call.* FROM agent_provider_calls call JOIN agent_run_actions action ON action.id=call.action_id
          WHERE action.run_id=$1 ORDER BY call.created_at,call.id`, [runId]),
        pool.query(`SELECT artifact.id,artifact.provider_call_id,artifact.action_id,artifact.schema_key,
            artifact.schema_version,artifact.media_type,artifact.content_sha256,artifact.size_bytes,artifact.created_at
          FROM agent_provider_output_artifacts artifact JOIN agent_run_actions action ON action.id=artifact.action_id
          WHERE action.run_id=$1 ORDER BY artifact.created_at,artifact.id`, [runId]),
        pool.query(`SELECT call.* FROM agent_tool_calls call JOIN agent_run_actions action ON action.id=call.action_id
          WHERE action.run_id=$1 ORDER BY call.created_at,call.id`, [runId]),
        pool.query(`SELECT artifact.id,artifact.tool_call_id,artifact.action_id,artifact.media_type,
            artifact.content_sha256,artifact.size_bytes,artifact.created_at
          FROM agent_tool_artifacts artifact JOIN agent_run_actions action ON action.id=artifact.action_id
          WHERE action.run_id=$1 ORDER BY artifact.created_at,artifact.id`, [runId]),
        pool.query(`SELECT id,stage_id,action_id,artifact_key,artifact_kind,schema_key,schema_version,media_type,
            content_sha256,size_bytes,source_tool_artifact_ids,source_stage_artifact_ids,created_at
          FROM agent_runtime_stage_artifacts WHERE run_id=$1 ORDER BY created_at,id`, [runId]),
        pool.query(`SELECT draft.run_id,draft.action_id,draft.article_id,draft.revision_id,
            draft.source_artifact_ids,draft.content_sha256,draft.verification_artifact_id,
            draft.composition_artifact_id,draft.created_at,article.slug,article.publication_state,
            revision.title
          FROM agent_blog_foundation_drafts draft JOIN blog_articles article ON article.id=draft.article_id
          JOIN blog_article_revisions revision ON revision.id=draft.revision_id
          WHERE draft.run_id=$1 ORDER BY draft.created_at,draft.article_id`, [runId]),
        pool.query(`SELECT id,handoff_kind,source_run_id,source_artifact_id,source_output_type,
            source_artifact_key,source_content_sha256,target_run_id,target_input_sha256,created_at
          FROM agent_run_handoffs WHERE target_run_id=$1 ORDER BY created_at,id`, [runId]),
        pool.query(`SELECT id,handoff_kind,source_run_id,source_artifact_id,source_output_type,
            source_artifact_key,source_content_sha256,target_run_id,target_input_sha256,created_at
          FROM agent_run_handoffs WHERE source_run_id=$1 ORDER BY created_at,id`, [runId]),
      ]);
      const handoffView = row => ({
        id: row.id, kind: row.handoff_kind, sourceRunId: row.source_run_id,
        sourceArtifactId: row.source_artifact_id, sourceOutputType: row.source_output_type,
        sourceArtifactKey: row.source_artifact_key, sourceContentSha256: row.source_content_sha256,
        targetRunId: row.target_run_id, targetInputSha256: row.target_input_sha256,
        createdAt: iso(row.created_at),
      });
      return {
        run: {
          id: run.id, workflowKey: run.workflow_key, workflowVersion: run.workflow_version,
          triggerKind: run.trigger_kind, status: run.status, behaviorProfileId: run.behavior_profile_id,
          policyProfileId: run.policy_profile_id, manifestSha256: run.manifest_sha256,
          outputType: run.output_type, outputId: run.output_id, errorCode: run.error_code,
          queuedAt: iso(run.queued_at), startedAt: iso(run.started_at), finishedAt: iso(run.finished_at),
        },
        stages: stages.rows.map(row => ({
          id: row.id, ordinal: row.ordinal, stageKey: row.stage_key, kind: row.kind, status: row.status,
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
        providerOutputArtifacts: providerOutputArtifacts.rows.map(row => ({
          id: row.id, providerCallId: row.provider_call_id, actionId: row.action_id,
          schema: { key: row.schema_key, version: row.schema_version }, mediaType: row.media_type,
          contentSha256: row.content_sha256, sizeBytes: row.size_bytes, createdAt: iso(row.created_at),
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
        stageArtifacts: stageArtifacts.rows.map(row => ({
          id: row.id, stageId: row.stage_id, actionId: row.action_id, artifactKey: row.artifact_key,
          artifactKind: row.artifact_kind, schema: { key: row.schema_key, version: row.schema_version },
          mediaType: row.media_type, contentSha256: row.content_sha256, sizeBytes: row.size_bytes,
          sourceToolArtifactIds: row.source_tool_artifact_ids,
          sourceStageArtifactIds: row.source_stage_artifact_ids, createdAt: iso(row.created_at),
        })),
        foundationDrafts: foundationDrafts.rows.map(row => ({
          runId: row.run_id, actionId: row.action_id, articleId: row.article_id, revisionId: row.revision_id,
          sourceArtifactIds: row.source_artifact_ids, contentSha256: row.content_sha256,
          verificationArtifactId: row.verification_artifact_id,
          compositionArtifactId: row.composition_artifact_id,
          slug: row.slug, title: row.title, publicationState: row.publication_state,
          createdAt: iso(row.created_at),
        })),
        handoffs: {
          incoming: incomingHandoffs.rows.map(handoffView),
          outgoing: outgoingHandoffs.rows.map(handoffView),
        },
      };
    },
  };
}
