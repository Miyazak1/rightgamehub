const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');

test('GitHub outreach handoff opens a reviewable prefilled issue without sending it',async()=>{
  const {githubIssueDraftUrl}=await import('../../packages/platform-client/src/author-outreach-copy.mjs');
  const url=new URL(githubIssueDraftUrl({repositoryUrl:'https://github.com/example/game'},{draftSubject:'邀请核对作品',draftBody:'请作者先核对页面，再决定是否认领。'}));
  assert.equal(url.origin+url.pathname,'https://github.com/example/game/issues/new');
  assert.equal(url.searchParams.get('title'),'邀请核对作品');
  assert.match(url.searchParams.get('body'),/决定是否认领/u);
});

test('admin outreach UI keeps sync, copy, external review and sent-state recording separate',async()=>{
  const [app,queue]=await Promise.all([fs.readFile('packages/platform-client/src/App.jsx','utf8'),fs.readFile('packages/platform-client/src/AuthorOutreachQueue.jsx','utf8')]);
  assert.match(app,/<AuthorOutreachQueue api=\{api\} demo=\{demo\}\/>/u);
  assert.match(queue,/同步合格候选/u);
  assert.match(queue,/复制草稿/u);
  assert.match(queue,/在 GitHub 核对并发送/u);
  assert.match(queue,/记录已联系/u);
  assert.match(queue,/不自动创建 Issue，不自动重复催促/u);
  assert.doesNotMatch(queue,/fetch\(['"]https:\/\/api\.github\.com/u);
});
