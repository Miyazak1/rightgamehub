import crypto from 'node:crypto';
import { withTransaction } from './database.mjs';
import { stableHash } from './researcher-qa-protocol/stable-json.mjs';

export class AgentProviderGatewayRepositoryError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AgentProviderGatewayRepositoryError';
    this.code = code;
  }
}

const fail = code => { throw new AgentProviderGatewayRepositoryError(code); };
const json = value => JSON.stringify(value);
const integer = (value, min, max, code) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(code);
  return value;
};
const text = (value, max, code) => {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) fail(code);
  return value;
};

const usage = (value = {}) => ({
  providerCalls: integer(value.providerCalls ?? 1, 0, 1000, 'AGENT_PROVIDER_USAGE_INVALID'),
  inputTokens: integer(value.inputTokens ?? 0, 0, 10_000_000, 'AGENT_PROVIDER_USAGE_INVALID'),
  outputTokens: integer(value.outputTokens ?? 0, 0, 2_000_000, 'AGENT_PROVIDER_USAGE_INVALID'),
  costMicrousd: integer(value.costMicrousd ?? 0, 0, 1_000_000_000_000, 'AGENT_PROVIDER_USAGE_INVALID'),
});

const limitSet = (value, fallback) => {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    providerCalls: integer(Math.min(source.providerCalls ?? fallback.providerCalls, fallback.providerCalls), 0, 1_000_000, 'AGENT_BUDGET_LIMIT_INVALID'),
    inputTokens: integer(Math.min(source.inputTokens ?? fallback.inputTokens, fallback.inputTokens), 0, 1_000_000_000, 'AGENT_BUDGET_LIMIT_INVALID'),
    outputTokens: integer(Math.min(source.outputTokens ?? fallback.outputTokens, fallback.outputTokens), 0, 1_000_000_000, 'AGENT_BUDGET_LIMIT_INVALID'),
    costMicrousd: integer(Math.min(source.costMicrousd ?? fallback.costMicrousd, fallback.costMicrousd), 0, 1_000_000_000_000, 'AGENT_BUDGET_LIMIT_INVALID'),
  };
};

const add = (left, right) => ({
  providerCalls: Number(left.providerCalls ?? 0) + right.providerCalls,
  inputTokens: Number(left.inputTokens ?? 0) + right.inputTokens,
  outputTokens: Number(left.outputTokens ?? 0) + right.outputTokens,
  costMicrousd: Number(left.costMicrousd ?? 0) + right.costMicrousd,
});

const within = (used, limits) => Object.keys(limits).every(key => used[key] <= limits[key]);

function totals(row = {}) {
  return {
    providerCalls: Number(row.provider_calls ?? 0), inputTokens: Number(row.input_tokens ?? 0),
    outputTokens: Number(row.output_tokens ?? 0), costMicrousd: Number(row.cost_microusd ?? 0),
  };
}

const aggregateSql = where => `SELECT
  COALESCE(sum(CASE WHEN status='reserved' THEN reserved_provider_calls ELSE charged_provider_calls END),0)::bigint AS provider_calls,
  COALESCE(sum(CASE WHEN status='reserved' THEN reserved_input_tokens ELSE charged_input_tokens END),0)::bigint AS input_tokens,
  COALESCE(sum(CASE WHEN status='reserved' THEN reserved_output_tokens ELSE charged_output_tokens END),0)::bigint AS output_tokens,
  COALESCE(sum(CASE WHEN status='reserved' THEN reserved_cost_microusd ELSE charged_cost_microusd END),0)::bigint AS cost_microusd
  FROM agent_budget_reservations WHERE status IN ('reserved','settled','uncertain') AND ${where}`;

export function normalizeModelPolicy(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('AGENT_MODEL_POLICY_INVALID');
  const result = {
    taskClass: text(value.taskClass, 120, 'AGENT_MODEL_POLICY_INVALID'),
    requiresJsonSchema: value.requiresJsonSchema === true,
    maxInputTokens: integer(value.maxInputTokens, 1, 100_000_000, 'AGENT_MODEL_POLICY_INVALID'),
    maxOutputTokens: integer(value.maxOutputTokens, 1, 10_000_000, 'AGENT_MODEL_POLICY_INVALID'),
    maxCostMicrousd: integer(value.maxCostMicrousd, 0, 1_000_000_000_000, 'AGENT_MODEL_POLICY_INVALID'),
    latencyClass: text(value.latencyClass, 40, 'AGENT_MODEL_POLICY_INVALID'),
  };
  if (value.preferredProvider != null) result.preferredProvider = text(value.preferredProvider, 80, 'AGENT_MODEL_POLICY_INVALID');
  if (value.preferredModel != null) result.preferredModel = text(value.preferredModel, 160, 'AGENT_MODEL_POLICY_INVALID');
  return result;
}

export class PostgresAgentProviderGatewayRepository {
  constructor(pool, {
    agentMonthlyLimits = { providerCalls: 200, inputTokens: 10_000_000, outputTokens: 2_000_000, costMicrousd: 100_000_000 },
    platformMonthlyLimits = { providerCalls: 20_000, inputTokens: 1_000_000_000, outputTokens: 200_000_000, costMicrousd: 10_000_000_000 },
    circuitFailureThreshold = 3, circuitCooldownSeconds = 300,
  } = {}) {
    this.pool = pool;
    this.agentMonthlyLimits = limitSet({}, agentMonthlyLimits);
    this.platformMonthlyLimits = limitSet({}, platformMonthlyLimits);
    this.circuitFailureThreshold = integer(circuitFailureThreshold, 1, 100, 'AGENT_PROVIDER_CIRCUIT_CONFIG_INVALID');
    this.circuitCooldownSeconds = integer(circuitCooldownSeconds, 1, 86400, 'AGENT_PROVIDER_CIRCUIT_CONFIG_INVALID');
  }

  async registerModel(input) {
    if (!Array.isArray(input.taskClasses) || input.taskClasses.length < 1 || input.taskClasses.length > 32
      || new Set(input.taskClasses).size !== input.taskClasses.length
      || input.taskClasses.some(item => typeof item !== 'string' || !/^[a-z][a-z0-9.-]{2,119}$/u.test(item))) fail('AGENT_PROVIDER_MODEL_INVALID');
    if (!['active', 'disabled', 'retired'].includes(input.status ?? 'active')) fail('AGENT_PROVIDER_MODEL_INVALID');
    const policy = normalizeModelPolicy({
      taskClass: input.taskClasses?.[0], requiresJsonSchema: input.supportsJsonSchema,
      maxInputTokens: input.maxInputTokens, maxOutputTokens: input.maxOutputTokens,
      maxCostMicrousd: 0, latencyClass: 'catalog',
    });
    void policy;
    const row = (await this.pool.query(`INSERT INTO agent_provider_models(
        provider,model_id,catalog_version,status,task_classes,supports_json_schema,max_input_tokens,max_output_tokens,
        input_price_microusd_per_million,output_price_microusd_per_million,config_json
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT(provider,model_id,catalog_version) DO NOTHING RETURNING *`, [
      text(input.provider, 80, 'AGENT_PROVIDER_MODEL_INVALID'), text(input.modelId, 160, 'AGENT_PROVIDER_MODEL_INVALID'),
      integer(input.catalogVersion, 1, 2147483647, 'AGENT_PROVIDER_MODEL_INVALID'), input.status ?? 'active', input.taskClasses,
      input.supportsJsonSchema === true, input.maxInputTokens, input.maxOutputTokens,
      integer(input.inputPriceMicrousdPerMillion, 0, 1_000_000_000_000, 'AGENT_PROVIDER_MODEL_INVALID'),
      integer(input.outputPriceMicrousdPerMillion, 0, 1_000_000_000_000, 'AGENT_PROVIDER_MODEL_INVALID'), json(input.config ?? {}),
    ])).rows[0];
    if (row) return { provider: row.provider, modelId: row.model_id, catalogVersion: row.catalog_version, existing: false };
    const existing = (await this.pool.query(`SELECT * FROM agent_provider_models
      WHERE provider=$1 AND model_id=$2 AND catalog_version=$3`, [input.provider, input.modelId, input.catalogVersion])).rows[0];
    if (!existing || stableHash(existing.config_json) !== stableHash(input.config ?? {})
      || stableHash(existing.task_classes) !== stableHash(input.taskClasses)
      || existing.status !== (input.status ?? 'active') || existing.supports_json_schema !== (input.supportsJsonSchema === true)
      || existing.max_input_tokens !== input.maxInputTokens || existing.max_output_tokens !== input.maxOutputTokens
      || Number(existing.input_price_microusd_per_million) !== input.inputPriceMicrousdPerMillion
      || Number(existing.output_price_microusd_per_million) !== input.outputPriceMicrousdPerMillion) fail('AGENT_PROVIDER_MODEL_VERSION_CONFLICT');
    return { provider: existing.provider, modelId: existing.model_id, catalogVersion: existing.catalog_version, existing: true };
  }

  async resolveModel(input) {
    const policy = normalizeModelPolicy(input);
    const rows = (await this.pool.query(`SELECT * FROM (
      SELECT DISTINCT ON(provider,model_id) * FROM agent_provider_models
      ORDER BY provider,model_id,catalog_version DESC
    ) latest WHERE status='active' AND $1=ANY(task_classes) AND ($2=false OR supports_json_schema=true)
      AND max_input_tokens>=$3 AND max_output_tokens>=$4
      AND ($5::text IS NULL OR provider=$5) AND ($6::text IS NULL OR model_id=$6)
      ORDER BY catalog_version DESC,provider,model_id`, [policy.taskClass, policy.requiresJsonSchema,
      policy.maxInputTokens, policy.maxOutputTokens, policy.preferredProvider ?? null, policy.preferredModel ?? null])).rows;
    const candidates = rows.map(row => {
      const numerator = BigInt(policy.maxInputTokens) * BigInt(row.input_price_microusd_per_million)
        + BigInt(policy.maxOutputTokens) * BigInt(row.output_price_microusd_per_million);
      const cost = Number((numerator + 999_999n) / 1_000_000n);
      return { row, cost };
    }).filter(item => item.cost <= policy.maxCostMicrousd)
      .sort((a, b) => a.cost - b.cost || a.row.provider.localeCompare(b.row.provider) || a.row.model_id.localeCompare(b.row.model_id));
    if (!candidates.length) fail('AGENT_PROVIDER_MODEL_UNAVAILABLE');
    const { row, cost } = candidates[0];
    return {
      provider: row.provider, modelId: row.model_id, catalogVersion: row.catalog_version,
      supportsJsonSchema: row.supports_json_schema, maxInputTokens: row.max_input_tokens,
      maxOutputTokens: row.max_output_tokens, estimatedCostMicrousd: cost, config: row.config_json,
      modelPolicy: policy,
    };
  }

  async loadSecret(agentUserId, provider) {
    const row = (await this.pool.query(`SELECT ciphertext,nonce,auth_tag FROM agent_provider_secrets
      WHERE agent_user_id=$1 AND provider=$2`, [agentUserId, provider])).rows[0];
    if (!row) fail('AGENT_PROVIDER_KEY_REQUIRED');
    return row;
  }

  async getProviderCallByAction(actionId) {
    const row = (await this.pool.query(`SELECT call.*,action.status AS action_status
      FROM agent_provider_calls call JOIN agent_run_actions action ON action.id=call.action_id
      WHERE call.action_id=$1`, [actionId])).rows[0];
    return row ? {
      id: row.id, actionId: row.action_id, status: row.status, actionStatus: row.action_status,
      provider: row.provider, modelId: row.model_id, providerRequestId: row.provider_request_id,
      responseRef: row.response_ref_json, usage: row.usage_json, errorCode: row.error_code,
    } : null;
  }

  async reserveProviderCall({ actionId, model, request, promptTemplate, responseSchema, tokenCeiling, timeoutSeconds, estimatedUsage }) {
    const requested = usage(estimatedUsage);
    tokenCeiling = integer(tokenCeiling, 1, 2_000_000, 'AGENT_PROVIDER_TOKEN_CEILING_INVALID');
    timeoutSeconds = integer(timeoutSeconds, 1, 3600, 'AGENT_PROVIDER_TIMEOUT_INVALID');
    return withTransaction(this.pool, async client => {
      const action = (await client.query(`SELECT a.*,r.agent_user_id,r.budget_json,r.policy_profile_id,p.policy_json
        FROM agent_run_actions a JOIN agent_runs r ON r.id=a.run_id
        JOIN agent_policy_profiles p ON p.id=r.policy_profile_id AND p.agent_user_id=r.agent_user_id
        WHERE a.id=$1 FOR UPDATE OF a,r`, [actionId])).rows[0];
      if (!action || action.status !== 'authorized' || action.action_kind !== 'provider') fail('AGENT_PROVIDER_ACTION_NOT_AUTHORIZED');
      const existing = (await client.query('SELECT * FROM agent_budget_reservations WHERE action_id=$1', [actionId])).rows[0];
      if (existing) return { reservationId: existing.id, callId: (await client.query('SELECT id FROM agent_provider_calls WHERE action_id=$1', [actionId])).rows[0]?.id, existing: true };
      const periodMonth = (await client.query("SELECT date_trunc('month',now() AT TIME ZONE 'UTC')::date AS month")).rows[0].month;
      const periodKey = new Date(periodMonth).toISOString().slice(0, 7);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`agent-budget:${action.agent_user_id}:${periodKey}`]);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`agent-budget:platform:${periodKey}`]);
      const circuit = (await client.query(`INSERT INTO agent_provider_circuits(provider,model_id) VALUES($1,$2)
        ON CONFLICT(provider,model_id) DO UPDATE SET updated_at=agent_provider_circuits.updated_at RETURNING *`,
      [model.provider, model.modelId])).rows[0];
      if (circuit.state === 'open' && new Date(circuit.retry_at).getTime() > Date.now()) fail('AGENT_PROVIDER_CIRCUIT_OPEN');
      if (circuit.state === 'half-open' && new Date(circuit.probe_lease_until).getTime() > Date.now()) fail('AGENT_PROVIDER_CIRCUIT_OPEN');
      if (circuit.state !== 'closed') await client.query(`UPDATE agent_provider_circuits SET state='half-open',
        probe_lease_token=$3,probe_lease_until=now()+interval '60 seconds',updated_at=now() WHERE provider=$1 AND model_id=$2`,
      [model.provider, model.modelId, crypto.randomUUID()]);
      const runUsed = totals((await client.query(aggregateSql('run_id=$1'), [action.run_id])).rows[0]);
      const agentUsed = totals((await client.query(aggregateSql("agent_user_id=$1 AND period_month=date_trunc('month',now() AT TIME ZONE 'UTC')::date"), [action.agent_user_id])).rows[0]);
      const platformUsed = totals((await client.query(aggregateSql("period_month=date_trunc('month',now() AT TIME ZONE 'UTC')::date"))).rows[0]);
      const runLimits = {
        providerCalls: action.budget_json.providerCalls ?? 0, inputTokens: action.budget_json.inputTokens ?? 0,
        outputTokens: action.budget_json.outputTokens ?? 0, costMicrousd: model.modelPolicy.maxCostMicrousd,
      };
      const agentLimits = limitSet(action.policy_json?.budgets?.agentMonthly, this.agentMonthlyLimits);
      if (!within(add(runUsed, requested), runLimits)) fail('AGENT_RUN_BUDGET_EXCEEDED');
      if (!within(add(agentUsed, requested), agentLimits)) fail('AGENT_MONTHLY_BUDGET_EXCEEDED');
      if (!within(add(platformUsed, requested), this.platformMonthlyLimits)) fail('AGENT_PLATFORM_BUDGET_EXCEEDED');
      const reservationId = crypto.randomUUID();
      const callId = crypto.randomUUID();
      await client.query(`INSERT INTO agent_budget_reservations(
          id,action_id,run_id,agent_user_id,provider,model_id,period_month,status,
          reserved_provider_calls,reserved_input_tokens,reserved_output_tokens,reserved_cost_microusd
        ) VALUES($1,$2,$3,$4,$5,$6,$7,'reserved',$8,$9,$10,$11)`,
      [reservationId, action.id, action.run_id, action.agent_user_id, model.provider, model.modelId,
        periodMonth, requested.providerCalls, requested.inputTokens, requested.outputTokens, requested.costMicrousd]);
      await client.query(`INSERT INTO agent_provider_calls(
          id,action_id,reservation_id,provider,model_id,catalog_version,status,model_policy_json,
          prompt_template_key,prompt_template_version,response_schema_key,response_schema_version,
          request_sha256,token_ceiling,timeout_seconds
        ) VALUES($1,$2,$3,$4,$5,$6,'reserved',$7,$8,$9,$10,$11,$12,$13,$14)`,
      [callId, action.id, reservationId, model.provider, model.modelId, model.catalogVersion, json(model.modelPolicy),
        promptTemplate.key, promptTemplate.version, responseSchema.key, responseSchema.version,
        stableHash(request), tokenCeiling, timeoutSeconds]);
      await client.query(`UPDATE agent_run_actions SET status='reserved',reservation_ref=$2,updated_at=now()
        WHERE id=$1 AND status='authorized'`, [action.id, reservationId]);
      await client.query(`INSERT INTO agent_run_events(run_id,stage_id,action_id,event_type,actor_kind,payload_json)
        VALUES($1,$2,$3,'action.reserved','system',$4)`, [action.run_id, action.stage_id, action.id,
        json({ reservationId, provider: model.provider, modelId: model.modelId, estimatedUsage: requested })]);
      return { reservationId, callId, existing: false };
    });
  }

  async markSending(callId) {
    return withTransaction(this.pool, async client => {
      const call = (await client.query(`UPDATE agent_provider_calls SET status='sending',sending_at=now(),updated_at=now()
        WHERE id=$1 AND status='reserved' RETURNING *`, [callId])).rows[0];
      if (!call) fail('AGENT_PROVIDER_CALL_STATE');
      const action = (await client.query(`UPDATE agent_run_actions SET status='sending',updated_at=now()
        WHERE id=$1 AND status='reserved' RETURNING *`, [call.action_id])).rows[0];
      if (!action) fail('AGENT_PROVIDER_ACTION_STATE');
      await client.query(`INSERT INTO agent_run_events(run_id,stage_id,action_id,event_type,actor_kind,payload_json)
        VALUES($1,$2,$3,'action.sending','system',$4)`, [action.run_id, action.stage_id, action.id,
        json({ provider: call.provider, modelId: call.model_id })]);
      return { actionId: action.id, provider: call.provider, modelId: call.model_id };
    });
  }

  async acknowledge(callId, { providerRequestId, responseRef = {} }) {
    return withTransaction(this.pool, async client => {
      const call = (await client.query(`UPDATE agent_provider_calls SET status='acknowledged',provider_request_id=$2,
        response_ref_json=$3,acknowledged_at=now(),updated_at=now() WHERE id=$1 AND status='sending' RETURNING *`,
      [callId, text(providerRequestId, 240, 'AGENT_PROVIDER_RECEIPT_INVALID'), json(responseRef)])).rows[0];
      if (!call) fail('AGENT_PROVIDER_CALL_STATE');
      const sent = (await client.query(`UPDATE agent_run_actions SET status='sent',provider_request_id=$2,
        sent_at=now(),updated_at=now() WHERE id=$1 AND status='sending' RETURNING *`, [call.action_id, providerRequestId])).rows[0];
      if (!sent) fail('AGENT_PROVIDER_ACTION_STATE');
      const action = (await client.query(`UPDATE agent_run_actions SET status='acknowledged',response_ref_json=$2,
        acknowledged_at=now(),updated_at=now() WHERE id=$1 AND status='sent' RETURNING *`,
      [call.action_id, json(responseRef)])).rows[0];
      await client.query(`INSERT INTO agent_run_events(run_id,stage_id,action_id,event_type,actor_kind,payload_json)
        VALUES($1,$2,$3,'action.acknowledged','system',$4)`, [action.run_id, action.stage_id, action.id,
        json({ providerRequestId })]);
      return { actionId: action.id, providerRequestId };
    });
  }

  async finish(callId, { status = 'succeeded', actualUsage = {}, responseRef = null, errorCode = null,
    errorMessage = null, circuitFailure = false } = {}) {
    if (!['succeeded', 'failed'].includes(status)) fail('AGENT_PROVIDER_CALL_STATE');
    const actual = usage({ providerCalls: 1, ...actualUsage });
    return withTransaction(this.pool, async client => {
      const call = (await client.query('SELECT * FROM agent_provider_calls WHERE id=$1 FOR UPDATE', [callId])).rows[0];
      if (!call || call.status !== 'acknowledged') fail('AGENT_PROVIDER_CALL_STATE');
      const reservation = (await client.query('SELECT * FROM agent_budget_reservations WHERE id=$1 FOR UPDATE', [call.reservation_id])).rows[0];
      if (!reservation || reservation.status !== 'reserved') fail('AGENT_BUDGET_RESERVATION_STATE');
      const charged = {
        providerCalls: Math.max(reservation.reserved_provider_calls, actual.providerCalls),
        inputTokens: Math.max(reservation.reserved_input_tokens, actual.inputTokens),
        outputTokens: Math.max(reservation.reserved_output_tokens, actual.outputTokens),
        costMicrousd: Math.max(Number(reservation.reserved_cost_microusd), actual.costMicrousd),
      };
      await client.query(`UPDATE agent_budget_reservations SET status='settled',actual_provider_calls=$2,
        actual_input_tokens=$3,actual_output_tokens=$4,actual_cost_microusd=$5,charged_provider_calls=$6,
        charged_input_tokens=$7,charged_output_tokens=$8,charged_cost_microusd=$9,settled_at=now(),updated_at=now()
        WHERE id=$1`, [reservation.id, actual.providerCalls, actual.inputTokens, actual.outputTokens, actual.costMicrousd,
        charged.providerCalls, charged.inputTokens, charged.outputTokens, charged.costMicrousd]);
      await client.query(`UPDATE agent_provider_calls SET status=$2,response_ref_json=COALESCE($3,response_ref_json),
        usage_json=$4,error_code=$5,error_message=$6,finished_at=now(),updated_at=now() WHERE id=$1`,
      [call.id, status, responseRef === null ? null : json(responseRef), json(actual), errorCode, errorMessage]);
      const action = (await client.query(`UPDATE agent_run_actions SET status=$2,response_ref_json=COALESCE($3,response_ref_json),
        usage_json=$4,error_code=$5,error_message=$6,finished_at=now(),updated_at=now()
        WHERE id=$1 AND status='acknowledged' RETURNING *`,
      [call.action_id, status, responseRef === null ? null : json(responseRef), json(charged), errorCode, errorMessage])).rows[0];
      if (!action) fail('AGENT_PROVIDER_ACTION_STATE');
      await this.#refreshRunUsage(client, action.run_id);
      if (status === 'succeeded') await this.#recordCircuit(client, call.provider, call.model_id, true, null);
      else if (circuitFailure) await this.#recordCircuit(client, call.provider, call.model_id, false, errorCode);
      await client.query(`INSERT INTO agent_run_events(run_id,stage_id,action_id,event_type,actor_kind,payload_json)
        VALUES($1,$2,$3,$4,'system',$5)`, [action.run_id, action.stage_id, action.id, `action.${status}`,
        json({ actualUsage: actual, chargedUsage: charged, errorCode })]);
      return { actionId: action.id, status, usage: actual, chargedUsage: charged };
    });
  }

  async failBeforeAcknowledgement(callId, { notDispatched = false, errorCode, errorMessage, circuitFailure = false }) {
    return withTransaction(this.pool, async client => {
      const call = (await client.query('SELECT * FROM agent_provider_calls WHERE id=$1 FOR UPDATE', [callId])).rows[0];
      if (!call || !['reserved', 'sending'].includes(call.status)) fail('AGENT_PROVIDER_CALL_STATE');
      const safe = call.status === 'reserved' || notDispatched === true;
      const outcome = safe ? 'failed' : 'uncertain';
      const reservation = (await client.query('SELECT * FROM agent_budget_reservations WHERE id=$1 FOR UPDATE', [call.reservation_id])).rows[0];
      if (!reservation || reservation.status !== 'reserved') fail('AGENT_BUDGET_RESERVATION_STATE');
      await client.query(`UPDATE agent_budget_reservations SET status=$2,
        charged_provider_calls=CASE WHEN $2='uncertain' THEN reserved_provider_calls ELSE 0 END,
        charged_input_tokens=CASE WHEN $2='uncertain' THEN reserved_input_tokens ELSE 0 END,
        charged_output_tokens=CASE WHEN $2='uncertain' THEN reserved_output_tokens ELSE 0 END,
        charged_cost_microusd=CASE WHEN $2='uncertain' THEN reserved_cost_microusd ELSE 0 END,
        settled_at=CASE WHEN $2='uncertain' THEN now() ELSE NULL END,
        released_at=CASE WHEN $2='released' THEN now() ELSE NULL END,updated_at=now() WHERE id=$1`,
      [reservation.id, safe ? 'released' : 'uncertain']);
      await client.query(`UPDATE agent_provider_calls SET status=$2,error_code=$3,error_message=$4,
        finished_at=now(),updated_at=now() WHERE id=$1`, [call.id, outcome, errorCode, errorMessage]);
      const action = (await client.query(`UPDATE agent_run_actions SET status=$2,error_code=$3,error_message=$4,
        finished_at=now(),updated_at=now() WHERE id=$1 AND status=$5 RETURNING *`,
      [call.action_id, outcome, errorCode, errorMessage, call.status === 'reserved' ? 'reserved' : 'sending'])).rows[0];
      if (!action) fail('AGENT_PROVIDER_ACTION_STATE');
      await this.#refreshRunUsage(client, action.run_id);
      if (circuitFailure) await this.#recordCircuit(client, call.provider, call.model_id, false, errorCode);
      await client.query(`INSERT INTO agent_run_events(run_id,stage_id,action_id,event_type,actor_kind,payload_json)
        VALUES($1,$2,$3,$4,'system',$5)`, [action.run_id, action.stage_id, action.id, `action.${outcome}`,
        json({ errorCode, notDispatched: safe })]);
      return { actionId: action.id, status: outcome, budgetStatus: safe ? 'released' : 'uncertain' };
    });
  }

  async #refreshRunUsage(client, runId) {
    const row = totals((await client.query(aggregateSql('run_id=$1'), [runId])).rows[0]);
    await client.query(`UPDATE agent_runs SET usage_json=COALESCE(usage_json,'{}'::jsonb)
      || $2::jsonb,updated_at=now() WHERE id=$1`, [runId, json(row)]);
  }

  async #recordCircuit(client, provider, modelId, success, errorCode) {
    if (success) {
      await client.query(`UPDATE agent_provider_circuits SET state='closed',consecutive_failures=0,opened_at=NULL,
        retry_at=NULL,probe_lease_token=NULL,probe_lease_until=NULL,last_error_code=NULL,last_success_at=now(),updated_at=now()
        WHERE provider=$1 AND model_id=$2`, [provider, modelId]);
      return;
    }
    await client.query(`UPDATE agent_provider_circuits SET
      consecutive_failures=consecutive_failures+1,last_error_code=$3,
      state=CASE WHEN state='half-open' OR consecutive_failures+1>=$4 THEN 'open' ELSE 'closed' END,
      opened_at=CASE WHEN state='half-open' OR consecutive_failures+1>=$4 THEN now() ELSE opened_at END,
      retry_at=CASE WHEN state='half-open' OR consecutive_failures+1>=$4 THEN now()+($5*interval '1 second') ELSE NULL END,
      probe_lease_token=NULL,probe_lease_until=NULL,updated_at=now()
      WHERE provider=$1 AND model_id=$2`, [provider, modelId, errorCode, this.circuitFailureThreshold, this.circuitCooldownSeconds]);
  }
}
