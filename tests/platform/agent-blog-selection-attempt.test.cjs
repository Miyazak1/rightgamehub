const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const load = () => import('../../apps/api/src/agent-blog-foundation-generation.mjs');
const valid = () => ({ mode: 'single', selectedIndexes: [1],
  angle: '从一次可以验证的实际体验观察项目用途和适用边界',
  rationale: '仓库的固定版本资料提供了明确的使用步骤、输入输出、常见用途和适用边界，适合先完成一次可观察的最小体验。',
  interestSignals: ['可以快速体验'], comparisonAxes: [],
  scores: { readerValue: 80, handsOnPotential: 80, novelty: 70, explainability: 85, evidenceStrength: 90 },
  decisionReasonCodes: ['EVIDENCE_STRONG'] });

test('invalid selection attempts retain bounded diagnostics without relaxing selection@2', async () => {
  const { validateBlogFoundationSelectionAttempt: attempt, validateBlogFoundationSelectionResponse: strict } = await load();
  const missing = valid(); delete missing.scores; delete missing.decisionReasonCodes;
  assert.throws(() => strict(missing), error => error.code === 'AGENT_BLOG_SELECTION_SCHEMA_INVALID');
  const captured = attempt(missing);
  assert.equal(captured.accepted, false);
  assert.deepEqual(captured.rawOutput, missing);
  assert.deepEqual(captured.validation.missingFields, ['scores', 'decisionReasonCodes']);
  const score = valid(); score.scores.readerValue = '80';
  assert.deepEqual(attempt(score).validation.invalidFields, ['scores.readerValue']);
  const code = valid(); code.decisionReasonCodes = ['invented'];
  assert.ok(attempt(code).validation.invalidFields.includes('decisionReasonCodes'));
  const extra = { ...valid(), surprise: 'not accepted' };
  assert.equal(attempt(extra).validation.unexpectedFieldCount, 1);
  assert.equal(attempt('not JSON').accepted, false);
  assert.equal(attempt('[]').accepted, false);
  assert.throws(() => attempt('x'.repeat(262145)), /AGENT_BLOG_PROVIDER_OUTPUT_INVALID/u);
  assert.deepEqual(attempt(JSON.stringify(valid())).selection, valid());
});

async function fixture(outputs, { failure = null, workflowKey = 'blog.project.single' } = {}) {
  const { createAgentBlogFoundationGenerationHandlers, validateBlogFoundationSelectionAttempt } = await load();
  const id = crypto.randomUUID(), calls = [], saved = [];
  const evidence = { id, content: { schemaVersion: 'github-repository-evidence-v1',
    repository: { key: 'owner/tool', canonicalUrl: 'https://github.com/owner/tool', owner: 'owner', name: 'tool' },
    sourceVersion: { revision: 'a'.repeat(40), canonicalUri: 'https://github.com/owner/tool/tree/' + 'a'.repeat(40),
      fetchedAt: '2026-11-16T00:00:00.000Z', contentSha256: 'b'.repeat(64) },
    metadata: { name: 'tool', fullName: 'owner/tool', description: '用途明确且可验证的开放工具', homepage: null,
      defaultBranch: 'main', stars: 10, forks: 2, openIssues: 0, topics: ['tool'], licenseSpdx: 'MIT', archived: false, pushedAt: null },
    readme: { canonicalUri: 'https://github.com/owner/tool/blob/' + 'a'.repeat(40) + '/README.md',
      path: 'README.md', text: '官方资料提供明确的使用步骤、用途、输入输出和适用边界，能够支持读者完成一次可验证的小规模体验。'.repeat(10) } } };
  const handlers = createAgentBlogFoundationGenerationHandlers({ workflowKey,
    artifactRepository: { readToolArtifact: async () => evidence,
      save: async value => { saved.push(value); return { id: crypto.randomUUID(), artifactKey: value.artifactKey, contentSha256: 'c'.repeat(64) }; } },
    providerGateway: { invoke: async request => {
      calls.push(request); if(failure && (failure.first || calls.length === 2))throw failure.error;
      const output = structuredClone(outputs[Math.min(calls.length - 1, outputs.length - 1)]);
      return { actionId: 'fixture-action-' + calls.length,
        output: request.responseSchema.key === 'blog.subject.selection-attempt' ? validateBlogFoundationSelectionAttempt(output) : output };
    } } });
  const context = { run: { id: crypto.randomUUID(), agentUserId: crypto.randomUUID(),
    input: { topicScope: '研究有趣且有明确资料的开放工具', recentTitles: [], previousRepositoryUrls: [] } },
  stage: { id: crypto.randomUUID() }, prerequisites: [{ stageKey: 'collect-evidence', status: 'succeeded', outputRef: { artifactIds: [id] } }] };
  return { calls, saved, run: () => handlers[workflowKey + ':select-subject'](context, { workerId: 'fixture', leaseToken: crypto.randomUUID() }) };
}

test('public selection repairs a missing-field response once and attributes the approved artifact to its repair action', async () => {
  const malformed = valid(); delete malformed.scores;
  const original = structuredClone(malformed), f = await fixture([malformed, valid()]);
  await f.run();
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].action.actionKey, 'select-subject-format-repair');
  assert.notEqual(f.calls[0].idempotencyKey, f.calls[1].idempotencyKey);
  assert.ok(f.calls[0].timeoutSeconds + f.calls[1].timeoutSeconds < 300);
  assert.deepEqual(JSON.parse(f.calls[1].request.messages[1].content).correction.previousOutput, original);
  assert.deepEqual(JSON.parse(f.calls[0].request.messages[1].content).responseExample.scores,
    { readerValue: 80, handsOnPotential: 80, novelty: 80, explainability: 80, evidenceStrength: 80 });
  assert.equal(f.saved.length, 1);
  assert.equal(f.saved[0].actionId, 'fixture-action-2');
  assert.equal(f.saved[0].schema.version, 2);
  assert.deepEqual(malformed, original);
});

test('normal selection adds no call; repeated bad format and semantic gate violations cannot save a selection', async () => {
  const good = await fixture([valid()]); await good.run(); assert.equal(good.calls.length, 1);
  const bad = valid(); delete bad.decisionReasonCodes;
  const repeated = await fixture([bad]);
  await assert.rejects(repeated.run(), error => error.code === 'AGENT_BLOG_SELECTION_SCHEMA_INVALID');
  assert.equal(repeated.calls.length, 2); assert.equal(repeated.saved.length, 0);
  const bypass = valid(); bypass.selectedIndexes = [2];
  const gated = await fixture([bad, bypass]);
  await assert.rejects(gated.run(), error => error.code === 'AGENT_BLOG_SELECTION_INDEX_INVALID');
  assert.equal(gated.saved.length, 0);
});

test('selection repair cannot bypass budgets, uncertain outcomes or shadow acceptance', async () => {
  const malformed = valid(); delete malformed.scores;
  const budget = Object.assign(Error('budget denied'), { code: 'AGENT_BUDGET_EXCEEDED' });
  const denied = await fixture([malformed], { failure: { error: budget } });
  await assert.rejects(denied.run(), error => error === budget);
  assert.equal(denied.calls.length, 2); assert.equal(denied.saved.length, 0);
  const uncertain = Object.assign(Error('outcome uncertain'), { code: 'AGENT_PROVIDER_OUTCOME_UNCERTAIN', uncertain: true });
  const unknown = await fixture([malformed], { failure: { first: true, error: uncertain } });
  await assert.rejects(unknown.run(), error => error === uncertain); assert.equal(unknown.calls.length, 1);
  const shadow = await fixture([malformed], { workflowKey: 'blog.project.single.draft-shadow' });
  await assert.rejects(shadow.run(), error => error.code === 'AGENT_BLOG_SELECTION_SCHEMA_INVALID');
  assert.equal(shadow.calls.length, 1); assert.equal(shadow.saved.length, 0);
});
