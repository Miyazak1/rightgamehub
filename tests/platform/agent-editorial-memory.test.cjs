const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.resolve(__dirname,
  '../../apps/api/src/agent-editorial-memory-repository.mjs'));
const inputModuleUrl = pathToFileURL(path.resolve(__dirname,
  '../../apps/api/src/agent-blog-private-canary-manual-run.mjs'));

const publishedAt = '2026-10-27T02:00:00.000Z';
const citation = id => ({ id });

test('single-project publication permanently excludes the main repository and remembers editorial intent', async () => {
  const { buildEditorialMemoryEvents } = await import(moduleUrl.href);
  const value = buildEditorialMemoryEvents({
    selection: { mode: 'single', repositoryUrls: ['https://github.com/Blue-Idea/Linkit'],
      revisions: ['abc123'], angle: '本地优先知识管理如何降低收藏负担',
      rationale: '这个项目提供可验证的本地知识整理路径。',
      interestSignals: ['可以快速体验', '结果直观可视化'] },
    citations: [citation('citation-1')], summary: '一篇基于官方仓库证据的项目研究。', publishedAt,
  });
  const project = value.events.find(item => item.eventType === 'project-featured');
  assert.equal(project.permanentMainExclusion, true);
  assert.equal(project.cooldownUntil, null);
  assert.equal(project.payload.repositoryUrl, 'https://github.com/Blue-Idea/Linkit');
  assert.deepEqual(value.events.filter(item => item.eventType === 'scenario-used')
    .map(item => item.payload.signal), ['可以快速体验', '结果直观可视化']);
  assert.equal(value.events.some(item => item.eventType === 'topic-used'), true);
  assert.equal(value.events.some(item => item.eventType === 'claim-stated'), true);
});

test('comparison publication keeps projects reusable but cools down the pair deterministically', async () => {
  const { buildEditorialMemoryEvents } = await import(moduleUrl.href);
  const selection = { mode: 'comparison',
    repositoryUrls: ['https://github.com/beta/tool', 'https://github.com/alpha/tool'],
    revisions: ['beta-rev', 'alpha-rev'], angle: '两种本地工具的工作流取舍',
    rationale: '比较相同任务下的安装、使用与边界。', comparisonAxes: ['安装', '隐私'],
    interestSignals: ['解决常见但容易忽略的问题'] };
  const first = buildEditorialMemoryEvents({ selection,
    citations: [citation('citation-b'), citation('citation-a')], summary: '对比研究。', publishedAt });
  const reversed = buildEditorialMemoryEvents({ selection: { ...selection,
    repositoryUrls: [...selection.repositoryUrls].reverse(), revisions: [...selection.revisions].reverse() },
    citations: [citation('citation-a'), citation('citation-b')], summary: '对比研究。', publishedAt });
  const projectEvents = first.events.filter(item => item.eventType === 'project-compared');
  assert.equal(projectEvents.every(item => item.permanentMainExclusion === false), true);
  assert.equal(projectEvents.every(item => item.cooldownUntil === '2026-11-26T02:00:00.000Z'), true);
  assert.equal(first.events.find(item => item.eventType === 'comparison-used').subjectKey,
    reversed.events.find(item => item.eventType === 'comparison-used').subjectKey);
  assert.equal(first.events.find(item => item.eventType === 'comparison-used').cooldownUntil,
    '2027-04-25T02:00:00.000Z');
});

test('selection memory freezes only active editorial cooldowns at snapshot time', async () => {
  const { buildEditorialSelectionMemory } = await import(moduleUrl.href);
  const memory = buildEditorialSelectionMemory([
    { subjectKind: 'topic', subjectKey: 'topic:active', occurrenceCount: 2,
      cooldownUntil: '2026-11-01T00:00:00.000Z', payload: { angle: '本地知识整理的使用路径' } },
    { subjectKind: 'claim', subjectKey: 'claim:expired', occurrenceCount: 1,
      cooldownUntil: '2026-10-20T00:00:00.000Z', payload: { rationale: '已经过期的判断' } },
    { subjectKind: 'project', subjectKey: 'project:owner/tool', occurrenceCount: 1,
      cooldownUntil: null, payload: { repositoryUrl: 'https://github.com/owner/tool' } },
  ], { capturedAt: '2026-10-27T00:00:00.000Z' });
  assert.equal(memory.schemaVersion, 'blog-editorial-memory-input-v1');
  assert.deepEqual(memory.activeCooldowns.map(item => [item.subjectKind, item.label]),
    [['topic', '本地知识整理的使用路径']]);
});

test('project research records initial, same-version and new-version lineage explicitly', async () => {
  const { buildEditorialMemoryEvents, buildProjectVersionMemoryEvent } = await import(moduleUrl.href);
  const built = buildEditorialMemoryEvents({
    selection: { mode: 'comparison', repositoryUrls: ['https://github.com/owner/tool'],
      revisions: ['commit-a'], angle: '同类工具的证据化比较',
      rationale: '为了比较相同任务下的使用边界，需要重新读取官方资料。',
      comparisonAxes: ['安装', '边界'], interestSignals: ['可以快速体验'] },
    citations: [citation('citation-1')], summary: '比较研究。', publishedAt,
  });
  const projectEvent = built.events.find(item => item.eventType === 'project-compared');
  const versionA = '11111111-1111-4111-8111-111111111111';
  const versionB = '22222222-2222-4222-8222-222222222222';
  const first = buildProjectVersionMemoryEvent({ projectEvent, researchSourceVersionId: versionA });
  assert.equal(first.payload.sourceVersionRelation, 'initial');
  assert.equal(first.researchReason, 'comparison-publication-research');
  const same = buildProjectVersionMemoryEvent({ projectEvent, researchSourceVersionId: versionA,
    previousEvent: { id: '33333333-3333-4333-8333-333333333333', researchSourceVersionId: versionA } });
  assert.equal(same.payload.sourceVersionRelation, 'same-version');
  const changed = buildProjectVersionMemoryEvent({ projectEvent, researchSourceVersionId: versionB,
    previousEvent: { id: '33333333-3333-4333-8333-333333333333', researchSourceVersionId: versionA } });
  assert.equal(changed.payload.sourceVersionRelation, 'new-version');
  assert.equal(changed.payload.previousResearchSourceVersionId, versionA);
});

test('claim memory binds cited evidence and preserves explicit revision lineage', async () => {
  const { buildClaimMemoryRelations } = await import(moduleUrl.href);
  const evidenceA = '11111111-1111-4111-8111-111111111111';
  const evidenceB = '22222222-2222-4222-8222-222222222222';
  const previous = '33333333-3333-4333-8333-333333333333';
  const relations = buildClaimMemoryRelations({ evidenceIds: [evidenceA, evidenceB, evidenceA],
    previousClaimEventId: previous });
  assert.deepEqual(relations.filter(item => item.relationKind === 'supports').map(item => item.evidenceId),
    [evidenceA, evidenceB]);
  assert.deepEqual(relations.find(item => item.relationKind === 'revises'), {
    relationKind: 'revises', evidenceId: null, relatedClaimEventId: previous,
    explanation: 'same-stable-claim-published-with-new-revision',
  });
  assert.equal(buildClaimMemoryRelations({ evidenceIds: [] })[0].relationKind, 'unknown');
});

test('runtime input prefers durable editorial memory while retaining historical citation fallback', async () => {
  const { PostgresAgentBlogPrivateCanaryInputRepository } = await import(inputModuleUrl.href);
  const { defaultAgentBehaviorProfile } = await import(pathToFileURL(path.resolve(__dirname,
    '../../apps/api/src/agent-behavior-profile.mjs')).href);
  const agentUserId = '11111111-1111-4111-8111-111111111111';
  const pool = { async query(sql) {
    if (sql.includes('FROM agent_blog_automation_settings')) return { rows: [{
      topic_scope: '开源工具', model: 'deepseek-flash',
      behavior_profile_id: '22222222-2222-4222-8222-222222222222', behavior_profile_version: 2,
      profile: defaultAgentBehaviorProfile(),
    }] };
    if (sql.includes('SELECT revision.title')) return { rows: [{ title: '历史文章' }] };
    if (sql.includes("citation->>'repositoryUrl'")) return { rows: [
      { repository_url: 'https://github.com/legacy/project', source_url: null },
      { repository_url: 'https://github.com/memory/project', source_url: null },
    ] };
    throw new Error(`unexpected query: ${sql}`);
  } };
  const repository = new PostgresAgentBlogPrivateCanaryInputRepository(pool, {
    editorialMemoryRepository: { async snapshot() { return {
      schemaVersion: 'agent-editorial-memory-snapshot-v1', items: [],
      previousRepositoryUrls: ['https://github.com/memory/project', 'https://github.com/new/project'],
      selectionMemory: { schemaVersion: 'blog-editorial-memory-input-v1',
        capturedAt: '2026-10-27T00:00:00.000Z', activeCooldowns: [] },
    }; } },
  });
  const snapshot = await repository.snapshot(agentUserId);
  assert.equal(snapshot.schemaVersion, 'agent-blog-private-canary-input-snapshot-v2');
  assert.deepEqual(snapshot.previousRepositoryUrls, [
    'https://github.com/legacy/project', 'https://github.com/memory/project',
    'https://github.com/new/project',
  ]);
  assert.deepEqual(snapshot.recentTitles, ['历史文章']);
  assert.equal(snapshot.editorialMemory.schemaVersion, 'blog-editorial-memory-input-v1');
});
