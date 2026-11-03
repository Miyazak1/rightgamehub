import { PAPER_STUDY_MAX_BYTES } from './paper-study-service.mjs';

// HTTP adapter shared by local/isolated hosts. Authentication is always supplied
// by the host's existing session service. No production registration here.
export function createPaperStudyHttpHandler({ service, authenticate }) {
  return async (req, res, url) => {
    if (!url.pathname.startsWith('/v1/me/paper-studies')) return false;
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
    try {
      const actor = await authenticate(req);
      if (!actor?.userId) throw Object.assign(Error('AUTH_REQUIRED'), { code: 'AUTH_REQUIRED', status: 401 });
      const match = /^\/v1\/me\/paper-studies(?:\/([a-f0-9-]{36})(?:\/(source|analyze|draft))?)?$/.exec(url.pathname);
      if (!match || url.search) throw Object.assign(Error(), { code: 'PAPER_STUDY_ROUTE_NOT_FOUND', status: 404 });
      const [, id, action] = match;
      let data;
      if (req.method === 'GET' && !action) data = id ? service.read(actor, id) : service.list(actor);
      else if (req.method === 'GET' && action === 'source') data = service.source(actor, id);
      else if (req.method === 'POST') {
        let size = 0; const chunks = [];
        for await (const b of req) { size += b.length; if (size > Math.ceil(PAPER_STUDY_MAX_BYTES / 3) * 4 + 2048) throw Object.assign(Error(), { code: 'PAPER_STUDY_IMPORT_TOO_LARGE', status: 413 }); chunks.push(b); }
        let body; try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { throw Object.assign(Error(), { code: 'PAPER_STUDY_INPUT_INVALID', status: 400 }); }
        if (id && (!body || Array.isArray(body) || Object.keys(body).length)) throw Object.assign(Error(), { code: 'PAPER_STUDY_INPUT_INVALID', status: 400 });
        if (!id) data = service.import(actor, body);
        else if (action === 'analyze') data = service.analyze(actor, id);
        else if (action === 'draft') data = service.draft(actor, id);
      }
      if (!data) throw Object.assign(Error(), { code: 'PAPER_STUDY_ROUTE_NOT_FOUND', status: 404 });
      send(req.method === 'POST' ? 202 : 200, { data });
    } catch (e) { send(e.status ?? e.statusCode ?? 422, { error: { code: /^[A-Z][A-Z0-9_]{2,100}$/.test(e.code ?? '') ? e.code : 'PAPER_STUDY_FAILED', message: '论文操作未完成，请检查文件或服务状态。' } }); }
    return true;
  };
}
