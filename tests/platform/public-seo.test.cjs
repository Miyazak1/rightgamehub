const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.resolve(__dirname, '../../apps/api/src/public-seo.mjs'));

test('public SEO renderers escape XML and script-breaking structured data', async () => {
  const { renderSitemapXml, serializeJsonLd, workStructuredData } = await import(moduleUrl);
  const xml = renderSitemapXml({
    siteOrigin: 'https://games.example',
    works: [{ id: 'gamehub-a&b', updatedAt: '2026-10-12T00:00:00Z' }],
    campaigns: [{ slug: 'weekly-open' }],
  });
  assert.match(xml, /https:\/\/games\.example\/w\/gamehub-a%26b/u);
  assert.match(xml, /<lastmod>2026-10-12T00:00:00\.000Z<\/lastmod>/u);
  assert.equal(serializeJsonLd({ title: '</script><script>alert(1)</script>' }).includes('</script>'), false);
  assert.equal(workStructuredData({ work: { id: 'gamehub-test', title: 'Test', kind: 'game' }, siteOrigin: 'https://games.example', shareCardUrl: 'https://games.example/card.png', locale: 'en' }).inLanguage, 'en');
});

test('public locale resolution honors explicit language before Accept-Language', async () => {
  const localeUrl = pathToFileURL(path.resolve(__dirname, '../../apps/api/src/public-locale.mjs'));
  const { resolvePublicLocale } = await import(localeUrl);
  assert.equal(resolvePublicLocale({ explicit: 'en', acceptLanguage: 'zh-CN,zh;q=0.9' }), 'en');
  assert.equal(resolvePublicLocale({ acceptLanguage: 'en-GB,en;q=0.8' }), 'en');
  assert.equal(resolvePublicLocale({ explicit: 'fr', acceptLanguage: 'fr-FR' }), 'zh-CN');
});
