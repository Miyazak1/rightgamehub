import crypto from 'node:crypto';
import { withTransaction } from './database.mjs';
import { stableHash } from './researcher-qa-protocol/stable-json.mjs';
import { PAPER_FOLLOW_UP_WORKFLOW_KEY } from './agent-paper-follow-up-contracts.mjs';

export class AgentPaperFollowUpRepositoryError extends Error {
  constructor(code) {
    super(code); this.name = 'AgentPaperFollowUpRepositoryError'; this.code = code; this.retryable = false;
  }
}
const fail = code => { throw new AgentPaperFollowUpRepositoryError(code); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const uuid = value => { if (typeof value !== 'string' || !UUID.test(value)) fail('AGENT_PAPER_FOLLOW_UP_INPUT_INVALID'); return value; };
const json = value => JSON.stringify(value);
const iso = value => value?.toISOString?.() ?? value ?? null;

const answerView = (row, evidence = []) => ({
  id: row.id, analysisId: row.semantic_analysis_id, runId: row.run_id,
  requestId: row.request_id, question: row.question, answer: row.answer,
  uncertainty: row.uncertainty, findingKeys: row.finding_keys ?? [],
  provider: row.provider, modelId: row.model_id, policyVersion: row.policy_version,
  promptVersion: row.prompt_version, answerSha256: row.answer_sha256,
  createdAt: iso(row.created_at), evidence,
});

export class PostgresAgentPaperFollowUpRepository {
  constructor(pool, { dailyLimit = 10 } = {}) {
    if (!pool || !Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 100) {
      fail('AGENT_PAPER_FOLLOW_UP_CONFIG_INVALID');
    }
    this.pool = pool; this.dailyLimit = dailyLimit;
  }

  async loadContext({ agentUserId, analysisId, question, runId }) {
    uuid(agentUserId); uuid(analysisId);
    const row = (await this.pool.query(`SELECT analysis.*,identity.title,identity.authors,
        version.source_url,version.research_source_version_id
      FROM agent_paper_semantic_analyses analysis
      JOIN agent_paper_versions version ON version.id=analysis.paper_version_id
      JOIN agent_paper_identities identity ON identity.id=version.paper_identity_id
      WHERE analysis.id=$1 AND analysis.agent_user_id=$2`, [analysisId, agentUserId])).rows[0];
    if (!row) fail('AGENT_PAPER_FOLLOW_UP_ANALYSIS_NOT_FOUND');
    if (row.section_manifest?.readingScope?.mode === 'text-only-draft') {
      fail('AGENT_PAPER_FOLLOW_UP_TEXT_DRAFT_ONLY');
    }
    uuid(runId);
    const quota = (await this.pool.query(`SELECT current.id,count(candidate.id)::int AS ordinal
      FROM agent_runs current
      JOIN agent_runs candidate ON candidate.agent_user_id=current.agent_user_id
        AND candidate.workflow_key=$3
        AND (candidate.created_at AT TIME ZONE 'Asia/Shanghai')::date=
          (current.created_at AT TIME ZONE 'Asia/Shanghai')::date
        AND (candidate.created_at,candidate.id)<=(current.created_at,current.id)
      WHERE current.id=$2 AND current.agent_user_id=$1 AND current.workflow_key=$3
      GROUP BY current.id`, [agentUserId, runId, PAPER_FOLLOW_UP_WORKFLOW_KEY])).rows[0];
    if (!quota) fail('AGENT_PAPER_FOLLOW_UP_CONTEXT_INVALID');
    const used = Number(quota.ordinal);
    if (used > this.dailyLimit) fail('AGENT_PAPER_FOLLOW_UP_DAILY_LIMIT');
    const findings = structuredClone(row.findings ?? []);
    const indexByEvidence = new Map();
    for (const finding of findings) {
      for (const relation of finding.relations ?? []) {
        if (!UUID.test(relation.evidenceId ?? '') || !Number.isSafeInteger(relation.evidenceIndex)) {
          fail('AGENT_PAPER_FOLLOW_UP_CONTEXT_INVALID');
        }
        const existing = indexByEvidence.get(relation.evidenceId);
        if (existing !== undefined && existing !== relation.evidenceIndex) {
          fail('AGENT_PAPER_FOLLOW_UP_CONTEXT_INVALID');
        }
        indexByEvidence.set(relation.evidenceId, relation.evidenceIndex);
      }
    }
    const evidenceIds = [...indexByEvidence.keys()];
    const evidenceRows = evidenceIds.length ? (await this.pool.query(`SELECT id,quote_text,quote_hash,
        evidence_kind,locator,allowed_uses FROM tool_research_evidence
      WHERE source_version_id=$1 AND id=ANY($2::uuid[])`,
    [row.research_source_version_id, evidenceIds])).rows : [];
    if (evidenceRows.length !== evidenceIds.length) fail('AGENT_PAPER_FOLLOW_UP_CONTEXT_INVALID');
    const evidence = evidenceRows.map(item => ({ index: indexByEvidence.get(item.id), id: item.id,
      quoteText: item.quote_text, quoteHash: item.quote_hash, evidenceKind: item.evidence_kind,
      locator: item.locator, allowedUses: item.allowed_uses ?? [] }))
      .sort((left, right) => left.index - right.index);
    return Object.freeze({ schemaVersion: 'paper-follow-up-context-v1', analysisId: row.id,
      analysisSha256: row.analysis_sha256, paperVersionId: row.paper_version_id,
      paper: { title: row.title, authors: row.authors ?? [], sourceUrl: row.source_url },
      question, findings, limitations: row.limitations ?? [], evidence,
      followUpQuestions: row.follow_up_questions ?? [], daily: { ordinal: used,
        limit: this.dailyLimit } });
  }

  async getByAction(actionId) {
    uuid(actionId);
    const row = (await this.pool.query('SELECT * FROM agent_paper_follow_up_answers WHERE action_id=$1',
      [actionId])).rows[0];
    return row ? answerView(row) : null;
  }

  async getByRun({ agentUserId, runId }) {
    uuid(agentUserId); uuid(runId);
    const row = (await this.pool.query(`SELECT * FROM agent_paper_follow_up_answers
      WHERE agent_user_id=$1 AND run_id=$2`, [agentUserId, runId])).rows[0];
    if (!row) return null;
    const evidence = (await this.pool.query(`SELECT link.finding_key,link.evidence_index,link.relation,
        evidence.id,evidence.quote_text,evidence.quote_hash,evidence.locator
      FROM agent_paper_follow_up_evidence_links link
      JOIN tool_research_evidence evidence ON evidence.id=link.evidence_id
      WHERE link.answer_id=$1 ORDER BY link.evidence_index,link.finding_key,link.relation`, [row.id])).rows
      .map(item => ({ findingKey: item.finding_key, evidenceIndex: item.evidence_index,
        relation: item.relation, id: item.id, quoteText: item.quote_text,
        quoteHash: item.quote_hash, locator: item.locator }));
    return answerView(row, evidence);
  }

  async list({ agentUserId, analysisId, limit = 20 }) {
    uuid(agentUserId); uuid(analysisId);
    limit = Math.min(50, Math.max(1, Number(limit) || 20));
    const rows = (await this.pool.query(`SELECT answer.* FROM agent_paper_follow_up_answers answer
      WHERE answer.agent_user_id=$1 AND answer.semantic_analysis_id=$2
      ORDER BY answer.created_at,answer.id LIMIT $3`, [agentUserId, analysisId, limit])).rows;
    const result = [];
    for (const row of rows) result.push(await this.getByRun({ agentUserId, runId: row.run_id }));
    return result;
  }

  async persist({ actionId, verificationArtifactId, verification }) {
    uuid(actionId); uuid(verificationArtifactId);
    if (!verification || verification.schemaVersion !== 'paper-follow-up-verification-v1'
      || verification.approved !== true || !UUID.test(verification.analysisId ?? '')
      || !/^[a-f0-9]{64}$/u.test(verification.answerSha256 ?? '')
      || !/^[a-f0-9]{64}$/u.test(verification.questionSha256 ?? '')) {
      fail('AGENT_PAPER_FOLLOW_UP_VERIFICATION_INVALID');
    }
    return withTransaction(this.pool, async client => {
      const action = (await client.query(`SELECT action.*,run.agent_user_id,run.workflow_key,
          run.status AS run_status,run.trigger_ref,run.input_json,stage.status AS stage_status
        FROM agent_run_actions action JOIN agent_runs run ON run.id=action.run_id
        JOIN agent_run_stages stage ON stage.id=action.stage_id AND stage.run_id=run.id
        WHERE action.id=$1 FOR UPDATE OF action,run,stage`, [actionId])).rows[0];
      if (!action || action.action_kind !== 'domain-write'
        || action.capability_key !== 'research.paper.follow-up' || action.contract_version !== 1
        || action.risk_level !== 'L2' || action.workflow_key !== PAPER_FOLLOW_UP_WORKFLOW_KEY) {
        fail('AGENT_PAPER_FOLLOW_UP_ACTION_INVALID');
      }
      const existing = (await client.query('SELECT * FROM agent_paper_follow_up_answers WHERE action_id=$1',
        [actionId])).rows[0];
      if (existing) {
        if (existing.answer_sha256 !== verification.answerSha256) {
          fail('AGENT_PAPER_FOLLOW_UP_IDEMPOTENCY_CONFLICT');
        }
        return answerView(existing);
      }
      if (action.status !== 'authorized' || action.run_status !== 'running'
        || action.stage_status !== 'running') fail('AGENT_PAPER_FOLLOW_UP_ACTION_NOT_AUTHORIZED');
      const artifact = (await client.query(`SELECT * FROM agent_runtime_stage_artifacts
        WHERE id=$1 AND run_id=$2 AND artifact_key='paper.follow-up-verification'
          AND artifact_kind='verification' AND schema_key='paper.semantic.follow-up-verification'
          AND schema_version=1`, [verificationArtifactId, action.run_id])).rows[0];
      const body = artifact?.content_json
        ? Object.fromEntries(Object.entries(artifact.content_json).filter(([key]) => key !== 'answerSha256')) : null;
      if (!artifact || artifact.content_json?.answerSha256 !== verification.answerSha256
        || stableHash(body) !== verification.answerSha256
        || stableHash(artifact.content_json) !== stableHash(verification)) {
        fail('AGENT_PAPER_FOLLOW_UP_VERIFICATION_INVALID');
      }
      const analysis = (await client.query(`SELECT * FROM agent_paper_semantic_analyses
        WHERE id=$1 AND agent_user_id=$2 FOR SHARE`,
      [verification.analysisId, action.agent_user_id])).rows[0];
      if (!analysis || analysis.analysis_sha256 !== verification.analysisSha256) {
        fail('AGENT_PAPER_FOLLOW_UP_CONTEXT_DRIFT');
      }
      const question = String(action.input_json?.question ?? '');
      if (stableHash(question) !== verification.questionSha256 || !UUID.test(action.trigger_ref ?? '')) {
        fail('AGENT_PAPER_FOLLOW_UP_CONTEXT_DRIFT');
      }
      const relations = verification.evidenceLinks ?? [];
      for (const link of relations) {
        const matched = (await client.query(`SELECT 1 FROM agent_paper_semantic_evidence_links
          WHERE analysis_id=$1 AND finding_key=$2 AND evidence_id=$3 AND relation=$4`,
        [analysis.id, link.findingKey, link.evidenceId, link.relation])).rows[0];
        if (!matched) fail('AGENT_PAPER_FOLLOW_UP_CITATION_INVALID');
      }
      const id = crypto.randomUUID();
      await client.query("UPDATE agent_run_actions SET status='reserved',reservation_ref=$2,updated_at=now() WHERE id=$1 AND status='authorized'",
        [action.id, `database:paper-follow-up:${id}`]);
      await client.query("UPDATE agent_run_actions SET status='sending',updated_at=now() WHERE id=$1 AND status='reserved'", [action.id]);
      await client.query("UPDATE agent_run_actions SET status='sent',provider_request_id=$2,sent_at=now(),updated_at=now() WHERE id=$1 AND status='sending'",
        [action.id, `database:paper-follow-up:${id}`]);
      await client.query("UPDATE agent_run_actions SET status='acknowledged',acknowledged_at=now(),updated_at=now() WHERE id=$1 AND status='sent'", [action.id]);
      await client.query(`INSERT INTO agent_paper_follow_up_answers(
          id,agent_user_id,semantic_analysis_id,run_id,action_id,request_id,schema_version,
          question,question_sha256,answer,uncertainty,finding_keys,policy_version,prompt_version,
          provider,model_id,answer_sha256
        ) VALUES($1,$2,$3,$4,$5,$6,1,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [id, action.agent_user_id, analysis.id, action.run_id, action.id, action.trigger_ref,
        question, verification.questionSha256, verification.answer, verification.uncertainty,
        json(verification.findingKeys), verification.policyVersion, verification.promptVersion,
        verification.provider, verification.modelId, verification.answerSha256]);
      for (const link of relations) await client.query(`INSERT INTO agent_paper_follow_up_evidence_links(
          answer_id,finding_key,evidence_id,evidence_index,relation) VALUES($1,$2,$3,$4,$5)`,
      [id, link.findingKey, link.evidenceId, link.evidenceIndex, link.relation]);
      const response = { type: 'paper.semantic-follow-up', answerId: id,
        analysisId: analysis.id, answerSha256: verification.answerSha256, publicationAttempted: false };
      const succeeded = (await client.query(`UPDATE agent_run_actions SET status='succeeded',
          response_ref_json=$2,finished_at=now(),updated_at=now()
        WHERE id=$1 AND status='acknowledged' RETURNING id`, [action.id, json(response)])).rows[0];
      if (!succeeded) fail('AGENT_PAPER_FOLLOW_UP_ACTION_INVALID');
      await client.query(`INSERT INTO agent_run_events(run_id,stage_id,action_id,event_type,actor_kind,payload_json)
        VALUES($1,$2,$3,'action.succeeded','system',$4)`,
      [action.run_id, action.stage_id, action.id, json(response)]);
      return answerView({ id, semantic_analysis_id: analysis.id, run_id: action.run_id,
        request_id: action.trigger_ref, question, answer: verification.answer,
        uncertainty: verification.uncertainty, finding_keys: verification.findingKeys,
        provider: verification.provider, model_id: verification.modelId,
        policy_version: verification.policyVersion, prompt_version: verification.promptVersion,
        answer_sha256: verification.answerSha256, created_at: new Date() });
    });
  }
}

const ACTION = Object.freeze({ actionKey: 'persist-answer', actionKind: 'domain-write',
  capabilityKey: 'research.paper.follow-up', contractVersion: 1, riskLevel: 'L2' });

export function createAgentPaperFollowUpGateway({ runtimeRepository, policyService, repository } = {}) {
  if (!runtimeRepository || !policyService || !repository) fail('AGENT_PAPER_FOLLOW_UP_DEPENDENCY_REQUIRED');
  return Object.freeze({
    async persist({ agentUserId, runId, stageId, workerId, leaseToken,
      verificationArtifactId, verification }) {
      const resource = { type: 'paper.semantic-follow-up', owner: agentUserId,
        id: verification.analysisId };
      const decision = await policyService.decide({ runId, stageId, action: ACTION, resource });
      if (decision.agentUserId !== agentUserId) fail('AGENT_PAPER_FOLLOW_UP_AGENT_MISMATCH');
      const prepared = await runtimeRepository.createAction({ runId, stageId, action: ACTION,
        idempotencyKey: `paper-follow-up-persist:${runId}`,
        request: { schemaVersion: 'paper-follow-up-persist-request-v1',
          analysisId: verification.analysisId, answerSha256: verification.answerSha256,
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
        if (prepared.existing) fail('AGENT_PAPER_FOLLOW_UP_ACTION_IN_PROGRESS');
        await runtimeRepository.waitForActionConfirmation({ actionId: prepared.id, stageId,
          workerId, leaseToken });
        return { status: 'waiting-confirmation', actionId: prepared.id };
      }
      if (!prepared.existing) await runtimeRepository.transitionAction({ actionId: prepared.id,
        from: 'prepared', to: 'authorized' });
      else if (prepared.status !== 'authorized') fail('AGENT_PAPER_FOLLOW_UP_ACTION_IN_PROGRESS');
      return repository.persist({ actionId: prepared.id, verificationArtifactId, verification });
    },
  });
}
