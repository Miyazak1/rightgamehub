const xmlEscape = value => String(value ?? '').replace(/[<>&"']/gu, character => ({
  '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
})[character]);

export const serializeJsonLd = value => JSON.stringify(value).replace(/</gu, '\\u003c');

export const workStructuredData = ({ work, siteOrigin, shareCardUrl }) => ({
  '@context': 'https://schema.org',
  '@type': work.kind === 'game' ? 'VideoGame' : work.kind === 'tool' ? 'SoftwareApplication' : 'CreativeWork',
  name: work.title,
  description: String(work.description || `在 GameHub 在线体验《${work.title}》。`).trim(),
  url: `${siteOrigin}/w/${encodeURIComponent(work.id)}`,
  image: shareCardUrl,
  ...(work.creatorDisplayName ? { author: { '@type': 'Person', name: work.creatorDisplayName } } : {}),
  isAccessibleForFree: true,
  inLanguage: 'zh-CN',
  publisher: { '@type': 'Organization', name: 'GameHub', url: siteOrigin },
});

export const campaignStructuredData = ({ campaign, siteOrigin, image }) => ({
  '@context': 'https://schema.org',
  '@type': 'CollectionPage',
  name: campaign.title,
  description: campaign.summary,
  url: `${siteOrigin}/discover/c/${encodeURIComponent(campaign.slug)}`,
  image,
  inLanguage: 'zh-CN',
  publisher: { '@type': 'Organization', name: 'GameHub', url: siteOrigin },
  mainEntity: {
    '@type': 'ItemList',
    itemListElement: (campaign.items ?? []).map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.work?.title || item.pitch,
      url: item.work?.id ? `${siteOrigin}/w/${encodeURIComponent(item.work.id)}` : undefined,
    })),
  },
});

export const renderRobotsTxt = siteOrigin => [
  'User-agent: *',
  'Allow: /',
  'Disallow: /v1/',
  'Disallow: /account',
  'Disallow: /creator',
  'Disallow: /admin',
  'Disallow: /play/',
  'Disallow: /challenge/',
  'Disallow: /s/',
  'Disallow: /install',
  'Disallow: /community/me',
  'Disallow: /community/bookmarks',
  'Disallow: /community/review',
  '',
  `Sitemap: ${siteOrigin}/sitemap.xml`,
  '',
].join('\n');

export const renderSitemapXml = ({ siteOrigin, works = [], campaigns = [] }) => {
  const entries = [
    { url: `${siteOrigin}/` },
    { url: `${siteOrigin}/discover` },
    { url: `${siteOrigin}/community` },
    ...works.map(work => ({ url: `${siteOrigin}/w/${encodeURIComponent(work.id)}`, modified: work.updatedAt || work.publishedAt || null })),
    ...campaigns.map(campaign => ({ url: `${siteOrigin}/discover/c/${encodeURIComponent(campaign.slug)}`, modified: campaign.updatedAt || campaign.publishedAt || null })),
  ];
  const unique = [...new Map(entries.map(entry => [entry.url, entry])).values()];
  const urls = unique.map(entry => {
    const lastmod = entry.modified && !Number.isNaN(Date.parse(entry.modified))
      ? `<lastmod>${xmlEscape(new Date(entry.modified).toISOString())}</lastmod>`
      : '';
    return `  <url><loc>${xmlEscape(entry.url)}</loc>${lastmod}</url>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
};

const listAllWorks = async catalogService => {
  if (!catalogService?.list) return [];
  const works = [];
  for (let offset = 0; offset <= 100000; offset += 50) {
    const page = await catalogService.list({ limit: 50, offset });
    works.push(...page);
    if (page.length < 50) break;
  }
  return [...new Map(works.map(work => [work.id, work])).values()];
};

export function registerPublicSeoRoutes(app, { siteOrigin, catalogService, campaignService }) {
  app.get('/robots.txt', async (_request, reply) => {
    reply.header('Cache-Control', 'public, max-age=3600');
    reply.header('X-Content-Type-Options', 'nosniff');
    return reply.type('text/plain; charset=utf-8').send(renderRobotsTxt(siteOrigin));
  });

  app.get('/sitemap.xml', async (_request, reply) => {
    const [works, campaigns] = await Promise.all([
      listAllWorks(catalogService),
      campaignService?.listPublic ? campaignService.listPublic({ limit: 12 }) : [],
    ]);
    reply.header('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
    reply.header('X-Content-Type-Options', 'nosniff');
    return reply.type('application/xml; charset=utf-8').send(renderSitemapXml({ siteOrigin, works, campaigns }));
  });
}
