import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { GAMEHUB_MCP_UI_URI, renderGameHubMcpWidget } from './gamehub-mcp-widget.mjs';

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

  registerAppResource(server, 'MOOYU.FUN hosted platform', GAMEHUB_MCP_UI_URI, {
    description: 'The complete hosted MOOYU.FUN platform interface. Pages, games, and interface content are served by MOOYU.FUN rather than packaged in the plugin.',
  }, async () => ({ contents: [{
    uri: GAMEHUB_MCP_UI_URI,
    mimeType: RESOURCE_MIME_TYPE,
    text: renderGameHubMcpWidget(origin),
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
  }] }));

  registerAppTool(server, 'open_gamehub', {
    title: 'Open MOOYU.FUN',
    description: 'Open the complete hosted MOOYU.FUN interface, optionally focused on one public game. Use this when the user wants to browse, participate, create, or play visually.',
    inputSchema: { workId: z.string().min(1).max(100).optional() },
    outputSchema: { view: z.object({ path: z.string(), url: z.string().url() }) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: {
      ui: { resourceUri: GAMEHUB_MCP_UI_URI, visibility: ['model', 'app'] },
      'openai/outputTemplate': GAMEHUB_MCP_UI_URI,
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

  registerAppTool(server, 'open_change_radar', {
    title: 'Open MOOYU Change Radar',
    description: 'Open the MOOYU.FUN Change Radar with a monitoring task prefilled. Use this when the user asks to monitor a public webpage for future changes. The user reviews and confirms the task in the sidebar before it becomes active.',
    inputSchema: {
      url: z.string().url().max(2048),
      title: z.string().trim().min(1).max(120).optional(),
      condition: z.string().trim().max(500).optional(),
      intervalMinutes: z.number().int().min(15).max(10080).default(360),
    },
    outputSchema: { view: z.object({ path: z.string(), url: z.string().url() }) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: {
      ui: { resourceUri: GAMEHUB_MCP_UI_URI, visibility: ['model', 'app'] },
      'openai/outputTemplate': GAMEHUB_MCP_UI_URI,
      'openai/toolInvocation/invoking': 'Preparing the Change Radar…',
      'openai/toolInvocation/invoked': 'Change Radar is ready for review.',
    },
  }, async ({ url: watchedUrl, title, condition, intervalMinutes = 360 }) => {
    const query = new URLSearchParams({ url: watchedUrl, interval: String(intervalMinutes) });
    if (title) query.set('title', title);
    if (condition) query.set('condition', condition);
    const path = `/tools/change-radar?${query}`;
    const url = new URL('/mcp-app', origin); url.searchParams.set('gh_route', path); url.searchParams.set('gh_host', 'mcp-app');
    return {
      content: [{ type: 'text', text: 'The monitoring task is prepared. Ask the user to review and confirm it in the MOOYU.FUN sidebar.' }],
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
      ui: { resourceUri: GAMEHUB_MCP_UI_URI, visibility: ['model', 'app'] },
      'openai/outputTemplate': GAMEHUB_MCP_UI_URI,
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
      ui: { resourceUri: GAMEHUB_MCP_UI_URI, visibility: ['model', 'app'] },
      'openai/outputTemplate': GAMEHUB_MCP_UI_URI,
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

  return server;
}

export function registerGameHubMcpRoutes(app, dependencies) {
  const corsHeaders = reply => reply
    .header('Access-Control-Allow-Origin', '*')
    .header('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS')
    .header('Access-Control-Allow-Headers', 'content-type, mcp-session-id, mcp-protocol-version')
    .header('Access-Control-Expose-Headers', 'Mcp-Session-Id');

  app.options('/mcp', async (_request, reply) => corsHeaders(reply).status(204).send());
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
