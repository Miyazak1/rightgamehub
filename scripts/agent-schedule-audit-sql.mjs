// Read-only schedule projection shared by release diagnostics. It does not
// import paper operations, dispatch events, or modify the original schedule.
export const SCHEDULE_AUDIT_SQL="SELECT COALESCE(json_agg(json_build_object('id',id,'workflow',workflow_key,'enabled',enabled,'timezone',timezone,'spec',schedule_spec_json,'lastFireAt',last_fire_at,'nextFireAt',next_fire_at,'suspended',config_json ? 'suspendedAt','workerState',config_json#>>'{worker,state}','workerHeartbeatAt',config_json#>>'{worker,heartbeatAt}')),'[]'::json) FROM agent_schedules";
