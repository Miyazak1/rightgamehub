const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

test('creator development logs publish into a public work timeline without exposing feedback text', async () => {
  const [app, page, styles, messages] = await Promise.all([
    fs.readFile('packages/platform-client/src/App.jsx', 'utf8'),
    fs.readFile('packages/platform-client/src/DevelopmentLogPage.jsx', 'utf8'),
    fs.readFile('packages/platform-client/src/styles.css', 'utf8'),
    fs.readFile('packages/platform-client/src/i18n.mjs', 'utf8'),
  ]);
  assert.match(app, /timeline\.title/);
  assert.match(messages, /'timeline\.title': '开发与贡献记录'/);
  assert.match(app, /api\.listWorkTimeline\(workId\)/);
  assert.match(app, /go\(`\/creator\/works\/\$\{work\.id\}\/development`\)/);
  assert.match(messages, /玩家原始反馈保持私有/);
  assert.match(messages, /公开后会和已验收贡献一起出现在作品时间线/);
  assert.doesNotMatch(page, /api\.listCreatorFeedback/);
  assert.match(styles, /\.work-development__list/);
  assert.match(styles, /\.development-log-form/);
});
