const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function loadPaperStudyConfig(env = process.env) {
  for (const key of ['PAPER_STUDY_ENABLED','PAPER_STUDY_WORKER_ENABLED']) {
    if (env[key] != null && !['true','false'].includes(env[key])) throw Error('PAPER_STUDY_CONFIG_INVALID');
  }
  // This release adapts persistence/auth/runtime only. Neither a deployment flag
  // nor a renderer request can switch real model calls or publication on.
  if (env.PAPER_STUDY_MODELS_ENABLED && env.PAPER_STUDY_MODELS_ENABLED !== 'false'
    || env.PAPER_STUDY_PUBLISH_ENABLED && env.PAPER_STUDY_PUBLISH_ENABLED !== 'false') throw Error('PAPER_STUDY_EXTERNAL_ACTIONS_NOT_RELEASED');
  const enabled = env.PAPER_STUDY_ENABLED === 'true';
  const executionAgentUserId = env.PAPER_STUDY_EXECUTION_AGENT_USER_ID || null;
  if (enabled && !uuid.test(executionAgentUserId ?? '')) throw Error('PAPER_STUDY_EXECUTION_AGENT_REQUIRED');
  return Object.freeze({ enabled, workerEnabled: enabled && env.PAPER_STUDY_WORKER_ENABLED === 'true', executionAgentUserId,
    modelsEnabled: false, publishingEnabled: false });
}
