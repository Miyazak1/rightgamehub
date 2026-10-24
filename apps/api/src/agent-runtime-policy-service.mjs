import { normalizeActionDefinition, normalizeWorkflowManifest } from './agent-runtime-contracts.mjs';

const RISK = Object.freeze({ L0: 0, L1: 1, L2: 2, L3: 3, L4: 4, L5: 5 });

export class AgentRuntimePolicyError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AgentRuntimePolicyError';
    this.code = code;
  }
}

const fail = code => { throw new AgentRuntimePolicyError(code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const list = value => Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];

function scopeAllows(scope, resource) {
  if (!object(scope)) return false;
  const types = list(scope.resourceTypes);
  const owners = list(scope.owners);
  const identifiers = list(scope.resourceIds);
  if (types.length && !types.includes(resource.type)) return false;
  if (owners.length && !owners.includes(resource.owner)) return false;
  if (identifiers.length && !identifiers.includes(resource.id)) return false;
  return true;
}

export function createAgentRuntimePolicyService({ pool }) {
  if (!pool) fail('AGENT_POLICY_POOL_REQUIRED');
  return {
    async decide({ runId, stageId, action: input, resource = {} }) {
      const action = normalizeActionDefinition(input);
      if (!object(resource)) fail('AGENT_POLICY_RESOURCE_INVALID');
      const row = (await pool.query(`SELECT r.*,s.stage_key,s.kind AS stage_kind,s.status AS stage_status,
          w.manifest_json,p.policy_json,p.policy_sha256,a.status AS agent_status,u.status AS user_status
        FROM agent_runs r
        JOIN agent_run_stages s ON s.run_id=r.id AND s.id=$2
        JOIN agent_workflow_definitions w ON w.workflow_key=r.workflow_key AND w.workflow_version=r.workflow_version
        JOIN agent_policy_profiles p ON p.agent_user_id=r.agent_user_id AND p.id=r.policy_profile_id
        JOIN agent_accounts a ON a.user_id=r.agent_user_id
        JOIN users u ON u.id=r.agent_user_id
        WHERE r.id=$1`, [runId, stageId])).rows[0];
      if (!row) fail('AGENT_POLICY_CONTEXT_NOT_FOUND');
      const manifest = normalizeWorkflowManifest(row.manifest_json);
      const stage = manifest.stages.find(item => item.key === row.stage_key);
      const frozen = Array.isArray(row.capability_snapshot?.grants) ? row.capability_snapshot.grants : [];
      const grant = frozen.find(item => item.key === action.capabilityKey && item.version === action.contractVersion);
      const reasons = [];
      if (row.agent_status !== 'active' || row.user_status !== 'active') reasons.push('AGENT_INACTIVE');
      if (row.status !== 'running' || row.stage_status !== 'running') reasons.push('RUNTIME_NOT_RUNNING');
      if (!stage?.capability || stage.capability.key !== action.capabilityKey || stage.capability.version !== action.contractVersion) reasons.push('WORKFLOW_CAPABILITY_MISMATCH');
      if (!grant) reasons.push('CAPABILITY_NOT_FROZEN');
      if (grant && RISK[action.riskLevel] > RISK[grant.riskCeiling]) reasons.push('RISK_EXCEEDS_GRANT');
      if (grant && !scopeAllows(grant.scope, resource)) reasons.push('RESOURCE_OUT_OF_SCOPE');
      let live = null;
      if (grant) live = (await pool.query(`SELECT id FROM agent_capability_grants
        WHERE id=$1 AND agent_user_id=$2 AND capability_key=$3 AND contract_version=$4
          AND status='active' AND valid_from<=now() AND (valid_until IS NULL OR valid_until>now())`,
      [grant.id, row.agent_user_id, action.capabilityKey, action.contractVersion])).rows[0];
      if (grant && !live) reasons.push('CAPABILITY_REVOKED');
      const policy = object(row.policy_json) ? row.policy_json : {};
      if (list(policy.deniedCapabilities).includes(action.capabilityKey)) reasons.push('POLICY_CAPABILITY_DENIED');
      const autonomousRiskCeiling = Object.hasOwn(RISK, policy.autonomousRiskCeiling)
        ? policy.autonomousRiskCeiling : policy.mode === 'compatibility' ? 'L3' : 'L1';
      const confirmation = reasons.length === 0 && (
        list(policy.confirmationCapabilities).includes(action.capabilityKey)
        || RISK[action.riskLevel] > RISK[autonomousRiskCeiling]
        || (action.capabilityKey === 'blog.article.publish' && policy.autoPublish !== true)
      );
      const decision = reasons.length ? 'deny' : confirmation ? 'require-confirmation' : 'allow';
      return {
        schemaVersion: 'agent-policy-decision-v1', decision,
        agentUserId: row.agent_user_id, runId: row.id, stageId, capability: {
          key: action.capabilityKey, version: action.contractVersion,
        },
        matchedGrantIds: live ? [live.id] : [], riskLevel: action.riskLevel,
        resource: structuredClone(resource), constraints: {
          scope: grant?.scope ?? {}, autonomousRiskCeiling,
          requiresVerifiedEvidence: policy.requiresVerifiedEvidence !== false,
          requiresHumanConfirmation: confirmation,
        },
        policyProfileId: row.policy_profile_id, policySha256: row.policy_sha256,
        reasonCodes: reasons, decidedAt: new Date().toISOString(),
      };
    },
  };
}
