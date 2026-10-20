const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const moduleUrl = relativePath => pathToFileURL(path.join(root, relativePath)).href;

const works = [
  {
    id: 'game-1', kind: 'game', title: '<b>轨道谜题</b>', description: '短篇浏览器游戏',
    revision: '4', estimatedMinutes: 8, tags: ['益智', 'orbit'], creatorDisplayName: 'Creator',
    openSource: false, claimStatus: 'verified',
  },
  {
    id: 'lesson-1', kind: 'courseware', title: '二次函数探索', description: '拖动参数观察图像',
    revision: '2', estimatedMinutes: 12, tags: ['数学', '函数'], creatorDisplayName: 'Teacher',
    openSource: true, claimStatus: 'publisher',
  },
];

const campaign = {
  slug: 'weekly-math', title: '本周数学专题', summary: '从交互作品理解函数和图像之间的关系。',
  eyebrow: '学习专题', campaignKind: 'collection', version: 3, items: [{ workId: 'lesson-1' }],
};

test('Agent capability service discovers and resolves only bounded public capability types', async () => {
  const { createAgentCapabilityService } = await import(moduleUrl('apps/api/src/agent-capability-service.mjs'));
  const catalogService = {
    list: async ({ kind, q = '' }) => works.filter(work => work.kind === kind
      && (!q || [work.title, work.description, ...work.tags].join(' ').toLowerCase().includes(q.toLowerCase()))),
    get: async id => {
      const work = works.find(item => item.id === id);
      if (!work) { const error = new Error('missing'); error.statusCode = 404; throw error; }
      return work;
    },
  };
  const discoveryCampaignService = {
    listPublic: async () => [campaign],
    getPublic: async slug => {
      if (slug === campaign.slug) return campaign;
      const error = new Error('missing'); error.statusCode = 404; throw error;
    },
  };
  const service = createAgentCapabilityService({ catalogService, discoveryCampaignService, siteOrigin: 'https://mooyu.fun' });

  const official = await service.searchCapabilities({ query: '知识图', kinds: ['official-tool'], locale: 'zh-CN', limit: 6 });
  assert.deepEqual(official.capabilities.map(item => item.id), ['official-tool:knowledge-map']);
  assert.equal(official.capabilities[0].requiresAuth, false);
  const crossLocale = await service.searchCapabilities({ query: '墨鱼知识图', kinds: ['official-tool'], locale: 'en', limit: 6 });
  assert.deepEqual(crossLocale.capabilities.map(item => item.id), ['official-tool:knowledge-map']);

  const courseware = await service.searchCapabilities({ query: '函数', kinds: ['courseware'], locale: 'zh-CN', limit: 6 });
  assert.deepEqual(courseware.capabilities.map(item => item.id), ['courseware:lesson-1']);
  assert.equal(courseware.capabilities[0].url, 'https://mooyu.fun/w/lesson-1');

  const collection = await service.getCapability({ capabilityId: 'collection:weekly-math', locale: 'zh-CN' });
  assert.equal(collection.metadata.source, 'published-collection');
  assert.equal(collection.metadata.itemCount, 1);
  assert.equal(collection.launch.route, '/discover/c/weekly-math');
  assert.equal(collection.launch.interaction.reason, 'browse-in-ui');

  const game = await service.getCapability({ capabilityId: 'game:game-1', locale: 'zh-CN' });
  assert.equal(game.title, '轨道谜题');
  assert.equal(game.trustTier, 'verified-publisher');
  assert.equal(game.metadata.creator, 'Creator');

  const tool = await service.getCapability({ capabilityId: 'official-tool:pdf-reader', locale: 'en' });
  assert.equal(tool.title, 'MOOYU PDF Reader');
  assert.equal(tool.dataHandling.retention, 'device-local');
  assert.equal(tool.dedicatedTool, 'open_pdf_reader');

  const embedded = await service.launchCapability({ capabilityId: 'courseware:lesson-1', launchMode: 'canvas', locale: 'zh-CN' });
  assert.equal(embedded.status, 'requires_user_interaction');
  assert.match(embedded.url, /^https:\/\/mooyu\.fun\/mcp-app\?/u);
  assert.match(embedded.url, /gh_route=%2Fworks%2Flesson-1/u);

  const web = await service.launchCapability({ capabilityId: 'official-tool:pdf-reader', launchMode: 'web', locale: 'en' });
  assert.equal(web.status, 'web_fallback');
  assert.equal(web.url, 'https://mooyu.fun/tools/pdf-reader');

  await assert.rejects(
    service.getCapability({ capabilityId: 'account-action:admin', locale: 'zh-CN' }),
    error => error.code === 'CAPABILITY_NOT_FOUND' && error.statusCode === 404,
  );
  await assert.rejects(
    service.getCapability({ capabilityId: 'game:missing', locale: 'zh-CN' }),
    error => error.code === 'CAPABILITY_NOT_FOUND' && error.statusCode === 404,
  );
  await assert.rejects(
    service.getCapability({ capabilityId: 'game:lesson-1', locale: 'zh-CN' }),
    error => error.code === 'CAPABILITY_NOT_FOUND' && error.statusCode === 404,
  );
});
