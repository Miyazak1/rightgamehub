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

export function createGameHubMcpServer({ catalogService, discoveryCampaignService = null, siteOrigin = 'https://mooyu.fun' }) {
  const origin = new URL(siteOrigin).origin;
  const widget = createGameHubMcpWidget(origin);
  const uiResourceUri = widget.uri;
  const officialTool = toolId => toOfficialToolMcpMetadata(requireOfficialToolCapability(toolId));
  const capabilityService = createAgentCapabilityService({ catalogService, discoveryCampaignService, siteOrigin: origin });
  const server = new McpServer(
    { name: 'gamehub', title: '墨鱼工坊 MOOYU.FUN', version: '1.0.0' },
    { instructions: 'Use search_capabilities, then get_capability, then launch_capability for general discovery. For a known official task, prefer its dedicated open_* tool because it preserves task-specific inputs. A launch result confirms navigation only, never completion. Never place private file contents or secrets in tool arguments.' },
  );

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
      url: z.string().url().max(2048),
      title: z.string().trim().min(1).max(120).optional(),
      condition: z.string().trim().max(500).optional(),
      ruleType: z.enum(['any','keyword_appears','keyword_disappears','number_changes']).default('any'),
      ruleValue: z.string().trim().max(200).optional(),
      intervalMinutes: z.number().int().min(15).max(10080).default(360),
    },
    outputSchema: { view: z.object({ path: z.string(), url: z.string().url() }) },
  }, async ({ url: watchedUrl, title, condition, ruleType = 'any', ruleValue, intervalMinutes = 360 }) => {
    const query = new URLSearchParams({ url: watchedUrl, interval: String(intervalMinutes), ruleType });
    if (title) query.set('title', title);
    if (condition) query.set('condition', condition);
    if (ruleValue) query.set('ruleValue', ruleValue);
    const path = `${changeRadarTool.route}?${query}`;
    const url = new URL('/mcp-app', origin); url.searchParams.set('gh_route', path); url.searchParams.set('gh_host', 'mcp-app');
    return {
      content: [{ type: 'text', text: 'The monitoring task is prepared. Ask the user to review and confirm it in the MOOYU.FUN sidebar.' }],
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

export function registerGameHubMcpRoutes(app, dependencies) {
  const corsHeaders = reply => reply
    .header('Access-Control-Allow-Origin', '*')
    .header('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS')
    .header('Access-Control-Allow-Headers', 'content-type, mcp-session-id, mcp-protocol-version')
    .header('Access-Control-Expose-Headers', 'Mcp-Session-Id');

  app.options('/mcp', async (_request, reply) => corsHeaders(reply).status(204).send());
  app.get('/mcp-widget/:revision/widget.js', async (request, reply) => {
    const widget = createGameHubMcpWidget(dependencies.siteOrigin);
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
