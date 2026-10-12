import crypto from 'node:crypto';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/gu, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

const campaignFields = {
  slug: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{2,62}[a-z0-9]$' },
  eyebrow: { type: 'string', minLength: 2, maxLength: 40 },
  title: { type: 'string', minLength: 5, maxLength: 80 },
  summary: { type: 'string', minLength: 20, maxLength: 300 },
  campaignKind: { type: 'string', enum: ['weekly_open_game','improve_together','collection'] },
  startsAt: { anyOf: [{ type: 'string', format: 'date-time' },{ type: 'null' }] },
  endsAt: { anyOf: [{ type: 'string', format: 'date-time' },{ type: 'null' }] },
  items: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'object', additionalProperties: false, required: ['workId','pitch'], properties: {
    workId: { type: 'string', format: 'uuid' }, pitch: { type: 'string', minLength: 5, maxLength: 160 },
  } } },
};

const landingPage = ({ campaign, siteOrigin, nonce }) => {
  const canonical = `${siteOrigin}/discover/c/${encodeURIComponent(campaign.slug)}`;
  const target = `${siteOrigin}/#/discover/c/${encodeURIComponent(campaign.slug)}?public=1`;
  const firstWork = campaign.items[0]?.work;
  const image = firstWork ? `${siteOrigin}/v1/works/${encodeURIComponent(firstWork.id)}/share-card.png` : null;
  const imageMeta = image ? `<meta property="og:image" content="${escapeHtml(image)}"><meta name="twitter:image" content="${escapeHtml(image)}">` : '';
  const handoff = `window.location.replace(${JSON.stringify(target).replace(/</gu, '\\u003c')});`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(campaign.title)} | GameHub</title><meta name="description" content="${escapeHtml(campaign.summary)}"><link rel="canonical" href="${escapeHtml(canonical)}"><meta property="og:type" content="website"><meta property="og:site_name" content="GameHub"><meta property="og:title" content="${escapeHtml(campaign.title)}"><meta property="og:description" content="${escapeHtml(campaign.summary)}"><meta property="og:url" content="${escapeHtml(canonical)}">${imageMeta}<meta name="twitter:card" content="summary_large_image"><style>body{min-height:100vh;margin:0;display:grid;place-items:center;background:#f7f6fb;color:#17131f;font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei UI",sans-serif}.card{width:min(620px,calc(100% - 48px));padding:36px;border:1px solid #d8d3e2;background:#fff;box-shadow:6px 6px 0 #ded9e8}.label{color:#7651f5;font:800 11px ui-monospace,monospace;letter-spacing:.14em}h1{margin:12px 0;font-size:32px}p{color:#625c6d;line-height:1.7}a{display:inline-block;margin-top:8px;padding:11px 18px;background:#8255f6;color:#fff;font-weight:800;text-decoration:none}</style></head><body><main class="card"><span class="label">${escapeHtml(campaign.eyebrow)}</span><h1>${escapeHtml(campaign.title)}</h1><p>${escapeHtml(campaign.summary)}</p><a href="${escapeHtml(target)}">查看专题</a></main><script nonce="${nonce}">${handoff}</script></body></html>`;
};

export function registerDiscoveryCampaignRoutes(app, { service, requireAuth, siteOrigin }) {
  const envelope = data => ({ data });
  const slugParams = { type: 'object', additionalProperties: false, required: ['slug'], properties: { slug: campaignFields.slug } };
  const idParams = { type: 'object', additionalProperties: false, required: ['campaignId'], properties: { campaignId: { type: 'string', format: 'uuid' } } };

  app.get('/discover/c/:slug', { schema: { params: slugParams } }, async (request, reply) => {
    const campaign = await service.getPublic(request.params.slug);
    const nonce = crypto.randomBytes(18).toString('base64');
    reply.header('Cache-Control', 'public, max-age=60');
    reply.header('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src 'self' https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Content-Type-Options', 'nosniff');
    return reply.type('text/html; charset=utf-8').send(landingPage({ campaign, siteOrigin, nonce }));
  });
  app.get('/v1/discovery/campaigns', {
    schema: { querystring: { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, maximum: 12 } } } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'public, max-age=30');
    return envelope(await service.listPublic(request.query));
  });
  app.get('/v1/discovery/campaigns/:slug', { schema: { params: slugParams } }, async (request, reply) => {
    reply.header('Cache-Control', 'public, max-age=30');
    return envelope(await service.getPublic(request.params.slug));
  });
  app.get('/v1/admin/discovery-campaigns', { preHandler: requireAuth }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return envelope(await service.listAdmin(request.actor));
  });
  app.post('/v1/admin/discovery-campaigns', {
    preHandler: requireAuth,
    schema: { body: { type: 'object', additionalProperties: false, required: ['slug','eyebrow','title','summary','campaignKind','items'], properties: campaignFields } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return reply.status(201).send(envelope(await service.create(request.actor, request.body)));
  });
  app.patch('/v1/admin/discovery-campaigns/:campaignId', {
    preHandler: requireAuth,
    schema: { params: idParams, body: { type: 'object', additionalProperties: false, required: ['action','expectedVersion'], properties: {
      action: { type: 'string', enum: ['edit','publish','archive'] }, expectedVersion: { type: 'integer', minimum: 1 }, ...campaignFields,
    } } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return envelope(await service.update(request.actor, request.params.campaignId, request.body));
  });
}

