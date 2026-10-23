const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');

test('GameHub MCP exposes published blog search and read as bounded read-only tools', async t => {
  const [{ createGameHubMcpServer }, { Client }, { InMemoryTransport }] = await Promise.all([
    import(pathToFileURL(path.join(root, 'apps/api/src/gamehub-mcp-server.mjs'))),
    import(pathToFileURL(path.join(root, 'apps/api/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'))),
    import(pathToFileURL(path.join(root, 'apps/api/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js'))),
  ]);
  const article = {
    id: crypto.randomUUID(), slug: 'agent-ready-platform', locale: 'zh-CN', title: '为 Agent 设计平台能力',
    summary: '解释游戏、工具和文章在 Agent 中应采用不同调用语义。',
    blocks: [{ type: 'paragraph', text: '文章只能从已发布版本读取。' }], citations: [],
    author: { displayName: '墨鱼工坊' }, publishedAt: '2026-10-22T00:00:00.000Z', updatedAt: '2026-10-22T01:00:00.000Z',
  };
  const blogService = {
    listPublic: async query => { assert.equal(query.q, 'Agent'); assert.equal(query.locale, 'zh-CN'); return { items: [article], nextCursor: null }; },
    getPublic: async slug => { assert.equal(slug, article.slug); return article; },
  };
  const server = createGameHubMcpServer({
    siteOrigin: 'https://mooyu.fun', blogService,
    catalogService: { list: async () => [], get: async () => null },
  });
  const client = new Client({ name: 'blog-agent-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  const tools = await client.listTools();
  for (const name of ['search_blog_articles', 'read_blog_article']) {
    const tool = tools.tools.find(item => item.name === name);
    assert.ok(tool); assert.equal(tool.annotations.readOnlyHint, true); assert.equal(tool._meta?.ui, undefined);
  }
  const search = await client.callTool({ name: 'search_blog_articles', arguments: { query: 'Agent', locale: 'zh-CN' } });
  assert.equal(search.structuredContent.articles[0].url, 'https://mooyu.fun/blog/agent-ready-platform');
  const read = await client.callTool({ name: 'read_blog_article', arguments: { slug: article.slug } });
  assert.equal(read.structuredContent.article.blocks[0].text, '文章只能从已发布版本读取。');
});
