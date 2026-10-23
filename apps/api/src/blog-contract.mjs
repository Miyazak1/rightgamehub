import crypto from 'node:crypto';
import net from 'node:net';

export const BLOG_LIMITS = Object.freeze({
  title: 120,
  summary: 360,
  blocks: 96,
  text: 60000,
  citations: 80,
  citationLabel: 180,
  citationTitle: 300,
  code: 24000,
  listItems: 40,
  inputBytes: 131072,
});

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hashPattern = /^[0-9a-f]{64}$/i;
const slugPattern = /^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])$/;
const idempotencyPattern = /^[A-Za-z0-9_-]{16,128}$/;
const languagePattern = /^[a-z0-9+#._-]{1,32}$/i;
const uuid = value => typeof value === 'string' && uuidPattern.test(value);

export class BlogArticleError extends Error {
  constructor(code, statusCode, message) {
    super(message);
    this.name = 'BlogArticleError';
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = statusCode >= 500;
  }
}

const fail = (code, statusCode, message) => { throw new BlogArticleError(code, statusCode, message); };
const scalarLength = value => Array.from(value).length;
const objectWithOnly = (value, keys) => Boolean(value)
  && typeof value === 'object'
  && !Array.isArray(value)
  && Object.keys(value).every(key => keys.includes(key));
const text = (value, min, max, message) => {
  if (typeof value !== 'string') fail('BLOG_CONTENT_INVALID', 400, message);
  const normalized = value.trim();
  if (scalarLength(normalized) < min || scalarLength(normalized) > max) fail('BLOG_CONTENT_INVALID', 400, message);
  return normalized;
};

export const canonicalJson = value => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
export const blogRequestHash = value => crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
export const blogArticleId = value => {
  if (!uuid(value)) fail('BLOG_ARTICLE_NOT_FOUND', 404, '文章不存在。');
  return value;
};
export const blogIdempotencyKey = value => {
  if (!idempotencyPattern.test(value ?? '')) fail('IDEMPOTENCY_KEY_REQUIRED', 400, '需要有效的请求标识。');
  return value;
};
export const blogEtag = article => `"article-${article.id}-${article.version}"`;
export const blogExpectedVersion = (articleId, value) => {
  const escaped = articleId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^"article-${escaped}-([1-9][0-9]{0,17})"$`).exec(value ?? '');
  if (!match) fail('PRECONDITION_REQUIRED', 428, '需要当前文章的 ETag。');
  return match[1];
};

export function safeBlogUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) fail('BLOG_CONTENT_INVALID', 400, '引用链接无效。');
  let url;
  try { url = new URL(value); } catch { fail('BLOG_CONTENT_INVALID', 400, '引用链接无效。'); }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (url.protocol !== 'https:' || url.username || url.password || url.port
    || net.isIP(hostname.replace(/^\[|\]$/g, '')) || !hostname.includes('.')
    || /(^|\.)(localhost|local|internal|test|invalid)$/.test(hostname)) {
    fail('BLOG_CONTENT_INVALID', 400, '引用链接必须是可公开访问的 HTTPS 地址。');
  }
  url.hash = '';
  return url.href;
}

function normalizeBlock(block) {
  if (block?.type === 'paragraph') {
    if (!objectWithOnly(block, ['type', 'text'])) fail('BLOG_CONTENT_INVALID', 400, '正文块格式无效。');
    return { type: 'paragraph', text: text(block.text, 1, 8000, '段落内容无效。') };
  }
  if (block?.type === 'heading') {
    if (!objectWithOnly(block, ['type', 'level', 'text']) || ![2, 3].includes(block.level)) fail('BLOG_CONTENT_INVALID', 400, '标题块格式无效。');
    return { type: 'heading', level: block.level, text: text(block.text, 1, 180, '小标题内容无效。') };
  }
  if (block?.type === 'quote') {
    if (!objectWithOnly(block, ['type', 'text', 'citationIds']) || !Array.isArray(block.citationIds) || block.citationIds.length > 8) fail('BLOG_CONTENT_INVALID', 400, '引用块格式无效。');
    if (block.citationIds.some(id => !uuid(id))) fail('BLOG_CONTENT_INVALID', 400, '引用块格式无效。');
    const citationIds = [...block.citationIds];
    if (new Set(citationIds).size !== citationIds.length) fail('BLOG_CONTENT_INVALID', 400, '引用块含有重复来源。');
    return { type: 'quote', text: text(block.text, 1, 3000, '引用内容无效。'), citationIds };
  }
  if (block?.type === 'list') {
    if (!objectWithOnly(block, ['type', 'ordered', 'items']) || typeof block.ordered !== 'boolean'
      || !Array.isArray(block.items) || block.items.length < 1 || block.items.length > BLOG_LIMITS.listItems) fail('BLOG_CONTENT_INVALID', 400, '列表块格式无效。');
    return { type: 'list', ordered: block.ordered, items: block.items.map(item => text(item, 1, 1000, '列表项内容无效。')) };
  }
  if (block?.type === 'code') {
    if (!objectWithOnly(block, ['type', 'language', 'text']) || !languagePattern.test(block.language ?? '')) fail('BLOG_CONTENT_INVALID', 400, '代码块格式无效。');
    return { type: 'code', language: block.language.toLowerCase(), text: text(block.text, 1, BLOG_LIMITS.code, '代码块内容无效。') };
  }
  fail('BLOG_CONTENT_INVALID', 400, '正文包含不支持的内容块。');
}

function normalizeCitation(citation) {
  if (!objectWithOnly(citation, ['id', 'label', 'title', 'url', 'publisher', 'publishedAt', 'accessedAt'])) fail('BLOG_CONTENT_INVALID', 400, '引用来源格式无效。');
  const publishedAt = citation.publishedAt == null ? null : new Date(citation.publishedAt);
  const accessedAt = new Date(citation.accessedAt);
  if ((publishedAt && Number.isNaN(publishedAt.getTime())) || Number.isNaN(accessedAt.getTime())) fail('BLOG_CONTENT_INVALID', 400, '引用来源时间无效。');
  return {
    id: uuid(citation.id) ? citation.id : fail('BLOG_CONTENT_INVALID', 400, '引用来源格式无效。'),
    label: text(citation.label, 1, BLOG_LIMITS.citationLabel, '引用标签无效。'),
    title: text(citation.title, 1, BLOG_LIMITS.citationTitle, '引用标题无效。'),
    url: safeBlogUrl(citation.url),
    publisher: text(citation.publisher, 1, 160, '引用发布者无效。'),
    publishedAt: publishedAt?.toISOString() ?? null,
    accessedAt: accessedAt.toISOString(),
  };
}

export function normalizeBlogContent(input) {
  if (!objectWithOnly(input, ['slug', 'locale', 'title', 'summary', 'blocks', 'citations'])) fail('BLOG_CONTENT_INVALID', 400, '文章内容格式无效。');
  if (!slugPattern.test(input.slug ?? '')) fail('BLOG_CONTENT_INVALID', 400, '文章地址标识无效。');
  if (!['zh-CN', 'en'].includes(input.locale)) fail('BLOG_CONTENT_INVALID', 400, '文章语言无效。');
  if (!Array.isArray(input.blocks) || input.blocks.length < 1 || input.blocks.length > BLOG_LIMITS.blocks
    || !Array.isArray(input.citations) || input.citations.length > BLOG_LIMITS.citations) fail('BLOG_CONTENT_INVALID', 400, '文章正文或引用数量无效。');
  const citations = input.citations.map(normalizeCitation);
  const citationIds = new Set(citations.map(item => item.id));
  if (citationIds.size !== citations.length) fail('BLOG_CONTENT_INVALID', 400, '文章含有重复引用来源。');
  const blocks = input.blocks.map(normalizeBlock);
  const referenced = blocks.flatMap(block => block.type === 'quote' ? block.citationIds : []);
  if (referenced.some(id => !citationIds.has(id))) fail('BLOG_CONTENT_INVALID', 400, '正文引用了不存在的来源。');
  const totalText = blocks.reduce((sum, block) => sum + (block.text ? scalarLength(block.text) : block.items?.reduce((n, item) => n + scalarLength(item), 0) ?? 0), 0);
  if (totalText > BLOG_LIMITS.text) fail('BLOG_CONTENT_INVALID', 400, '文章正文过长。');
  const content = {
    slug: input.slug,
    locale: input.locale,
    title: text(input.title, 2, BLOG_LIMITS.title, '文章标题无效。'),
    summary: text(input.summary, 20, BLOG_LIMITS.summary, '文章摘要无效。'),
    blocks,
    citations,
  };
  if (Buffer.byteLength(JSON.stringify(content)) > BLOG_LIMITS.inputBytes) fail('BLOG_CONTENT_INVALID', 400, '文章内容体积过大。');
  return content;
}

export function normalizeResearchProvenance(input) {
  const allowed = ['contractVersion', 'topicId', 'reportSnapshotId', 'reportSha256', 'claimIds', 'evidenceIds', 'generatedAt'];
  if (!objectWithOnly(input, allowed) || input.contractVersion !== 'change-radar-publication-draft-v1'
    || !uuid(input.topicId) || !uuid(input.reportSnapshotId)
    || !hashPattern.test(input.reportSha256 ?? '') || !Array.isArray(input.claimIds) || !input.claimIds.length || input.claimIds.length > 100
    || !Array.isArray(input.evidenceIds) || !input.evidenceIds.length || input.evidenceIds.length > 200) {
    fail('BLOG_PROVENANCE_INVALID', 422, '研究来源证明无效。');
  }
  const generatedAt = new Date(input.generatedAt);
  if (input.claimIds.some(id => !uuid(id)) || input.evidenceIds.some(id => !uuid(id))) fail('BLOG_PROVENANCE_INVALID', 422, '研究来源证明无效。');
  const claimIds = [...input.claimIds];
  const evidenceIds = [...input.evidenceIds];
  if (Number.isNaN(generatedAt.getTime()) || new Set(claimIds).size !== claimIds.length || new Set(evidenceIds).size !== evidenceIds.length) fail('BLOG_PROVENANCE_INVALID', 422, '研究来源证明无效。');
  return { ...input, reportSha256: input.reportSha256.toLowerCase(), claimIds, evidenceIds, generatedAt: generatedAt.toISOString() };
}
