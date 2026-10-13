const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');

test('GameHub MCP exposes read-only catalog tools and a versioned hosted UI', async t => {
  const [{ createGameHubMcpServer }, { Client }, { InMemoryTransport }] = await Promise.all([
    import(pathToFileURL(path.join(root, 'apps/api/src/gamehub-mcp-server.mjs'))),
    import(pathToFileURL(path.join(root, 'apps/api/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'))),
    import(pathToFileURL(path.join(root, 'apps/api/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js'))),
  ]);
  const work = {
    id: 'game-1', title: 'Orbital Order', description: 'Physics puzzle', kind: 'game',
    estimatedMinutes: 3, tags: ['puzzle'], creatorDisplayName: 'GameHub', openSource: true,
  };
  const catalogService = { list: async query => { assert.equal(query.runtime, 'web'); return [work]; }, get: async id => { assert.equal(id, work.id); return work; } };
  const server = createGameHubMcpServer({ catalogService, siteOrigin: 'https://mooyu.fun' });
  const client = new Client({ name: 'gamehub-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });

  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map(item => item.name).sort(), ['get_game', 'open_gamehub', 'search_games']);
  assert.equal(tools.tools.find(item => item.name === 'search_games').annotations.readOnlyHint, true);
  const openGameHubTool = tools.tools.find(item => item.name === 'open_gamehub');
  assert.equal(openGameHubTool._meta.ui.resourceUri, 'ui://gamehub/platform-v7.html');
  assert.deepEqual(openGameHubTool._meta.ui.visibility, ['model', 'app']);
  assert.equal(openGameHubTool._meta['openai/outputTemplate'], 'ui://gamehub/platform-v7.html');

  const search = await client.callTool({ name: 'search_games', arguments: { query: 'orbit', limit: 4 } });
  assert.equal(search.structuredContent.games[0].playUrl, 'https://mooyu.fun/w/game-1');
  const opened = await client.callTool({ name: 'open_gamehub', arguments: { workId: 'game-1' } });
  assert.equal(opened.structuredContent.view.path, '/works/game-1');
  assert.match(opened.structuredContent.view.url, /\/mcp-app\?gh_route=/u);
  assert.match(opened.structuredContent.view.url, /gh_host=mcp-app/u);

  const resource = await client.readResource({ uri: 'ui://gamehub/platform-v7.html' });
  assert.equal(resource.contents[0].mimeType, 'text/html;profile=mcp-app');
  assert.match(resource.contents[0].text, /<iframe id="gamehub-frame"/u);
  assert.match(resource.contents[0].text, /ui\/request-display-mode/u);
  assert.match(resource.contents[0].text, /gh_embed','platform-v7'/u);
  assert.match(resource.contents[0].text, /searchParams\.set\('lang',locale\)/u);
  assert.match(resource.contents[0].text, /gamehub\/navigation\.openExternal/u);
  assert.match(resource.contents[0].text, /openai\?\.openExternal/u);
  assert.ok(resource.contents[0].text.includes("new RegExp('^/works/([^/?#]+)/?$')"));
  assert.doesNotMatch(resource.contents[0].text, /route\.match\(\/\^\/works\//u);
  assert.match(resource.contents[0].text, /new URL\(work\?'\/w\/'\+work\[1\]:route,SITE_ORIGIN\)/u);
  const moduleScript = resource.contents[0].text.match(/<script type="module">([\s\S]*?)<\/script>/u)?.[1];
  assert.ok(moduleScript);
  await assert.rejects(
    import(`data:text/javascript,${encodeURIComponent(moduleScript)}`),
    error => error?.name === 'ReferenceError' && /document is not defined/u.test(error.message),
  );
  assert.deepEqual(resource.contents[0]._meta.ui.csp.frameDomains, ['https://mooyu.fun']);
  assert.equal(resource.contents[0]._meta.ui.domain, 'https://mooyu.fun');
  assert.deepEqual(resource.contents[0]._meta['openai/widgetCSP'].frame_domains, ['https://mooyu.fun']);
  assert.equal(resource.contents[0]._meta['openai/widgetDomain'], 'https://mooyu.fun');
  assert.deepEqual(resource.contents[0]._meta['openai/ui'].availableDisplayModes, ['fullscreen']);
});

test('portable plugin connects the remote MCP server and ships through the common verified updater', async () => {
  const [plugin, mcp, build, caddy, app] = await Promise.all([
    fs.readFile(path.join(root, 'plugins/gamehub/plugin.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(root, 'plugins/gamehub/mcp.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(root, 'scripts/prepare-agent-downloads.mjs'), 'utf8'),
    fs.readFile(path.join(root, 'deploy/Caddyfile'), 'utf8'),
    fs.readFile(path.join(root, 'packages/platform-client/src/App.jsx'), 'utf8'),
  ]);
  assert.equal(plugin.version, '0.3.0');
  assert.deepEqual(mcp.mcpServers.gamehub, { type: 'streamable-http', url: 'https://mooyu.fun/mcp' });
  assert.match(build, /marketplace\.plugins\.map/u);
  assert.match(build, /Promise\.all\(pluginRoots\.map\(listFiles\)\)/u);
  assert.match(build, /updateScope: 'all-marketplace-plugins'/u);
  assert.match(caddy, /handle \/mcp[\s\S]*reverse_proxy api:3090/u);
  assert.match(caddy, /handle \/\.well-known\/oauth-\*[\s\S]*reverse_proxy api:3090/u);
  assert.match(caddy, /handle \/mcp-app[\s\S]*frame-ancestors 'self' https:\/\/web-sandbox\.oaiusercontent\.com https:\/\/\*\.web-sandbox\.oaiusercontent\.com/u);
  assert.match(caddy, /handle \/mcp-app[\s\S]*codex-sandbox:/u);
  assert.match(caddy, /handle \/mcp-app[\s\S]*Cache-Control "no-store"/u);
  assert.match(app, /游戏和交互界面由墨鱼工坊服务器提供/u);
  assert.match(app, /每 6 小时校验新版/u);
});

test('GameHub MCP route accepts a real stateless Streamable HTTP client', async t => {
  const [{ registerGameHubMcpRoutes }, { Client }, { StreamableHTTPClientTransport }, { default: Fastify }] = await Promise.all([
    import(pathToFileURL(path.join(root, 'apps/api/src/gamehub-mcp-server.mjs'))),
    import(pathToFileURL(path.join(root, 'apps/api/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'))),
    import(pathToFileURL(path.join(root, 'apps/api/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js'))),
    import(pathToFileURL(path.join(root, 'apps/api/node_modules/fastify/fastify.js'))),
  ]);
  const app = Fastify({ logger: false });
  registerGameHubMcpRoutes(app, {
    siteOrigin: 'https://mooyu.fun',
    catalogService: { list: async () => [], get: async () => { const error = new Error('missing'); error.statusCode = 404; throw error; } },
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const { port } = app.server.address();
  const client = new Client({ name: 'gamehub-http-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
  await client.connect(transport);
  t.after(async () => { await client.close(); await app.close(); });
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 3);
  assert.equal((await client.callTool({ name: 'search_games', arguments: {} })).structuredContent.games.length, 0);
});
