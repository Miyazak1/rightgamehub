import { createIsolatedAccountApi } from './account-api-fixture.mjs';

// Loopback-only contract data. Uses the real auth service and the same product
// client as desktop; does not claim to exercise a production business database.
export async function createBusinessApiFixture({ onMail, slowQuery = false } = {}) {
  let accountOnly = false, empty = false, failMedia = false;
  const calls = [], saved = new Set();
  const work = { id: 'local-server-game', title: '隔离服务作品', description: '来自本地 HTTP 服务的目录内容。',
    kind: 'game', state: 'published', visibility: 'public', revision: '1', targets: [], tags: ['隔离验证'],
    coverUrl: '/v1/works/local-server-game/cover?v=1', creatorDisplayName: '本地测试作者', official: true };
  const course = { ...work, id: 'local-server-course', kind: 'courseware', title: '隔离服务课件', courseware: { subjects: ['physics'] } };
  const article = { id: 'local-article', slug: 'local-article', locale: 'zh-CN', title: '隔离服务日志',
    summary: '本地 HTTP 服务返回的测试文章。', publishedAt: '2026-11-01T00:00:00Z',
    author: { displayName: '本地测试作者', handle: 'local-author', avatar: { kind: 'preset', presetKey: 'cat' } },
    blocks: [{ type: 'heading', level: 2, text: '服务端内容' }, { type: 'paragraph', text: '这段正文来自独立的本地 API。', citationIds: [] }], citations: [] };
  const backend = await createIsolatedAccountApi({ onMail, handleBusinessRequest: async (req, res, url, authenticate) => {
    const path = url.pathname;
    if (!/^\/v1\/(?:works|blog|discovery|profiles|users|me\/library)(?:\/|$)/.test(path)) return false;
    calls.push({ method: req.method, path, query: Object.fromEntries(url.searchParams) });
    if (slowQuery && path === '/v1/works' && url.searchParams.get('q') === '__slow__') {
      await new Promise(resolve => { const timer = setTimeout(resolve, 3000); res.once('close', () => { clearTimeout(timer); resolve(); }); });
      if (res.destroyed) return true;
    }
    if (accountOnly) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { code: 'DESKTOP_AUTH_TEST_ROUTE_DISABLED', message: 'Account only' } })); return true; }
    const json = data => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ data })); return true; };
    if (path.endsWith('/cover')) {
      res.writeHead(200, { 'Content-Type': failMedia ? 'text/html' : 'image/png' });
      res.end(failMedia ? '<script>bad()</script>' : Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=', 'base64')); return true;
    }
    if (path === '/v1/works') return json(empty ? [] : url.searchParams.get('kind') === 'courseware' ? [course] : [work, course]);
    if (path === '/v1/discovery/campaigns') return json([]);
    if (path === '/v1/blog/articles') return json({ items: empty ? [] : [article], nextCursor: null });
    if (path === '/v1/blog/articles/local-article') return json(article);
    if (path === '/v1/works/local-server-game' || path === '/v1/works/local-server-course') return json(path.endsWith('-course') ? course : work);
    if (/^\/v1\/me\/library(?:\/|$)/.test(path)) {
      if (!await authenticate()) throw Object.assign(new Error('Authentication required'), { code: 'AUTH_REQUIRED', statusCode: 401 });
      const id = path.split('/')[4];
      if (!id) return json([...saved].map(workId => ({ workId, work, savedAt: '2026-11-01T00:00:00Z', lastPlayedAt: null })));
      if (req.method === 'PUT') saved.add(id);
      if (req.method === 'DELETE') saved.delete(id);
      return json({ workId: id, saved: saved.has(id), savedAt: saved.has(id) ? '2026-11-01T00:00:00Z' : null });
    }
    if (path === '/v1/profiles/local-author') return json({ id: 'local-author', handle: 'local-author', displayName: '本地测试作者',
      avatar: { kind: 'preset', presetKey: 'cat' }, links: [], featuredWorks: [], githubRepositories: [], works: [], contributions: [],
      activity: [], achievements: [], skills: [], followerCount: 0, followingCount: 0, visibility: 'public', joinedAt: '2026-11-01T00:00:00Z' });
    res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } })); return true;
  } });
  return Object.assign(backend, { businessCalls: calls, accountOnly(value) { accountOnly = value; }, empty(value) { empty = value; }, failMedia(value) { failMedia = value; } });
}
