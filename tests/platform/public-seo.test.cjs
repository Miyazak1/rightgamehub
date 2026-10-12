const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.resolve(__dirname, '../../apps/api/src/public-seo.mjs'));

test('public SEO renderers escape XML and script-breaking structured data', async () => {
  const { renderSitemapXml, serializeJsonLd } = await import(moduleUrl);
  const xml = renderSitemapXml({
    siteOrigin: 'https://games.example',
    works: [{ id: 'gamehub-a&b', updatedAt: '2026-10-12T00:00:00Z' }],
    campaigns: [{ slug: 'weekly-open' }],
  });
  assert.match(xml, /https:\/\/games\.example\/w\/gamehub-a%26b/u);
  assert.match(xml, /<lastmod>2026-10-12T00:00:00\.000Z<\/lastmod>/u);
  assert.equal(serializeJsonLd({ title: '</script><script>alert(1)</script>' }).includes('</script>'), false);
});
