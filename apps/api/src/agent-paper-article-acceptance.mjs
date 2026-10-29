import crypto from 'node:crypto';
import { withTransaction } from './database.mjs';
import { stableHash } from './researcher-qa-protocol/stable-json.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const AGENT_PAPER_ARTICLE_ACCEPTANCE_POLICY = Object.freeze({
  schemaVersion: 'agent-paper-article-acceptance-policy-v1', policyVersion: 1,
  requiredSamples: 3, expectedStagesPerDraft: 5, expectedToolCallsPerDraft: 1,
  expectedProviderCallsPerDraft: 1, maxStageRetriesPerDraft: 0,
});

export class AgentPaperArticleAcceptanceError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'AgentPaperArticleAcceptanceError';
    this.code = code;
    this.details = details;
    this.retryable = false;
  }
}

const fail = (code, details) => { throw new AgentPaperArticleAcceptanceError(code, details); };
const number = value => Number(value ?? 0);

function validateIds(value, count = 3) {
  if (!Array.isArray(value) || value.length !== count || new Set(value).size !== value.length
    || value.some(id => typeof id !== 'string' || !UUID.test(id))) {
    fail('AGENT_PAPER_ARTICLE_ACCEPTANCE_INPUT_INVALID');
  }
  return value.map(id => id.toLowerCase());
}

function validatePolicy(policy) {
  if (!policy || policy.schemaVersion !== 'agent-paper-article-acceptance-policy-v1'
    || policy.policyVersion !== 1 || policy.requiredSamples !== 3) {
    fail('AGENT_PAPER_ARTICLE_ACCEPTANCE_POLICY_INVALID');
  }
  return structuredClone(policy);
}

function deterministicUuid(seed) {
  const bytes = crypto.createHash('sha256').update(seed).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function evaluateAgentPaperArticleSources(samples,
  policy = AGENT_PAPER_ARTICLE_ACCEPTANCE_POLICY) {
  policy = validatePolicy(policy);
  if (!Array.isArray(samples) || samples.length !== policy.requiredSamples) {
    fail('AGENT_PAPER_ARTICLE_ACCEPTANCE_EVIDENCE_INVALID');
  }
  const reasons = [];
  if (new Set(samples.map(sample => sample.analysisId)).size !== policy.requiredSamples) reasons.push('ANALYSIS_DUPLICATED');
  if (new Set(samples.map(sample => sample.paperIdentityId)).size !== policy.requiredSamples) reasons.push('PAPER_DUPLICATED');
  if (new Set(samples.map(sample => sample.paperVersionId)).size !== policy.requiredSamples) reasons.push('PAPER_VERSION_DUPLICATED');
  if (new Set(samples.map(sample => sample.arxivId)).size !== policy.requiredSamples) reasons.push('ARXIV_ID_DUPLICATED');
  for (const sample of samples) {
    if (sample.analysisRunStatus !== 'succeeded' || sample.researchExecutionStatus !== 'succeeded'
      || sample.queueState !== 'completed' || sample.discoveryStatus !== 'completed') reasons.push('RESEARCH_LINEAGE_INCOMPLETE');
    if (sample.sourceKind !== 'arxiv' || !sample.arxivId
      || !/^https:\/\/arxiv\.org\//u.test(sample.sourceUrl ?? '')) reasons.push('SOURCE_NOT_REAL_OPEN_ARXIV');
    if (sample.accessLevel !== 'fulltext-open' || sample.executionAccessLevel !== 'fulltext-open') {
      reasons.push('FULLTEXT_NOT_OPEN');
    }
    if (sample.reliabilityGrade !== 'trusted-text'
      || stableHash(sample.permittedUses ?? []) !== stableHash(['analysis', 'citation', 'comparison'])
      || (sample.parseReasonCodes ?? []).length !== 0) reasons.push('PARSE_QUALITY_NOT_TRUSTED');
    if (number(sample.pageCount) < 1 || number(sample.findingCount) < 1
      || number(sample.evidenceLinkCount) < 1 || number(sample.pageEvidenceCount) < 1) {
      reasons.push('SEMANTIC_EVIDENCE_INCOMPLETE');
    }
  }
  return { passed: reasons.length === 0, reasonCodes: [...new Set(reasons)] };
}

export function evaluateAgentPaperArticleAcceptance(snapshot,
  policy = AGENT_PAPER_ARTICLE_ACCEPTANCE_POLICY) {
  policy = validatePolicy(policy);
  if (!snapshot || snapshot.schemaVersion !== 'agent-paper-article-acceptance-evidence-v1'
    || !UUID.test(snapshot.agentUserId ?? '') || !UUID.test(snapshot.requestId ?? '')
    || !Array.isArray(snapshot.samples) || snapshot.samples.length !== policy.requiredSamples) {
    fail('AGENT_PAPER_ARTICLE_ACCEPTANCE_EVIDENCE_INVALID');
  }
  const source = evaluateAgentPaperArticleSources(snapshot.samples, policy);
  const reasons = [...source.reasonCodes];
  for (const sample of snapshot.samples) {
    if (sample.draftWorkflowKey !== 'paper.article.draft-shadow' || sample.draftWorkflowVersion !== 1
      || sample.draftStatus !== 'succeeded' || sample.outputType !== 'blog.private-draft'
      || sample.outputId !== sample.articleId) reasons.push('DRAFT_RUN_INVALID');
    if (number(sample.stageCount) !== policy.expectedStagesPerDraft || number(sample.nonSucceededStages) !== 0
      || number(sample.stageRetries) > policy.maxStageRetriesPerDraft
      || number(sample.nonSucceededActions) !== 0) reasons.push('DRAFT_EXECUTION_NOT_CLEAN');
    if (number(sample.toolCalls) !== policy.expectedToolCallsPerDraft
      || number(sample.providerCalls) !== policy.expectedProviderCallsPerDraft
      || number(sample.failedOrUncertainToolCalls) !== 0
      || number(sample.failedOrUncertainProviderCalls) !== 0) reasons.push('DRAFT_CALL_GRAPH_INVALID');
    if (sample.publicationState !== 'draft' || sample.revisionState !== 'working'
      || sample.publishedRevisionId !== null || sample.publicationReceiptExists
      || number(sample.publishEvents) !== 0 || number(sample.publishActions) !== 0) reasons.push('PUBLICATION_AUTHORITY_OBSERVED');
    if (!sample.analysisSelectionMatches || !sample.paperVersionSelectionMatches
      || !sample.verificationApproved || !sample.compositionHashMatches
      || !sample.verificationHashMatches || number(sample.sourceArtifactCount) !== 1) {
      reasons.push('DRAFT_LINEAGE_INCOMPLETE');
    }
    if (number(sample.citationCount) !== 1 || !sample.citationUrlMatches
      || !sample.citationHasPageLocator || !sample.everyFactualBlockCited) reasons.push('CITATION_COVERAGE_INVALID');
  }
  const reasonCodes = [...new Set(reasons)];
  const metrics = {
    samples: snapshot.samples.length,
    pages: snapshot.samples.reduce((sum, sample) => sum + number(sample.pageCount), 0),
    findings: snapshot.samples.reduce((sum, sample) => sum + number(sample.findingCount), 0),
    evidenceLinks: snapshot.samples.reduce((sum, sample) => sum + number(sample.evidenceLinkCount), 0),
    providerCalls: snapshot.samples.reduce((sum, sample) => sum + number(sample.providerCalls), 0),
    toolCalls: snapshot.samples.reduce((sum, sample) => sum + number(sample.toolCalls), 0),
  };
  const evidenceSha256 = stableHash(snapshot);
  const report = { schemaVersion: 'agent-paper-article-acceptance-v1', policyVersion: policy.policyVersion,
    verdict: reasonCodes.length ? 'failed' : 'passed', reasonCodes, metrics, evidenceSha256 };
  return { ...report, reportSha256: stableHash({ report, policy, evidence: snapshot }) };
}

const reportView = row => ({ id: row.id, agentUserId: row.agent_user_id,
  requestId: row.request_id, policyVersion: row.policy_version, analysisIds: row.analysis_ids,
  draftRunIds: row.draft_run_ids, articleIds: row.article_ids, verdict: row.verdict,
  reasonCodes: row.reason_codes, metrics: row.metrics_json, evidenceSha256: row.evidence_sha256,
  reportSha256: row.report_sha256, createdAt: row.created_at?.toISOString?.() ?? row.created_at });

export class PostgresAgentPaperArticleAcceptanceRepository {
  constructor(pool) {
    if (!pool) fail('AGENT_PAPER_ARTICLE_ACCEPTANCE_DATABASE_REQUIRED');
    this.pool = pool;
  }

  async inspectSources(agentUserId, analysisIds) {
    if (!UUID.test(agentUserId ?? '')) fail('AGENT_PAPER_ARTICLE_ACCEPTANCE_INPUT_INVALID');
    analysisIds = validateIds(analysisIds);
    const rows = (await this.pool.query(`SELECT analysis.id AS analysis_id,
        analysis.paper_version_id,analysis.run_id AS analysis_run_id,analysis_run.status AS analysis_run_status,
        jsonb_array_length(analysis.findings) AS finding_count,
        version.paper_identity_id,version.source_url,version.access_level,
        identity.canonical_id,identity.arxiv_id,assessment.reliability_grade,
        assessment.permitted_uses,assessment.reason_codes AS parse_reason_codes,layout.page_count,
        execution.id AS research_execution_id,execution.status AS research_execution_status,
        execution.access_level AS execution_access_level,queue.state AS queue_state,
        candidate.source_kind,discovery.status AS discovery_status,
        (SELECT count(*)::int FROM agent_paper_semantic_evidence_links link
          WHERE link.analysis_id=analysis.id) AS evidence_link_count,
        (SELECT count(DISTINCT link.evidence_id)::int FROM agent_paper_semantic_evidence_links link
          JOIN tool_research_evidence evidence ON evidence.id=link.evidence_id
          WHERE link.analysis_id=analysis.id AND evidence.locator->>'kind'='paper.layout'
            AND jsonb_array_length(evidence.locator->'pages')>0) AS page_evidence_count
      FROM agent_paper_semantic_analyses analysis
      JOIN agent_runs analysis_run ON analysis_run.id=analysis.run_id
      JOIN agent_paper_versions version ON version.id=analysis.paper_version_id
      JOIN agent_paper_identities identity ON identity.id=version.paper_identity_id
      JOIN agent_paper_parse_assessments assessment ON assessment.paper_version_id=version.id
      JOIN agent_paper_layout_manifests layout ON layout.paper_version_id=version.id
      JOIN LATERAL (SELECT item.* FROM agent_paper_research_executions item
        WHERE item.agent_user_id=$1 AND item.paper_version_id=version.id
          AND item.runtime_run_id=analysis.run_id AND item.status='succeeded'
          AND item.result_json->>'analysisId'=analysis.id::text
        ORDER BY item.finished_at DESC NULLS LAST,item.id DESC LIMIT 1) execution ON true
      JOIN agent_paper_research_queue_items queue ON queue.id=execution.queue_item_id
      JOIN agent_paper_discovery_candidates candidate ON candidate.id=queue.source_candidate_id
      JOIN agent_paper_discovery_runs discovery ON discovery.id=candidate.run_id
      WHERE analysis.agent_user_id=$1 AND analysis.id=ANY($2::uuid[])
      ORDER BY array_position($2::uuid[],analysis.id)`, [agentUserId, analysisIds])).rows;
    if (rows.length !== analysisIds.length) fail('AGENT_PAPER_ARTICLE_ACCEPTANCE_SOURCE_NOT_FOUND');
    return rows.map(row => ({ analysisId: row.analysis_id, paperVersionId: row.paper_version_id,
      paperIdentityId: row.paper_identity_id, canonicalId: row.canonical_id, arxivId: row.arxiv_id,
      sourceUrl: row.source_url, accessLevel: row.access_level,
      analysisRunId: row.analysis_run_id, analysisRunStatus: row.analysis_run_status,
      researchExecutionId: row.research_execution_id,
      researchExecutionStatus: row.research_execution_status,
      executionAccessLevel: row.execution_access_level, queueState: row.queue_state,
      sourceKind: row.source_kind, discoveryStatus: row.discovery_status,
      reliabilityGrade: row.reliability_grade, permittedUses: row.permitted_uses ?? [],
      parseReasonCodes: row.parse_reason_codes ?? [], pageCount: number(row.page_count),
      findingCount: number(row.finding_count), evidenceLinkCount: number(row.evidence_link_count),
      pageEvidenceCount: number(row.page_evidence_count) }));
  }

  async snapshot({ agentUserId, requestId, sources, results }) {
    if (!UUID.test(agentUserId ?? '') || !UUID.test(requestId ?? '')
      || !Array.isArray(sources) || sources.length !== 3 || !Array.isArray(results) || results.length !== 3) {
      fail('AGENT_PAPER_ARTICLE_ACCEPTANCE_INPUT_INVALID');
    }
    const runIds = results.map(result => result.runId);
    const rows = (await this.pool.query(`SELECT run.id AS draft_run_id,run.workflow_key,
        run.workflow_version,run.status AS draft_status,run.output_type,run.output_id,
        mapping.article_id,mapping.source_artifact_ids,mapping.verification_artifact_id,
        mapping.composition_artifact_id,article.publication_state,article.published_revision_id,
        revision.revision_state,revision.blocks,revision.citations,
        composition.content_json AS composition_json,composition.content_sha256 AS composition_sha256,
        verification.content_json AS verification_json,
        EXISTS(SELECT 1 FROM agent_blog_foundation_publications publication
          WHERE publication.article_id=article.id) AS publication_receipt_exists,
        (SELECT count(*)::int FROM blog_article_events event
          WHERE event.article_id=article.id AND event.action='published') AS publish_events,
        (SELECT count(*)::int FROM agent_run_stages stage WHERE stage.run_id=run.id) AS stage_count,
        (SELECT count(*)::int FROM agent_run_stages stage
          WHERE stage.run_id=run.id AND stage.status<>'succeeded') AS non_succeeded_stages,
        (SELECT COALESCE(sum(GREATEST(stage.attempt-1,0)),0)::int FROM agent_run_stages stage
          WHERE stage.run_id=run.id) AS stage_retries,
        (SELECT count(*)::int FROM agent_run_actions action
          WHERE action.run_id=run.id AND action.status<>'succeeded') AS non_succeeded_actions,
        (SELECT count(*)::int FROM agent_run_actions action
          WHERE action.run_id=run.id AND action.capability_key='blog.article.publish') AS publish_actions,
        (SELECT count(*)::int FROM agent_tool_calls call JOIN agent_run_actions action ON action.id=call.action_id
          WHERE action.run_id=run.id AND call.status='succeeded') AS tool_calls,
        (SELECT count(*)::int FROM agent_tool_calls call JOIN agent_run_actions action ON action.id=call.action_id
          WHERE action.run_id=run.id AND call.status IN ('failed','uncertain')) AS bad_tool_calls,
        (SELECT count(*)::int FROM agent_provider_calls call JOIN agent_run_actions action ON action.id=call.action_id
          WHERE action.run_id=run.id AND call.status='succeeded') AS provider_calls,
        (SELECT count(*)::int FROM agent_provider_calls call JOIN agent_run_actions action ON action.id=call.action_id
          WHERE action.run_id=run.id AND call.status IN ('failed','uncertain')) AS bad_provider_calls
      FROM agent_runs run
      JOIN agent_blog_foundation_drafts mapping ON mapping.run_id=run.id
      JOIN blog_articles article ON article.id=mapping.article_id
      JOIN blog_article_revisions revision ON revision.id=mapping.revision_id
      JOIN agent_runtime_stage_artifacts composition ON composition.id=mapping.composition_artifact_id
      JOIN agent_runtime_stage_artifacts verification ON verification.id=mapping.verification_artifact_id
      WHERE run.agent_user_id=$1 AND run.id=ANY($2::uuid[])
      ORDER BY array_position($2::uuid[],run.id)`, [agentUserId, runIds])).rows;
    if (rows.length !== results.length) fail('AGENT_PAPER_ARTICLE_ACCEPTANCE_DRAFT_NOT_FOUND');
    const samples = rows.map((row, index) => {
      const source = sources[index];
      const result = results[index];
      if (source.analysisId !== result.analysisId || row.draft_run_id !== result.runId
        || row.article_id !== result.articleId) fail('AGENT_PAPER_ARTICLE_ACCEPTANCE_LINEAGE_INVALID');
      const blocks = Array.isArray(row.blocks) ? row.blocks : [];
      const citations = Array.isArray(row.citations) ? row.citations : [];
      const articleBlocks = blocks.at(-2)?.type === 'heading' && blocks.at(-2)?.text === '继续追问'
        ? blocks.slice(0, -2) : blocks;
      const factual = articleBlocks.filter(block => ['paragraph', 'list', 'quote'].includes(block.type));
      const citation = citations[0];
      const composition = row.composition_json ?? {};
      const verification = row.verification_json ?? {};
      return { ...source, draftRunId: row.draft_run_id,
        draftWorkflowKey: row.workflow_key, draftWorkflowVersion: row.workflow_version,
        draftStatus: row.draft_status, outputType: row.output_type, outputId: row.output_id,
        articleId: row.article_id, publicationState: row.publication_state,
        revisionState: row.revision_state, publishedRevisionId: row.published_revision_id,
        publicationReceiptExists: row.publication_receipt_exists === true,
        publishEvents: number(row.publish_events), publishActions: number(row.publish_actions),
        stageCount: number(row.stage_count), nonSucceededStages: number(row.non_succeeded_stages),
        stageRetries: number(row.stage_retries), nonSucceededActions: number(row.non_succeeded_actions),
        toolCalls: number(row.tool_calls), failedOrUncertainToolCalls: number(row.bad_tool_calls),
        providerCalls: number(row.provider_calls), failedOrUncertainProviderCalls: number(row.bad_provider_calls),
        sourceArtifactCount: Array.isArray(row.source_artifact_ids) ? row.source_artifact_ids.length : 0,
        analysisSelectionMatches: composition.selection?.analysisId === source.analysisId,
        paperVersionSelectionMatches: composition.selection?.paperVersionId === source.paperVersionId,
        verificationApproved: verification.approved === true,
        compositionHashMatches: verification.contentSha256 === row.composition_sha256,
        verificationHashMatches: verification.compositionArtifactId === row.composition_artifact_id
          && row.verification_artifact_id != null,
        citationCount: citations.length, citationUrlMatches: citation?.url === source.sourceUrl,
        citationHasPageLocator: /^第 [0-9、]+ 页$/u.test(citation?.locator ?? ''),
        everyFactualBlockCited: factual.length > 0 && factual.every(block =>
          Array.isArray(block.citationIds) && block.citationIds.length === 1
          && block.citationIds[0] === citation?.id) };
    });
    return { schemaVersion: 'agent-paper-article-acceptance-evidence-v1', agentUserId,
      requestId, samples };
  }

  async persist({ snapshot, policy, evaluation }) {
    const id = crypto.randomUUID();
    const analysisIds = snapshot.samples.map(sample => sample.analysisId);
    const runIds = snapshot.samples.map(sample => sample.draftRunId);
    const articleIds = snapshot.samples.map(sample => sample.articleId);
    return withTransaction(this.pool, async client => {
      const row = (await client.query(`INSERT INTO agent_paper_article_acceptance_reports(
          id,agent_user_id,request_id,policy_version,analysis_ids,draft_run_ids,article_ids,
          verdict,reason_codes,metrics_json,evidence_json,evidence_sha256,report_sha256
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT(agent_user_id,request_id,policy_version) DO NOTHING RETURNING *`,
      [id, snapshot.agentUserId, snapshot.requestId, policy.policyVersion, analysisIds, runIds, articleIds,
        evaluation.verdict, evaluation.reasonCodes, JSON.stringify(evaluation.metrics), JSON.stringify(snapshot),
        evaluation.evidenceSha256, evaluation.reportSha256])).rows[0];
      if (row) return { ...reportView(row), existing: false };
      const existing = (await client.query(`SELECT * FROM agent_paper_article_acceptance_reports
        WHERE agent_user_id=$1 AND request_id=$2 AND policy_version=$3`,
      [snapshot.agentUserId, snapshot.requestId, policy.policyVersion])).rows[0];
      if (!existing || existing.report_sha256 !== evaluation.reportSha256) {
        fail('AGENT_PAPER_ARTICLE_ACCEPTANCE_CONFLICT');
      }
      return { ...reportView(existing), existing: true };
    });
  }
}

export function createAgentPaperArticleAcceptanceService({ repository, paperArticleRunner,
  policy = AGENT_PAPER_ARTICLE_ACCEPTANCE_POLICY } = {}) {
  if (!repository || !paperArticleRunner) fail('AGENT_PAPER_ARTICLE_ACCEPTANCE_DEPENDENCY_REQUIRED');
  policy = validatePolicy(policy);
  return Object.freeze({
    async run({ agentUserId, analysisIds, requestId }) {
      if (!UUID.test(agentUserId ?? '') || !UUID.test(requestId ?? '')) {
        fail('AGENT_PAPER_ARTICLE_ACCEPTANCE_INPUT_INVALID');
      }
      analysisIds = validateIds(analysisIds, policy.requiredSamples);
      const sources = await repository.inspectSources(agentUserId, analysisIds);
      const sourceEvaluation = evaluateAgentPaperArticleSources(sources, policy);
      if (!sourceEvaluation.passed) fail('AGENT_PAPER_ARTICLE_ACCEPTANCE_SOURCE_REJECTED', sourceEvaluation);
      const results = [];
      for (const [index, analysisId] of analysisIds.entries()) {
        results.push(await paperArticleRunner.run({ analysisId,
          requestId: deterministicUuid(`${requestId}\0${index}\0${analysisId}`) }));
      }
      const snapshot = await repository.snapshot({ agentUserId, requestId, sources, results });
      const evaluation = evaluateAgentPaperArticleAcceptance(snapshot, policy);
      const report = await repository.persist({ snapshot, policy, evaluation });
      return { schemaVersion: 'agent-paper-article-acceptance-result-v1', ...report,
        publicationAttempted: false, automaticScheduleChange: false };
    },
  });
}
