const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const work = { id: 'work-one', title: '测试游戏', description: '需要保留现有游戏', instructions: '点击移动', state: 'published', visibility: 'public', kind: 'game', revision: '7', repositoryUrl: 'https://github.com/example/game?token=discard', ownerUserId: 'private-owner', token: 'must-not-export', targets: [{ targetKey: 'web', state: 'published', currentReleaseId: 'live-release' }] };
const releases = [{ id: 'new-draft', targetKey: 'web', label: 'newer draft' }, { id: 'live-release', targetKey: 'web', label: '1.0.0', packageType: 'web_zip', secret: 'signed-url' }];
const load = () => import('../../packages/platform-client/src/creator-ai-task.mjs');

test('AI tasks select the actual published release and export only necessary context', async () => {
  const { createCreatorAiTask } = await load();
  const task = createCreatorAiTask({ kind: 'leaderboards', work, releases, form: { metric: '用时', direction: 'asc', period: 'daily', scoring: '通关后记录耗时毫秒，暂停时间不计入。' } });
  assert.equal(task.protocol, 'gamehub.creator-ai-task');
  assert.equal(task.schemaVersion, 1);
  assert.deepEqual(task.context.currentPublishedReleases, [{ id: 'live-release', targetKey: 'web', label: '1.0.0', packageType: 'web_zip' }]);
  assert.equal(task.context.work.repositoryUrl, 'https://github.com/example/game');
  assert.equal(task.context.sourceCodeIncluded, false);
  assert.equal(task.requirements.direction, 'asc');
  assert.equal(task.requirements.period, 'daily');
  assert.equal(task.requirements.verification, 'client_reported');
  assert.doesNotMatch(JSON.stringify(task), /private-owner|must-not-export|signed-url|newer draft|token=discard/);
});

test('Chinese and JSON tasks preserve explicit confirmation and truthful delivery requirements', async () => {
  const { createCreatorAiTask, formatCreatorAiTask } = await load();
  const task = createCreatorAiTask({ kind: 'multiplayer', work, releases, form: { players: '4', gameplay: '四人轮流出牌，先清空手牌的人获胜。', privateInformation: '只有自己可以看到手牌。' } });
  assert.equal(task.requirements.players, 4);
  assert.equal(task.executionPolicy.autoUpload, false);
  assert.equal(task.executionPolicy.autoPublish, false);
  assert.equal(task.executionPolicy.uploadRequiresUserConfirmation, true);
  assert.equal(task.executionPolicy.publishRequiresUserConfirmation, true);
  assert.equal(task.executionPolicy.packageLocally, true);
  const prompt = formatCreatorAiTask(task);
  for (const content of ['work-one', 'live-release', '四人轮流出牌', 'getPlayerView', 'commandId', '检查', '修改', '测试', '打包', '不得自动上传', '分别需要我明确确认', '尚未检查本地源码']) assert.ok(prompt.includes(content), content);
  assert.deepEqual(JSON.parse(JSON.stringify(task)), task);
});

test('drafts and withdrawn works do not pretend to have current published versions', async () => {
  const { currentPublishedReleases } = await load();
  assert.deepEqual(currentPublishedReleases({ ...work, state: 'draft' }, releases), []);
  assert.deepEqual(currentPublishedReleases({ ...work, visibility: 'private' }, releases), []);
  assert.equal(currentPublishedReleases(work, [])[0].label, null, 'do not substitute a different release when history is incomplete');
});

test('AI task validation rejects unsupported player counts, sorting and incomplete needs', async () => {
  const { createCreatorAiTask } = await load();
  for (const players of ['1', '9', '2.5', 'wrong']) assert.throws(() => createCreatorAiTask({ kind: 'multiplayer', work, form: { players, gameplay: '两人轮流移动棋子，先到终点获胜。' } }));
  assert.throws(() => createCreatorAiTask({ kind: 'multiplayer', work, form: { players: '2', gameplay: '太短' } }));
  for (const form of [{ metric: '', direction: 'asc', period: 'daily' }, { metric: '分', direction: 'sideways', period: 'daily' }, { metric: '分', direction: 'desc', period: 'weekly' }]) assert.throws(() => createCreatorAiTask({ kind: 'leaderboards', work, form: { ...form, scoring: '通关后记录完整的一局成绩。' } }));
});

test('AI task source reference paths exist in this release', async () => {
  const { createCreatorAiTask } = await load();
  const task = createCreatorAiTask({ kind: 'multiplayer', work, form: { players: '2', gameplay: '两个人轮流移动棋子，先到终点获胜。' } });
  for (const reference of task.references.filter(item => item.url.includes('/blob/'))) await fs.access(path.resolve(__dirname, '../..', reference.url.split('/codex/game-services-foundation/')[1]));
});
