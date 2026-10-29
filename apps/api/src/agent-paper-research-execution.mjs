import crypto from 'node:crypto';
import { stableHash } from './researcher-qa-protocol/stable-json.mjs';
import { ARXIV_PAPER_READ_TOOL } from './agent-arxiv-paper-tool.mjs';
import { PAPER_SEMANTIC_WORKFLOW_KEY } from './agent-paper-semantic-contracts.mjs';

export const PAPER_RESEARCH_EXECUTION_WORKFLOW_KEY = 'paper.private.research';

export const PAPER_RESEARCH_EXECUTION_WORKFLOW = Object.freeze({
  schemaVersion: 'agent-workflow-v1',
  workflowKey: PAPER_RESEARCH_EXECUTION_WORKFLOW_KEY,
  workflowVersion: 1,
  inputSchema: 'paper-private-research-input-v1',
  outputSchema: 'paper-private-research-output-v1',
  requiredCapabilities: [
    { key: 'research.paper.read', version: 2 },
    { key: 'provider.text.generate', version: 1 },
    { key: 'research.paper.analyze', version: 1 },
  ],
  defaultBudget: { providerCalls: 1, toolCalls: 1, inputTokens: 60000,
    outputTokens: 7000, wallClockSeconds: 1800 },
  stages: [
    { key: 'resolve-source', kind: 'deterministic', dependsOn: [], maxAttempts: 1,
      timeoutSeconds: 60 },
    { key: 'acquire-source', kind: 'tool', dependsOn: ['resolve-source'], maxAttempts: 3,
      timeoutSeconds: 180, capability: { key: 'research.paper.read', version: 2 },
      idempotencyMode: 'key' },
    { key: 'verify-eligibility', kind: 'deterministic', dependsOn: ['acquire-source'],
      maxAttempts: 1, timeoutSeconds: 60 },
    { key: 'reconstruct-sections', kind: 'deterministic', dependsOn: ['verify-eligibility'],
      maxAttempts: 1, timeoutSeconds: 60 },
    { key: 'extract-semantics', kind: 'provider', dependsOn: ['reconstruct-sections'],
      maxAttempts: 2, timeoutSeconds: 600,
      capability: { key: 'provider.text.generate', version: 1 }, idempotencyMode: 'key' },
    { key: 'verify-semantics', kind: 'deterministic', dependsOn: ['extract-semantics'],
      maxAttempts: 1, timeoutSeconds: 120 },
    { key: 'persist-analysis', kind: 'domain-write', dependsOn: ['verify-semantics'],
      maxAttempts: 1, timeoutSeconds: 120,
      capability: { key: 'research.paper.analyze', version: 1 }, idempotencyMode: 'queryable' },
    { key: 'finalize-queue', kind: 'domain-write', dependsOn: ['persist-analysis'],
      maxAttempts: 1, timeoutSeconds: 60,
      capability: { key: 'research.paper.analyze', version: 1 },
      idempotencyMode: 'queryable' },
  ],
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);
const BLOCKING = new Set([
  'PAPER_RESEARCH_FULLTEXT_REQUIRED',
  'PAPER_RESEARCH_IDENTITY_REQUIRED',
  'PAPER_RESEARCH_USER_PDF_EXTERNAL_PROCESSING_FORBIDDEN',
  'PAPER_RESEARCH_PARSE_QUALITY_BLOCKED',
]);

export class AgentPaperResearchExecutionError extends Error {
  constructor(code, { retryable = false, details = null } = {}) {
    super(code);
    this.name = 'AgentPaperResearchExecutionError';
    this.code = code;
    this.retryable = retryable;
    this.details = details;
    this.statusCode = code.endsWith('_NOT_FOUND') ? 404
      : code.endsWith('_REQUIRED') ? 403
        : code.endsWith('_CONFLICT') || code.endsWith('_BUSY') ? 409 : 400;
  }
}

const fail = (code, options) => { throw new AgentPaperResearchExecutionError(code, options); };
const json = value => JSON.stringify(value);
const iso = value => value?.toISOString?.() ?? value ?? null;
const uuid = value => {
  if (typeof value !== 'string' || !UUID.test(value)) fail('PAPER_RESEARCH_INPUT_INVALID');
  return value;
};

export function normalizePaperResearchExecutionInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['schemaVersion', 'executionId', 'queueItemId',
      'externalProcessingConsent'].includes(key))
    || value.schemaVersion !== 'paper-private-research-input-v1'
    || !UUID.test(value.executionId ?? '') || !UUID.test(value.queueItemId ?? '')
    || typeof value.externalProcessingConsent !== 'boolean') {
    fail('PAPER_RESEARCH_INPUT_INVALID');
  }
  return structuredClone(value);
}

const prerequisite = (context, stageKey) => {
  const stage = context.prerequisites.find(item => item.stageKey === stageKey && item.status === 'succeeded');
  if (!stage) fail('PAPER_RESEARCH_PREREQUISITE_INVALID');
  return stage.outputRef ?? {};
};

const executionView = row => ({
  id: row.id, queueItemId: row.queue_item_id, requestId: row.request_id,
  attemptNumber: row.attempt_number, runtimeRunId: row.runtime_run_id,
  paperVersionId: row.paper_version_id, status: row.effective_status ?? row.status,
  storedStatus: row.status, stageKey: row.effective_stage_key ?? row.stage_key,
  accessLevel: row.access_level, inputSnapshot: row.input_snapshot,
  result: row.result_json, errorCode: row.effective_error_code ?? row.error_code,
  createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), finishedAt: iso(row.finished_at),
  runtime: row.runtime_run_id ? { status: row.run_status, errorCode: row.run_error_code,
    outputType: row.output_type, outputId: row.output_id } : null,
});

async function appendEvent(client, { executionId, agentUserId, actorKind, actorRef = null,
  eventType, stageKey, payload = {} }) {
  await client.query(`INSERT INTO agent_paper_research_execution_events(
      id,execution_id,agent_user_id,actor_kind,actor_ref,event_type,stage_key,payload_json
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [crypto.randomUUID(), executionId, agentUserId,
    actorKind, actorRef, eventType, stageKey, json(payload)]);
}

async function executionContext(pool, context, { lock = false } = {}) {
  const input = normalizePaperResearchExecutionInput(context.run.input);
  const row = (await pool.query(`SELECT execution.*,item.state AS queue_state,
      item.paper_identity_id,item.source_candidate_id,candidate.arxiv_id,candidate.canonical_doi,
      candidate.local_document_id,candidate.title,candidate.candidate_sha256
    FROM agent_paper_research_executions execution
    JOIN agent_paper_research_queue_items item ON item.id=execution.queue_item_id
    JOIN agent_paper_discovery_candidates candidate ON candidate.id=item.source_candidate_id
    WHERE execution.id=$1 AND execution.agent_user_id=$2 AND execution.queue_item_id=$3
      AND execution.runtime_run_id=$4${lock ? ' FOR UPDATE OF execution,item' : ''}`,
  [input.executionId, context.run.agentUserId, input.queueItemId, context.run.id])).rows[0];
  if (!row) fail('PAPER_RESEARCH_EXECUTION_NOT_FOUND');
  return { input, row };
}

async function latestVersion(pool, row) {
  if (!row.paper_identity_id) return null;
  return (await pool.query(`SELECT version.*,assessment.reliability_grade,
      assessment.permitted_uses,assessment.reason_codes
    FROM agent_paper_versions version
    LEFT JOIN agent_paper_parse_assessments assessment ON assessment.paper_version_id=version.id
    WHERE version.paper_identity_id=$1
    ORDER BY CASE version.access_level WHEN 'fulltext-open' THEN 0
      WHEN 'fulltext-user-provided' THEN 1 ELSE 2 END,version.created_at DESC,version.id DESC
    LIMIT 1`, [row.paper_identity_id])).rows[0] ?? null;
}

async function markStage(pool, context, stageKey, payload = {}) {
  const { row } = await executionContext(pool, context);
  if (TERMINAL.has(row.status)) return;
  await pool.query(`UPDATE agent_paper_research_executions
    SET status='running',stage_key=$2,error_code=NULL WHERE id=$1`, [row.id, stageKey]);
  await appendEvent(pool, { executionId: row.id, agentUserId: row.agent_user_id,
    actorKind: 'worker', eventType: 'execution.stage', stageKey, payload });
}

async function markFailure(pool, context, stageKey, error) {
  let scoped;
  try { scoped = await executionContext(pool, context); } catch { return; }
  if (TERMINAL.has(scoped.row.status)) return;
  const code = String(error?.code ?? 'PAPER_RESEARCH_STAGE_FAILED').slice(0, 120);
  if (error?.retryable === true) {
    await appendEvent(pool, { executionId: scoped.row.id, agentUserId: scoped.row.agent_user_id,
      actorKind: 'worker', eventType: 'execution.stage', stageKey,
      payload: { outcome: 'retryable-failure', errorCode: code } });
    return;
  }
  const status = BLOCKING.has(code) ? 'blocked' : 'failed';
  await pool.query(`UPDATE agent_paper_research_executions SET status=$2,stage_key=$3,
    error_code=$4,finished_at=CASE WHEN $2='failed' THEN now() ELSE NULL END WHERE id=$1`,
  [scoped.row.id, status, stageKey, code]);
  await appendEvent(pool, { executionId: scoped.row.id, agentUserId: scoped.row.agent_user_id,
    actorKind: 'worker', eventType: status === 'blocked' ? 'execution.blocked' : 'execution.failed',
    stageKey, payload: { errorCode: code } });
}

function wrapStage(pool, stageKey, handler) {
  return async (context, execution) => {
    await markStage(pool, context, stageKey);
    try { return await handler(context, execution); }
    catch (error) { await markFailure(pool, context, stageKey, error); throw error; }
  };
}

export function createAgentPaperResearchExecutionHandlers({ pool, toolGateway,
  evidenceRepository, semanticHandlers } = {}) {
  if (!pool || !toolGateway || !evidenceRepository || !semanticHandlers) {
    fail('PAPER_RESEARCH_DEPENDENCY_REQUIRED');
  }
  const semantic = stageKey => semanticHandlers[`${PAPER_SEMANTIC_WORKFLOW_KEY}:${stageKey}`];
  for (const key of ['verify-eligibility', 'reconstruct-sections', 'extract-semantics',
    'verify-semantics', 'persist-analysis']) if (typeof semantic(key) !== 'function') {
    fail('PAPER_RESEARCH_DEPENDENCY_REQUIRED');
  }
  const withSemanticInput = async (stageKey, context, execution) => {
    const acquired = prerequisite(context, 'acquire-source');
    if (!UUID.test(acquired.paperVersionId ?? '')) fail('PAPER_RESEARCH_VERSION_REQUIRED');
    const input = { schemaVersion: 'paper-semantic-run-input-v1',
      paperVersionId: acquired.paperVersionId, purpose: 'private-research' };
    const result = await semantic(stageKey)({ ...context,
      run: { ...context.run, input, inputSha256: stableHash(input) } }, execution);
    return stageKey === 'persist-analysis' ? { outputRef: result.outputRef } : result;
  };
  return Object.freeze({
    [`${PAPER_RESEARCH_EXECUTION_WORKFLOW_KEY}:resolve-source`]: wrapStage(pool,
      'resolve-source', async context => {
        const { input, row } = await executionContext(pool, context);
        if (row.queue_state !== 'queued') fail('PAPER_RESEARCH_QUEUE_NOT_READY');
        const version = await latestVersion(pool, row);
        if (version?.access_level === 'fulltext-user-provided') {
          // Rights to store/read a file are not the same as permission to send it
          // to an external model. R1.8 deliberately fails closed here.
          fail('PAPER_RESEARCH_USER_PDF_EXTERNAL_PROCESSING_FORBIDDEN');
        }
        if (version?.access_level === 'fulltext-open') return { outputRef: {
          schemaVersion: 'paper-research-source-resolution-v1', mode: 'existing-open-fulltext',
          paperVersionId: version.id, accessLevel: version.access_level,
          externalProcessingConsent: input.externalProcessingConsent } };
        if (row.arxiv_id) return { outputRef: {
          schemaVersion: 'paper-research-source-resolution-v1', mode: 'acquire-arxiv-open-fulltext',
          arxivId: row.arxiv_id, paperVersionId: null, accessLevel: 'metadata-only',
          externalProcessingConsent: input.externalProcessingConsent } };
        if (!row.paper_identity_id) fail('PAPER_RESEARCH_IDENTITY_REQUIRED');
        fail('PAPER_RESEARCH_FULLTEXT_REQUIRED');
      }),

    [`${PAPER_RESEARCH_EXECUTION_WORKFLOW_KEY}:acquire-source`]: wrapStage(pool,
      'acquire-source', async (context, execution) => {
        const source = prerequisite(context, 'resolve-source');
        if (UUID.test(source.paperVersionId ?? '')) return { outputRef: source };
        if (source.mode !== 'acquire-arxiv-open-fulltext' || !source.arxivId) {
          fail('PAPER_RESEARCH_FULLTEXT_REQUIRED');
        }
        const result = await toolGateway.invoke({ runId: context.run.id, stageId: context.stage.id,
          workerId: execution.workerId, leaseToken: execution.leaseToken,
          action: { actionKey: 'acquire-arxiv-open-fulltext', actionKind: 'tool',
            capabilityKey: 'research.paper.read', contractVersion: 2, riskLevel: 'L1' },
          idempotencyKey: `paper-research-acquire:${context.run.id}`,
          resource: { type: 'paper.arxiv', owner: 'public', id: source.arxivId },
          tool: { toolKey: ARXIV_PAPER_READ_TOOL.toolKey,
            contractVersion: ARXIV_PAPER_READ_TOOL.contractVersion },
          request: { paper: source.arxivId } });
        if (result.status !== 'succeeded') fail('PAPER_RESEARCH_ACQUISITION_INCOMPLETE',
          { retryable: true });
        const archived = await evidenceRepository.archiveSourceArtifact({ runId: context.run.id,
          stageId: context.stage.id, actionId: result.actionId, toolArtifactId: result.artifactId,
          workerId: execution.workerId, leaseToken: execution.leaseToken });
        if (!UUID.test(archived.paperVersionId ?? '')) fail('PAPER_RESEARCH_ARCHIVE_INCOMPLETE');
        const { row } = await executionContext(pool, context);
        await pool.query(`UPDATE agent_paper_research_executions
          SET paper_version_id=$2,access_level='fulltext-open' WHERE id=$1`,
        [row.id, archived.paperVersionId]);
        return { outputRef: { schemaVersion: 'paper-research-acquisition-ref-v1',
          mode: 'acquired-arxiv-open-fulltext', paperVersionId: archived.paperVersionId,
          accessLevel: 'fulltext-open', evidenceCount: archived.evidenceCount,
          parseQuality: archived.parseQuality ?? null } };
      }),

    ...Object.fromEntries(['verify-eligibility', 'reconstruct-sections', 'extract-semantics',
      'verify-semantics', 'persist-analysis'].map(stageKey => [
      `${PAPER_RESEARCH_EXECUTION_WORKFLOW_KEY}:${stageKey}`,
      wrapStage(pool, stageKey, (context, execution) => withSemanticInput(stageKey, context, execution)),
    ])),

    [`${PAPER_RESEARCH_EXECUTION_WORKFLOW_KEY}:finalize-queue`]: wrapStage(pool,
      'finalize-queue', async context => {
        const saved = prerequisite(context, 'persist-analysis');
        const acquired = prerequisite(context, 'acquire-source');
        if (!UUID.test(saved.analysisId ?? '') || !UUID.test(acquired.paperVersionId ?? '')) {
          fail('PAPER_RESEARCH_FINALIZATION_INVALID');
        }
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const { row } = await executionContext(client, context, { lock: true });
          if (row.status === 'succeeded') {
            await client.query('COMMIT');
            return { outputRef: row.result_json,
              runOutput: { type: 'paper.private-research', id: row.id } };
          }
          if (row.queue_state !== 'queued') fail('PAPER_RESEARCH_QUEUE_NOT_READY');
          const result = { schemaVersion: 'paper-private-research-result-v1',
            executionId: row.id, queueItemId: row.queue_item_id,
            paperVersionId: acquired.paperVersionId, analysisId: saved.analysisId,
            analysisSha256: saved.analysisSha256, private: true,
            publicationAttempted: false };
          await client.query(`UPDATE agent_paper_research_executions SET status='succeeded',
            stage_key='finalize-queue',paper_version_id=$2,access_level='fulltext-open',
            result_json=$3,error_code=NULL,finished_at=now() WHERE id=$1`,
          [row.id, acquired.paperVersionId, json(result)]);
          await client.query(`UPDATE agent_paper_research_queue_items
            SET state='completed',reason='private research completed' WHERE id=$1`,
          [row.queue_item_id]);
          await client.query(`INSERT INTO agent_paper_research_queue_events(
              id,queue_item_id,agent_user_id,operator_user_id,previous_state,next_state,reason
            ) VALUES($1,$2,$3,$4,'queued','completed','private research execution succeeded')`,
          [crypto.randomUUID(), row.queue_item_id, row.agent_user_id, row.operator_user_id]);
          await appendEvent(client, { executionId: row.id, agentUserId: row.agent_user_id,
            actorKind: 'worker', eventType: 'execution.succeeded', stageKey: 'finalize-queue',
            payload: result });
          await client.query('COMMIT');
          return { outputRef: result,
            runOutput: { type: 'paper.private-research', id: row.id } };
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
      }),
  });
}

export function createPaperResearchExecutionCanary({ runtimeRepository, enabled = true } = {}) {
  if (!runtimeRepository) fail('PAPER_RESEARCH_DEPENDENCY_REQUIRED');
  const requireEnabled = () => { if (enabled !== true) fail('PAPER_RESEARCH_DISABLED'); };
  return Object.freeze({
    async register(actorUserId) {
      requireEnabled(); uuid(actorUserId);
      const registered = await runtimeRepository.registerWorkflow({ actorUserId,
        manifest: PAPER_RESEARCH_EXECUTION_WORKFLOW, status: 'draft' });
      if (registered.status === 'draft') await runtimeRepository.activateWorkflow(
        PAPER_RESEARCH_EXECUTION_WORKFLOW.workflowKey,
        PAPER_RESEARCH_EXECUTION_WORKFLOW.workflowVersion);
      return PAPER_RESEARCH_EXECUTION_WORKFLOW;
    },
    async createRun({ agentUserId, idempotencyKey, triggerRef, input, config = {} }) {
      requireEnabled();
      return runtimeRepository.createRun({ agentUserId,
        workflowKey: PAPER_RESEARCH_EXECUTION_WORKFLOW.workflowKey,
        workflowVersion: PAPER_RESEARCH_EXECUTION_WORKFLOW.workflowVersion,
        triggerKind: 'manual', triggerRef, idempotencyKey,
        input: normalizePaperResearchExecutionInput(input), config,
        budget: PAPER_RESEARCH_EXECUTION_WORKFLOW.defaultBudget });
    },
  });
}

export function createAgentPaperResearchExecutionService({ pool, runtimeRepository,
  authorizeOperator, provider = 'deepseek', modelId = 'deepseek-flash' } = {}) {
  if (!pool || !runtimeRepository || typeof authorizeOperator !== 'function') {
    fail('PAPER_RESEARCH_DEPENDENCY_REQUIRED');
  }
  const canary = createPaperResearchExecutionCanary({ runtimeRepository, enabled: true });
  const scope = async (actor, agentUserId) => {
    const operatorId = uuid(actor?.userId); agentUserId = uuid(agentUserId);
    if (await authorizeOperator(structuredClone(actor)) !== true) fail('PAPER_RESEARCH_OPERATOR_REQUIRED');
    const account = (await pool.query(`SELECT user_id,operator_user_id FROM agent_accounts
      WHERE user_id=$1 AND operator_user_id=$2 AND status='active'`,
    [agentUserId, operatorId])).rows[0];
    if (!account) fail('PAPER_RESEARCH_AGENT_NOT_FOUND');
    return { agentUserId, operatorId };
  };
  const load = async (agentUserId, executionId) => {
    const row = (await pool.query(`SELECT execution.*,run.status AS run_status,
        run.error_code AS run_error_code,run.output_type,run.output_id,
        COALESCE((SELECT stage.stage_key FROM agent_run_stages stage
          WHERE stage.run_id=run.id AND stage.status IN ('running','leased','queued')
          ORDER BY stage.ordinal LIMIT 1),execution.stage_key) AS effective_stage_key,
        CASE WHEN execution.status IN ('queued','running') AND run.status IN ('failed','rejected','uncertain')
          THEN 'failed' WHEN execution.status IN ('queued','running') AND run.status='cancelled'
          THEN 'cancelled' ELSE execution.status END AS effective_status,
        CASE WHEN execution.status IN ('queued','running') AND run.status IN ('failed','rejected','uncertain')
          THEN COALESCE(run.error_code,execution.error_code) ELSE execution.error_code END AS effective_error_code
      FROM agent_paper_research_executions execution
      LEFT JOIN agent_runs run ON run.id=execution.runtime_run_id
      WHERE execution.agent_user_id=$1 AND execution.id=$2`, [agentUserId, executionId])).rows[0];
    if (!row) fail('PAPER_RESEARCH_EXECUTION_NOT_FOUND');
    return executionView(row);
  };
  const start = async (actor, agentUserId, queueItemId, { requestId,
    externalProcessingConsent = false } = {}) => {
    const scoped = await scope(actor, agentUserId); queueItemId = uuid(queueItemId);
    requestId = uuid(requestId);
    if (externalProcessingConsent !== false) {
      // R1.8 does not yet claim a user-PDF external processing consent contract.
      fail('PAPER_RESEARCH_EXTERNAL_CONSENT_UNSUPPORTED');
    }
    const prior = (await pool.query(`SELECT id,queue_item_id,input_snapshot
      FROM agent_paper_research_executions WHERE agent_user_id=$1 AND request_id=$2`,
    [scoped.agentUserId, requestId])).rows[0];
    if (prior) {
      if (prior.queue_item_id !== queueItemId
        || prior.input_snapshot?.externalProcessingConsent !== externalProcessingConsent) {
        fail('PAPER_RESEARCH_IDEMPOTENCY_CONFLICT');
      }
      return load(scoped.agentUserId, prior.id);
    }
    const item = (await pool.query(`SELECT item.*,candidate.arxiv_id,candidate.canonical_doi,
        candidate.local_document_id,candidate.candidate_sha256
      FROM agent_paper_research_queue_items item
      JOIN agent_paper_discovery_candidates candidate ON candidate.id=item.source_candidate_id
      WHERE item.id=$1 AND item.agent_user_id=$2`, [queueItemId, scoped.agentUserId])).rows[0];
    if (!item) fail('PAPER_RESEARCH_QUEUE_NOT_FOUND');
    if (item.state !== 'queued') fail('PAPER_RESEARCH_QUEUE_NOT_READY');
    const active = (await pool.query(`SELECT id FROM agent_paper_research_executions
      WHERE queue_item_id=$1 AND status IN ('queued','running')`, [queueItemId])).rows[0];
    if (active) fail('PAPER_RESEARCH_EXECUTION_BUSY');
    const attemptNumber = Number((await pool.query(`SELECT COALESCE(max(attempt_number),0)+1 AS n
      FROM agent_paper_research_executions WHERE queue_item_id=$1`, [queueItemId])).rows[0].n);
    const executionId = crypto.randomUUID();
    const snapshot = { schemaVersion: 'paper-private-research-input-snapshot-v1',
      queueItemId, paperIdentityId: item.paper_identity_id, sourceCandidateId: item.source_candidate_id,
      arxivId: item.arxiv_id, doi: item.canonical_doi, localDocumentId: item.local_document_id,
      candidateSha256: item.candidate_sha256, externalProcessingConsent,
      publicPublicationEnabled: false };
    await pool.query(`INSERT INTO agent_paper_research_executions(
        id,agent_user_id,operator_user_id,queue_item_id,request_id,attempt_number,status,
        stage_key,access_level,input_snapshot
      ) VALUES($1,$2,$3,$4,$5,$6,'queued','resolve-source','unknown',$7)`,
    [executionId, scoped.agentUserId, scoped.operatorId, queueItemId, requestId,
      attemptNumber, json(snapshot)]);
    await appendEvent(pool, { executionId, agentUserId: scoped.agentUserId,
      actorKind: 'operator', actorRef: scoped.operatorId, eventType: 'execution.created',
      stageKey: 'resolve-source', payload: { requestId, attemptNumber } });
    try {
      await canary.register(scoped.operatorId);
      const run = await canary.createRun({ agentUserId: scoped.agentUserId,
        triggerRef: executionId, idempotencyKey: `paper-research:${executionId}`,
        input: { schemaVersion: 'paper-private-research-input-v1', executionId, queueItemId,
          externalProcessingConsent }, config: { model: { provider, modelId } } });
      await pool.query(`UPDATE agent_paper_research_executions
        SET runtime_run_id=$2,status='running' WHERE id=$1`, [executionId, run.id]);
      await appendEvent(pool, { executionId, agentUserId: scoped.agentUserId,
        actorKind: 'system', eventType: 'execution.started', stageKey: 'resolve-source',
        payload: { runtimeRunId: run.id } });
    } catch (error) {
      await pool.query(`UPDATE agent_paper_research_executions SET status='failed',
        error_code=$2,finished_at=now() WHERE id=$1`, [executionId,
        String(error?.code ?? 'PAPER_RESEARCH_RUN_CREATE_FAILED').slice(0, 120)]);
      throw error;
    }
    return load(scoped.agentUserId, executionId);
  };
  return Object.freeze({
    async list(actor, agentUserId, limit = 50) {
      const scoped = await scope(actor, agentUserId);
      limit = Math.min(100, Math.max(1, Number(limit) || 50));
      const rows = (await pool.query(`SELECT execution.id FROM agent_paper_research_executions execution
        WHERE execution.agent_user_id=$1 ORDER BY execution.created_at DESC,execution.id DESC LIMIT $2`,
      [scoped.agentUserId, limit])).rows;
      return Promise.all(rows.map(row => load(scoped.agentUserId, row.id)));
    },
    start,
    async retry(actor, agentUserId, executionId, { requestId }) {
      const scoped = await scope(actor, agentUserId); executionId = uuid(executionId);
      const prior = await load(scoped.agentUserId, executionId);
      if (!['blocked', 'failed', 'cancelled'].includes(prior.status)) {
        fail('PAPER_RESEARCH_EXECUTION_BUSY');
      }
      return start(actor, agentUserId, prior.queueItemId, { requestId,
        externalProcessingConsent: false });
    },
    async cancel(actor, agentUserId, executionId, reason) {
      const scoped = await scope(actor, agentUserId); executionId = uuid(executionId);
      if (typeof reason !== 'string' || reason.trim().length < 3 || reason.trim().length > 1000) {
        fail('PAPER_RESEARCH_INPUT_INVALID');
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const row = (await client.query(`SELECT * FROM agent_paper_research_executions
          WHERE id=$1 AND agent_user_id=$2 FOR UPDATE`, [executionId, scoped.agentUserId])).rows[0];
        if (!row) fail('PAPER_RESEARCH_EXECUTION_NOT_FOUND');
        if (TERMINAL.has(row.status)) { await client.query('COMMIT'); return load(scoped.agentUserId, executionId); }
        if (row.runtime_run_id) {
          const active = Number((await client.query(`SELECT count(*)::int AS n FROM agent_run_stages
            WHERE run_id=$1 AND status IN ('leased','running')`, [row.runtime_run_id])).rows[0].n);
          if (active) fail('PAPER_RESEARCH_EXECUTION_BUSY');
          await client.query(`UPDATE agent_run_stages SET status='cancelled',finished_at=now(),updated_at=now()
            WHERE run_id=$1 AND status IN ('queued','blocked')`, [row.runtime_run_id]);
          await client.query(`UPDATE agent_runs SET status='cancelled',error_code='OPERATOR_CANCELLED',
            error_message=$2,finished_at=now(),updated_at=now()
            WHERE id=$1 AND status IN ('queued','waiting','running')`, [row.runtime_run_id, reason.trim()]);
        }
        await client.query(`UPDATE agent_paper_research_executions SET status='cancelled',
          error_code=NULL,finished_at=now() WHERE id=$1`, [executionId]);
        await appendEvent(client, { executionId, agentUserId: scoped.agentUserId,
          actorKind: 'operator', actorRef: scoped.operatorId, eventType: 'execution.cancelled',
          stageKey: row.stage_key, payload: { reason: reason.trim() } });
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
      return load(scoped.agentUserId, executionId);
    },
  });
}
