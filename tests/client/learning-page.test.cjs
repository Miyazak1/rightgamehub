const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

test('learning area is a first-class bilingual route backed only by courseware catalog items', async () => {
  const [app,navigation,page,messages,styles] = await Promise.all([
    fs.readFile('packages/platform-client/src/App.jsx','utf8'),
    fs.readFile('packages/platform-client/src/PlatformNavigation.jsx','utf8'),
    fs.readFile('packages/platform-client/src/LearningPage.jsx','utf8'),
    fs.readFile('packages/platform-client/src/i18n.mjs','utf8'),
    fs.readFile('packages/platform-client/src/styles.css','utf8'),
  ]);
  assert.match(app,/route === '\/learn'.*<LearningPage/u);
  assert.match(app,/learn: 'learning'/u);
  assert.match(navigation,/\['\/learn', 'navigation\.learning'/u);
  assert.match(page,/api\.listWorks\(\{kind:'courseware',limit:50\}/u);
  assert.match(page,/metadata\?\.format==='mooyu\.courseware'/u);
  assert.match(page,/metadata\?\.summary\?\.errors===0/u);
  assert.match(messages,/'navigation\.learning': '\u5b66\u4e60'/u);
  assert.match(messages,/'navigation\.learning': 'Learn'/u);
  assert.match(messages,/'learning\.trustVerified': '\u7ed3\u6784\u5316\u76ee\u6807\u4e0e\u670d\u52a1\u5668\u590d\u9a8c'/u);
  assert.match(styles,/\.learning-grid\{display:grid/u);
});
