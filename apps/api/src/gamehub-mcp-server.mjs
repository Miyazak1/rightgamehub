import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { createGameHubMcpWidget, GAMEHUB_MCP_UI_COMPATIBILITY_URIS } from './gamehub-mcp-widget.mjs';

const asPublicWork = (work, siteOrigin) => ({
  id: work.id,
  title: work.title,
  description: work.description || '',
  kind: work.kind,
  estimatedMinutes: Number(work.estimatedMinutes || 0),
  tags: Array.isArray(work.tags) ? work.tags.slice(0, 12) : [],
  creator: work.creatorDisplayName || '墨鱼工坊',
  openSource: Boolean(work.openSource),
  playUrl: `${siteOrigin}/w/${encodeURIComponent(work.id)}`,
});

const toolError = message => ({ isError: true, content: [{ type: 'text', text: message }] });

export function createGameHubMcpServer({ catalogService, siteOrigin = 'https://mooyu.fun' }) {
  const origin = new URL(siteOrigin).origin;
  const widget = createGameHubMcpWidget(origin);
  const uiResourceUri = widget.uri;
  const server = new McpServer({ name: 'gamehub', title: '墨鱼工坊 MOOYU.FUN', version: '1.0.0' });

  server.registerTool('search_games', {
    title: 'Search MOOYU.FUN games',
    description: 'Search the public MOOYU.FUN catalog for free browser games. This is read-only and does not require an account.',
    inputSchema: {
      query: z.string().trim().max(100).optional(),
      limit: z.number().int().min(1).max(12).default(6),
    },
    outputSchema: {
      games: z.array(z.object({
        id: z.string(), title: z.string(), description: z.string(), kind: z.string(),
        estimatedMinutes: z.number(), tags: z.array(z.string()), creator: z.string(),
        openSource: z.boolean(), playUrl: z.string().url(),
      })),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ query, limit = 6 }) => {
    const works = await catalogService.list({ q: query || '', kind: 'game', runtime: 'web', limit });
    const games = works.map(work => asPublicWork(work, origin));
    return {
      content: [{ type: 'text', text: games.length
        ? `Found ${games.length} playable MOOYU.FUN game${games.length === 1 ? '' : 's'}: ${games.map(game => game.title).join(', ')}.`
        : 'No matching playable MOOYU.FUN games were found.' }],
      structuredContent: { games },
    };
  });

  server.registerTool('get_game', {
    title: 'Get a MOOYU.FUN game',
    description: 'Get public details and the stable play page for one MOOYU.FUN game. This is read-only.',
    inputSchema: { workId: z.string().min(1).max(100) },
    outputSchema: { game: z.object({
      id: z.string(), title: z.string(), description: z.string(), kind: z.string(),
      estimatedMinutes: z.number(), tags: z.array(z.string()), creator: z.string(),
      openSource: z.boolean(), playUrl: z.string().url(),
    }) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ workId }) => {
    try {
      const game = asPublicWork(await catalogService.get(workId), origin);
      return { content: [{ type: 'text', text: `${game.title}: ${game.description}\nPlay: ${game.playUrl}` }], structuredContent: { game } };
    } catch (error) {
      if (error?.statusCode === 404) return toolError('That MOOYU.FUN game was not found.');
      throw error;
    }
  });

  const uiResourceDescription = 'The complete hosted MOOYU.FUN platform interface. Pages, games, and interface content are served by MOOYU.FUN rather than packaged in the plugin.';
  const readUiResource = uri => ({ contents: [{
    uri,
    mimeType: RESOURCE_MIME_TYPE,
    text: widget.html,
    _meta: {
      ui: {
        prefersBorder: false,
        domain: origin,
        csp: { frameDomains: [origin], resourceDomains: [origin], connectDomains: [origin] },
      },
      'openai/ui': { availableDisplayModes: ['fullscreen'] },
      'openai/widgetDescription': 'Browse and play the complete hosted MOOYU.FUN platform.',
      'openai/widgetPrefersBorder': false,
      'openai/widgetDomain': origin,
      'openai/widgetCSP': {
        frame_domains: [origin],
        resource_domains: [origin],
        connect_domains: [origin],
      },
    },
  }] });

  registerAppResource(server, 'MOOYU.FUN hosted platform', uiResourceUri, {
    description: uiResourceDescription,
  }, async () => readUiResource(uiResourceUri));

  for (const [index, compatibilityUri] of GAMEHUB_MCP_UI_COMPATIBILITY_URIS.entries()) {
    registerAppResource(server, `MOOYU.FUN hosted platform compatibility ${index + 1}`, compatibilityUri, {
      description: `${uiResourceDescription} Compatibility resource for an existing ChatGPT conversation.`,
    }, async () => readUiResource(compatibilityUri));
  }

  registerAppTool(server, 'open_gamehub', {
    title: 'Open MOOYU.FUN',
    description: 'Open the complete hosted MOOYU.FUN interface, optionally focused on one public game. Use this when the user wants to browse, participate, create, or play visually.',
    inputSchema: { workId: z.string().min(1).max(100).optional() },
    outputSchema: { view: z.object({ path: z.string(), url: z.string().url() }) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: {
      ui: { resourceUri: uiResourceUri, visibility: ['model', 'app'] },
      'openai/outputTemplate': uiResourceUri,
      'openai/toolInvocation/invoking': 'Opening MOOYU.FUN…',
      'openai/toolInvocation/invoked': 'MOOYU.FUN opened.',
    },
  }, async ({ workId }) => {
    try {
      if (workId) await catalogService.get(workId);
      const path = workId ? `/works/${encodeURIComponent(workId)}` : '/discover';
      const url = new URL('/mcp-app', origin); url.searchParams.set('gh_route', path); url.searchParams.set('gh_host', 'mcp-app');
      return {
        content: [{ type: 'text', text: workId ? 'Opened the selected game in MOOYU.FUN.' : 'Opened the MOOYU.FUN game catalog.' }],
        structuredContent: { view: { path, url: url.href } },
      };
    } catch (error) {
      if (error?.statusCode === 404) return toolError('That MOOYU.FUN game was not found.');
      throw error;
    }
  });

  registerAppTool(server, 'open_pdf_reader', {
    title: 'Open MOOYU PDF Reader',
    description: 'Open the local-first MOOYU.FUN PDF reading workspace. The user chooses the PDF inside the UI; never put document contents in tool arguments. Extracted text, OCR results, notes, excerpts, and citations stay on the user device. In an embedded Agent, the UI automatically shares a bounded reading context while never sharing the raw PDF.',
    inputSchema: {},
    outputSchema: { view: z.object({ path: z.string(), url: z.string().url() }) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: {
      ui: { resourceUri: uiResourceUri, visibility: ['model', 'app'] },
      'openai/outputTemplate': uiResourceUri,
      'openai/toolInvocation/invoking': 'Opening the local PDF workspace…',
      'openai/toolInvocation/invoked': 'PDF workspace opened.',
    },
  }, async () => {
    const path = '/tools/pdf-reader';
    const url = new URL('/mcp-app', origin); url.searchParams.set('gh_route', path); url.searchParams.set('gh_host', 'mcp-app');
    return {
      content: [{ type: 'text', text: 'Opened the local PDF reader. Ask the user to choose a PDF there. The raw file stays local; readable page text and annotations are automatically exposed as bounded conversation context.' }],
      structuredContent: { view: { path, url: url.href } },
    };
  });

  registerAppTool(server, 'open_knowledge_map', {
    title: 'Open MOOYU Knowledge Map',
    description: 'Create or open an editable visual knowledge map in the MOOYU.FUN sidebar. Use this when the user asks to turn the current conversation, plan, research, or notes into a knowledge map. Supply complete Markdown headings and lists. Use mode "replace" when revising the map already open in this conversation; use "new" for a separate map. The map remains in the user interface and is saved locally on that device.',
    inputSchema: {
      title: z.string().trim().min(1).max(100).optional(),
      markdown: z.string().trim().min(1).max(30000).optional(),
      mode: z.enum(['new', 'replace']).default('new'),
      focusLabel: z.string().trim().max(240).optional(),
    },
    outputSchema: {
      view: z.object({ path: z.string(), url: z.string().url() }),
      knowledgeMap: z.object({ title: z.string(), markdown: z.string(), mode: z.enum(['new', 'replace']), focusLabel: z.string() }),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    _meta: {
      ui: { resourceUri: uiResourceUri, visibility: ['model', 'app'] },
      'openai/outputTemplate': uiResourceUri,
      'openai/toolInvocation/invoking': 'Building the knowledge map…',
      'openai/toolInvocation/invoked': 'Knowledge map opened.',
    },
  }, async ({ title = '未命名知识图', markdown, mode = 'new', focusLabel = '' }) => {
    const source = markdown || `# ${title}`;
    const path = '/tools/knowledge-map';
    const url = new URL('/mcp-app', origin); url.searchParams.set('gh_route', path); url.searchParams.set('gh_host', 'mcp-app');
    return {
      content: [{ type: 'text', text: `Opened “${title}” as an editable MOOYU knowledge map. The visible map contains ${source.length} Markdown characters and is saved locally on the user's device.` }],
      structuredContent: { view: { path, url: url.href }, knowledgeMap: { title, markdown: source, mode, focusLabel } },
    };
  });

  registerAppTool(server, 'open_change_radar', {
    title: 'Open MOOYU Change Radar',
    description: 'Open the MOOYU.FUN Change Radar directory, prefill a public-page monitoring task, or open one of the signed-in user’s existing research topics. For a research topic, the authenticated sidebar—not this public MCP endpoint—may run a bounded accepted-metric query or an accepted structured-fact timeline and return evidence-linked read-only context to the Agent. Fact timelines require a dimensionKey and predicateKey; unknown occurrence times stay unknown and are excluded from change math. Monitoring tasks still require user review before activation.',
    inputSchema: {
      url: z.string().url().max(2048).optional(),
      title: z.string().trim().min(1).max(120).optional(),
      condition: z.string().trim().max(500).optional(),
      ruleType: z.enum(['any','keyword_appears','keyword_disappears','number_changes']).default('any'),
      ruleValue: z.string().trim().max(200).optional(),
      intervalMinutes: z.number().int().min(15).max(10080).default(360),
      topicId: z.string().trim().regex(/^[A-Za-z0-9_-]+$/u).max(100).optional(),
      analysisType: z.enum(['metric-filter','metric-comparison','metric-trend','metric-matrix','metric-view','derived-metric','fact-timeline']).optional(),
      metricKey: z.string().trim().regex(/^[a-z0-9][a-z0-9._-]*$/u).max(80).optional(),
      methodVersion: z.string().trim().regex(/^[a-z0-9][a-z0-9._-]*$/u).max(80).optional(),
      metrics: z.array(z.object({metricKey:z.string().trim().regex(/^[a-z0-9][a-z0-9._-]*$/u).max(80),methodVersion:z.string().trim().regex(/^[a-z0-9][a-z0-9._-]*$/u).max(80)}).strict()).min(2).max(8).optional(),
      derivedMetricId: z.string().trim().regex(/^[A-Za-z0-9_-]+$/u).max(100).optional(),
      metricViewId: z.string().trim().regex(/^[A-Za-z0-9_-]+$/u).max(100).optional(),
      dimensionKey: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u).max(40).optional(),
      dimensionValue: z.string().trim().min(1).max(120).optional(),
      subject: z.string().trim().min(1).max(240).optional(),
      predicateKey: z.string().trim().regex(/^[a-z0-9][a-z0-9._-]*$/u).max(80).optional(),
      scopeKey: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u).max(40).optional(),
      scopeValue: z.string().trim().min(1).max(120).optional(),
      trendInterval: z.enum(['day','week','month']).default('month'),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
    },
    outputSchema: { view: z.object({ path: z.string(), url: z.string().url() }) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: {
      ui: { resourceUri: uiResourceUri, visibility: ['model', 'app'] },
      'openai/outputTemplate': uiResourceUri,
      'openai/toolInvocation/invoking': 'Preparing the Change Radar…',
      'openai/toolInvocation/invoked': 'Change Radar is ready for review.',
    },
  }, async ({ url: watchedUrl, title, condition, ruleType = 'any', ruleValue, intervalMinutes = 360, topicId, analysisType, metricKey, methodVersion, metrics, derivedMetricId, metricViewId, dimensionKey, dimensionValue, subject, predicateKey, scopeKey, scopeValue, trendInterval = 'month', from, to }) => {
    if (watchedUrl && topicId) return toolError('Provide url (prepare a public-page watch) or topicId (open an existing private research topic), not both.');
    if (analysisType && !topicId) return toolError('Research analysis can only target an existing research topic.');
    if (topicId && (title || condition || ruleValue)) return toolError('Monitoring fields cannot be combined with a research-topic request.');
    if (!watchedUrl && !topicId && (title || condition || ruleValue)) return toolError('Monitoring fields require url.');
    if (analysisType && !['metric-matrix','metric-view','derived-metric','fact-timeline'].includes(analysisType) && !metricKey) return toolError('Metric filter, comparison, and trend analysis require metricKey.');
    if (analysisType === 'metric-matrix' && (!metrics || new Set(metrics.map(item=>`${item.metricKey}:${item.methodVersion}`)).size !== metrics.length)) return toolError('Metric matrix analysis requires 2–8 unique metricKey and methodVersion pairs.');
    if (analysisType !== 'metric-matrix' && metrics) return toolError('The metrics array is only valid for metric-matrix analysis.');
    if (analysisType === 'metric-matrix' && (metricKey || methodVersion || dimensionValue)) return toolError('Metric matrix analysis uses metrics and dimensionKey, not single-metric fields or dimensionValue.');
    if (analysisType === 'derived-metric' && !derivedMetricId) return toolError('Derived metric analysis requires derivedMetricId.');
    if (analysisType !== 'derived-metric' && derivedMetricId) return toolError('derivedMetricId is only valid for derived-metric analysis.');
    if (analysisType === 'derived-metric' && (metricKey || methodVersion || metrics || dimensionKey || dimensionValue)) return toolError('Derived metric analysis uses only a saved derivedMetricId and an optional time window.');
    if (analysisType === 'metric-view' && !metricViewId) return toolError('Saved metric view analysis requires metricViewId.');
    if (analysisType !== 'metric-view' && metricViewId) return toolError('metricViewId is only valid for metric-view analysis.');
    if (analysisType === 'metric-view' && (metricKey || methodVersion || metrics || derivedMetricId || dimensionKey || dimensionValue || from || to)) return toolError('Saved metric view analysis uses only metricViewId; its frozen configuration supplies the query fields.');
    if (analysisType === 'fact-timeline' && (!dimensionKey || !predicateKey)) return toolError('Fact timeline analysis requires dimensionKey and predicateKey.');
    if (analysisType === 'fact-timeline' && !/^[a-z0-9][a-z0-9._-]{0,79}$/u.test(dimensionKey)) return toolError('Fact timeline dimensionKey must use the normalized lower-case fact key format.');
    if (analysisType === 'fact-timeline' && Boolean(scopeKey) !== Boolean(scopeValue)) return toolError('Fact timeline scopeKey and scopeValue must be provided together.');
    if (analysisType === 'fact-timeline' && (metricKey || methodVersion || metrics || derivedMetricId || metricViewId || dimensionValue)) return toolError('Fact timeline analysis uses fact fields, an optional scope pair, and an optional time window.');
    if (analysisType !== 'fact-timeline' && (subject || predicateKey || scopeKey || scopeValue)) return toolError('Fact fields are only valid for fact-timeline analysis.');
    if (['metric-comparison','metric-trend','metric-matrix'].includes(analysisType) && !dimensionKey) return toolError('Metric comparison, trend, and matrix analysis require dimensionKey.');
    if (analysisType === 'metric-trend' && !dimensionValue) return toolError('Metric trend analysis requires dimensionValue.');
    if (analysisType === 'metric-filter' && Boolean(dimensionKey) !== Boolean(dimensionValue)) return toolError('Metric filtering requires dimensionKey and dimensionValue together.');
    if (from && to && new Date(from) > new Date(to)) return toolError('The analysis time window must begin on or before it ends.');
    if ((metricKey || methodVersion || metrics || derivedMetricId || metricViewId || dimensionKey || dimensionValue || subject || predicateKey || scopeKey || scopeValue || from || to) && !analysisType) return toolError('Provide analysisType when analysis fields are present.');
    const query = watchedUrl ? new URLSearchParams({ url: watchedUrl, interval: String(intervalMinutes), ruleType }) : topicId ? new URLSearchParams({ topicId }) : new URLSearchParams();
    if (watchedUrl && title) query.set('title', title);
    if (watchedUrl && condition) query.set('condition', condition);
    if (watchedUrl && ruleValue) query.set('ruleValue', ruleValue);
    if (analysisType) {
      query.set('analysis', analysisType);
      if (metricKey) query.set('metricKey', metricKey);
      if (methodVersion) query.set('methodVersion', methodVersion);
      if (metrics) for (const item of metrics) query.append('metric', `${item.metricKey}:${item.methodVersion}`);
      if (derivedMetricId) query.set('derivedMetricId', derivedMetricId);
      if (metricViewId) query.set('metricViewId', metricViewId);
      if (dimensionKey) query.set('dimensionKey', dimensionKey);
      if (dimensionValue) query.set('dimensionValue', dimensionValue);
      if (subject) query.set('subject', subject);
      if (predicateKey) query.set('predicateKey', predicateKey);
      if (scopeKey) query.set('scopeKey', scopeKey);
      if (scopeValue) query.set('scopeValue', scopeValue);
      if (analysisType === 'metric-trend') query.set('trendInterval', trendInterval);
      if (from) query.set('from', from);
      if (to) query.set('to', to);
    }
    const path = query.size ? `/tools/change-radar?${query}` : '/tools/change-radar';
    const url = new URL('/mcp-app', origin); url.searchParams.set('gh_route', path); url.searchParams.set('gh_host', 'mcp-app');
    return {
      content: [{ type: 'text', text: watchedUrl ? 'The monitoring task is prepared. Ask the user to review and confirm it in the MOOYU.FUN sidebar.' : analysisType ? 'The authenticated MOOYU.FUN sidebar is opening the requested research topic and running the bounded read-only analysis. Use only the evidence-linked result returned by the sidebar; missing values are unknown, not zero, and the analysis does not prove causation.' : topicId ? 'The authenticated MOOYU.FUN sidebar is opening the requested research topic. Private topic data is resolved in the sidebar and is not read by this public MCP endpoint.' : 'The authenticated MOOYU.FUN sidebar is opening Change Radar. The public MCP endpoint does not read private topics; bounded topic summaries are supplied only by the signed-in sidebar.' }],
      structuredContent: { view: { path, url: url.href } },
    };
  });

  registerAppTool(server, 'open_privacy_redactor', {
    title: 'Open MOOYU Privacy Redactor',
    description: 'Open the local-first MOOYU.FUN privacy tool for reviewing and redacting sensitive text, images, or PDFs. Use this instead of putting private content into tool arguments. The content stays in the user interface and is not uploaded by this tool.',
    inputSchema: {
      mode: z.enum(['text', 'image', 'pdf']).default('text'),
      types: z.array(z.enum(['email', 'phone', 'idCard', 'bankCard', 'ipAddress', 'secret'])).max(6).optional(),
    },
    outputSchema: { view: z.object({ path: z.string(), url: z.string().url() }) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: {
      ui: { resourceUri: uiResourceUri, visibility: ['model', 'app'] },
      'openai/outputTemplate': uiResourceUri,
      'openai/toolInvocation/invoking': 'Opening the local privacy workspace…',
      'openai/toolInvocation/invoked': 'Privacy workspace opened.',
    },
  }, async ({ mode = 'text', types }) => {
    const query = new URLSearchParams({ mode });
    if (types?.length) query.set('types', [...new Set(types)].join(','));
    const path = `/tools/privacy-redactor?${query}`;
    const url = new URL('/mcp-app', origin); url.searchParams.set('gh_route', path); url.searchParams.set('gh_host', 'mcp-app');
    return {
      content: [{ type: 'text', text: 'Opened the local privacy workspace. Ask the user to paste or choose the sensitive content there; do not request that private content as a tool argument.' }],
      structuredContent: { view: { path, url: url.href } },
    };
  });

  registerAppTool(server, 'open_document_compare', {
    title: 'Open MOOYU Document Compare',
    description: 'Open the local MOOYU.FUN document comparison workspace. The user can paste or choose private documents inside the UI; never put document contents in tool arguments. Supports local text, PDF, and DOCX comparison.',
    inputSchema: {
      mode: z.enum(['lines', 'words', 'characters']).default('lines'),
      leftLabel: z.string().trim().min(1).max(80).optional(),
      rightLabel: z.string().trim().min(1).max(80).optional(),
    },
    outputSchema: { view: z.object({ path: z.string(), url: z.string().url() }) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: {
      ui: { resourceUri: uiResourceUri, visibility: ['model', 'app'] },
      'openai/outputTemplate': uiResourceUri,
      'openai/toolInvocation/invoking': 'Opening the local document comparison workspace…',
      'openai/toolInvocation/invoked': 'Document comparison workspace opened.',
    },
  }, async ({ mode = 'lines', leftLabel, rightLabel }) => {
    const query = new URLSearchParams({ mode });
    if (leftLabel) query.set('leftLabel', leftLabel);
    if (rightLabel) query.set('rightLabel', rightLabel);
    const path = `/tools/document-compare?${query}`;
    const url = new URL('/mcp-app', origin); url.searchParams.set('gh_route', path); url.searchParams.set('gh_host', 'mcp-app');
    return {
      content: [{ type: 'text', text: 'Opened the local document comparison workspace. Ask the user to paste or choose both documents there; do not request private document contents as tool arguments.' }],
      structuredContent: { view: { path, url: url.href } },
    };
  });

  registerAppTool(server, 'open_spreadsheet_audit', {
    title: 'Open MOOYU Spreadsheet Formula Audit',
    description: 'Open the local MOOYU.FUN spreadsheet formula audit workspace for tracing formulas, finding structural anomalies, and comparing workbook versions. The user chooses XLSX or XLSM files inside the UI; never put workbook contents in tool arguments. Raw files stay on the user device. After the user selects a file, the UI sends this conversation a disclosed minimal audit summary without ordinary cell values.',
    inputSchema: {
      mode: z.enum(['audit', 'compare']).default('audit'),
    },
    outputSchema: { view: z.object({ path: z.string(), url: z.string().url() }) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: {
      ui: { resourceUri: uiResourceUri, visibility: ['model', 'app'] },
      'openai/outputTemplate': uiResourceUri,
      'openai/toolInvocation/invoking': 'Opening the local spreadsheet audit workspace…',
      'openai/toolInvocation/invoked': 'Spreadsheet audit workspace opened.',
    },
  }, async ({ mode = 'audit' }) => {
    const path = `/tools/spreadsheet-audit?${new URLSearchParams({ mode })}`;
    const url = new URL('/mcp-app', origin); url.searchParams.set('gh_route', path); url.searchParams.set('gh_host', 'mcp-app');
    return {
      content: [{ type: 'text', text: 'Opened the local spreadsheet formula audit workspace. Ask the user to choose the workbook there. The raw file stays local; after selection, the UI automatically returns a minimal disclosed audit summary to this conversation.' }],
      structuredContent: { view: { path, url: url.href } },
    };
  });

  return server;
}

export function registerGameHubMcpWidgetRoutes(app, { siteOrigin = 'https://mooyu.fun' } = {}) {
  app.get('/mcp-widget/:revision/widget.js', async (request, reply) => {
    const widget = createGameHubMcpWidget(siteOrigin);
    if (request.params.revision !== widget.script.revision) {
      return reply.header('Cache-Control', 'no-store').status(404).send({ error: 'MCP_WIDGET_NOT_FOUND' });
    }
    return reply
      .header('Access-Control-Allow-Origin', '*')
      .header('Cross-Origin-Resource-Policy', 'cross-origin')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .type('text/javascript; charset=utf-8')
      .send(widget.script.text);
  });
}

export function registerGameHubMcpRoutes(app, dependencies, { registerWidget = true } = {}) {
  const corsHeaders = reply => reply
    .header('Access-Control-Allow-Origin', '*')
    .header('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS')
    .header('Access-Control-Allow-Headers', 'content-type, mcp-session-id, mcp-protocol-version')
    .header('Access-Control-Expose-Headers', 'Mcp-Session-Id');

  app.options('/mcp', async (_request, reply) => corsHeaders(reply).status(204).send());
  if (registerWidget) registerGameHubMcpWidgetRoutes(app, dependencies);
  for (const method of ['POST', 'GET', 'DELETE']) app.route({ method, url: '/mcp', handler: async (request, reply) => {
    corsHeaders(reply).header('Cache-Control', 'no-store');
    const server = createGameHubMcpServer(dependencies);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    reply.raw.once('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
    try {
      await server.connect(transport);
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } catch (error) {
      request.log?.error?.({ err: error }, 'GameHub MCP request failed');
      if (!reply.raw.headersSent) reply.raw.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({
        jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null,
      }));
    }
  } });
}
