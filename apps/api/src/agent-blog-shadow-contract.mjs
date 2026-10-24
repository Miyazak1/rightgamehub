const TERMINAL = new Set(['published', 'rejected', 'failed']);
const STATUS_MAP = Object.freeze({
  queued: { run: 'queued', stage: 'queued' },
  generating: { run: 'running', stage: 'running' },
  checking: { run: 'running', stage: 'running' },
  published: { run: 'succeeded', stage: 'succeeded' },
  rejected: { run: 'rejected', stage: 'failed' },
  failed: { run: 'failed', stage: 'failed' },
});

export function mapLegacyAgentBlogRun(input) {
  const snapshot = structuredClone(input);
  const mapped = STATUS_MAP[snapshot?.status];
  const mismatchCodes = [];
  if (!mapped) mismatchCodes.push('SOURCE_STATUS_UNSUPPORTED');
  if (TERMINAL.has(snapshot?.status) !== Boolean(snapshot?.finishedAt)) mismatchCodes.push('FINISHED_AT_MISMATCH');
  if (['generating', 'checking'].includes(snapshot?.status) && !snapshot?.startedAt) mismatchCodes.push('STARTED_AT_MISSING');
  if (snapshot?.status === 'published' && (!snapshot?.article?.id || !snapshot?.article?.title)) mismatchCodes.push('PUBLISHED_OUTPUT_MISSING');
  if (snapshot?.article?.withdrawnAt && !snapshot?.article?.withdrawnByUserId) mismatchCodes.push('WITHDRAW_ACTOR_MISSING');
  if (!Number.isInteger(snapshot?.behaviorProfileVersion) || snapshot.behaviorProfileVersion < 1) mismatchCodes.push('BEHAVIOR_PROFILE_VERSION_MISSING');
  return {
    mappedRunStatus: mapped?.run ?? 'failed',
    mappedStageStatus: mapped?.stage ?? 'failed',
    parityStatus: mismatchCodes.length ? 'invalid' : 'exact',
    mismatchCodes,
  };
}
