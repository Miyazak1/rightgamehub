const test = require('node:test'), assert = require('node:assert/strict');
const displayModule = () => import('../../packages/platform-client/src/upload-display.mjs');

test('upload publication requires succeeded plus an explicit published result, and completes all eight steps', async () => {
  const { uploadDisplay } = await displayModule();
  const view = uploadDisplay({ state: 'succeeded', publicationOutcome: 'published' });
  assert.equal(view.published, true); assert.equal(view.terminal, true);
  assert.equal(view.steps.length, 8); assert.ok(view.steps.every(step => step.status === 'complete'));
  assert.equal(view.steps.at(-1).label, '已发布'); assert.equal(view.steps.at(-1).detail, '发布完成');
  assert.equal(view.steps.find(step => step.id === 'succeeded').detail, '已完成');
  assert.match(view.description, /新版本已经发布/); assert.equal(view.steps.some(step => step.detail === '当前阶段'), false);
});

for (const [outcome, message, detail] of [['draft',/保留为草稿，尚未发布/,'保留草稿'],['skipped_newer_intent',/更新的发布操作.*未替换线上版本/,'保留草稿'],['blocked',/作品或目标平台已暂停.*未自动发布/,'发布受限'],['pending',/发布结果尚未确认/,'结果待确认'],['toString',/发布结果尚未确认/,'结果待确认'],[undefined,/发布结果尚未确认/,'结果待确认']]) {
  test('successful validation preserves its actual non-publication result: ' + outcome, async () => {
    const { uploadDisplay } = await displayModule(), view = uploadDisplay({ state: 'succeeded', publicationOutcome: outcome });
    assert.equal(view.published, false); assert.equal(view.terminal, true); assert.match(view.description, message);
    assert.deepEqual(view.steps.filter(step => step.status === 'current').map(step => [step.id,step.detail]), [['succeeded',detail]]);
    assert.equal(view.steps.at(-1).status, 'pending'); assert.equal(view.steps.filter(step => step.status === 'complete').length, 6);
  });
}

test('processing stages stay current without inventing publication or using ongoing labels for completed stages', async () => {
  const { uploadDisplay } = await displayModule();
  for (const [index,state] of ['created','receiving','uploaded','queued','validating','scanning'].entries()) {
    const view = uploadDisplay({ state, publicationOutcome: 'published' });
    assert.equal(view.published, false); assert.equal(view.terminal, false);
    assert.equal(view.steps[index].status, 'current'); assert.equal(view.steps.at(-1).status, 'pending');
    for (const step of view.steps.filter(step => step.status === 'complete')) assert.doesNotMatch(step.label, /正在|中$/);
  }
  assert.equal(uploadDisplay({ state: 'created' }, { phase: 'receiving' }).steps[1].status, 'current');
});

for (const [state,title] of [['failed','处理失败'],['review_required','等待人工审核'],['expired','上传已过期'],['unrecognized','等待确认状态'],['published','等待确认状态']]) {
  test('failure, review or unknown upload state must not claim published: ' + state, async () => {
    const { uploadDisplay } = await displayModule(), view = uploadDisplay({ state, publicationOutcome: 'published' });
    assert.equal(view.title, title); assert.equal(view.published, false);
    assert.equal(view.steps.some(step => step.status !== 'pending'), false);
  });
}

test('restored API records derive the same terminal display without transient local progress', async () => {
  const { uploadDisplay } = await displayModule();
  for (const publicationOutcome of ['published','draft','skipped_newer_intent','blocked']) {
    const upload = { state: 'succeeded', publicationOutcome };
    assert.deepEqual(uploadDisplay(upload, { phase: 'done' }), uploadDisplay(JSON.parse(JSON.stringify(upload))));
  }
  assert.equal(uploadDisplay({ state: 'validating' }, { phase: 'error' }).published, false);
  assert.equal(uploadDisplay({ state: 'validating' }, { phase: 'error' }).title, '状态需确认');
  assert.equal(uploadDisplay(null).published, false);
});
