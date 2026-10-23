const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');

test('GameHub MCP exposes catalog and official app tools with a content-addressed hosted UI', async t => {
  const [{ createGameHubMcpServer }, { createGameHubMcpWidget, GAMEHUB_MCP_UI_COMPATIBILITY_URIS }, { Client }, { InMemoryTransport }] = await Promise.all([
    import(pathToFileURL(path.join(root, 'apps/api/src/gamehub-mcp-server.mjs'))),
    import(pathToFileURL(path.join(root, 'apps/api/src/gamehub-mcp-widget.mjs'))),
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
  assert.deepEqual(tools.tools.map(item => item.name).sort(), ['get_capability', 'get_game', 'launch_capability', 'open_change_radar', 'open_document_compare', 'open_gamehub', 'open_knowledge_map', 'open_pdf_reader', 'open_privacy_redactor', 'open_spreadsheet_audit', 'search_capabilities', 'search_games']);
  assert.equal(tools.tools.find(item => item.name === 'search_games').annotations.readOnlyHint, true);
  const openGameHubTool = tools.tools.find(item => item.name === 'open_gamehub');
  const mcpUiUri = openGameHubTool._meta.ui.resourceUri;
  const revision = mcpUiUri.match(/^ui:\/\/gamehub\/platform-([a-f0-9]{16})\.html$/u)?.[1];
  assert.ok(revision, `Expected a content-addressed MCP UI URI, received ${mcpUiUri}`);
  assert.deepEqual(openGameHubTool._meta.ui.visibility, ['model', 'app']);
  assert.equal(openGameHubTool._meta['openai/outputTemplate'], mcpUiUri);
  const uiTools = tools.tools.filter(item => item._meta?.ui?.resourceUri);
  assert.equal(uiTools.length, 8);
  for (const tool of uiTools) {
    assert.equal(tool._meta.ui.resourceUri, mcpUiUri);
    assert.equal(tool._meta['openai/outputTemplate'], mcpUiUri);
  }
  assert.equal(tools.tools.find(item => item.name === 'search_games')._meta?.ui, undefined);
  assert.equal(tools.tools.find(item => item.name === 'get_game')._meta?.ui, undefined);
  assert.equal(tools.tools.find(item => item.name === 'search_capabilities')._meta?.ui, undefined);
  assert.equal(tools.tools.find(item => item.name === 'get_capability')._meta?.ui, undefined);

  const capabilitySearch = await client.callTool({ name: 'search_capabilities', arguments: { query: '知识图', kinds: ['official-tool'], locale: 'zh-CN' } });
  assert.equal(capabilitySearch.structuredContent.capabilities[0].id, 'official-tool:knowledge-map');
  const capabilityDetail = await client.callTool({ name: 'get_capability', arguments: { capabilityId: 'official-tool:pdf-reader', locale: 'zh-CN' } });
  assert.equal(capabilityDetail.structuredContent.capability.dataHandling.retention, 'device-local');
  assert.equal(capabilityDetail.structuredContent.capability.dedicatedTool, 'open_pdf_reader');
  const capabilityLaunch = await client.callTool({ name: 'launch_capability', arguments: { capabilityId: 'game:game-1', launchMode: 'canvas' } });
  assert.equal(capabilityLaunch.structuredContent.launch.status, 'requires_user_interaction');
  assert.equal(capabilityLaunch.structuredContent.launch.route, '/works/game-1');
  const rejectedLaunch = await client.callTool({ name: 'launch_capability', arguments: { capabilityId: 'game:game-1', parameters: { url: 'https://example.com' } } });
  assert.equal(rejectedLaunch.isError, true);
  assert.match(rejectedLaunch.content[0].text, /unrecognized key|invalid arguments/iu);

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
  const radarDirectory = await client.callTool({ name: 'open_change_radar', arguments: {} });
  assert.equal(radarDirectory.structuredContent.view.path, '/apps/change-radar');
  assert.match(radarDirectory.content[0].text, /signed-in sidebar/iu);
  const radar = await client.callTool({ name: 'open_change_radar', arguments: { url: 'https://example.com/pricing', title: 'Pricing', condition: 'Price drops', intervalMinutes: 60 } });
  assert.match(radar.structuredContent.view.path, /^\/apps\/change-radar\?/u);
  assert.match(radar.structuredContent.view.path, /condition=Price\+drops/u);
  assert.match(radar.structuredContent.view.url, /gh_route=%2Fapps%2Fchange-radar/u);
  const radarAnalysis = await client.callTool({ name: 'open_change_radar', arguments: { topicId: '00000000-0000-4000-8000-000000000001', analysisType: 'metric-trend', metricKey: 'plan.price', methodVersion: 'direct-observation-v1', dimensionKey: 'plan', dimensionValue: 'pro', trendInterval: 'month' } });
  assert.match(radarAnalysis.structuredContent.view.path, /topicId=00000000-0000-4000-8000-000000000001/u);
  assert.match(radarAnalysis.structuredContent.view.path, /analysis=metric-trend/u);
  assert.match(radarAnalysis.structuredContent.view.path, /metricKey=plan.price/u);
  assert.match(radarAnalysis.structuredContent.view.path, /dimensionValue=pro/u);
  assert.match(radarAnalysis.content[0].text, /authenticated MOOYU\.FUN sidebar/iu);
  const radarFilter = await client.callTool({ name: 'open_change_radar', arguments: { topicId: '00000000-0000-4000-8000-000000000001', analysisType: 'metric-filter', metricKey: 'plan.price', dimensionKey: 'plan', dimensionValue: 'pro', from: '2026-01-01T00:00:00.000Z' } });
  assert.match(radarFilter.structuredContent.view.path, /analysis=metric-filter/u);
  assert.match(radarFilter.structuredContent.view.path, /from=2026-01-01T00%3A00%3A00.000Z/u);
  const radarFilterWithoutDimension = await client.callTool({ name: 'open_change_radar', arguments: { topicId: '00000000-0000-4000-8000-000000000001', analysisType: 'metric-filter', metricKey: 'plan.price' } });
  assert.doesNotMatch(radarFilterWithoutDimension.structuredContent.view.path, /dimensionKey=/u);
  const radarMatrix = await client.callTool({ name: 'open_change_radar', arguments: { topicId: '00000000-0000-4000-8000-000000000001', analysisType: 'metric-matrix', metrics: [{metricKey:'plan.price',methodVersion:'direct-observation-v1'},{metricKey:'plan.storage',methodVersion:'direct-observation-v1'}], dimensionKey: 'plan' } });
  assert.match(radarMatrix.structuredContent.view.path, /analysis=metric-matrix/u);
  assert.match(radarMatrix.structuredContent.view.path, /metric=plan.price%3Adirect-observation-v1/u);
  assert.match(radarMatrix.structuredContent.view.path, /metric=plan.storage%3Adirect-observation-v1/u);
  const radarDerived = await client.callTool({ name: 'open_change_radar', arguments: { topicId: '00000000-0000-4000-8000-000000000001', analysisType: 'derived-metric', derivedMetricId: '00000000-0000-4000-8000-000000000002', from: '2026-01-01T00:00:00.000Z' } });
  assert.match(radarDerived.structuredContent.view.path, /analysis=derived-metric/u);
  assert.match(radarDerived.structuredContent.view.path, /derivedMetricId=00000000-0000-4000-8000-000000000002/u);
  const radarSavedView = await client.callTool({ name: 'open_change_radar', arguments: { topicId: '00000000-0000-4000-8000-000000000001', analysisType: 'metric-view', metricViewId: '00000000-0000-4000-8000-000000000003' } });
  assert.match(radarSavedView.structuredContent.view.path, /analysis=metric-view/u);
  assert.match(radarSavedView.structuredContent.view.path, /metricViewId=00000000-0000-4000-8000-000000000003/u);
  const radarFactTimeline = await client.callTool({ name: 'open_change_radar', arguments: { topicId: '00000000-0000-4000-8000-000000000001', analysisType: 'fact-timeline', subject: 'Professional plan', dimensionKey: 'pricing', predicateKey: 'monthly-price', scopeKey: 'region', scopeValue: 'global', from: '2026-01-01T00:00:00.000Z' } });
  assert.match(radarFactTimeline.structuredContent.view.path, /analysis=fact-timeline/u);
  assert.match(radarFactTimeline.structuredContent.view.path, /subject=Professional\+plan/u);
  assert.match(radarFactTimeline.structuredContent.view.path, /predicateKey=monthly-price/u);
  assert.match(radarFactTimeline.structuredContent.view.path, /scopeKey=region/u);
  const invalidRadarAnalysis = await client.callTool({ name: 'open_change_radar', arguments: { topicId: '00000000-0000-4000-8000-000000000001', analysisType: 'metric-trend', metricKey: 'plan.price', dimensionKey: 'plan' } });
  assert.equal(invalidRadarAnalysis.isError, true);
  const invalidRadarFilter = await client.callTool({ name: 'open_change_radar', arguments: { topicId: '00000000-0000-4000-8000-000000000001', analysisType: 'metric-filter', metricKey: 'plan.price', dimensionKey: 'plan' } });
  assert.equal(invalidRadarFilter.isError, true);
  const invalidHybridRadar = await client.callTool({ name: 'open_change_radar', arguments: { url: 'https://example.com', analysisType: 'metric-filter', metricKey: 'plan.price' } });
  assert.equal(invalidHybridRadar.isError, true);
  const invalidRadarMatrix = await client.callTool({ name: 'open_change_radar', arguments: { topicId: '00000000-0000-4000-8000-000000000001', analysisType: 'metric-matrix', metrics: [{metricKey:'plan.price',methodVersion:'direct-observation-v1'},{metricKey:'plan.price',methodVersion:'direct-observation-v1'}], dimensionKey: 'plan' } });
  assert.equal(invalidRadarMatrix.isError, true);
  const invalidRadarDerived = await client.callTool({ name: 'open_change_radar', arguments: { topicId: '00000000-0000-4000-8000-000000000001', analysisType: 'derived-metric', derivedMetricId: '00000000-0000-4000-8000-000000000002', metricKey: 'plan.price' } });
  assert.equal(invalidRadarDerived.isError, true);
  const invalidRadarSavedView = await client.callTool({ name: 'open_change_radar', arguments: { topicId: '00000000-0000-4000-8000-000000000001', analysisType: 'metric-view', metricViewId: '00000000-0000-4000-8000-000000000003', from: '2026-01-01T00:00:00.000Z' } });
  assert.equal(invalidRadarSavedView.isError, true);
  const invalidRadarFactTimeline = await client.callTool({ name: 'open_change_radar', arguments: { topicId: '00000000-0000-4000-8000-000000000001', analysisType: 'fact-timeline', dimensionKey: 'pricing' } });
  assert.equal(invalidRadarFactTimeline.isError, true);
  const invalidRadarFactScope = await client.callTool({ name: 'open_change_radar', arguments: { topicId: '00000000-0000-4000-8000-000000000001', analysisType: 'fact-timeline', dimensionKey: 'pricing', predicateKey: 'monthly-price', scopeKey: 'region' } });
  assert.equal(invalidRadarFactScope.isError, true);
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

  const resource = await client.readResource({ uri: mcpUiUri });
  const widget = createGameHubMcpWidget('https://mooyu.fun');
  assert.equal(resource.contents[0].mimeType, 'text/html;profile=mcp-app');
  assert.match(resource.contents[0].text, /<iframe id="gamehub-frame"/u);
  const scriptSource = resource.contents[0].text.match(/<script type="module" src="([^"]+)"><\/script>/u)?.[1];
  assert.equal(scriptSource, `https://mooyu.fun${widget.script.path}`);
  assert.doesNotMatch(resource.contents[0].text, /<script type="module">/u);
  assert.doesNotMatch(resource.contents[0].text, /__GAMEHUB_MCP_UI_REVISION__/u);
  assert.equal(createHash('sha256').update(resource.contents[0].text, 'utf8').digest('hex').slice(0, 16), revision);
  const canonicalScript = widget.script.text.replaceAll(widget.script.revision, '__GAMEHUB_MCP_UI_REVISION__');
  assert.equal(createHash('sha256').update(canonicalScript, 'utf8').digest('hex'), widget.script.sha256);
  assert.match(widget.script.text, /ui\/request-display-mode/u);
  assert.ok(widget.script.text.includes(`gh_embed','${widget.script.revision}'`));
  assert.match(widget.script.text, /searchParams\.set\('lang',locale\)/u);
  assert.match(widget.script.text, /gamehub\/navigation\.openExternal/u);
  assert.match(widget.script.text, /gamehub\/spreadsheet-audit\.submit/u);
  assert.match(widget.script.text, /gamehub\/pdf-reader\.context/u);
  assert.match(widget.script.text, /gamehub\/change-radar\.context/u);
  assert.match(widget.script.text, /includesResearchQuestions/u);
  assert.match(widget.script.text, /includesAcceptedClaims/u);
  assert.match(widget.script.text, /includesAcceptedMetrics/u);
  assert.match(widget.script.text, /includesImmutableResearchReports/u);
  assert.match(widget.script.text, /includesUnreadResearchNotifications/u);
  assert.match(widget.script.text, /includesClaimReviewSignals/u);
  assert.match(widget.script.text, /includesMetricUnitProvenance/u);
  assert.match(widget.script.text, /cleanRadarContextV8/u);
  assert.match(widget.script.text, /cleanRadarContextV9/u);
  assert.match(widget.script.text, /includesEventClusterRelationshipDiagnostics/u);
  assert.match(widget.script.text, /cleanRadarContextV10/u);
  assert.match(widget.script.text, /includesMetricPeriodAttribution/u);
  assert.match(widget.script.text, /metricPeriodMissingIsZero=false/u);
  assert.match(widget.script.text, /metricPeriodCausalAttribution=false/u);
  assert.match(widget.script.text, /cleanRadarContextV11/u);
  assert.match(widget.script.text, /cleanRadarContextV12/u);
  assert.match(widget.script.text, /cleanRadarContextV13/u);
  assert.match(widget.script.text, /cleanRadarContextV14/u);
  assert.match(widget.script.text, /cleanRadarContextV15/u);
  assert.match(widget.script.text, /cleanRadarContextV16/u);
  assert.match(widget.script.text, /includesAuthenticatedRequestedAnalysis/u);
  assert.match(widget.script.text, /requestedAnalysisResolvedByAuthenticatedSidebar=true/u);
  assert.match(widget.script.text, /requestedAnalysisMissingIsZero=false/u);
  assert.match(widget.script.text, /requestedAnalysisCausalAttribution=false/u);
  assert.match(widget.script.text, /factTimelineAcceptedFactsOnly=true/u);
  assert.match(widget.script.text, /factTimelineUnknownTimeExcludedFromChange=true/u);
  assert.match(widget.script.text, /factTimelinePublicationTimeSubstituted=false/u);
  assert.match(widget.script.text, /includesDeterministicTrendSummary/u);
  assert.match(widget.script.text, /trendSummaryMissingIsZero=false/u);
  assert.match(widget.script.text, /trendSummaryCausalAttribution=false/u);
  assert.match(widget.script.text, /includesAuthenticatedMetricMatrix/u);
  assert.match(widget.script.text, /includesAuthenticatedDerivedMetric/u);
  assert.match(widget.script.text, /includesSavedDerivedMetricDefinitions/u);
  assert.match(widget.script.text, /includesSavedMetricViews/u);
  assert.match(widget.script.text, /savedMetricViewsExecuteOnlyAfterAuthenticatedResolution=true/u);
  assert.match(widget.script.text, /derivedMetricUsesSavedFormulaOnly=true/u);
  assert.match(widget.script.text, /metricMatrixMissingIsZero=false/u);
  assert.match(widget.script.text, /metricMatrixCausalAttribution=false/u);
  assert.match(widget.script.text, /eventClusterIndependenceVerified=false/u);
  assert.match(widget.script.text, /sourceValue/u);
  assert.match(widget.script.text, /claimReviewSignals/u);
  assert.match(widget.script.text, /excludesUnreviewedClaims:true/u);
  assert.match(widget.script.text, /excludesUnreviewedMetrics:true/u);
  assert.match(widget.script.text, /missingIsZero:false/u);
  assert.match(widget.script.text, /selectedTopic/u);
  assert.match(widget.script.text, /\[2,3,4,5,6,7\]\.includes/u);
  assert.match(widget.script.text, /gamehub\/knowledge-map\.context/u);
  assert.match(widget.script.text, /gamehub\/knowledge-map\.request-agent/u);
  assert.match(widget.script.text, /gamehub\/knowledge-map\.draft/u);
  assert.match(widget.script.text, /event\.origin===SITE_ORIGIN/u);
  assert.match(widget.script.text, /ui\/update-model-context/u);
  assert.match(widget.script.text, /ui\/message/u);
  assert.match(widget.script.text, /ordinaryCellValuesShared:false/u);
  assert.match(widget.script.text, /openai\?\.openExternal/u);
  assert.ok(widget.script.text.includes("new RegExp('^/works/([^/?#]+)/?$')"));
  assert.doesNotMatch(widget.script.text, /route\.match\(\/\^\/works\//u);
  assert.match(widget.script.text, /new URL\(work\?'\/w\/'\+work\[1\]:route,SITE_ORIGIN\)/u);
  await assert.rejects(
    import(`data:text/javascript,${encodeURIComponent(widget.script.text)}`),
    error => error?.name === 'ReferenceError' && /document is not defined/u.test(error.message),
  );
  assert.deepEqual(resource.contents[0]._meta.ui.csp.frameDomains, ['https://mooyu.fun']);
  assert.equal(resource.contents[0]._meta.ui.domain, 'https://mooyu.fun');
  assert.deepEqual(resource.contents[0]._meta['openai/widgetCSP'].frame_domains, ['https://mooyu.fun']);
  assert.equal(resource.contents[0]._meta['openai/widgetDomain'], 'https://mooyu.fun');
  assert.deepEqual(resource.contents[0]._meta['openai/ui'].availableDisplayModes, ['fullscreen']);

  const resources = await client.listResources();
  assert.deepEqual(
    resources.resources.map(item => item.uri),
    [mcpUiUri, ...GAMEHUB_MCP_UI_COMPATIBILITY_URIS],
  );
  for (const compatibilityUri of GAMEHUB_MCP_UI_COMPATIBILITY_URIS) {
    const compatibilityResource = await client.readResource({ uri: compatibilityUri });
    assert.equal(compatibilityResource.contents[0].uri, compatibilityUri);
    assert.equal(compatibilityResource.contents[0].mimeType, 'text/html;profile=mcp-app');
    assert.equal(compatibilityResource.contents[0].text, widget.html);
    assert.doesNotMatch(compatibilityResource.contents[0].text, /<script type="module">/u);
    assert.match(compatibilityResource.contents[0].text, /<script type="module" src=/u);
  }
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
  assert.match(caddy, /handle \/mcp-widget\/\*[\s\S]*reverse_proxy api:3090/u);
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
  assert.equal(tools.tools.length, 12);
  assert.equal((await client.callTool({ name: 'search_games', arguments: {} })).structuredContent.games.length, 0);
  const openGameHub = tools.tools.find(item => item.name === 'open_gamehub');
  const resource = await client.readResource({ uri: openGameHub._meta.ui.resourceUri });
  const scriptSource = resource.contents[0].text.match(/<script type="module" src="([^"]+)"><\/script>/u)?.[1];
  assert.ok(scriptSource);
  const scriptResponse = await fetch(`http://127.0.0.1:${port}${new URL(scriptSource).pathname}`);
  assert.equal(scriptResponse.status, 200);
  assert.equal(scriptResponse.headers.get('access-control-allow-origin'), '*');
  assert.equal(scriptResponse.headers.get('cross-origin-resource-policy'), 'cross-origin');
  assert.match(scriptResponse.headers.get('cache-control'), /immutable/u);
  assert.match(await scriptResponse.text(), /ui\/initialize/u);
});
