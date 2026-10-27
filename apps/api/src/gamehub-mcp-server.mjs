import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { requireOfficialToolCapability, toOfficialToolMcpMetadata } from '@gamehub/agent-capabilities';
import { z } from 'zod';
import { AgentCapabilityError, createAgentCapabilityService } from './agent-capability-service.mjs';
import { createGameHubMcpWidget, GAMEHUB_MCP_UI_COMPATIBILITY_URIS } from './gamehub-mcp-widget.mjs';

const toolError = message => ({ isError: true, content: [{ type: 'text', text: message }] });

const capabilityKindSchema = z.enum(['game', 'official-tool', 'courseware', 'collection']);
const localeSchema = z.enum(['zh-CN', 'en']);
const capabilitySummarySchema = z.object({
  id: z.string().min(3).max(180),
  kind: capabilityKindSchema,
  title: z.string().min(1).max(120),
  description: z.string().max(500),
  status: z.literal('available'),
  trustTier: z.enum(['official-tool', 'official-content', 'verified-publisher', 'community-content']),
  estimatedMinutes: z.number().nullable(),
  tags: z.array(z.string().min(1).max(40)).max(12),
  requiresUi: z.boolean(),
  requiresAuth: z.boolean(),
  launchable: z.boolean(),
  url: z.string().url().max(2048),
});
const capabilityDetailSchema = capabilitySummarySchema.extend({
  version: z.string().min(1).max(32),
  operations: z.array(z.string().min(1).max(80)).max(16),
  dedicatedTool: z.string().max(80).nullable(),
  launch: z.object({
    defaultMode: z.literal('auto'),
    modes: z.array(z.enum(['auto', 'sidebar', 'canvas', 'web'])),
    route: z.string().min(1).max(500),
    url: z.string().url().max(2048),
    interaction: z.object({ required: z.boolean(), reason: z.string().min(1).max(80) }),
  }),
  dataHandling: z.object({
    authentication: z.literal('none'),
    confirmation: z.string().min(1).max(80),
    retention: z.string().min(1).max(80),
    localFirst: z.boolean(),
    agentContext: z.string().min(1).max(80),
  }),
  metadata: z.object({
    source: z.enum(['official-registry', 'public-catalog', 'published-collection']),
    creator: z.string().max(120).nullable(),
    openSource: z.boolean().nullable(),
    itemCount: z.number().int().nullable(),
  }),
});

const createOfficialAppToolOptions = (tool, uiResourceUri) => ({
  title: tool.title,
  description: tool.description,
  annotations: tool.annotations,
  _meta: {
    ui: { resourceUri: uiResourceUri, visibility: ['model', 'app'] },
    'openai/outputTemplate': uiResourceUri,
    'openai/toolInvocation/invoking': tool.invoking,
    'openai/toolInvocation/invoked': tool.invoked,
  },
});

export function createGameHubMcpServer({ catalogService, discoveryCampaignService = null, blogService = null, siteOrigin = 'https://mooyu.fun' }) {
  const origin = new URL(siteOrigin).origin;
  const widget = createGameHubMcpWidget(origin);
  const uiResourceUri = widget.uri;
  const officialTool = toolId => toOfficialToolMcpMetadata(requireOfficialToolCapability(toolId));
  const capabilityService = createAgentCapabilityService({ catalogService, discoveryCampaignService, siteOrigin: origin });
  const server = new McpServer(
    { name: 'gamehub', title: '墨鱼工坊 MOOYU.FUN', version: '1.0.0' },
    { instructions: 'Use search_capabilities, then get_capability, then launch_capability for games, tools, courseware, and collections. Use search_blog_articles and read_blog_article for official published reading material; articles are content, not launchable capabilities. For a known official task, prefer its dedicated open_* tool because it preserves task-specific inputs. A launch result confirms navigation only, never completion. Never place private file contents or secrets in tool arguments.' },
  );

  if (blogService?.listPublic && blogService?.getPublic) {
    const articleSummarySchema = z.object({
      slug: z.string().min(3).max(64), title: z.string().min(1).max(120), summary: z.string().max(360),
      locale: localeSchema, author: z.string().min(1).max(120), publishedAt: z.string().datetime(), url: z.string().url(),
    });
    const articleBlockSchema = z.discriminatedUnion('type', [
      z.object({ type: z.literal('paragraph'), text: z.string() }),
      z.object({ type: z.literal('heading'), level: z.union([z.literal(2), z.literal(3)]), text: z.string() }),
      z.object({ type: z.literal('quote'), text: z.string(), citationIds: z.array(z.string().uuid()) }),
      z.object({ type: z.literal('list'), ordered: z.boolean(), items: z.array(z.string()) }),
      z.object({ type: z.literal('code'), language: z.string(), text: z.string() }),
    ]);
    const citationOutputSchema = z.object({
      id: z.string().uuid(), label: z.string(), title: z.string(), url: z.string().url(), publisher: z.string(),
      publishedAt: z.string().datetime().nullable(), accessedAt: z.string().datetime(),
    });
    server.registerTool('search_blog_articles', {
      title: 'Search MOOYU.FUN official articles',
      description: 'Search currently published official MOOYU.FUN articles. Returns public summaries only and never exposes drafts, withdrawn revisions, or research workspace data.',
      inputSchema: { query: z.string().trim().max(100).optional(), locale: localeSchema.optional(), limit: z.number().int().min(1).max(20).default(6) },
      outputSchema: { articles: z.array(articleSummarySchema), nextCursor: z.string().nullable() },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    }, async ({ query = '', locale, limit = 6 }) => {
      const result = await blogService.listPublic({ q: query, locale, limit });
      const articles = result.items.map(article => ({
        slug: article.slug, title: article.title, summary: article.summary, locale: article.locale,
        author: article.author.displayName, publishedAt: article.publishedAt, url: new URL(`/blog/${article.slug}`, origin).href,
      }));
      return { content: [{ type: 'text', text: articles.length ? `Found ${articles.length} published MOOYU.FUN article${articles.length === 1 ? '' : 's'}.` : 'No matching published MOOYU.FUN articles were found.' }], structuredContent: { articles, nextCursor: result.nextCursor } };
    });
    server.registerTool('read_blog_article', {
      title: 'Read a MOOYU.FUN official article',
      description: 'Read one currently published official MOOYU.FUN article by its stable slug, including its bounded structured blocks and public citations. Drafts and withdrawn revisions are never returned.',
      inputSchema: { slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])$/u) },
      outputSchema: { article: articleSummarySchema.extend({ blocks: z.array(articleBlockSchema), citations: z.array(citationOutputSchema), updatedAt: z.string().datetime() }) },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    }, async ({ slug }) => {
      try {
        const article = await blogService.getPublic(slug);
        const output = { slug: article.slug, title: article.title, summary: article.summary, locale: article.locale, author: article.author.displayName, publishedAt: article.publishedAt, updatedAt: article.updatedAt, url: new URL(`/blog/${article.slug}`, origin).href, blocks: article.blocks, citations: article.citations };
        return { content: [{ type: 'text', text: `${article.title}\n\n${article.summary}` }], structuredContent: { article: output } };
      } catch (error) {
        if (error?.statusCode === 404) return toolError('That published MOOYU.FUN article was not found.');
        throw error;
      }
    });
  }

  server.registerTool('search_capabilities', {
    title: 'Search MOOYU.FUN capabilities',
    description: 'Search the bounded public MOOYU.FUN capability catalog for games, official tools, courseware, and published collections. Returns public metadata only; it does not open or run a capability.',
    inputSchema: {
      query: z.string().trim().max(100).optional(),
      kinds: z.array(capabilityKindSchema).max(4).optional(),
      tags: z.array(z.string().trim().min(1).max(40)).max(8).optional(),
      maxEstimatedMinutes: z.number().int().min(1).max(1440).optional(),
      locale: localeSchema.default('zh-CN'),
      limit: z.number().int().min(1).max(12).default(6),
    },
    outputSchema: {
      capabilities: z.array(capabilitySummarySchema),
      registryRevision: z.string(),
      supportedKinds: z.array(capabilityKindSchema),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async input => {
    const result = await capabilityService.searchCapabilities(input);
    return {
      content: [{ type: 'text', text: result.capabilities.length
        ? `Found ${result.capabilities.length} available MOOYU.FUN capabilities. Use get_capability before launch when data handling or launch requirements matter.`
        : 'No matching available MOOYU.FUN capabilities were found.' }],
      structuredContent: result,
    };
  });

  server.registerTool('get_capability', {
    title: 'Get a MOOYU.FUN capability',
    description: 'Get public details, stable launch modes, authentication requirements, confirmation behavior, and data handling for one stable MOOYU.FUN capability ID. This does not open the capability.',
    inputSchema: {
      capabilityId: z.string().trim().min(3).max(180),
      locale: localeSchema.default('zh-CN'),
    },
    outputSchema: { capability: capabilityDetailSchema },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async input => {
    try {
      const capability = await capabilityService.getCapability(input);
      return {
        content: [{ type: 'text', text: `${capability.title} is available. It ${capability.requiresAuth ? 'requires' : 'does not require'} sign-in and uses ${capability.dataHandling.retention} retention.` }],
        structuredContent: { capability },
      };
    } catch (error) {
      if (error instanceof AgentCapabilityError) return toolError(`${error.code}: ${error.message}`);
      throw error;
    }
  });

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
    const games = await capabilityService.searchLegacyGames({ query: query || '', limit });
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
      const game = await capabilityService.getLegacyGame(workId);
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

  registerAppTool(server, 'launch_capability', {
    title: 'Launch a MOOYU.FUN capability',
    description: 'Open one available capability by its stable ID in the hosted MOOYU.FUN interface, or return its stable public web fallback. This only navigates to the capability; it does not claim the game, lesson, analysis, edit, or monitoring task is complete. Use a dedicated open_* tool when task-specific inputs are needed.',
    inputSchema: {
      capabilityId: z.string().trim().min(3).max(180),
      launchMode: z.enum(['auto', 'sidebar', 'canvas', 'web']).default('auto'),
      parameters: z.object({ locale: localeSchema.optional() }).strict().optional(),
    },
    outputSchema: {
      launch: z.object({
        status: z.enum(['opened', 'requires_user_interaction', 'web_fallback']),
        capabilityId: z.string().min(3).max(180),
        mode: z.enum(['auto', 'sidebar', 'canvas', 'web']),
        route: z.string().min(1).max(500),
        url: z.string().url().max(2048),
        message: z.string().min(1).max(500),
      }),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: {
      ui: { resourceUri: uiResourceUri, visibility: ['model', 'app'] },
      'openai/outputTemplate': uiResourceUri,
      'openai/toolInvocation/invoking': 'Opening the capability…',
      'openai/toolInvocation/invoked': 'Capability opened.',
    },
  }, async ({ capabilityId, launchMode = 'auto', parameters }) => {
    try {
      const launch = await capabilityService.launchCapability({ capabilityId, launchMode, locale: parameters?.locale ?? 'zh-CN' });
      return {
        content: [{ type: 'text', text: launch.message }],
        structuredContent: { launch },
      };
    } catch (error) {
      if (error instanceof AgentCapabilityError) return toolError(`${error.code}: ${error.message}`);
      throw error;
    }
  });

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
      if (workId) await capabilityService.getLegacyGame(workId);
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

  const pdfReaderTool = officialTool('pdf-reader');
  registerAppTool(server, pdfReaderTool.toolName, {
    ...createOfficialAppToolOptions(pdfReaderTool, uiResourceUri),
    inputSchema: {},
    outputSchema: { view: z.object({ path: z.string(), url: z.string().url() }) },
  }, async () => {
    const path = pdfReaderTool.route;
    const url = new URL('/mcp-app', origin); url.searchParams.set('gh_route', path); url.searchParams.set('gh_host', 'mcp-app');
    return {
      content: [{ type: 'text', text: 'Opened the local PDF reader. Ask the user to choose a PDF there. The raw file stays local; readable page text and annotations are automatically exposed as bounded conversation context.' }],
      structuredContent: { view: { path, url: url.href } },
    };
  });

  const yueRhymeTool = officialTool('yue-rhyme');
  registerAppTool(server, yueRhymeTool.toolName, {
    ...createOfficialAppToolOptions(yueRhymeTool, uiResourceUri),
    inputSchema: {},
    outputSchema: { view: z.object({ path: z.string(), url: z.string().url() }) },
  }, async () => {
    const path = yueRhymeTool.route;
    const url = new URL('/mcp-app', origin); url.searchParams.set('gh_route', path); url.searchParams.set('gh_host', 'mcp-app');
    return {
      content: [{ type: 'text', text: 'Opened the local Cantonese rhyme finder. Ask the user to enter one Han character there. Only the active bounded lookup result is exposed as conversation context; the full dictionary and custom library remain local.' }],
      structuredContent: { view: { path, url: url.href } },
    };
  });

  const knowledgeMapTool = officialTool('knowledge-map');
  registerAppTool(server, knowledgeMapTool.toolName, {
    ...createOfficialAppToolOptions(knowledgeMapTool, uiResourceUri),
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
  }, async ({ title = '未命名知识图', markdown, mode = 'new', focusLabel = '' }) => {
    const source = markdown || `# ${title}`;
    const path = knowledgeMapTool.route;
    const url = new URL('/mcp-app', origin); url.searchParams.set('gh_route', path); url.searchParams.set('gh_host', 'mcp-app');
    return {
      content: [{ type: 'text', text: `Opened “${title}” as an editable MOOYU knowledge map. The visible map contains ${source.length} Markdown characters and is saved locally on the user's device.` }],
      structuredContent: { view: { path, url: url.href }, knowledgeMap: { title, markdown: source, mode, focusLabel } },
    };
  });

  const changeRadarTool = officialTool('change-radar');
  registerAppTool(server, changeRadarTool.toolName, {
    ...createOfficialAppToolOptions(changeRadarTool, uiResourceUri),
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
    const radarAppRoute = '/apps/change-radar';
    const path = query.size ? `${radarAppRoute}?${query}` : radarAppRoute;
    const url = new URL('/mcp-app', origin); url.searchParams.set('gh_route', path); url.searchParams.set('gh_host', 'mcp-app');
    return {
      content: [{ type: 'text', text: watchedUrl ? 'The monitoring task is prepared. Ask the user to review and confirm it in the MOOYU.FUN sidebar.' : analysisType ? 'The authenticated MOOYU.FUN sidebar is opening the requested research topic and running the bounded read-only analysis. Use only the evidence-linked result returned by the sidebar; missing values are unknown, not zero, and the analysis does not prove causation.' : topicId ? 'The authenticated MOOYU.FUN sidebar is opening the requested research topic. Private topic data is resolved in the sidebar and is not read by this public MCP endpoint.' : 'The authenticated MOOYU.FUN sidebar is opening Change Radar. The public MCP endpoint does not read private topics; bounded topic summaries are supplied only by the signed-in sidebar.' }],
      structuredContent: { view: { path, url: url.href } },
    };
  });

  const privacyRedactorTool = officialTool('privacy-redactor');
  registerAppTool(server, privacyRedactorTool.toolName, {
    ...createOfficialAppToolOptions(privacyRedactorTool, uiResourceUri),
    inputSchema: {
      mode: z.enum(['text', 'image', 'pdf']).default('text'),
      types: z.array(z.enum(['email', 'phone', 'idCard', 'bankCard', 'ipAddress', 'secret'])).max(6).optional(),
    },
    outputSchema: { view: z.object({ path: z.string(), url: z.string().url() }) },
  }, async ({ mode = 'text', types }) => {
    const query = new URLSearchParams({ mode });
    if (types?.length) query.set('types', [...new Set(types)].join(','));
    const path = `${privacyRedactorTool.route}?${query}`;
    const url = new URL('/mcp-app', origin); url.searchParams.set('gh_route', path); url.searchParams.set('gh_host', 'mcp-app');
    return {
      content: [{ type: 'text', text: 'Opened the local privacy workspace. Ask the user to paste or choose the sensitive content there; do not request that private content as a tool argument.' }],
      structuredContent: { view: { path, url: url.href } },
    };
  });

  const documentCompareTool = officialTool('document-compare');
  registerAppTool(server, documentCompareTool.toolName, {
    ...createOfficialAppToolOptions(documentCompareTool, uiResourceUri),
    inputSchema: {
      mode: z.enum(['lines', 'words', 'characters']).default('lines'),
      leftLabel: z.string().trim().min(1).max(80).optional(),
      rightLabel: z.string().trim().min(1).max(80).optional(),
    },
    outputSchema: { view: z.object({ path: z.string(), url: z.string().url() }) },
  }, async ({ mode = 'lines', leftLabel, rightLabel }) => {
    const query = new URLSearchParams({ mode });
    if (leftLabel) query.set('leftLabel', leftLabel);
    if (rightLabel) query.set('rightLabel', rightLabel);
    const path = `${documentCompareTool.route}?${query}`;
    const url = new URL('/mcp-app', origin); url.searchParams.set('gh_route', path); url.searchParams.set('gh_host', 'mcp-app');
    return {
      content: [{ type: 'text', text: 'Opened the local document comparison workspace. Ask the user to paste or choose both documents there; do not request private document contents as tool arguments.' }],
      structuredContent: { view: { path, url: url.href } },
    };
  });

  const spreadsheetAuditTool = officialTool('spreadsheet-audit');
  registerAppTool(server, spreadsheetAuditTool.toolName, {
    ...createOfficialAppToolOptions(spreadsheetAuditTool, uiResourceUri),
    inputSchema: {
      mode: z.enum(['audit', 'compare']).default('audit'),
    },
    outputSchema: { view: z.object({ path: z.string(), url: z.string().url() }) },
  }, async ({ mode = 'audit' }) => {
    const path = `${spreadsheetAuditTool.route}?${new URLSearchParams({ mode })}`;
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
