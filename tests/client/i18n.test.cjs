const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs/promises');

const moduleUrl = pathToFileURL(path.resolve(__dirname, '../../packages/platform-client/src/i18n.mjs')).href;

test('normalizes supported browser locales', async () => {
  const { normalizeLocale } = await import(moduleUrl);
  assert.equal(normalizeLocale('zh-CN'), 'zh-CN');
  assert.equal(normalizeLocale('zh-TW'), 'zh-CN');
  assert.equal(normalizeLocale('en-US'), 'en');
  assert.equal(normalizeLocale('fr-FR'), null);
});

test('prefers a saved language and falls back to browser languages', async () => {
  const { resolveLocale } = await import(moduleUrl);
  assert.equal(resolveLocale({ stored: 'en', languages: ['zh-CN'] }), 'en');
  assert.equal(resolveLocale({ stored: 'fr', languages: ['fr-FR', 'en-GB'] }), 'en');
  assert.equal(resolveLocale({ stored: null, languages: ['fr-FR'] }), 'zh-CN');
});

test('keeps the Chinese and English message catalogs in parity', async () => {
  const { catalogKeys } = await import(moduleUrl);
  assert.deepEqual(catalogKeys('en'), catalogKeys('zh-CN'));
});

test('formats parameterized messages in both languages', async () => {
  const { translate } = await import(moduleUrl);
  assert.equal(translate('zh-CN', 'discover.count', { count: 2 }), '2 个作品');
  assert.equal(translate('en', 'discover.count', { count: 1 }), '1 work');
  assert.equal(translate('en', 'discover.count', { count: 2 }), '2 works');
  assert.equal(translate('en-US', 'share.title', { title: 'Orbital Order' }), 'Share Orbital Order');
});

test('community public surfaces consume the shared locale context', async () => {
  const [shell, home, feed, participation, events, parties, projects, contributions] = await Promise.all([
    'CommunityShell.jsx', 'CommunityHome.jsx', 'CommunityPage.jsx', 'CommunityParticipation.jsx',
    'CommunityEvents.jsx', 'CommunityParties.jsx', 'CommunityProjects.jsx', 'ContributionCenter.jsx',
  ].map(file => fs.readFile(path.resolve(__dirname, `../../packages/platform-client/src/${file}`), 'utf8')));
  for (const source of [shell, home, feed, participation, events, parties, projects, contributions]) assert.match(source, /useI18n/);
  assert.match(shell, /community\.nav\.home/);
  assert.match(home, /community\.homeTitle/);
  assert.match(feed, /community\.submitPost/);
  assert.match(participation, /community\.participationTitle/);
  assert.match(events, /date\(event\.startsAt/);
  assert.match(parties, /date\(party\.startsAt/);
  assert.match(projects, /community\.projectsLead/);
  assert.match(contributions, /community\.contributionTitle/);
});

test('creator workspace uses shared translations while admin stays out of scope', async () => {
  const [navigation, app, plan, ...creatorPages] = await Promise.all([
    fs.readFile(path.resolve(__dirname, '../../packages/platform-client/src/PlatformNavigation.jsx'), 'utf8'),
    fs.readFile(path.resolve(__dirname, '../../packages/platform-client/src/App.jsx'), 'utf8'),
    fs.readFile(path.resolve(__dirname, '../../docs/73-internationalization-plan.zh-CN.md'), 'utf8'),
    ...['WorkEditPage.jsx','WorkMetadataFields.jsx','DevelopmentLogPage.jsx','CreatorAiTaskPage.jsx','CompetitionDeveloperCenter.jsx','MultiplayerDeveloperCenter.jsx','MultiplayerRuleSubmissionPage.jsx','UploadStatus.jsx'].map(file => fs.readFile(path.resolve(__dirname, `../../packages/platform-client/src/${file}`), 'utf8')),
  ]);
  assert.match(navigation, /creator\.nav\.works/);
  assert.match(navigation, /creator\.backPlatform/);
  assert.match(app, /creator\.worksTitle/);
  assert.match(app, /creator\.applicationPending/);
  assert.match(app, /creator\.github\.title/);
  assert.match(app, /creator\.build\.title/);
  for (const source of creatorPages) assert.match(source, /useI18n/);
  assert.match(plan, /管理员后台与社区审核管理明确保持中文/);
});

test('external hosts and installer assets expose English-localized entry points', async () => {
  const [app, harness, packageJson, packageNls, packageNlsZh, packagingScript] = await Promise.all([
    fs.readFile(path.resolve(__dirname, '../../packages/platform-client/src/App.jsx'), 'utf8'),
    fs.readFile(path.resolve(__dirname, '../../extensions/harness/src/platform-client.jsx'), 'utf8'),
    fs.readFile(path.resolve(__dirname, '../../extensions/vscode/package.json'), 'utf8'),
    fs.readFile(path.resolve(__dirname, '../../extensions/vscode/package.nls.json'), 'utf8'),
    fs.readFile(path.resolve(__dirname, '../../extensions/vscode/package.nls.zh-cn.json'), 'utf8'),
    fs.readFile(path.resolve(__dirname, '../../scripts/package-vscode-extension.mjs'), 'utf8'),
  ]);
  assert.match(app, /agentInstallEnglish/);
  assert.match(app, /installCopy/);
  assert.match(harness, /Discover, publish, and play Agent games/);
  const manifest = JSON.parse(packageJson);
  assert.equal(manifest.displayName, '%extension.displayName%');
  assert.deepEqual(Object.keys(JSON.parse(packageNls)).sort(), Object.keys(JSON.parse(packageNlsZh)).sort());
  assert.match(packagingScript, /package\.nls\.json/);
  assert.match(packagingScript, /package\.nls\.zh-cn\.json/);
});
