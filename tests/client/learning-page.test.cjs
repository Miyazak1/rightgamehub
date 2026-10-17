const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

test('learning area is a first-class bilingual route with categories and a curated simulation library', async () => {
  const [app,navigation,page,catalog,messages,styles,webPackage,buildScript,caddy] = await Promise.all([
    fs.readFile('packages/platform-client/src/App.jsx','utf8'),
    fs.readFile('packages/platform-client/src/PlatformNavigation.jsx','utf8'),
    fs.readFile('packages/platform-client/src/LearningPage.jsx','utf8'),
    fs.readFile('packages/platform-client/src/learning-catalog.mjs','utf8'),
    fs.readFile('packages/platform-client/src/i18n.mjs','utf8'),
    fs.readFile('packages/platform-client/src/styles.css','utf8'),
    fs.readFile('apps/web/package.json','utf8'),
    fs.readFile('scripts/build-learning-library.mjs','utf8'),
    fs.readFile('deploy/Caddyfile','utf8'),
  ]);
  assert.match(app,/route === '\/learn'.*<LearningPage/u);
  assert.match(app,/learn: 'learning'/u);
  assert.match(navigation,/\['\/learn', 'navigation\.learning'/u);
  assert.match(page,/api\.listWorks\(\{kind:'courseware',limit:50\}/u);
  assert.match(page,/metadata\?\.format==='mooyu\.courseware'/u);
  assert.match(page,/metadata\?\.summary\?\.errors===0/u);
  assert.match(page,/learningCategories\.map/u);
  assert.match(page,/learningSubjects\.map/u);
  assert.match(page,/builtInLearningItems/u);
  assert.match(catalog,/id: 'simulations'/u);
  assert.match(catalog,/generatedLearningItems/u);
  const generated = await fs.readFile('packages/platform-client/src/generated-learning-items.mjs','utf8');
  assert.match(generated,/quadratic-shape-explorer/u);
  assert.match(generated,/force-motion-lab/u);
  assert.match(generated,/projectile-motion-challenge/u);
  assert.match(generated,/chemical-equilibrium-lab/u);
  assert.match(messages,/'navigation\.learning': '\u5b66\u4e60'/u);
  assert.match(messages,/'navigation\.learning': 'Learn'/u);
  assert.match(messages,/'learning\.trustVerified': '\u7ed3\u6784\u5316\u76ee\u6807\u4e0e\u670d\u52a1\u5668\u590d\u9a8c'/u);
  assert.match(messages,/'learning\.categories': '\u5b66\u4e60\u5206\u7c7b'/u);
  assert.match(styles,/\.learning-grid\{display:grid/u);
  assert.match(styles,/\.learning-category-grid\{display:grid/u);
  assert.match(styles,/\.learning-category__copy small\{font-size:13px/u, 'desktop learning categories must remain readable at normal zoom');
  assert.match(styles,/\.learning-card__body>p\{height:48px;font-size:14px/u, 'desktop courseware summaries must not collapse into microcopy');
  assert.match(webPackage,/build-learning-library\.mjs/u);
  assert.match(buildScript,/readdir\(templateRoot/u);
  assert.match(buildScript,/manifest\.catalog/u);
  assert.match(buildScript,/generated-learning-items\.mjs/u);
  assert.match(buildScript,/loadCoursewareInventory/u);
  assert.match(generated,/dist\/index\.html/u);
  assert.match(caddy,/handle \/learning\/courseware\/\*/u);
});
