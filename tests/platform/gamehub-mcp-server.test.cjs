const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');

test('GameHub MCP exposes catalog and official app tools with a versioned hosted UI', async t => {
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
  assert.deepEqual(tools.tools.map(item => item.name).sort(), ['get_game', 'open_change_radar', 'open_document_compare', 'open_gamehub', 'open_knowledge_map', 'open_pdf_reader', 'open_privacy_redactor', 'open_spreadsheet_audit', 'search_games']);
  assert.equal(tools.tools.find(item => item.name === 'search_games').annotations.readOnlyHint, true);
  const openGameHubTool = tools.tools.find(item => item.name === 'open_gamehub');
  assert.equal(openGameHubTool._meta.ui.resourceUri, 'ui://gamehub/platform-v9.html');
  assert.deepEqual(openGameHubTool._meta.ui.visibility, ['model', 'app']);
  assert.equal(openGameHubTool._meta['openai/outputTemplate'], 'ui://gamehub/platform-v9.html');

  const search = await client.callTool({ name: 'search_games', arguments: { query: 'orbit', limit: 4 } });
  assert.equal(search.structuredContent.games[0].playUrl, 'https://mooyu.fun/w/game-1');
  const opened = await client.callTool({ name: 'open_gamehub', arguments: { workId: 'game-1' } });
  assert.equal(opened.structuredContent.view.path, '/works/game-1');
  assert.match(opened.structuredContent.view.url, /\/mcp-app\?gh_route=/u);
  assert.match(opened.structuredContent.view.url, /gh_host=mcp-app/u);
  const pdfTool = tools.tools.find(item => item.name === 'open_pdf_reader');
  assert.equal(pdfTool.annotations.readOnlyHint, true);
  assert.match(pdfTool.description, /never put document contents in tool arguments/iu);
  const pdfReader = await client.callTool({ name: 'open_pdf_reader', arguments: {} });
  assert.equal(pdfReader.structuredContent.view.path, '/tools/pdf-reader');
  assert.match(pdfReader.structuredContent.view.url, /gh_route=%2Ftools%2Fpdf-reader/u);
  const knowledgeTool = tools.tools.find(item => item.name === 'open_knowledge_map');
  assert.equal(knowledgeTool.annotations.readOnlyHint, false);
  assert.equal(knowledgeTool.annotations.destructiveHint, false);
  const knowledge = await client.callTool({ name: 'open_knowledge_map', arguments: { title: 'Launch plan', markdown: '# Launch\n## Risks\n- Timing', mode: 'replace', focusLabel: 'Risks' } });
  assert.equal(knowledge.structuredContent.view.path, '/tools/knowledge-map');
  assert.equal(knowledge.structuredContent.knowledgeMap.title, 'Launch plan');
  assert.equal(knowledge.structuredContent.knowledgeMap.mode, 'replace');
  assert.match(knowledge.structuredContent.knowledgeMap.markdown, /## Risks/u);
  const radarTool = tools.tools.find(item => item.name === 'open_change_radar');
  assert.equal(radarTool.annotations.readOnlyHint, true);
  assert.equal(radarTool.annotations.destructiveHint, false);
  const radar = await client.callTool({ name: 'open_change_radar', arguments: { url: 'https://example.com/pricing', title: 'Pricing', condition: 'Price drops', intervalMinutes: 60 } });
  assert.match(radar.structuredContent.view.path, /^\/tools\/change-radar\?/u);
  assert.match(radar.structuredContent.view.path, /condition=Price\+drops/u);
  assert.match(radar.structuredContent.view.url, /gh_route=%2Ftools%2Fchange-radar/u);
  const privacyTool = tools.tools.find(item => item.name === 'open_privacy_redactor');
  assert.equal(privacyTool.annotations.readOnlyHint, true);
  assert.equal(privacyTool.annotations.destructiveHint, false);
  assert.doesNotMatch(privacyTool.description, /upload the private content/iu);
  const privacy = await client.callTool({ name: 'open_privacy_redactor', arguments: { mode: 'image', types: ['email', 'phone'] } });
  assert.match(privacy.structuredContent.view.path, /^\/tools\/privacy-redactor\?/u);
  assert.match(privacy.structuredContent.view.path, /mode=image/u);
  assert.match(privacy.structuredContent.view.path, /types=email%2Cphone/u);
  assert.match(privacy.structuredContent.view.url, /gh_route=%2Ftools%2Fprivacy-redactor/u);
  const compareTool = tools.tools.find(item => item.name === 'open_document_compare');
  assert.equal(compareTool.annotations.readOnlyHint, true);
  assert.equal(compareTool.annotations.destructiveHint, false);
  assert.match(compareTool.description, /never put document contents in tool arguments/iu);
  const comparison = await client.callTool({ name: 'open_document_compare', arguments: { mode: 'words', leftLabel: 'Contract v1', rightLabel: 'Contract v2' } });
  assert.match(comparison.structuredContent.view.path, /^\/tools\/document-compare\?/u);
  assert.match(comparison.structuredContent.view.path, /mode=words/u);
  assert.match(comparison.structuredContent.view.path, /leftLabel=Contract\+v1/u);
  assert.match(comparison.structuredContent.view.url, /gh_route=%2Ftools%2Fdocument-compare/u);
  const spreadsheetTool = tools.tools.find(item => item.name === 'open_spreadsheet_audit');
  assert.equal(spreadsheetTool.annotations.readOnlyHint, true);
  assert.equal(spreadsheetTool.annotations.destructiveHint, false);
  assert.match(spreadsheetTool.description, /never put workbook contents in tool arguments/iu);
  assert.match(spreadsheetTool.description, /minimal audit summary/iu);
  const spreadsheet = await client.callTool({ name: 'open_spreadsheet_audit', arguments: { mode: 'compare' } });
  assert.match(spreadsheet.structuredContent.view.path, /^\/tools\/spreadsheet-audit\?/u);
  assert.match(spreadsheet.structuredContent.view.path, /mode=compare/u);
  assert.match(spreadsheet.structuredContent.view.url, /gh_route=%2Ftools%2Fspreadsheet-audit/u);

  const resource = await client.readResource({ uri: 'ui://gamehub/platform-v9.html' });
  assert.equal(resource.contents[0].mimeType, 'text/html;profile=mcp-app');
  assert.match(resource.contents[0].text, /<iframe id="gamehub-frame"/u);
  assert.match(resource.contents[0].text, /ui\/request-display-mode/u);
  assert.match(resource.contents[0].text, /gh_embed','platform-v9'/u);
  assert.match(resource.contents[0].text, /searchParams\.set\('lang',locale\)/u);
  assert.match(resource.contents[0].text, /gamehub\/navigation\.openExternal/u);
  assert.match(resource.contents[0].text, /gamehub\/spreadsheet-audit\.submit/u);
  assert.match(resource.contents[0].text, /gamehub\/pdf-reader\.context/u);
  assert.match(resource.contents[0].text, /gamehub\/change-radar\.context/u);
  assert.match(resource.contents[0].text, /gamehub\/knowledge-map\.context/u);
  assert.match(resource.contents[0].text, /gamehub\/knowledge-map\.request-agent/u);
  assert.match(resource.contents[0].text, /gamehub\/knowledge-map\.draft/u);
  assert.match(resource.contents[0].text, /event\.origin===SITE_ORIGIN/u);
  assert.match(resource.contents[0].text, /ui\/update-model-context/u);
  assert.match(resource.contents[0].text, /ui\/message/u);
  assert.match(resource.contents[0].text, /ordinaryCellValuesShared:false/u);
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
  assert.equal(plugin.version, '0.4.0');
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
  assert.equal(tools.tools.length, 9);
  assert.equal((await client.callTool({ name: 'search_games', arguments: {} })).structuredContent.games.length, 0);
});
