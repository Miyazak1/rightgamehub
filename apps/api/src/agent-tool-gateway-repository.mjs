import crypto from 'node:crypto';
import { withTransaction } from './database.mjs';
import { stableHash } from './researcher-qa-protocol/stable-json.mjs';

export class AgentToolGatewayRepositoryError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AgentToolGatewayRepositoryError';
    this.code = code;
  }
}

const fail = code => { throw new AgentToolGatewayRepositoryError(code); };
const json = value => JSON.stringify(value);
const key = (value, code) => {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9.-]{2,119}$/u.test(value)) fail(code);
  return value;
};
const integer = (value, min, max, code) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(code);
  return value;
};
const RISK = new Set(['L0', 'L1', 'L2', 'L3', 'L4', 'L5']);
const EXECUTION = new Set(['in-process', 'worker', 'sandbox', 'remote']);
const EFFECT = new Set(['read-only', 'idempotent-write', 'non-idempotent-write']);

const contractView = row => ({
  toolKey: row.tool_key,
  contractVersion: row.contract_version,
  status: row.status,
  capabilityKey: row.capability_key,
  riskLevel: row.risk_level,
  executionClass: row.execution_class,
  effectClass: row.effect_class,
  inputSchema: { key: row.input_schema_key, version: row.input_schema_version },
  outputSchema: { key: row.output_schema_key, version: row.output_schema_version },
  networkPolicy: row.network_policy_json,
  filesystemPolicy: row.filesystem_policy_json,
  timeoutSeconds: row.timeout_seconds,
  outputLimitBytes: row.output_limit_bytes,
});

export class PostgresAgentToolGatewayRepository {
  constructor(pool, { agentMonthlyLimit = 1000, platformMonthlyLimit = 100000 } = {}) {
    this.pool = pool;
    this.agentMonthlyLimit = integer(agentMonthlyLimit, 1, 10000000, 'AGENT_TOOL_BUDGET_CONFIG_INVALID');
    this.platformMonthlyLimit = integer(platformMonthlyLimit, 1, 100000000, 'AGENT_TOOL_BUDGET_CONFIG_INVALID');
  }

  async registerTool(input) {
    const normalized = {
      toolKey: key(input?.toolKey, 'AGENT_TOOL_CONTRACT_INVALID'),
      contractVersion: integer(input?.contractVersion, 1, 2147483647, 'AGENT_TOOL_CONTRACT_INVALID'),
      status: input?.status ?? 'active',
      capabilityKey: key(input?.capabilityKey, 'AGENT_TOOL_CONTRACT_INVALID'),
      riskLevel: input?.riskLevel,
      executionClass: input?.executionClass,
      effectClass: input?.effectClass,
      inputSchema: input?.inputSchema,
      outputSchema: input?.outputSchema,
      networkPolicy: input?.networkPolicy ?? {},
      filesystemPolicy: input?.filesystemPolicy ?? {},
      timeoutSeconds: integer(input?.timeoutSeconds, 1, 3600, 'AGENT_TOOL_CONTRACT_INVALID'),
      outputLimitBytes: integer(input?.outputLimitBytes, 1, 10485760, 'AGENT_TOOL_CONTRACT_INVALID'),
    };
    if (!['active', 'disabled', 'retired'].includes(normalized.status) || !RISK.has(normalized.riskLevel)
      || !EXECUTION.has(normalized.executionClass) || !EFFECT.has(normalized.effectClass)
      || !normalized.inputSchema || !normalized.outputSchema) fail('AGENT_TOOL_CONTRACT_INVALID');
    key(normalized.inputSchema.key, 'AGENT_TOOL_CONTRACT_INVALID');
    key(normalized.outputSchema.key, 'AGENT_TOOL_CONTRACT_INVALID');
    integer(normalized.inputSchema.version, 1, 2147483647, 'AGENT_TOOL_CONTRACT_INVALID');
    integer(normalized.outputSchema.version, 1, 2147483647, 'AGENT_TOOL_CONTRACT_INVALID');
    const values = [normalized.toolKey, normalized.contractVersion, normalized.status, normalized.capabilityKey,
      normalized.riskLevel, normalized.executionClass, normalized.effectClass, normalized.inputSchema.key,
      normalized.inputSchema.version, normalized.outputSchema.key, normalized.outputSchema.version,
      json(normalized.networkPolicy), json(normalized.filesystemPolicy), normalized.timeoutSeconds, normalized.outputLimitBytes];
    const row = (await this.pool.query(`INSERT INTO agent_tool_contracts(
        tool_key,contract_version,status,capability_key,risk_level,execution_class,effect_class,
        input_schema_key,input_schema_version,output_schema_key,output_schema_version,
        network_policy_json,filesystem_policy_json,timeout_seconds,output_limit_bytes
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT(tool_key,contract_version) DO NOTHING RETURNING *`, values)).rows[0];
    if (row) return { ...contractView(row), existing: false };
    const existing = (await this.pool.query('SELECT * FROM agent_tool_contracts WHERE tool_key=$1 AND contract_version=$2',
      [normalized.toolKey, normalized.contractVersion])).rows[0];
    if (!existing || stableHash(contractView(existing)) !== stableHash(normalized)) fail('AGENT_TOOL_CONTRACT_VERSION_CONFLICT');
    return { ...contractView(existing), existing: true };
  }

  async resolveTool({ toolKey, contractVersion }) {
    const row = (await this.pool.query(`SELECT * FROM agent_tool_contracts
      WHERE tool_key=$1 AND contract_version=$2 AND status='active'`, [toolKey, contractVersion])).rows[0];
    if (!row) fail('AGENT_TOOL_UNAVAILABLE');
    return contractView(row);
  }

  async getToolCallByAction(actionId) {
    const row = (await this.pool.query(`SELECT call.*,action.status AS action_status
      FROM agent_tool_calls call JOIN agent_run_actions action ON action.id=call.action_id
      WHERE call.action_id=$1`, [actionId])).rows[0];
    return row ? {
      id: row.id, actionId: row.action_id, status: row.status, actionStatus: row.action_status,
      toolKey: row.tool_key, contractVersion: row.contract_version, receiptId: row.receipt_id,
      responseRef: row.response_ref_json, responseSha256: row.response_sha256,
      usage: row.usage_json, errorCode: row.error_code,
    } : null;
  }

  async reserveToolCall({ actionId, contract, request }) {
    return withTransaction(this.pool, async client => {
      const action = (await client.query(`SELECT action.*,run.agent_user_id,run.budget_json,policy.policy_json
        FROM agent_run_actions action JOIN agent_runs run ON run.id=action.run_id
        JOIN agent_policy_profiles policy ON policy.id=run.policy_profile_id AND policy.agent_user_id=run.agent_user_id
        WHERE action.id=$1 FOR UPDATE OF action,run`, [actionId])).rows[0];
      if (!action || action.status !== 'authorized' || action.action_kind !== 'tool') fail('AGENT_TOOL_ACTION_NOT_AUTHORIZED');
      const existing = (await client.query('SELECT * FROM agent_tool_calls WHERE action_id=$1', [actionId])).rows[0];
      if (existing) return { callId: existing.id, existing: true };
      const registered = (await client.query(`SELECT * FROM agent_tool_contracts
        WHERE tool_key=$1 AND contract_version=$2 AND status='active' FOR SHARE`,
      [contract.toolKey, contract.contractVersion])).rows[0];
      if (!registered) fail('AGENT_TOOL_UNAVAILABLE');
      if (action.capability_key !== registered.capability_key || action.contract_version !== registered.contract_version
        || action.risk_level !== registered.risk_level) fail('AGENT_TOOL_ACTION_CONTRACT_MISMATCH');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`agent-tool-budget:${action.run_id}`]);
      const period = (await client.query("SELECT to_char(date_trunc('month',now() AT TIME ZONE 'UTC'),'YYYY-MM') AS key")).rows[0].key;
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`agent-tool-budget:${action.agent_user_id}:${period}`]);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`agent-tool-budget:platform:${period}`]);
      const used = Number((await client.query(`SELECT count(*)::int AS n FROM agent_tool_calls call
        JOIN agent_run_actions counted ON counted.id=call.action_id WHERE counted.run_id=$1`, [action.run_id])).rows[0].n);
      if (used + 1 > Number(action.budget_json?.toolCalls ?? 0)) fail('AGENT_RUN_TOOL_BUDGET_EXCEEDED');
      const agentUsed = Number((await client.query(`SELECT count(*)::int AS n FROM agent_tool_calls call
        JOIN agent_run_actions counted ON counted.id=call.action_id
        JOIN agent_runs run ON run.id=counted.run_id
        WHERE run.agent_user_id=$1 AND call.created_at>=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
      [action.agent_user_id])).rows[0].n);
      const platformUsed = Number((await client.query(`SELECT count(*)::int AS n FROM agent_tool_calls
        WHERE created_at>=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`)).rows[0].n);
      const policyLimit = Number(action.policy_json?.budgets?.agentMonthly?.toolCalls ?? this.agentMonthlyLimit);
      const agentLimit = Number.isSafeInteger(policyLimit) ? Math.max(0, Math.min(this.agentMonthlyLimit, policyLimit)) : this.agentMonthlyLimit;
      if (agentUsed + 1 > agentLimit) fail('AGENT_MONTHLY_TOOL_BUDGET_EXCEEDED');
      if (platformUsed + 1 > this.platformMonthlyLimit) fail('AGENT_PLATFORM_TOOL_BUDGET_EXCEEDED');
      const callId = crypto.randomUUID();
      await client.query(`INSERT INTO agent_tool_calls(
        id,action_id,tool_key,contract_version,status,request_sha256
      ) VALUES($1,$2,$3,$4,'reserved',$5)`, [callId, action.id, registered.tool_key,
        registered.contract_version, stableHash(request)]);
      await client.query(`UPDATE agent_run_actions SET status='reserved',reservation_ref=$2,updated_at=now()
        WHERE id=$1 AND status='authorized'`, [action.id, callId]);
      await client.query(`INSERT INTO agent_run_events(run_id,stage_id,action_id,event_type,actor_kind,payload_json)
        VALUES($1,$2,$3,'action.reserved','system',$4)`, [action.run_id, action.stage_id, action.id,
        json({ toolCallId: callId, toolKey: registered.tool_key, contractVersion: registered.contract_version })]);
      return { callId, existing: false };
    });
  }

  async markSending(callId) {
    return withTransaction(this.pool, async client => {
      const call = (await client.query(`UPDATE agent_tool_calls SET status='sending',sending_at=now(),updated_at=now()
        WHERE id=$1 AND status='reserved' RETURNING *`, [callId])).rows[0];
      if (!call) fail('AGENT_TOOL_CALL_STATE');
      const action = (await client.query(`UPDATE agent_run_actions SET status='sending',updated_at=now()
        WHERE id=$1 AND status='reserved' RETURNING *`, [call.action_id])).rows[0];
      if (!action) fail('AGENT_TOOL_ACTION_STATE');
      await client.query(`INSERT INTO agent_run_events(run_id,stage_id,action_id,event_type,actor_kind,payload_json)
        VALUES($1,$2,$3,'action.sending','system',$4)`, [action.run_id, action.stage_id, action.id,
        json({ toolKey: call.tool_key, contractVersion: call.contract_version })]);
      return { actionId: action.id };
    });
  }

  async acknowledge(callId, { receiptId, responseRef = {} }) {
    return withTransaction(this.pool, async client => {
      const call = (await client.query(`UPDATE agent_tool_calls SET status='acknowledged',receipt_id=$2,
        response_ref_json=$3,acknowledged_at=now(),updated_at=now()
        WHERE id=$1 AND status='sending' RETURNING *`, [callId, String(receiptId).slice(0, 240), json(responseRef)])).rows[0];
      if (!call || typeof receiptId !== 'string' || !receiptId) fail('AGENT_TOOL_RECEIPT_INVALID');
      const sent = (await client.query(`UPDATE agent_run_actions SET status='sent',provider_request_id=$2,
        sent_at=now(),updated_at=now() WHERE id=$1 AND status='sending' RETURNING *`, [call.action_id, receiptId])).rows[0];
      if (!sent) fail('AGENT_TOOL_ACTION_STATE');
      const action = (await client.query(`UPDATE agent_run_actions SET status='acknowledged',response_ref_json=$2,
        acknowledged_at=now(),updated_at=now() WHERE id=$1 AND status='sent' RETURNING *`,
      [call.action_id, json(responseRef)])).rows[0];
      await client.query(`INSERT INTO agent_run_events(run_id,stage_id,action_id,event_type,actor_kind,payload_json)
        VALUES($1,$2,$3,'action.acknowledged','system',$4)`, [action.run_id, action.stage_id, action.id,
        json({ receiptId })]);
      return { actionId: action.id };
    });
  }

  async finish(callId, { output, responseRef = {}, usage = { toolCalls: 1 } }) {
    const serialized = JSON.stringify(output);
    const sizeBytes = Buffer.byteLength(serialized);
    return withTransaction(this.pool, async client => {
      const call = (await client.query(`SELECT call.*,contract.output_limit_bytes
        FROM agent_tool_calls call JOIN agent_tool_contracts contract
          ON contract.tool_key=call.tool_key AND contract.contract_version=call.contract_version
        WHERE call.id=$1 FOR UPDATE OF call`, [callId])).rows[0];
      if (!call || call.status !== 'acknowledged') fail('AGENT_TOOL_CALL_STATE');
      if (sizeBytes < 1 || sizeBytes > call.output_limit_bytes) fail('AGENT_TOOL_OUTPUT_LIMIT_EXCEEDED');
      const artifactId = crypto.randomUUID();
      const digest = stableHash(output);
      await client.query(`INSERT INTO agent_tool_artifacts(
        id,tool_call_id,action_id,media_type,content_json,content_sha256,size_bytes
      ) VALUES($1,$2,$3,'application/json',$4,$5,$6)`,
      [artifactId, call.id, call.action_id, serialized, digest, sizeBytes]);
      const reference = { ...responseRef, artifactId, sha256: digest, sizeBytes, mediaType: 'application/json' };
      await client.query(`UPDATE agent_tool_calls SET status='succeeded',response_ref_json=$2,response_sha256=$3,
        usage_json=$4,finished_at=now(),updated_at=now() WHERE id=$1`, [call.id, json(reference), digest, json(usage)]);
      const action = (await client.query(`UPDATE agent_run_actions SET status='succeeded',response_ref_json=$2,
        response_sha256=$3,usage_json=$4,finished_at=now(),updated_at=now()
        WHERE id=$1 AND status='acknowledged' RETURNING *`, [call.action_id, json(reference), digest, json(usage)])).rows[0];
      if (!action) fail('AGENT_TOOL_ACTION_STATE');
      await this.#refreshRunUsage(client, action.run_id);
      await client.query(`INSERT INTO agent_run_events(run_id,stage_id,action_id,event_type,actor_kind,payload_json)
        VALUES($1,$2,$3,'action.succeeded','system',$4)`, [action.run_id, action.stage_id, action.id,
        json({ toolKey: call.tool_key, artifactId, sizeBytes })]);
      return { actionId: action.id, artifactId, responseRef: reference, output };
    });
  }

  async failAfterAcknowledgement(callId, { errorCode, errorMessage }) {
    return withTransaction(this.pool, async client => {
      const call = (await client.query(`UPDATE agent_tool_calls SET status='failed',error_code=$2,error_message=$3,
        finished_at=now(),updated_at=now() WHERE id=$1 AND status='acknowledged' RETURNING *`,
      [callId, errorCode, errorMessage])).rows[0];
      if (!call) fail('AGENT_TOOL_CALL_STATE');
      const action = (await client.query(`UPDATE agent_run_actions SET status='failed',error_code=$2,error_message=$3,
        finished_at=now(),updated_at=now() WHERE id=$1 AND status='acknowledged' RETURNING *`,
      [call.action_id, errorCode, errorMessage])).rows[0];
      if (!action) fail('AGENT_TOOL_ACTION_STATE');
      await this.#refreshRunUsage(client, action.run_id);
      await client.query(`INSERT INTO agent_run_events(run_id,stage_id,action_id,event_type,actor_kind,payload_json)
        VALUES($1,$2,$3,'action.failed','system',$4)`, [action.run_id, action.stage_id, action.id,
        json({ errorCode, acknowledged: true })]);
      return { actionId: action.id, status: 'failed' };
    });
  }

  async failBeforeAcknowledgement(callId, { notDispatched = false, errorCode, errorMessage }) {
    return withTransaction(this.pool, async client => {
      const call = (await client.query(`SELECT call.*,contract.effect_class FROM agent_tool_calls call
        JOIN agent_tool_contracts contract ON contract.tool_key=call.tool_key AND contract.contract_version=call.contract_version
        WHERE call.id=$1 FOR UPDATE OF call`, [callId])).rows[0];
      if (!call || !['reserved', 'sending'].includes(call.status)) fail('AGENT_TOOL_CALL_STATE');
      const safe = call.status === 'reserved' || notDispatched === true || call.effect_class === 'read-only';
      const outcome = safe ? 'failed' : 'uncertain';
      await client.query(`UPDATE agent_tool_calls SET status=$2,error_code=$3,error_message=$4,
        finished_at=now(),updated_at=now() WHERE id=$1`, [call.id, outcome, errorCode, errorMessage]);
      const action = (await client.query(`UPDATE agent_run_actions SET status=$2,error_code=$3,error_message=$4,
        finished_at=now(),updated_at=now() WHERE id=$1 AND status=$5 RETURNING *`,
      [call.action_id, outcome, errorCode, errorMessage, call.status === 'reserved' ? 'reserved' : 'sending'])).rows[0];
      if (!action) fail('AGENT_TOOL_ACTION_STATE');
      await this.#refreshRunUsage(client, action.run_id);
      await client.query(`INSERT INTO agent_run_events(run_id,stage_id,action_id,event_type,actor_kind,payload_json)
        VALUES($1,$2,$3,$4,'system',$5)`, [action.run_id, action.stage_id, action.id, `action.${outcome}`,
        json({ errorCode, notDispatched: safe, effectClass: call.effect_class })]);
      return { actionId: action.id, status: outcome };
    });
  }

  async #refreshRunUsage(client, runId) {
    const count = Number((await client.query(`SELECT count(*)::int AS n FROM agent_tool_calls call
      JOIN agent_run_actions action ON action.id=call.action_id WHERE action.run_id=$1`, [runId])).rows[0].n);
    await client.query(`UPDATE agent_runs SET usage_json=COALESCE(usage_json,'{}'::jsonb)
      || jsonb_build_object('toolCalls',$2::integer),updated_at=now() WHERE id=$1`, [runId, count]);
  }
}
