BEGIN;

-- A worker can know that an external or database side effect has an unknown
-- outcome even before the generic gateway reaches its sending state.  The
-- runtime repository has always treated an explicit uncertain=true failure as
-- terminal uncertainty for every non-terminal action.  Keep the database
-- state machine aligned with that fail-closed contract.
CREATE OR REPLACE FUNCTION guard_agent_runtime_foundation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='agent_workflow_definitions' THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Agent workflow definitions cannot be deleted'; END IF;
    IF NEW.workflow_key<>OLD.workflow_key OR NEW.workflow_version<>OLD.workflow_version
      OR NEW.schema_version<>OLD.schema_version OR NEW.manifest_json<>OLD.manifest_json
      OR NEW.manifest_sha256<>OLD.manifest_sha256 OR NEW.runtime_min_version<>OLD.runtime_min_version
      OR NEW.created_by_user_id<>OLD.created_by_user_id OR NEW.created_at<>OLD.created_at
      OR NOT ((OLD.status='draft' AND NEW.status IN ('draft','active','retired'))
        OR (OLD.status='active' AND NEW.status IN ('active','retired'))
        OR (OLD.status='retired' AND NEW.status='retired')) THEN
      RAISE EXCEPTION 'Agent workflow identity and manifest are immutable';
    END IF;
  ELSIF TG_TABLE_NAME='agent_capability_grants' THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Agent capability grants cannot be deleted'; END IF;
    IF NEW.id<>OLD.id OR NEW.agent_user_id<>OLD.agent_user_id OR NEW.capability_key<>OLD.capability_key
      OR NEW.contract_version<>OLD.contract_version OR NEW.scope_json<>OLD.scope_json
      OR NEW.risk_ceiling<>OLD.risk_ceiling OR NEW.valid_from<>OLD.valid_from
      OR NEW.valid_until IS DISTINCT FROM OLD.valid_until OR NEW.granted_by_user_id<>OLD.granted_by_user_id
      OR NEW.reason<>OLD.reason OR NEW.created_at<>OLD.created_at
      OR (OLD.status<>'active' AND NEW IS DISTINCT FROM OLD) THEN
      RAISE EXCEPTION 'Agent capability grant identity cannot change or reactivate';
    END IF;
  ELSIF TG_TABLE_NAME='agent_policy_profiles' THEN
    RAISE EXCEPTION 'Agent policy profile versions are immutable';
  ELSIF TG_TABLE_NAME='agent_policy_profile_assignments' AND TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Agent policy assignment cannot be deleted';
  ELSIF TG_TABLE_NAME='agent_runs' THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Agent runs cannot be deleted'; END IF;
    IF NEW.id<>OLD.id OR NEW.agent_user_id<>OLD.agent_user_id OR NEW.workflow_key<>OLD.workflow_key
      OR NEW.workflow_version<>OLD.workflow_version OR NEW.manifest_sha256<>OLD.manifest_sha256
      OR NEW.trigger_kind<>OLD.trigger_kind OR NEW.trigger_ref IS DISTINCT FROM OLD.trigger_ref
      OR NEW.idempotency_key<>OLD.idempotency_key OR NEW.behavior_profile_id<>OLD.behavior_profile_id
      OR NEW.policy_profile_id<>OLD.policy_profile_id OR NEW.capability_snapshot<>OLD.capability_snapshot
      OR NEW.config_snapshot<>OLD.config_snapshot OR NEW.input_json<>OLD.input_json
      OR NEW.input_sha256<>OLD.input_sha256 OR NEW.budget_json<>OLD.budget_json
      OR NEW.queued_at<>OLD.queued_at OR NEW.created_at<>OLD.created_at
      OR OLD.status IN ('succeeded','rejected','failed','cancelled','uncertain') THEN
      RAISE EXCEPTION 'Agent run frozen fields or terminal state cannot change';
    END IF;
    IF NEW.status<>OLD.status AND NOT (
      (OLD.status='queued' AND NEW.status IN ('running','cancelled','failed'))
      OR (OLD.status='running' AND NEW.status IN ('waiting','succeeded','rejected','failed','cancelled','uncertain'))
      OR (OLD.status='waiting' AND NEW.status IN ('running','failed','cancelled','uncertain'))
    ) THEN RAISE EXCEPTION 'Invalid Agent run state transition'; END IF;
  ELSIF TG_TABLE_NAME='agent_run_stages' THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Agent run stages cannot be deleted'; END IF;
    IF NEW.id<>OLD.id OR NEW.run_id<>OLD.run_id OR NEW.stage_key<>OLD.stage_key
      OR NEW.ordinal<>OLD.ordinal OR NEW.kind<>OLD.kind OR NEW.depends_on<>OLD.depends_on
      OR NEW.max_attempts<>OLD.max_attempts OR NEW.timeout_seconds<>OLD.timeout_seconds
      OR NEW.input_sha256<>OLD.input_sha256 OR NEW.created_at<>OLD.created_at
      OR OLD.status IN ('succeeded','skipped','failed','cancelled','uncertain') THEN
      RAISE EXCEPTION 'Agent stage definition or terminal state cannot change';
    END IF;
    IF NEW.status<>OLD.status AND NOT (
      (OLD.status='blocked' AND NEW.status IN ('queued','skipped','cancelled'))
      OR (OLD.status='queued' AND NEW.status IN ('leased','cancelled','failed'))
      OR (OLD.status='leased' AND NEW.status IN ('running','queued','succeeded','failed','cancelled','uncertain'))
      OR (OLD.status='running' AND NEW.status IN ('waiting','queued','succeeded','failed','cancelled','uncertain'))
      OR (OLD.status='waiting' AND NEW.status IN ('queued','failed','cancelled','uncertain'))
    ) THEN RAISE EXCEPTION 'Invalid Agent stage state transition'; END IF;
  ELSIF TG_TABLE_NAME='agent_run_actions' THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Agent run actions cannot be deleted'; END IF;
    IF NEW.id<>OLD.id OR NEW.run_id<>OLD.run_id OR NEW.stage_id<>OLD.stage_id
      OR NEW.action_key<>OLD.action_key OR NEW.action_kind<>OLD.action_kind
      OR NEW.capability_key<>OLD.capability_key OR NEW.contract_version<>OLD.contract_version
      OR NEW.risk_level<>OLD.risk_level OR NEW.idempotency_key<>OLD.idempotency_key
      OR NEW.request_json<>OLD.request_json OR NEW.request_sha256<>OLD.request_sha256
      OR NEW.policy_decision_json<>OLD.policy_decision_json OR NEW.prepared_at<>OLD.prepared_at
      OR NEW.created_at<>OLD.created_at
      OR OLD.status IN ('succeeded','rejected','failed','uncertain','cancelled') THEN
      RAISE EXCEPTION 'Agent action request or terminal state cannot change';
    END IF;
    IF NEW.status<>OLD.status AND NOT (
      (OLD.status='prepared' AND NEW.status IN ('authorized','rejected','cancelled','uncertain'))
      OR (OLD.status='authorized' AND NEW.status IN ('reserved','rejected','failed','cancelled','uncertain'))
      OR (OLD.status='reserved' AND NEW.status IN ('sending','failed','cancelled','uncertain'))
      OR (OLD.status='sending' AND NEW.status IN ('sent','failed','uncertain'))
      OR (OLD.status='sent' AND NEW.status IN ('acknowledged','failed','uncertain'))
      OR (OLD.status='acknowledged' AND NEW.status IN ('succeeded','failed','uncertain'))
    ) THEN RAISE EXCEPTION 'Invalid Agent action state transition'; END IF;
  ELSIF TG_TABLE_NAME='agent_run_events' THEN
    RAISE EXCEPTION 'Agent run events are append-only';
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
