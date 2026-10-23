import { serializeJsonLd } from './public-seo.mjs';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const renderBlock = (block, citations) => {
  if (block.type === 'heading') return `<h${block.level}>${escapeHtml(block.text)}</h${block.level}>`;
  if (block.type === 'quote') {
    const labels = block.citationIds.map(id => citations.find(item => item.id === id)?.label).filter(Boolean).map(escapeHtml).join(' · ');
    return `<blockquote><p>${escapeHtml(block.text)}</p>${labels ? `<cite>${labels}</cite>` : ''}</blockquote>`;
  }
  if (block.type === 'list') return `<${block.ordered ? 'ol' : 'ul'}>${block.items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</${block.ordered ? 'ol' : 'ul'}>`;
  if (block.type === 'code') return `<pre><code>${escapeHtml(block.text)}</code></pre>`;
  return `<p>${escapeHtml(block.text)}</p>`;
};

export const blogStructuredData = ({ article, siteOrigin }) => ({
  '@context': 'https://schema.org', '@type': 'Article', headline: article.title, description: article.summary,
  url: `${siteOrigin}/blog/${encodeURIComponent(article.slug)}`, inLanguage: article.locale,
  datePublished: article.firstPublishedAt ?? article.publishedAt, dateModified: article.updatedAt,
  author: article.author.accountType==='agent'
    ? { '@type': 'Organization', name: `${article.author.displayName}（${article.author.agentDisclosure?.badgeLabel??'官方机器人'}）`, description: article.author.agentDisclosure?.operatorLabel??'由墨鱼工坊运营' }
    : { '@type': 'Person', name: article.author.displayName },
  publisher: { '@type': 'Organization', name: '墨鱼工坊 MOOYU.FUN', url: siteOrigin },
});

export function renderBlogArticleHtml({ article, siteOrigin, nonce }) {
  const title = escapeHtml(`${article.title} · 墨鱼日志`), summary = escapeHtml(article.summary);
  const canonical = `${siteOrigin}/blog/${encodeURIComponent(article.slug)}`;
  const body = article.blocks.map(block => renderBlock(block, article.citations)).join('');
  const citations = article.citations.length ? `<footer><h2>资料来源</h2><ol>${article.citations.map(citation => `<li><a href="${escapeHtml(citation.url)}" rel="noreferrer">${escapeHtml(citation.label)}</a><small>${escapeHtml(citation.publisher)} · ${escapeHtml(citation.title)}</small></li>`).join('')}</ol></footer>` : '';
  const data = serializeJsonLd(blogStructuredData({ article, siteOrigin }));
  const disclosure=article.author.accountType==='agent'?`<span class="agent-badge">${escapeHtml(article.author.agentDisclosure?.badgeLabel??'官方机器人')}</span> ${escapeHtml(article.author.agentDisclosure?.operatorLabel??'由墨鱼工坊运营')} · `:'';
  return `<!doctype html><html lang="${escapeHtml(article.locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><meta name="description" content="${summary}"><meta property="og:type" content="article"><meta property="og:title" content="${escapeHtml(article.title)}"><meta property="og:description" content="${summary}"><meta property="og:url" content="${canonical}"><link rel="canonical" href="${canonical}"><script type="application/ld+json" nonce="${nonce}">${data}</script><style>html{color-scheme:light dark}body{margin:0;background:#f5f3f8;color:#18151f;font:16px/1.85 system-ui,-apple-system,"Microsoft YaHei",sans-serif}main{box-sizing:border-box;width:min(100% - 32px,800px);margin:48px auto 80px;padding:42px;background:#fff;border:1px solid #ded9e8;box-shadow:7px 7px 0 #ded9e8}nav a,a{color:#6546d8}header{padding-bottom:28px;border-bottom:1px solid #ded9e8}h1{margin:18px 0 12px;font-size:clamp(32px,6vw,48px);line-height:1.2}header>p{color:#625d6b;font-size:18px}header small{color:#77717f}.agent-badge{display:inline-block;padding:1px 6px;border:1px solid #7657e8;color:#6546d8;font-weight:700}.content{padding-top:24px}.content h2{margin-top:38px}.content h3{margin-top:30px}.content blockquote{margin:24px 0;padding:14px 20px;border-left:4px solid #7657e8;background:#f7f4ff}.content cite,.content pre{display:block}.content pre{overflow:auto;padding:18px;background:#17131e;color:#f6f1ff}footer{margin-top:35px;padding-top:24px;border-top:1px solid #ded9e8}footer small{display:block;color:#77717f}@media(prefers-color-scheme:dark){body{background:#0e0c12;color:#f6f2fa}main{background:#17141d;border-color:#37313f;box-shadow:7px 7px 0 #292431}header,footer{border-color:#37313f}header>p,header small,footer small{color:#aaa3b3}.content blockquote{background:#211b2e}}</style></head><body><main><nav><a href="${siteOrigin}/blog">← 墨鱼日志</a></nav><article><header><h1>${escapeHtml(article.title)}</h1><p>${summary}</p><small>${escapeHtml(article.author.displayName)} · ${disclosure}${escapeHtml(new Date(article.publishedAt).toLocaleDateString(article.locale))}</small></header><section class="content">${body}</section>${citations}</article></main></body></html>`;
}
