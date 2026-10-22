const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');

test('standalone Change Radar MCP exposes only its bounded sidebar tool', async t => {
  const [{ createChangeRadarMcpServer }, { Client }, { InMemoryTransport }] = await Promise.all([
    import(pathToFileURL(path.join(root, 'apps/api/src/change-radar-mcp-server.mjs'))),
    import(pathToFileURL(path.join(root, 'apps/api/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'))),
    import(pathToFileURL(path.join(root, 'apps/api/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js'))),
  ]);
  const server = createChangeRadarMcpServer({ siteOrigin: 'https://mooyu.fun' });
  const client = new Client({ name: 'change-radar-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });

  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map(item => item.name), ['open_change_radar']);
  const tool = tools.tools[0];
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.equal(tool.annotations.destructiveHint, false);
  assert.match(tool.description, /user reviews and confirms/iu);

  const directory = await client.callTool({ name: 'open_change_radar', arguments: {} });
  assert.equal(directory.structuredContent.view.path, '/tools/change-radar');
  assert.match(directory.content[0].text, /signs in/iu);

  const preparedWatch = await client.callTool({
    name: 'open_change_radar',
    arguments: {
      url: 'https://example.com/pricing',
      title: 'Example pricing',
      condition: 'Enterprise price changes',
      intervalMinutes: 60,
    },
  });
  assert.match(preparedWatch.structuredContent.view.path, /^\/tools\/change-radar\?/u);
  assert.match(preparedWatch.structuredContent.view.path, /condition=Enterprise\+price\+changes/u);
  assert.match(preparedWatch.content[0].text, /review and confirm/iu);

  const analysis = await client.callTool({
    name: 'open_change_radar',
    arguments: {
      topicId: 'topic-1',
      analysisType: 'metric-trend',
      metricKey: 'plan.price',
      methodVersion: 'direct-observation-v1',
      dimensionKey: 'plan',
      dimensionValue: 'pro',
    },
  });
  assert.match(analysis.structuredContent.view.path, /analysis=metric-trend/u);
  assert.match(analysis.content[0].text, /missing values are unknown, not zero/iu);
  assert.match(analysis.content[0].text, /does not prove causation/iu);

  const invalidAnalysis = await client.callTool({
    name: 'open_change_radar',
    arguments: {
      topicId: 'topic-1',
      analysisType: 'metric-trend',
      metricKey: 'plan.price',
      dimensionKey: 'plan',
    },
  });
  assert.equal(invalidAnalysis.isError, true);
});

test('Change Radar ships as a separate marketplace plugin and endpoint', async () => {
  const [plugin, mcp, claudePlugin, hostSupport, skill, agentsMarketplace, claudeMarketplace, caddy, appSource] = await Promise.all([
    fs.readFile(path.join(root, 'plugins/change-radar/plugin.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(root, 'plugins/change-radar/mcp.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(root, 'plugins/change-radar/.claude-plugin/plugin.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(root, 'plugins/change-radar/host-support.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(root, 'plugins/change-radar/skills/change-radar/SKILL.md'), 'utf8'),
    fs.readFile(path.join(root, '.agents/plugins/marketplace.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(root, '.claude-plugin/marketplace.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(root, 'deploy/Caddyfile'), 'utf8'),
    fs.readFile(path.join(root, 'apps/api/src/app.mjs'), 'utf8'),
  ]);

  assert.equal(plugin.name, 'change-radar');
  assert.equal(claudePlugin.name, plugin.name);
  assert.equal(claudePlugin.version, plugin.version);
  assert.deepEqual(mcp.mcpServers['change-radar'], {
    type: 'streamable-http',
    url: 'https://mooyu.fun/mcp/change-radar',
  });
  assert.equal(hostSupport.service.keepsRunningWhenAgentCloses, true);
  assert.match(skill, /Never request a DeepSeek or other model-provider API key/iu);
  assert.match(skill, /Missing values are unknown, not zero/iu);
  assert.match(skill, /time correlation does not establish causation/iu);
  assert.ok(agentsMarketplace.plugins.some(item => item.name === 'change-radar' && item.source?.path === './plugins/change-radar'));
  assert.ok(claudeMarketplace.plugins.some(item => item.name === 'change-radar' && item.source === './plugins/change-radar'));
  assert.match(caddy, /handle \/mcp\/change-radar\s*\{\s*reverse_proxy api:3090\s*\}/u);

  const standaloneRegistration = appSource.indexOf('registerChangeRadarMcpRoutes(app, { siteOrigin });');
  const catalogCondition = appSource.indexOf('if (catalogService) {', standaloneRegistration);
  assert.ok(standaloneRegistration >= 0, 'Expected the standalone Change Radar MCP route to be registered');
  assert.ok(catalogCondition > standaloneRegistration, 'Change Radar MCP registration must not depend on the game catalog');
});

test('standalone Change Radar endpoint works without a game catalog', async t => {
  const [{ registerChangeRadarMcpRoutes }, { registerGameHubMcpWidgetRoutes }, { Client }, { StreamableHTTPClientTransport }, { default: Fastify }] = await Promise.all([
    import(pathToFileURL(path.join(root, 'apps/api/src/change-radar-mcp-server.mjs'))),
    import(pathToFileURL(path.join(root, 'apps/api/src/gamehub-mcp-server.mjs'))),
    import(pathToFileURL(path.join(root, 'apps/api/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'))),
    import(pathToFileURL(path.join(root, 'apps/api/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js'))),
    import(pathToFileURL(path.join(root, 'apps/api/node_modules/fastify/fastify.js'))),
  ]);
  const app = Fastify({ logger: false });
  registerGameHubMcpWidgetRoutes(app, { siteOrigin: 'https://mooyu.fun' });
  registerChangeRadarMcpRoutes(app, { siteOrigin: 'https://mooyu.fun' });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const { port } = app.server.address();
  const client = new Client({ name: 'change-radar-http-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp/change-radar`));
  t.after(async () => { await client.close().catch(() => {}); await app.close(); });
  await client.connect(transport);

  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map(item => item.name), ['open_change_radar']);
  const opened = await client.callTool({ name: 'open_change_radar', arguments: {} });
  assert.equal(opened.structuredContent.view.path, '/tools/change-radar');

  const resource = await client.readResource({ uri: tools.tools[0]._meta.ui.resourceUri });
  const scriptUrl = resource.contents[0].text.match(/<script type="module" src="([^"]+)"><\/script>/u)?.[1];
  assert.ok(scriptUrl, 'Expected an external MCP widget bridge script');
  const scriptPath = new URL(scriptUrl).pathname;
  const scriptResponse = await app.inject({ method: 'GET', url: scriptPath });
  assert.equal(scriptResponse.statusCode, 200);
  assert.match(scriptResponse.headers['content-type'], /text\/javascript/u);
});
