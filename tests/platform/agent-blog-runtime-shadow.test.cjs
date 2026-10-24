const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const moduleUrl = pathToFileURL(path.join(root, 'apps/api/src/agent-blog-runtime-shadow.mjs')).href;

const snapshot = status => ({
  schemaVersion: 'agent-blog-legacy-run-v1', legacyRunId: 'run', agentUserId: 'agent', requestedByUserId: null,
  triggerKind: 'schedule', status, model: 'deepseek-flash', topicScope: '有趣而有用的开源项目',
  behaviorProfileId: 'profile', behaviorProfileVersion: 1,
  article: status === 'published' ? { id: 'article', slug: 'article', title: '文章', withdrawnAt: null, withdrawnByUserId: null } : null,
  reasonCodes: [], providerUsage: {}, error: null,
  startedAt: status === 'queued' ? null : '2026-10-24T01:00:00.000Z',
  finishedAt: ['published', 'rejected', 'failed'].includes(status) ? '2026-10-24T01:10:00.000Z' : null,
  createdAt: '2026-10-24T00:59:00.000Z', updatedAt: '2026-10-24T01:10:00.000Z',
});

test('legacy blog states map deterministically without granting provider or publication ownership', async () => {
  const { mapLegacyAgentBlogRun } = await import(moduleUrl);
  assert.deepEqual(mapLegacyAgentBlogRun(snapshot('queued')), {
    mappedRunStatus: 'queued', mappedStageStatus: 'queued', parityStatus: 'exact', mismatchCodes: [],
  });
  assert.deepEqual(mapLegacyAgentBlogRun(snapshot('checking')), {
    mappedRunStatus: 'running', mappedStageStatus: 'running', parityStatus: 'exact', mismatchCodes: [],
  });
  assert.deepEqual(mapLegacyAgentBlogRun(snapshot('published')), {
    mappedRunStatus: 'succeeded', mappedStageStatus: 'succeeded', parityStatus: 'exact', mismatchCodes: [],
  });
  assert.equal(mapLegacyAgentBlogRun({ ...snapshot('published'), article: null }).parityStatus, 'invalid');
  assert.deepEqual(mapLegacyAgentBlogRun({ ...snapshot('generating'), startedAt: null }).mismatchCodes, ['STARTED_AT_MISSING']);
});

test('passive shadow reconciliation is idempotent and never calls a model or publisher', async () => {
  const { createAgentBlogRuntimeShadowProjector } = await import(moduleUrl);
  const calls = [];
  const source = {
    id: 'legacy-run', agent_user_id: 'agent', requested_by_user_id: null, trigger_kind: 'manual', status: 'queued',
    model: 'deepseek-flash', topic_scope: '有趣而有用的开源项目', behavior_profile_id: 'profile', behavior_profile_version: 1,
    article_id: null, article_slug: null, article_title: null, withdrawn_at: null, withdrawn_by_user_id: null,
    reason_codes: [], provider_usage: {}, error_code: null, error_message: null, started_at: null, finished_at: null,
    created_at: new Date('2026-10-24T00:00:00.000Z'), updated_at: new Date('2026-10-24T00:00:00.000Z'),
  };
  let digest = null;
  const repository = {
    listChangedRunIds: async () => ['legacy-run'],
    loadSource: async () => source,
    saveProjection: async input => {
      calls.push(input);
      const changed = digest !== input.digest;
      digest = input.digest;
      return { projection: { legacyRunId: source.id }, changed };
    },
    listForAgent: async () => [],
  };
  const projector = createAgentBlogRuntimeShadowProjector({ repository });
  assert.deepEqual(await projector.reconcileBatch(), { examined: 1, projected: 1, unchanged: 0, failed: 0 });
  assert.deepEqual(await projector.reconcileBatch(), { examined: 1, projected: 0, unchanged: 1, failed: 0 });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].mapping.parityStatus, 'exact');
  assert.equal(calls[0].snapshot.status, 'queued');
});

test('shadow schema is passive, append-only and cannot duplicate external side effects', () => {
  const migration = fs.readFileSync(path.join(root, 'apps/api/migrations/0126_agent_blog_runtime_shadow.sql'), 'utf8');
  const service = fs.readFileSync(path.join(root, 'apps/api/src/agent-blog-runtime-shadow.mjs'), 'utf8');
  assert.match(migration, /CREATE TABLE agent_blog_runtime_shadow_projections/u);
  assert.match(migration, /projection_mode<>'passive' OR runtime_run_id IS NULL/u);
  assert.match(migration, /provider_owner='legacy' AND publish_owner='legacy'/u);
  assert.match(migration, /Agent blog shadow events are append-only/u);
  assert.doesNotMatch(service, /fetch\(|writer\.generate|publish\(/u);
});
