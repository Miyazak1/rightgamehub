import crypto from 'node:crypto';
import {
  BlogArticleError,
  blogArticleId,
  blogEtag,
  blogExpectedVersion,
  blogIdempotencyKey,
  blogRequestHash,
  normalizeBlogContent,
  normalizeResearchProvenance,
} from './blog-contract.mjs';

const fail = (code, statusCode, message) => { throw new BlogArticleError(code, statusCode, message); };

export function createBlogService({ repository, ids = () => crypto.randomUUID() }) {
  const requireWriter = actor => {
    if (!actor?.userId) fail('AUTH_REQUIRED', 401, '请先登录。');
    if (actor.profile?.role !== 'admin' || !actor.profile?.canPublish || !actor.scopes?.includes('works:write')) fail('BLOG_WRITE_FORBIDDEN', 403, '当前账号没有平台文章编辑权限。');
  };
  const mutation = ({ actor, articleId = null, operation, body, idempotencyKey, ifMatch = null, provenance = null }) => {
    requireWriter(actor);
    const key = blogIdempotencyKey(idempotencyKey);
    const expectedVersion = articleId ? blogExpectedVersion(articleId, ifMatch) : null;
    return {
      actor,
      articleId,
      revisionId: ids(),
      eventId: ids(),
      operation,
      body,
      provenance,
      expectedVersion,
      idempotencyKey: key,
      requestHash: blogRequestHash({ articleId, operation, body, provenance, ifMatch }),
    };
  };
  const result = article => ({ article, etag: blogEtag(article) });

  return {
    listPublic(query = {}) {
      const limit = Math.min(50, Math.max(1, Math.floor(Number(query.limit) || 20)));
      const locale = query.locale == null ? null : String(query.locale);
      const search = String(query.q ?? '').trim();
      if (locale && !['zh-CN', 'en'].includes(locale)) fail('BLOG_QUERY_INVALID', 400, '文章语言筛选无效。');
      if (search.length > 100) fail('BLOG_QUERY_INVALID', 400, '文章搜索词过长。');
      return repository.listPublic({ limit, locale, query: search || null, cursor: query.cursor ?? null });
    },
    getPublic(slug) {
      if (typeof slug !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])$/.test(slug)) fail('BLOG_ARTICLE_NOT_FOUND', 404, '文章不存在。');
      return repository.getPublic(slug);
    },
    listMine(actor, query = {}) {
      requireWriter(actor);
      const limit = Math.min(100, Math.max(1, Math.floor(Number(query.limit) || 50)));
      return repository.listMine({ actor, limit, cursor: query.cursor ?? null });
    },
    async getMine(actor, id) {
      requireWriter(actor);
      return result(await repository.getMine({ actor, articleId: blogArticleId(id) }));
    },
    async createDraft(actor, input, idempotencyKey) {
      const body = normalizeBlogContent(input);
      const command = mutation({ actor, operation: 'create_draft', body, idempotencyKey });
      command.articleId = ids();
      return result(await repository.mutate(command));
    },
    async reviseDraft(actor, id, input, idempotencyKey, ifMatch) {
      const articleId = blogArticleId(id);
      const body = normalizeBlogContent(input);
      return result(await repository.mutate(mutation({ actor, articleId, operation: 'revise_draft', body, idempotencyKey, ifMatch })));
    },
    async publish(actor, id, idempotencyKey, ifMatch) {
      const articleId = blogArticleId(id);
      return result(await repository.mutate(mutation({ actor, articleId, operation: 'publish', body: null, idempotencyKey, ifMatch })));
    },
    async withdraw(actor, id, idempotencyKey, ifMatch) {
      const articleId = blogArticleId(id);
      return result(await repository.mutate(mutation({ actor, articleId, operation: 'withdraw', body: null, idempotencyKey, ifMatch })));
    },
    async importResearchDraft(actor, input, idempotencyKey) {
      if (!input || Object.keys(input).some(key => !['draft', 'provenance'].includes(key))) fail('BLOG_PROVENANCE_INVALID', 422, '研究草稿格式无效。');
      const body = normalizeBlogContent(input.draft);
      const provenance = normalizeResearchProvenance(input.provenance);
      const command = mutation({ actor, operation: 'import_research_draft', body, provenance, idempotencyKey });
      command.articleId = ids();
      if (typeof repository.importResearchDraft !== 'function') fail('BLOG_IMPORT_UNAVAILABLE', 503, '研究草稿导入暂不可用。');
      const article = await repository.importResearchDraft(command);
      if (article.publicationState !== 'draft') fail('BLOG_IMPORT_UNSAFE_RESULT', 500, '研究草稿导入没有保持私有状态。');
      return result(article);
    },
  };
}

export { BlogArticleError };
