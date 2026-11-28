import { PostgresAgentEditorialMemoryRepository } from './agent-editorial-memory-repository.mjs';
import { stableHash } from './researcher-qa-protocol/stable-json.mjs';
import { memoryFail, memoryRecord, memoryIso } from './agent-memory-readonly-contracts.mjs';

export async function readConversationMemory(db, agentId, origin, interactionId, request, capturedAt) {
  const target = (await db.query(`SELECT id,agent_user_id,channel,actor_ref,conversation_ref,created_at,kind
    FROM agent_interactions WHERE id=$1 AND agent_user_id=$2 AND channel=$3 AND actor_ref=$4 AND conversation_ref=$5 AND kind='message'`,
  [interactionId, agentId, origin.channel, origin.actorRef, origin.conversationRef])).rows[0];
  if (!target) memoryFail('AGENT_MEMORY_NOT_FOUND', 404);
  // Preserve legacy four-turn order and earliest completed child selection, but
  // also validate the child's ownership instead of trusting parent_id alone.
  const rows = (await db.query(`SELECT message.id,message.input_json,message.result_json,message.input_sha256,message.run_id,message.created_at,
      task.id AS task_id,task.result_json AS task_result,task.run_id AS task_run_id,task.created_at AS task_created_at
    FROM agent_interactions message
    LEFT JOIN LATERAL(SELECT id,result_json,run_id,created_at FROM agent_interactions child
      WHERE child.parent_id=message.id AND child.state='completed' AND child.kind<>'message'
        AND child.agent_user_id=message.agent_user_id AND child.channel=message.channel
        AND child.actor_ref=message.actor_ref AND child.conversation_ref=message.conversation_ref
      ORDER BY child.created_at LIMIT 1) task ON true
    WHERE message.agent_user_id=$1 AND message.channel=$2 AND message.actor_ref=$3 AND message.conversation_ref=$4
      AND message.kind='message' AND message.state='completed' AND message.created_at<$5
    ORDER BY message.created_at DESC,message.id DESC LIMIT 4`,
  [agentId, origin.channel, origin.actorRef, origin.conversationRef, target.created_at])).rows.reverse();
  const scope = { agentId, visibility: 'participant', channel: origin.channel, actorRef: origin.actorRef, conversationRef: origin.conversationRef };
  const records = [], history = [];
  for (const row of rows) {
    const add = (part, text, id, field, runId, taskId) => {
      if (typeof text !== 'string') memoryFail('AGENT_MEMORY_SOURCE_INVALID', 503);
      const reference = { kind: 'conversation', interactionId: row.id, part, ...(taskId ? { taskId } : {}) };
      records.push(memoryRecord({ kind: 'conversation', reference, scope,
        content: { role: part === 'request' ? 'user' : 'assistant', text }, capturedAt,
        observation: part === 'request' ? 'accepted-input' : 'generated-result-delivery-not-asserted',
        provenance: { store: 'agent_interactions', recordId: id, field, runId: runId ?? null,
          parentInteractionId: part === 'task-reply' ? row.id : null, createdAt: memoryIso(part === 'task-reply' ? row.task_created_at : row.created_at),
          inputSha256: part === 'request' ? row.input_sha256 : null, sourceValueSha256: stableHash(text) } }));
    };
    history.push({ role: 'user', content: row.input_json.message }, { role: 'assistant', content: row.result_json.reply, requestId: row.id });
    add('request', row.input_json.message, row.id, 'input_json.message', row.run_id);
    add('reply', row.result_json.reply, row.id, 'result_json.reply', row.run_id);
    if (row.task_result) {
      history.push({ role: 'assistant', content: row.task_result.reply, requestId: row.task_id });
      add('task-reply', row.task_result.reply, row.task_id, 'result_json.reply', row.task_run_id, row.task_id);
    }
  }
  return { records: request.reference ? records.filter(r => stableHash(r.reference) === stableHash(request.reference)) : records,
    compatibility: request.reference ? null : { history } };
}

export async function readResearchMemory(db, agentId, request, capturedAt) {
  const rows = (await db.query(`SELECT b.id AS binding_id,b.run_id,b.stage_id,b.action_id,b.tool_artifact_id,b.content_sha256 AS artifact_sha256,
      b.research_source_id,b.research_source_version_id,b.locator AS artifact_locator,eb.evidence_role,
      e.id AS evidence_id,e.quote_text,e.quote_hash,e.evidence_kind,e.allowed_uses,e.locator AS evidence_locator,
      v.content_hash AS version_hash,v.fetched_at,v.published_at,s.canonical_url,s.status AS source_status,c.tool_key,c.id AS tool_call_id
    FROM agent_research_artifact_bindings b
    JOIN agent_runs r ON r.id=b.run_id AND r.agent_user_id=b.agent_user_id
    JOIN agent_run_stages stage ON stage.id=b.stage_id AND stage.run_id=b.run_id
    JOIN agent_run_actions a ON a.id=b.action_id AND a.run_id=b.run_id AND a.stage_id=b.stage_id AND a.status='succeeded'
    JOIN agent_tool_artifacts artifact ON artifact.id=b.tool_artifact_id AND artifact.action_id=b.action_id AND artifact.content_sha256=b.content_sha256
    JOIN agent_tool_calls c ON c.id=artifact.tool_call_id AND c.action_id=b.action_id AND c.status='succeeded'
    JOIN agent_research_evidence_bindings eb ON eb.artifact_binding_id=b.id
    JOIN tool_research_evidence e ON e.id=eb.evidence_id AND e.source_version_id=b.research_source_version_id
    JOIN tool_research_source_versions v ON v.id=b.research_source_version_id AND v.source_id=b.research_source_id
    JOIN tool_research_sources s ON s.id=b.research_source_id AND s.user_id=b.agent_user_id
    WHERE b.agent_user_id=$1 AND b.artifact_kind='github.repository' AND s.source_type='github' AND s.status IN ('candidate','tracked')
      AND c.tool_key IN ('research.github.repository.read','research.github.repository.materials.read') AND c.contract_version=1
      AND $2::text=ANY(e.allowed_uses) AND ($3::uuid IS NULL OR b.id=$3) AND ($4::uuid IS NULL OR e.id=$4)
    ORDER BY v.fetched_at DESC,b.id,e.id LIMIT $5`,
  [agentId, request.use, request.reference?.bindingId ?? null, request.reference?.evidenceId ?? null, request.limit])).rows;
  return { compatibility: null, records: rows.map(row => {
    if (stableHash(row.quote_text) !== row.quote_hash) memoryFail('AGENT_MEMORY_PROVENANCE_MISMATCH', 503);
    return memoryRecord({ kind: 'research', reference: { kind: 'research', bindingId: row.binding_id, evidenceId: row.evidence_id },
      scope: { agentId, visibility: 'operator', purpose: request.use }, capturedAt, observation: 'archived-evidence-not-a-verified-conclusion',
      content: { text: row.quote_text, evidenceKind: row.evidence_kind, role: row.evidence_role, allowedUses: row.allowed_uses },
      provenance: { store: 'tool_research_evidence', recordId: row.evidence_id, quoteSha256: row.quote_hash,
        sourceId: row.research_source_id, sourceVersionId: row.research_source_version_id, sourceVersionSha256: row.version_hash,
        canonicalUrl: row.canonical_url, locator: row.evidence_locator, artifactLocator: row.artifact_locator,
        artifactBindingId: row.binding_id, toolArtifactId: row.tool_artifact_id, toolArtifactSha256: row.artifact_sha256,
        toolCallId: row.tool_call_id, toolKey: row.tool_key, runId: row.run_id, stageId: row.stage_id, actionId: row.action_id,
        fetchedAt: memoryIso(row.fetched_at), publishedAt: row.published_at ? memoryIso(row.published_at) : null, sourceStatus: row.source_status } });
  }) };
}

export async function readEditorialMemory(db, agentId, request, capturedAt) {
  const rows = (await db.query(`SELECT s.subject_kind,s.subject_key,s.latest_event_id,s.latest_revision_id,s.latest_payload_json,
      e.agent_user_id AS event_agent_id,e.subject_kind AS event_subject_kind,e.subject_key AS event_subject_key,e.payload_json AS event_payload,
      e.event_type,e.run_id,e.article_id,e.revision_id,e.research_source_version_id,e.previous_event_id,e.occurred_at,
      r.agent_user_id AS run_agent_id,article.author_user_id AS article_agent_id,revision.article_id AS revision_article_id,
      version.content_hash AS source_version_hash,source.canonical_url AS source_url,
      source.user_id AS research_owner_id,previous.agent_user_id AS previous_event_agent_id
    FROM agent_editorial_memory_subjects s LEFT JOIN agent_editorial_memory_events e ON e.id=s.latest_event_id
    LEFT JOIN agent_runs r ON r.id=e.run_id
    LEFT JOIN blog_articles article ON article.id=e.article_id
    LEFT JOIN blog_article_revisions revision ON revision.id=e.revision_id
    LEFT JOIN tool_research_source_versions version ON version.id=e.research_source_version_id
    LEFT JOIN tool_research_sources source ON source.id=version.source_id
    LEFT JOIN agent_editorial_memory_events previous ON previous.id=e.previous_event_id
    WHERE s.agent_user_id=$1 AND ($2::uuid IS NULL OR s.latest_event_id=$2)
      AND ($3::text IS NULL OR s.subject_kind=$3) AND ($4::text IS NULL OR s.subject_key=$4)
    ORDER BY s.last_seen_at DESC,s.subject_kind,s.subject_key LIMIT $5`,
  [agentId, request.reference?.eventId ?? null, request.reference?.subjectKind ?? null, request.reference?.subjectKey ?? null, request.limit])).rows;
  for (const row of rows) if (row.event_agent_id !== agentId || row.event_subject_kind !== row.subject_kind || row.event_subject_key !== row.subject_key
    || row.latest_revision_id !== row.revision_id || row.run_agent_id !== agentId || row.article_agent_id !== agentId
    || row.revision_article_id !== row.article_id || (row.research_source_version_id && row.research_owner_id !== agentId)
    || (row.previous_event_id && row.previous_event_agent_id !== agentId)
    || stableHash(row.latest_payload_json) !== stableHash(row.event_payload)) memoryFail('AGENT_MEMORY_PROVENANCE_MISMATCH', 503);
  const legacy = request.reference ? null : await new PostgresAgentEditorialMemoryRepository(db, { clock: () => new Date(capturedAt) }).snapshot(agentId, { limit: request.limit });
  if (legacy && (legacy.items.length !== rows.length || legacy.items.some((item, index) => item.subjectKind !== rows[index].subject_kind || item.subjectKey !== rows[index].subject_key))) memoryFail('AGENT_MEMORY_PROVENANCE_MISMATCH', 503);
  return { compatibility: legacy ? { snapshot: legacy } : null, records: rows.map((row, index) => memoryRecord({ kind: 'editorial',
    reference: { kind: 'editorial', subjectKind: row.subject_kind, subjectKey: row.subject_key, eventId: row.latest_event_id },
    scope: { agentId, visibility: 'operator', purpose: 'editorial' }, capturedAt, observation: 'editorial-projection-not-a-research-fact',
    content: legacy ? legacy.items[index] : { subjectKind: row.subject_kind, subjectKey: row.subject_key, payload: row.latest_payload_json },
    provenance: { store: 'agent_editorial_memory_subjects', subjectKind: row.subject_kind, subjectKey: row.subject_key,
      eventStore: 'agent_editorial_memory_events', eventId: row.latest_event_id, eventType: row.event_type,
      eventPayloadSha256: stableHash(row.event_payload), runId: row.run_id, articleId: row.article_id, revisionId: row.revision_id,
      researchSourceVersionId: row.research_source_version_id, researchSourceVersionSha256: row.source_version_hash,
      researchSourceUrl: row.source_url, previousEventId: row.previous_event_id, occurredAt: memoryIso(row.occurred_at) } })) };
}
