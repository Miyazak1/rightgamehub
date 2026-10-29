import crypto from 'node:crypto';
import { PostgresAgentRuntimeRepository } from './agent-runtime-repository.mjs';
import { createAgentRuntimeWorker } from './agent-runtime-worker.mjs';
import { createAgentRuntimePolicyService } from './agent-runtime-policy-service.mjs';
import { PostgresAgentProviderGatewayRepository } from './agent-provider-gateway-repository.mjs';
import { createAgentProviderGateway } from './agent-provider-gateway.mjs';
import { createAgentDeepSeekProviderAdapter } from './agent-deepseek-provider-adapter.mjs';
import { createAgentSecretVault } from './agent-secret-vault.mjs';
import { PostgresAgentRuntimeStageArtifactRepository } from './agent-runtime-stage-artifact-repository.mjs';
import { PAPER_FOLLOW_UP_RESPONSE_SCHEMAS } from './agent-paper-follow-up-contracts.mjs';
import { createPaperFollowUpCanary } from './agent-paper-follow-up-workflow.mjs';
import { PostgresAgentPaperFollowUpRepository, createAgentPaperFollowUpGateway }
  from './agent-paper-follow-up-repository.mjs';
import { createAgentPaperFollowUpHandlers } from './agent-paper-follow-up-runtime.mjs';

const errors = {
  AGENT_PAPER_FOLLOW_UP_INPUT_INVALID: [400, '追问参数无效。'],
  AGENT_PAPER_FOLLOW_UP_OPERATOR_REQUIRED: [403, '需要管理员权限。'],
  AGENT_PAPER_FOLLOW_UP_ANALYSIS_NOT_FOUND: [404, '论文语义分析不存在或不属于这个机器人。'],
  AGENT_PAPER_FOLLOW_UP_DAILY_LIMIT: [429, '今天的论文追问次数已用完。'],
  AGENT_PAPER_FOLLOW_UP_RUN_FAILED: [422, '回答未通过证据校验，未写入问答账本。'],
  AGENT_PAPER_FOLLOW_UP_INCOMPLETE: [503, '论文追问执行暂未完成。'],
};
export class AgentPaperFollowUpServiceError extends Error {
  constructor(code, details = {}) {
    const item = errors[code] ?? [409, '论文追问失败。'];
    super(`${code}: ${item[1]}`); this.name = 'AgentPaperFollowUpServiceError';
    this.code = code; this.statusCode = item[0]; this.retryable = this.statusCode >= 500;
    this.details = details;
  }
}
const fail = (code, details) => { throw new AgentPaperFollowUpServiceError(code, details); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const uuid = value => { if (typeof value !== 'string' || !UUID.test(value)) fail('AGENT_PAPER_FOLLOW_UP_INPUT_INVALID'); return value; };
const normalizedQuestion = value => {
  if (typeof value !== 'string') fail('AGENT_PAPER_FOLLOW_UP_INPUT_INVALID');
  const question = value.trim();
  if (Array.from(question).length < 2 || Array.from(question).length > 500
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(question)) {
    fail('AGENT_PAPER_FOLLOW_UP_INPUT_INVALID');
  }
  return question;
};
const iso = value => value?.toISOString?.() ?? value ?? null;

export function createAgentPaperFollowUpService({ pool, env = process.env, authorizeOperator,
  dailyLimit = 10 } = {}) {
  if (!pool || typeof authorizeOperator !== 'function' || !env.AGENT_SECRET_ENCRYPTION_KEY) {
    fail('AGENT_PAPER_FOLLOW_UP_CONFIG_INVALID');
  }
  const runtimeRepository = new PostgresAgentRuntimeRepository(pool);
  const policyService = createAgentRuntimePolicyService({ pool });
  const providerGateway = createAgentProviderGateway({ runtimeRepository,
    governanceRepository: new PostgresAgentProviderGatewayRepository(pool), policyService,
    secretVault: createAgentSecretVault({ masterKey: env.AGENT_SECRET_ENCRYPTION_KEY }),
    adapters: { deepseek: createAgentDeepSeekProviderAdapter() },
    responseSchemas: PAPER_FOLLOW_UP_RESPONSE_SCHEMAS });
  const artifactRepository = new PostgresAgentRuntimeStageArtifactRepository(pool);
  const repository = new PostgresAgentPaperFollowUpRepository(pool, { dailyLimit });
  const followUpGateway = createAgentPaperFollowUpGateway({ runtimeRepository, policyService, repository });
  const handlers = createAgentPaperFollowUpHandlers({ repository, providerGateway,
    artifactRepository, followUpGateway });
  const canary = createPaperFollowUpCanary({ runtimeRepository, enabled: true });
  let registered = null;

  const scope = async (actor, agentUserId) => {
    const operatorId = uuid(actor?.userId);
    if (await authorizeOperator(structuredClone(actor)) !== true) {
      fail('AGENT_PAPER_FOLLOW_UP_OPERATOR_REQUIRED');
    }
    const row = (await pool.query(`SELECT user_id FROM agent_accounts
      WHERE user_id=$1 AND operator_user_id=$2 AND status='active'`,
    [uuid(agentUserId), operatorId])).rows[0];
    if (!row) fail('AGENT_PAPER_FOLLOW_UP_ANALYSIS_NOT_FOUND');
    return { agentUserId: row.user_id, operatorId };
  };
  const ensureWorkflow = operatorId => {
    if (!registered) registered = canary.register(operatorId).catch(error => { registered = null; throw error; });
    return registered;
  };
  const runView = async (agentUserId, runId) => (await pool.query(`SELECT id,status,output_type,
      output_id,error_code,error_message FROM agent_runs WHERE id=$1 AND agent_user_id=$2`,
  [runId, agentUserId])).rows[0];

  return Object.freeze({
    async readAnalysis(actor, agentUserId, analysisId) {
      ({ agentUserId } = await scope(actor, agentUserId)); analysisId = uuid(analysisId);
      const row = (await pool.query(`SELECT analysis.*,identity.title,identity.authors,
          identity.publication_year,identity.venue,version.source_url
        FROM agent_paper_semantic_analyses analysis
        JOIN agent_paper_versions version ON version.id=analysis.paper_version_id
        JOIN agent_paper_identities identity ON identity.id=version.paper_identity_id
        WHERE analysis.id=$1 AND analysis.agent_user_id=$2`, [analysisId, agentUserId])).rows[0];
      if (!row) fail('AGENT_PAPER_FOLLOW_UP_ANALYSIS_NOT_FOUND');
      const evidence = (await pool.query(`SELECT DISTINCT link.finding_key,link.relation,
          evidence.id,evidence.quote_text,evidence.quote_hash,evidence.locator
        FROM agent_paper_semantic_evidence_links link
        JOIN tool_research_evidence evidence ON evidence.id=link.evidence_id
        WHERE link.analysis_id=$1 ORDER BY link.finding_key,evidence.id,link.relation`, [analysisId])).rows
        .map(item => ({ findingKey: item.finding_key, relation: item.relation, id: item.id,
          quoteText: item.quote_text, quoteHash: item.quote_hash, locator: item.locator }));
      return { schemaVersion: 'paper-follow-up-analysis-detail-v1', private: true,
        id: row.id, paperVersionId: row.paper_version_id, title: row.title,
        authors: row.authors ?? [], year: row.publication_year, venue: row.venue,
        sourceUrl: row.source_url, findings: row.findings ?? [], limitations: row.limitations ?? [],
        followUpQuestions: row.follow_up_questions ?? [], evidence,
        analysisSha256: row.analysis_sha256, createdAt: iso(row.created_at),
        answers: await repository.list({ agentUserId, analysisId, limit: 50 }) };
    },

    async list(actor, agentUserId, analysisId, limit) {
      ({ agentUserId } = await scope(actor, agentUserId));
      return repository.list({ agentUserId, analysisId: uuid(analysisId), limit });
    },

    async ask(actor, agentUserId, analysisId, { question, requestId }) {
      const scoped = await scope(actor, agentUserId); agentUserId = scoped.agentUserId;
      analysisId = uuid(analysisId); requestId = uuid(requestId);
      const input = { schemaVersion: 'paper-follow-up-run-input-v1', analysisId,
        question: normalizedQuestion(question) };
      await ensureWorkflow(scoped.operatorId);
      const created = await canary.createRun({ agentUserId, requestId, input,
        config: { model: { provider: 'deepseek', modelId: 'deepseek-flash' } } });
      let run = await runView(agentUserId, created.id);
      if (run?.status === 'succeeded') return repository.getByRun({ agentUserId, runId: run.id });
      if (run?.status === 'failed' || run?.status === 'cancelled') {
        fail('AGENT_PAPER_FOLLOW_UP_RUN_FAILED', { runId: run.id, errorCode: run.error_code });
      }
      const worker = createAgentRuntimeWorker({ repository: runtimeRepository, handlers,
        targetRunId: created.id,
        workerId: `paper-follow-up-${created.id}-${crypto.randomUUID().slice(0, 8)}`.slice(0, 120),
        instanceId: crypto.randomUUID(), leaseSeconds: 180, heartbeatSeconds: 30,
        pollMilliseconds: 250, recoveryBatch: 1, outboxBatch: 1 });
      for (let step = 0; step < 8; step += 1) {
        await worker.runOnce();
        run = await runView(agentUserId, created.id);
        if (run?.status === 'succeeded') {
          const answer = await repository.getByRun({ agentUserId, runId: run.id });
          if (!answer) fail('AGENT_PAPER_FOLLOW_UP_INCOMPLETE', { runId: run.id });
          return answer;
        }
        if (run?.status === 'failed' || run?.status === 'cancelled') {
          fail('AGENT_PAPER_FOLLOW_UP_RUN_FAILED', { runId: run.id, errorCode: run.error_code });
        }
      }
      fail('AGENT_PAPER_FOLLOW_UP_INCOMPLETE', { runId: created.id });
    },
  });
}
