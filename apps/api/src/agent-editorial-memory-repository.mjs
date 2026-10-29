import crypto from 'node:crypto';
import { normalizeGitHubRepositoryLocator } from './agent-github-repository-tool.mjs';
import { stableHash } from './researcher-qa-protocol/stable-json.mjs';

export class AgentEditorialMemoryRepositoryError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AgentEditorialMemoryRepositoryError';
    this.code = code;
    this.retryable = false;
  }
}

const fail = code => { throw new AgentEditorialMemoryRepositoryError(code); };
const compact = (value, max) => String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, max);
const json = value => JSON.stringify(value);

function textKey(kind, value) {
  const normalized = compact(value, 2000).toLocaleLowerCase('zh-CN');
  if (normalized.length < 2) fail('AGENT_EDITORIAL_MEMORY_INPUT_INVALID');
  return `${kind}:${stableHash(normalized)}`;
}

function iso(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) fail('AGENT_EDITORIAL_MEMORY_INPUT_INVALID');
  return date.toISOString();
}

function plusDays(value, days) {
  return new Date(new Date(value).getTime() + days * 86400000).toISOString();
}

function memoryLabel(item) {
  if (item.subjectKind === 'topic') return compact(item.payload?.angle, 240);
  if (item.subjectKind === 'claim') return compact(item.payload?.rationale, 1000);
  if (item.subjectKind === 'scenario') return compact(item.payload?.signal, 500);
  if (item.subjectKind === 'comparison') {
    const repositories = Array.isArray(item.payload?.repositories)
      ? item.payload.repositories.map(value => compact(value, 240)).filter(Boolean).sort() : [];
    return repositories.join('|');
  }
  return '';
}

export function buildEditorialSelectionMemory(items, { capturedAt = new Date().toISOString(), limit = 120 } = {}) {
  const snapshotAt = iso(capturedAt);
  if (!Array.isArray(items) || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    fail('AGENT_EDITORIAL_MEMORY_INPUT_INVALID');
  }
  const activeCooldowns = items.filter(item => ['comparison', 'topic', 'claim', 'scenario'].includes(item.subjectKind)
      && item.cooldownUntil && new Date(item.cooldownUntil).getTime() > new Date(snapshotAt).getTime())
    .map(item => ({
      subjectKind: item.subjectKind,
      subjectKey: compact(item.subjectKey, 512),
      label: memoryLabel(item),
      occurrenceCount: Number(item.occurrenceCount),
      cooldownUntil: iso(item.cooldownUntil),
    }))
    .filter(item => item.subjectKey.length >= 3 && item.label.length >= 2
      && Number.isSafeInteger(item.occurrenceCount) && item.occurrenceCount >= 1)
    .slice(0, limit);
  return Object.freeze({ schemaVersion: 'blog-editorial-memory-input-v1', capturedAt: snapshotAt,
    activeCooldowns });
}

export function buildEditorialMemoryEvents({ selection, citations, summary, publishedAt }) {
  if (!selection || !['single', 'comparison'].includes(selection.mode)
    || !Array.isArray(selection.repositoryUrls) || !selection.repositoryUrls.length
    || selection.repositoryUrls.length !== selection.revisions?.length
    || !Array.isArray(citations) || citations.length !== selection.repositoryUrls.length) {
    fail('AGENT_EDITORIAL_MEMORY_INPUT_INVALID');
  }
  const occurredAt = iso(publishedAt);
  const projects = selection.repositoryUrls.map((repositoryUrl, index) => {
    let repository;
    try { repository = normalizeGitHubRepositoryLocator(repositoryUrl); }
    catch { fail('AGENT_EDITORIAL_MEMORY_INPUT_INVALID'); }
    const citation = citations[index];
    if (!citation || typeof citation.id !== 'string') fail('AGENT_EDITORIAL_MEMORY_INPUT_INVALID');
    return { repository, revision: compact(selection.revisions[index], 240), citationId: citation.id };
  });
  const angle = compact(selection.angle, 240);
  const rationale = compact(selection.rationale, 1000);
  if (angle.length < 2 || rationale.length < 2) fail('AGENT_EDITORIAL_MEMORY_INPUT_INVALID');
  const events = projects.map(project => ({
    eventType: selection.mode === 'single' ? 'project-featured' : 'project-compared',
    subjectKind: 'project', subjectKey: `project:${project.repository.key}`,
    currentRole: selection.mode === 'single' ? 'main' : 'comparison',
    permanentMainExclusion: selection.mode === 'single',
    cooldownUntil: selection.mode === 'comparison' ? plusDays(occurredAt, 30) : null,
    citationId: project.citationId,
    payload: { repositoryKey: project.repository.key, repositoryUrl: project.repository.canonicalUrl,
      revision: project.revision, selectionMode: selection.mode, angle },
  }));
  if (selection.mode === 'comparison') {
    const keys = projects.map(item => item.repository.key).sort();
    events.push({ eventType: 'comparison-used', subjectKind: 'comparison',
      subjectKey: `comparison:${stableHash(keys)}`, currentRole: 'comparison',
      permanentMainExclusion: false, cooldownUntil: plusDays(occurredAt, 180), citationId: null,
      payload: { repositories: keys, comparisonAxes: Array.isArray(selection.comparisonAxes)
        ? selection.comparisonAxes.map(item => compact(item, 120)).filter(Boolean) : [], angle },
    });
  }
  events.push({ eventType: 'topic-used', subjectKind: 'topic', subjectKey: textKey('topic', angle),
    currentRole: 'topic', permanentMainExclusion: false, cooldownUntil: plusDays(occurredAt, 90),
    citationId: null, payload: { angle } });
  events.push({ eventType: 'claim-stated', subjectKind: 'claim', subjectKey: textKey('claim', rationale),
    currentRole: 'claim', permanentMainExclusion: false, cooldownUntil: plusDays(occurredAt, 90),
    citationId: null, payload: { rationale, articleSummary: compact(summary, 1000) } });
  const interestSignals = Array.isArray(selection.interestSignals)
    ? [...new Set(selection.interestSignals.map(item => compact(item, 500)).filter(Boolean))] : [];
  for (const signal of interestSignals) events.push({ eventType: 'scenario-used', subjectKind: 'scenario',
    subjectKey: textKey('scenario', signal), currentRole: 'scenario', permanentMainExclusion: false,
    cooldownUntil: plusDays(occurredAt, 90), citationId: null, payload: { signal } });
  return { occurredAt, events };
}

export function buildProjectVersionMemoryEvent({ projectEvent, researchSourceVersionId,
  previousEvent = null } = {}) {
  if (!projectEvent || projectEvent.subjectKind !== 'project'
    || !['project-featured', 'project-compared'].includes(projectEvent.eventType)
    || typeof researchSourceVersionId !== 'string' || !/^[0-9a-f-]{36}$/iu.test(researchSourceVersionId)
    || (previousEvent !== null && (typeof previousEvent.id !== 'string'
      || !/^[0-9a-f-]{36}$/iu.test(previousEvent.id)
      || typeof previousEvent.researchSourceVersionId !== 'string'
      || !/^[0-9a-f-]{36}$/iu.test(previousEvent.researchSourceVersionId)))) {
    fail('AGENT_EDITORIAL_MEMORY_VERSION_INPUT_INVALID');
  }
  const sourceVersionRelation = previousEvent === null ? 'initial'
    : previousEvent.researchSourceVersionId === researchSourceVersionId ? 'same-version' : 'new-version';
  const researchReason = projectEvent.payload.selectionMode === 'comparison'
    ? 'comparison-publication-research' : previousEvent === null
      ? 'single-publication-initial-research' : 'single-publication-reresearch';
  return {
    eventType: 'project-version-observed', subjectKind: 'project',
    subjectKey: projectEvent.subjectKey, previousEventId: previousEvent?.id ?? null,
    researchSourceVersionId, researchReason,
    payload: { ...projectEvent.payload, sourceVersionRelation, researchReason,
      previousResearchSourceVersionId: previousEvent?.researchSourceVersionId ?? null,
      researchSourceVersionId },
  };
}

export function buildClaimMemoryRelations({ evidenceIds, previousClaimEventId = null } = {}) {
  if (!Array.isArray(evidenceIds) || evidenceIds.length > 500
    || evidenceIds.some(id => typeof id !== 'string' || !/^[0-9a-f-]{36}$/iu.test(id))
    || (previousClaimEventId !== null && (typeof previousClaimEventId !== 'string'
      || !/^[0-9a-f-]{36}$/iu.test(previousClaimEventId)))) {
    fail('AGENT_EDITORIAL_MEMORY_CLAIM_RELATION_INPUT_INVALID');
  }
  const uniqueEvidenceIds = [...new Set(evidenceIds)];
  const relations = uniqueEvidenceIds.map(evidenceId => ({ relationKind: 'supports', evidenceId,
    relatedClaimEventId: null, explanation: 'published-claim-supported-by-cited-evidence' }));
  if (!relations.length) relations.push({ relationKind: 'unknown', evidenceId: null,
    relatedClaimEventId: null, explanation: 'published-claim-has-no-bound-evidence' });
  if (previousClaimEventId) relations.push({ relationKind: 'revises', evidenceId: null,
    relatedClaimEventId: previousClaimEventId, explanation: 'same-stable-claim-published-with-new-revision' });
  return relations;
}

export async function recordAgentEditorialMemory(client, {
  agentUserId, runId, articleId, revisionId, compositionArtifactId, publishedAt,
}) {
  const row = (await client.query(`SELECT composition.content_json,revision.summary,revision.citations
    FROM agent_runtime_stage_artifacts composition
    JOIN blog_article_revisions revision ON revision.id=$2 AND revision.article_id=$3
    WHERE composition.id=$1 AND composition.run_id=$4 AND composition.artifact_key='blog.composition'`,
  [compositionArtifactId, revisionId, articleId, runId])).rows[0];
  const selection = row?.content_json?.selection;
  if (!row || row.content_json?.schemaVersion !== 'blog-article-composition-v1') {
    fail('AGENT_EDITORIAL_MEMORY_LINEAGE_INVALID');
  }
  const built = buildEditorialMemoryEvents({ selection, citations: row.citations,
    summary: row.summary, publishedAt });
  const evidenceRows = (await client.query(`SELECT link.citation_id,binding.research_source_version_id
    FROM blog_revision_citation_evidence link
    JOIN agent_research_artifact_bindings binding ON binding.id=link.artifact_binding_id
    WHERE link.revision_id=$1
    GROUP BY link.citation_id,binding.research_source_version_id`, [revisionId])).rows;
  const versions = new Map(evidenceRows.map(item => [item.citation_id, item.research_source_version_id]));
  const revisionEvidenceIds = (await client.query(`SELECT DISTINCT evidence_id
    FROM blog_revision_citation_evidence WHERE revision_id=$1 ORDER BY evidence_id`, [revisionId])).rows
    .map(item => item.evidence_id);
  let insertedEventCount = 0;
  for (const event of built.events) {
    const id = crypto.randomUUID();
    let memoryEvent = (await client.query(`INSERT INTO agent_editorial_memory_events(
        id,agent_user_id,event_type,subject_kind,subject_key,run_id,article_id,revision_id,
        research_source_version_id,payload_json,occurred_at
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT(agent_user_id,event_type,subject_key,revision_id) DO NOTHING RETURNING id`, [
      id, agentUserId, event.eventType, event.subjectKind, event.subjectKey, runId, articleId, revisionId,
      event.citationId ? versions.get(event.citationId) ?? null : null, json(event.payload), built.occurredAt,
    ])).rows[0];
    if (!memoryEvent) continue;
    insertedEventCount += 1;
    const researchSourceVersionId = event.citationId ? versions.get(event.citationId) : null;
    if (event.citationId && !researchSourceVersionId) {
      fail('AGENT_EDITORIAL_MEMORY_EVIDENCE_LINEAGE_INVALID');
    }
    await client.query(`INSERT INTO agent_editorial_memory_subjects(
        agent_user_id,subject_kind,subject_key,first_seen_at,last_seen_at,occurrence_count,editorial_role,
        permanent_main_exclusion,cooldown_until,latest_event_id,latest_revision_id,latest_payload_json
      ) VALUES($1,$2,$3,$4,$4,1,$5,$6,$7,$8,$9,$10)
      ON CONFLICT(agent_user_id,subject_kind,subject_key) DO UPDATE SET
        last_seen_at=GREATEST(agent_editorial_memory_subjects.last_seen_at,EXCLUDED.last_seen_at),
        occurrence_count=agent_editorial_memory_subjects.occurrence_count+1,
        editorial_role=CASE WHEN EXCLUDED.last_seen_at>=agent_editorial_memory_subjects.last_seen_at
          THEN EXCLUDED.editorial_role ELSE agent_editorial_memory_subjects.editorial_role END,
        permanent_main_exclusion=agent_editorial_memory_subjects.permanent_main_exclusion
          OR EXCLUDED.permanent_main_exclusion,
        cooldown_until=CASE WHEN agent_editorial_memory_subjects.cooldown_until IS NULL THEN EXCLUDED.cooldown_until
          WHEN EXCLUDED.cooldown_until IS NULL THEN agent_editorial_memory_subjects.cooldown_until
          ELSE GREATEST(agent_editorial_memory_subjects.cooldown_until,EXCLUDED.cooldown_until) END,
        latest_event_id=CASE WHEN EXCLUDED.last_seen_at>=agent_editorial_memory_subjects.last_seen_at
          THEN EXCLUDED.latest_event_id ELSE agent_editorial_memory_subjects.latest_event_id END,
        latest_revision_id=CASE WHEN EXCLUDED.last_seen_at>=agent_editorial_memory_subjects.last_seen_at
          THEN EXCLUDED.latest_revision_id ELSE agent_editorial_memory_subjects.latest_revision_id END,
        latest_payload_json=CASE WHEN EXCLUDED.last_seen_at>=agent_editorial_memory_subjects.last_seen_at
          THEN EXCLUDED.latest_payload_json ELSE agent_editorial_memory_subjects.latest_payload_json END,
        updated_at=now()`, [
      agentUserId, event.subjectKind, event.subjectKey, built.occurredAt, event.currentRole,
      event.permanentMainExclusion, event.cooldownUntil, memoryEvent.id, revisionId, json(event.payload),
    ]);
    if (event.eventType === 'claim-stated') {
      const previousClaim = (await client.query(`SELECT id FROM agent_editorial_memory_events
        WHERE agent_user_id=$1 AND event_type='claim-stated' AND subject_key=$2 AND revision_id<>$3
        ORDER BY occurred_at DESC,id DESC LIMIT 1`, [agentUserId, event.subjectKey, revisionId])).rows[0];
      const relations = buildClaimMemoryRelations({ evidenceIds: revisionEvidenceIds,
        previousClaimEventId: previousClaim?.id ?? null });
      for (const relation of relations) {
        await client.query(`INSERT INTO agent_editorial_claim_relations(
            id,agent_user_id,claim_event_id,relation_kind,evidence_id,related_claim_event_id,explanation
          ) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`, [
          crypto.randomUUID(), agentUserId, memoryEvent.id, relation.relationKind, relation.evidenceId,
          relation.relatedClaimEventId, relation.explanation,
        ]);
      }
    }
    if (event.subjectKind === 'project') {
      const previous = (await client.query(`SELECT id,research_source_version_id
        FROM agent_editorial_memory_events
        WHERE agent_user_id=$1 AND event_type='project-version-observed' AND subject_key=$2
          AND revision_id<>$3
        ORDER BY occurred_at DESC,id DESC LIMIT 1`, [agentUserId, event.subjectKey, revisionId])).rows[0];
      const versionEvent = buildProjectVersionMemoryEvent({ projectEvent: event,
        researchSourceVersionId, previousEvent: previous ? { id: previous.id,
          researchSourceVersionId: previous.research_source_version_id } : null });
      const versionInserted = (await client.query(`INSERT INTO agent_editorial_memory_events(
          id,agent_user_id,event_type,subject_kind,subject_key,run_id,article_id,revision_id,
          research_source_version_id,payload_json,occurred_at,previous_event_id,research_reason
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT(agent_user_id,event_type,subject_key,revision_id) DO NOTHING RETURNING id`, [
        crypto.randomUUID(), agentUserId, versionEvent.eventType, versionEvent.subjectKind,
        versionEvent.subjectKey, runId, articleId, revisionId, versionEvent.researchSourceVersionId,
        json(versionEvent.payload), built.occurredAt, versionEvent.previousEventId, versionEvent.researchReason,
      ])).rows[0];
      if (versionInserted) insertedEventCount += 1;
    }
  }
  return { eventCount: insertedEventCount };
}

export class PostgresAgentEditorialMemoryRepository {
  constructor(pool, { clock = () => new Date() } = {}) {
    if (!pool) fail('AGENT_EDITORIAL_MEMORY_DATABASE_REQUIRED');
    this.pool = pool;
    this.clock = clock;
  }

  async snapshot(agentUserId, { limit = 200 } = {}) {
    if (typeof agentUserId !== 'string' || !/^[0-9a-f-]{36}$/iu.test(agentUserId)
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      fail('AGENT_EDITORIAL_MEMORY_INPUT_INVALID');
    }
    const rows = (await this.pool.query(`SELECT subject_kind,subject_key,first_seen_at,last_seen_at,
        occurrence_count,editorial_role,permanent_main_exclusion,cooldown_until,latest_payload_json
      FROM agent_editorial_memory_subjects WHERE agent_user_id=$1
      ORDER BY last_seen_at DESC,subject_kind,subject_key LIMIT $2`, [agentUserId, limit])).rows;
    const items = rows.map(row => ({ subjectKind: row.subject_kind, subjectKey: row.subject_key,
      firstSeenAt: row.first_seen_at?.toISOString?.() ?? row.first_seen_at,
      lastSeenAt: row.last_seen_at?.toISOString?.() ?? row.last_seen_at,
      occurrenceCount: Number(row.occurrence_count), currentRole: row.editorial_role,
      permanentMainExclusion: row.permanent_main_exclusion === true,
      cooldownUntil: row.cooldown_until?.toISOString?.() ?? row.cooldown_until,
      payload: row.latest_payload_json }));
    return Object.freeze({ schemaVersion: 'agent-editorial-memory-snapshot-v1', items,
      previousRepositoryUrls: items.filter(item => item.subjectKind === 'project' && item.permanentMainExclusion)
        .map(item => item.payload?.repositoryUrl).filter(Boolean),
      selectionMemory: buildEditorialSelectionMemory(items, { capturedAt: this.clock().toISOString() }) });
  }
}
