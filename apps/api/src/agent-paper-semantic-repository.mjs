import crypto from 'node:crypto';
import { withTransaction } from './database.mjs';
import { stableHash } from './researcher-qa-protocol/stable-json.mjs';
import { PAPER_SEMANTIC_WORKFLOW_KEY } from './agent-paper-semantic-contracts.mjs';
import { validatePaperArticleEvidencePack } from './agent-paper-article-generation.mjs';

export class AgentPaperSemanticRepositoryError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AgentPaperSemanticRepositoryError';
    this.code = code;
    this.retryable = false;
  }
}

const fail = code => { throw new AgentPaperSemanticRepositoryError(code); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const uuid = value => { if (typeof value !== 'string' || !UUID.test(value)) fail('AGENT_PAPER_SEMANTIC_INPUT_INVALID'); return value; };
const json = value => JSON.stringify(value);

const evidenceView = (row, index) => ({ index, id: row.id, quoteText: row.quote_text,
  quoteHash: row.quote_hash, evidenceKind: row.evidence_kind, locator: row.locator,
  allowedUses: row.allowed_uses ?? [] });

export class PostgresAgentPaperSemanticRepository {
  constructor(pool) {
    if (!pool) fail('AGENT_PAPER_SEMANTIC_CONFIG_INVALID');
    this.pool = pool;
  }

  async loadTrustedPaper({ agentUserId, paperVersionId }) {
    uuid(agentUserId); uuid(paperVersionId);
    const paper = (await this.pool.query(`SELECT version.id AS paper_version_id,
        version.research_source_version_id,version.content_sha256,version.source_url,version.access_level,
        source.source_type,source.publisher,source.authority_tier,
        identity.canonical_id,identity.title,identity.authors,identity.publication_year,identity.venue,
        layout.manifest_json,layout.content_sha256 AS layout_sha256,
        assessment.reliability_grade,assessment.permitted_uses,assessment.reason_codes,
        assessment.assessment_sha256,assessment.policy_version AS parse_policy_version
      FROM agent_paper_versions version
      JOIN agent_paper_identities identity ON identity.id=version.paper_identity_id
      JOIN agent_paper_layout_manifests layout ON layout.paper_version_id=version.id
      JOIN agent_paper_parse_assessments assessment ON assessment.paper_version_id=version.id
      JOIN tool_research_source_versions source_version ON source_version.id=version.research_source_version_id
      JOIN tool_research_sources source ON source.id=source_version.source_id
      WHERE version.id=$1 AND identity.agent_user_id=$2`, [paperVersionId, agentUserId])).rows[0];
    if (!paper) fail('AGENT_PAPER_SEMANTIC_PAPER_NOT_FOUND');
    if (paper.access_level !== 'fulltext-open' || paper.source_type !== 'pdf'
      || paper.publisher !== 'arXiv' || paper.authority_tier !== 'official-primary'
      || !/^https:\/\/arxiv\.org\//u.test(paper.source_url)) {
      fail('AGENT_PAPER_SEMANTIC_EXTERNAL_PROCESSING_FORBIDDEN');
    }
    if (paper.reliability_grade !== 'trusted-text'
      || stableHash(paper.permitted_uses ?? []) !== stableHash(['analysis', 'citation', 'comparison'])
      || (paper.reason_codes ?? []).length !== 0) fail('AGENT_PAPER_SEMANTIC_QUALITY_BLOCKED');
    const rows = (await this.pool.query(`SELECT evidence.*
      FROM tool_research_evidence evidence
      WHERE evidence.source_version_id=$1 AND evidence.locator->>'kind'='paper.layout'
        AND evidence.allowed_uses @> ARRAY['analysis','citation','comparison']::text[]
      ORDER BY COALESCE((evidence.locator->'pages'->>0)::integer,2147483647),evidence.id
      LIMIT 97`, [paper.research_source_version_id])).rows;
    if (rows.length < 1 || rows.length > 96) fail('AGENT_PAPER_SEMANTIC_EVIDENCE_INVALID');
    const evidence = rows.map((row, index) => evidenceView(row, index + 1));
    return Object.freeze({
      schemaVersion: 'paper-semantic-source-v1', paperVersionId: paper.paper_version_id,
      researchSourceVersionId: paper.research_source_version_id,
      identity: { canonicalId: paper.canonical_id, title: paper.title, authors: paper.authors,
        year: paper.publication_year, venue: paper.venue },
      sourceUrl: paper.source_url, accessLevel: paper.access_level,
      externalProcessingClass: 'public-arxiv-open-fulltext', contentSha256: paper.content_sha256,
      layoutSha256: paper.layout_sha256, parseAssessmentSha256: paper.assessment_sha256,
      parsePolicyVersion: paper.parse_policy_version, evidence,
      evidenceManifestSha256: stableHash(evidence.map(item => ({ index: item.index,
        id: item.id, quoteHash: item.quoteHash }))),
    });
  }

  async loadArticleEvidence({ agentUserId, analysisId, accessedAt = new Date().toISOString() }) {
    uuid(agentUserId); uuid(analysisId);
    const row = (await this.pool.query(`SELECT analysis.*,version.source_url,
        version.research_source_version_id,identity.title,identity.authors,
        identity.publication_year,identity.venue
      FROM agent_paper_semantic_analyses analysis
      JOIN agent_paper_versions version ON version.id=analysis.paper_version_id
      JOIN agent_paper_identities identity ON identity.id=version.paper_identity_id
      WHERE analysis.id=$1 AND analysis.agent_user_id=$2`, [analysisId, agentUserId])).rows[0];
    if (!row) fail('AGENT_PAPER_SEMANTIC_ANALYSIS_NOT_FOUND');
    const findings = structuredClone(row.findings ?? []);
    const indexByEvidence = new Map();
    for (const finding of findings) {
      for (const relation of finding.relations ?? []) {
        if (!UUID.test(relation.evidenceId ?? '') || !Number.isSafeInteger(relation.evidenceIndex)) {
          fail('AGENT_PAPER_SEMANTIC_EVIDENCE_INVALID');
        }
        const previous = indexByEvidence.get(relation.evidenceId);
        if (previous !== undefined && previous !== relation.evidenceIndex) {
          fail('AGENT_PAPER_SEMANTIC_EVIDENCE_INVALID');
        }
        indexByEvidence.set(relation.evidenceId, relation.evidenceIndex);
      }
    }
    const evidenceIds = [...indexByEvidence.keys()];
    if (!evidenceIds.length) fail('AGENT_PAPER_SEMANTIC_EVIDENCE_INVALID');
    const evidenceRows = (await this.pool.query(`SELECT id,quote_text,quote_hash,evidence_kind,
        locator,allowed_uses FROM tool_research_evidence
      WHERE source_version_id=$1 AND id=ANY($2::uuid[])
        AND allowed_uses @> ARRAY['citation']::text[]`,
    [row.research_source_version_id, evidenceIds])).rows;
    if (evidenceRows.length !== evidenceIds.length) fail('AGENT_PAPER_SEMANTIC_EVIDENCE_INVALID');
    const evidence = evidenceRows.map(item => ({ index: indexByEvidence.get(item.id), id: item.id,
      quoteText: item.quote_text, quoteHash: item.quote_hash, evidenceKind: item.evidence_kind,
      locator: item.locator, allowedUses: item.allowed_uses ?? [] }))
      .sort((left, right) => left.index - right.index);
    return validatePaperArticleEvidencePack({
      schemaVersion: 'paper-article-evidence-v1', analysisId: row.id,
      analysisSha256: row.analysis_sha256, paperVersionId: row.paper_version_id,
      paper: { title: row.title, authors: row.authors ?? [], year: row.publication_year,
        venue: row.venue, sourceUrl: row.source_url }, findings,
      limitations: row.limitations ?? [], followUpQuestions: row.follow_up_questions ?? [],
      evidence, accessedAt,
    });
  }

  async getByAction(actionId) {
    uuid(actionId);
    const row = (await this.pool.query('SELECT * FROM agent_paper_semantic_analyses WHERE action_id=$1',
      [actionId])).rows[0];
    return row ? { id: row.id, runId: row.run_id, paperVersionId: row.paper_version_id,
      analysisSha256: row.analysis_sha256, existing: true } : null;
  }

  async persist({ actionId, verificationArtifactId, analysis }) {
    uuid(actionId); uuid(verificationArtifactId);
    if (!analysis || analysis.schemaVersion !== 'paper-semantic-verification-v1'
      || analysis.approved !== true || !UUID.test(analysis.paperVersionId ?? '')
      || !Array.isArray(analysis.findings) || analysis.findings.length < 1
      || !/^[a-f0-9]{64}$/u.test(analysis.analysisSha256 ?? '')
      || !/^[a-f0-9]{64}$/u.test(analysis.evidenceManifestSha256 ?? '')) {
      fail('AGENT_PAPER_SEMANTIC_ANALYSIS_INVALID');
    }
    return withTransaction(this.pool, async client => {
      const action = (await client.query(`SELECT action.*,run.agent_user_id,run.workflow_key,
          run.status AS run_status,stage.status AS stage_status
        FROM agent_run_actions action JOIN agent_runs run ON run.id=action.run_id
        JOIN agent_run_stages stage ON stage.id=action.stage_id AND stage.run_id=run.id
        WHERE action.id=$1 FOR UPDATE OF action,run,stage`, [actionId])).rows[0];
      if (!action || action.action_kind !== 'domain-write'
        || action.capability_key !== 'research.paper.analyze' || action.contract_version !== 1
        || action.risk_level !== 'L2' || action.workflow_key !== PAPER_SEMANTIC_WORKFLOW_KEY) {
        fail('AGENT_PAPER_SEMANTIC_ACTION_INVALID');
      }
      const existing = (await client.query('SELECT * FROM agent_paper_semantic_analyses WHERE action_id=$1',
        [actionId])).rows[0];
      if (existing) {
        if (existing.paper_version_id !== analysis.paperVersionId
          || existing.analysis_sha256 !== analysis.analysisSha256) fail('AGENT_PAPER_SEMANTIC_IDEMPOTENCY_CONFLICT');
        return { id: existing.id, runId: existing.run_id, paperVersionId: existing.paper_version_id,
          analysisSha256: existing.analysis_sha256, existing: true };
      }
      if (action.status !== 'authorized' || action.run_status !== 'running'
        || action.stage_status !== 'running') fail('AGENT_PAPER_SEMANTIC_ACTION_NOT_AUTHORIZED');
      const verification = (await client.query(`SELECT * FROM agent_runtime_stage_artifacts
        WHERE id=$1 AND run_id=$2 AND artifact_key='paper.semantic-verification'
          AND artifact_kind='verification' AND schema_key='paper.semantic.verification'
          AND schema_version=1`, [verificationArtifactId, action.run_id])).rows[0];
      const verificationBody = verification?.content_json
        ? Object.fromEntries(Object.entries(verification.content_json)
          .filter(([key]) => key !== 'analysisSha256')) : null;
      if (!verification || verification.content_json?.analysisSha256 !== analysis.analysisSha256
        || stableHash(verificationBody) !== analysis.analysisSha256
        || stableHash(verification.content_json) !== stableHash(analysis)) {
        fail('AGENT_PAPER_SEMANTIC_VERIFICATION_INVALID');
      }
      const paper = (await client.query(`SELECT version.research_source_version_id,version.access_level,
          version.source_url,source.source_type,source.publisher,source.authority_tier,
          assessment.reliability_grade,assessment.permitted_uses
        FROM agent_paper_versions version
        JOIN agent_paper_identities identity ON identity.id=version.paper_identity_id
        JOIN agent_paper_parse_assessments assessment ON assessment.paper_version_id=version.id
        JOIN tool_research_source_versions source_version ON source_version.id=version.research_source_version_id
        JOIN tool_research_sources source ON source.id=source_version.source_id
        WHERE version.id=$1 AND identity.agent_user_id=$2 FOR SHARE OF version,identity,assessment`,
      [analysis.paperVersionId, action.agent_user_id])).rows[0];
      if (!paper || paper.reliability_grade !== 'trusted-text'
        || paper.access_level !== 'fulltext-open' || paper.source_type !== 'pdf'
        || paper.publisher !== 'arXiv' || paper.authority_tier !== 'official-primary'
        || !/^https:\/\/arxiv\.org\//u.test(paper.source_url)
        || stableHash(paper.permitted_uses ?? []) !== stableHash(['analysis', 'citation', 'comparison'])) {
        fail('AGENT_PAPER_SEMANTIC_QUALITY_BLOCKED');
      }
      const relations = analysis.findings.flatMap(finding => finding.relations.map(relation => ({
        findingKey: finding.key, evidenceId: relation.evidenceId, relation: relation.relation,
      })));
      const evidenceIds = [...new Set(relations.map(item => item.evidenceId))];
      const validEvidence = evidenceIds.length === 0 ? 0 : Number((await client.query(`SELECT count(*)::int AS n
        FROM tool_research_evidence WHERE source_version_id=$1 AND id=ANY($2::uuid[])
          AND allowed_uses @> ARRAY['analysis','citation','comparison']::text[]`,
      [paper.research_source_version_id, evidenceIds])).rows[0].n);
      if (validEvidence !== evidenceIds.length) fail('AGENT_PAPER_SEMANTIC_EVIDENCE_INVALID');
      const provider = String(analysis.provider ?? '').trim();
      const modelId = String(analysis.modelId ?? '').trim();
      const policyVersion = String(analysis.policyVersion ?? '').trim();
      const promptVersion = String(analysis.promptVersion ?? '').trim();
      if (!provider || !modelId || !policyVersion || !promptVersion) fail('AGENT_PAPER_SEMANTIC_ANALYSIS_INVALID');
      const id = crypto.randomUUID();
      await client.query("UPDATE agent_run_actions SET status='reserved',reservation_ref=$2,updated_at=now() WHERE id=$1 AND status='authorized'",
        [action.id, `database:paper-semantic:${id}`]);
      await client.query("UPDATE agent_run_actions SET status='sending',updated_at=now() WHERE id=$1 AND status='reserved'", [action.id]);
      await client.query("UPDATE agent_run_actions SET status='sent',provider_request_id=$2,sent_at=now(),updated_at=now() WHERE id=$1 AND status='sending'",
        [action.id, `database:paper-semantic:${id}`]);
      await client.query("UPDATE agent_run_actions SET status='acknowledged',acknowledged_at=now(),updated_at=now() WHERE id=$1 AND status='sent'", [action.id]);
      await client.query(`INSERT INTO agent_paper_semantic_analyses(
          id,agent_user_id,paper_version_id,run_id,action_id,schema_version,policy_version,prompt_version,
          provider,model_id,section_manifest,findings,limitations,follow_up_questions,
          evidence_manifest_sha256,analysis_sha256
        ) VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [id, action.agent_user_id, analysis.paperVersionId, action.run_id, action.id,
        policyVersion, promptVersion, provider, modelId, json(analysis.sectionManifest),
        json(analysis.findings), json(analysis.limitations), json(analysis.followUpQuestions),
        analysis.evidenceManifestSha256, analysis.analysisSha256]);
      for (const relation of relations) await client.query(`INSERT INTO agent_paper_semantic_evidence_links(
          analysis_id,finding_key,evidence_id,relation) VALUES($1,$2,$3,$4)`,
      [id, relation.findingKey, relation.evidenceId, relation.relation]);
      const response = { type: 'paper.semantic-analysis', analysisId: id,
        paperVersionId: analysis.paperVersionId, analysisSha256: analysis.analysisSha256,
        publicationAttempted: false };
      const succeeded = (await client.query(`UPDATE agent_run_actions SET status='succeeded',
          response_ref_json=$2,finished_at=now(),updated_at=now()
        WHERE id=$1 AND status='acknowledged' RETURNING id`, [action.id, json(response)])).rows[0];
      if (!succeeded) fail('AGENT_PAPER_SEMANTIC_ACTION_INVALID');
      await client.query(`INSERT INTO agent_run_events(run_id,stage_id,action_id,event_type,actor_kind,payload_json)
        VALUES($1,$2,$3,'action.succeeded','system',$4)`, [action.run_id, action.stage_id, action.id, json(response)]);
      return { id, runId: action.run_id, paperVersionId: analysis.paperVersionId,
        analysisSha256: analysis.analysisSha256, existing: false };
    });
  }
}

const ACTION = Object.freeze({ actionKey: 'persist-analysis', actionKind: 'domain-write',
  capabilityKey: 'research.paper.analyze', contractVersion: 1, riskLevel: 'L2' });

export function createAgentPaperSemanticGateway({ runtimeRepository, policyService, repository } = {}) {
  if (!runtimeRepository || !policyService || !repository) fail('AGENT_PAPER_SEMANTIC_DEPENDENCY_REQUIRED');
  return Object.freeze({
    async persist({ agentUserId, runId, stageId, workerId, leaseToken, verificationArtifactId, analysis }) {
      const resource = { type: 'paper.semantic-analysis', owner: agentUserId, id: analysis.paperVersionId };
      const decision = await policyService.decide({ runId, stageId, action: ACTION, resource });
      if (decision.agentUserId !== agentUserId) fail('AGENT_PAPER_SEMANTIC_AGENT_MISMATCH');
      const prepared = await runtimeRepository.createAction({ runId, stageId, action: ACTION,
        idempotencyKey: `paper-semantic-persist:${runId}`,
        request: { schemaVersion: 'paper-semantic-persist-request-v1',
          paperVersionId: analysis.paperVersionId, analysisSha256: analysis.analysisSha256,
          verificationArtifactId }, policyDecision: decision });
      const existing = prepared.existing ? await repository.getByAction(prepared.id) : null;
      if (existing) return existing;
      if (decision.decision === 'deny') {
        if (!prepared.existing) await runtimeRepository.transitionAction({ actionId: prepared.id,
          from: 'prepared', to: 'rejected', errorCode: 'AGENT_POLICY_DENIED',
          errorMessage: decision.reasonCodes.join(',') });
        fail('AGENT_POLICY_DENIED');
      }
      if (decision.decision === 'require-confirmation') {
        if (prepared.existing) fail('AGENT_PAPER_SEMANTIC_ACTION_IN_PROGRESS');
        await runtimeRepository.waitForActionConfirmation({ actionId: prepared.id, stageId, workerId, leaseToken });
        return { status: 'waiting-confirmation', actionId: prepared.id };
      }
      if (!prepared.existing) await runtimeRepository.transitionAction({ actionId: prepared.id,
        from: 'prepared', to: 'authorized' });
      else if (prepared.status !== 'authorized') fail('AGENT_PAPER_SEMANTIC_ACTION_IN_PROGRESS');
      return repository.persist({ actionId: prepared.id, verificationArtifactId, analysis });
    },
  });
}
