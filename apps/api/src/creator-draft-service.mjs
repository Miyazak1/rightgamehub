import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { buildBingoPackage, normalizeBingoContent, renderBingoHtml } from './creator-bingo-builder.mjs';

export class CreatorDraftError extends Error {
  constructor(code, statusCode, message) { super(message); this.name = 'CreatorDraftError'; this.code = code; this.statusCode = statusCode; }
}

export const CREATOR_STUDIOS = Object.freeze(['bingo', 'puzzle', 'story', 'world']);
const canonicalJson = value => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const requestHash = value => crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
const validKey = value => /^[\x21-\x7e]{16,128}$/.test(value ?? '');
const assertContent = content => {
  if (!content || Array.isArray(content) || typeof content !== 'object') throw new CreatorDraftError('DRAFT_CONTENT_INVALID', 400, '草稿内容必须是 JSON 对象。');
  if (Buffer.byteLength(JSON.stringify(content), 'utf8') > 1024 * 1024) throw new CreatorDraftError('DRAFT_CONTENT_TOO_LARGE', 413, '草稿内容不能超过 1 MiB。');
};
const validateStudioContent = (studio,content) => {
  assertContent(content);
  try { return studio === 'bingo' ? normalizeBingoContent(content) : content; }
  catch (error) { return asDraftError(error); }
};
export const creatorDraftEtag = draft => `"creator-draft-${draft.id}-${draft.revision}"`;

const expectedRevision = (draftId, ifMatch) => {
  const escaped = draftId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^"creator-draft-${escaped}-(\\d+)"$`).exec(ifMatch ?? '');
  if (!match) throw new CreatorDraftError('PRECONDITION_REQUIRED', 428, '操作前需要当前草稿版本。');
  return match[1];
};
const asDraftError = error => {
  if (error instanceof CreatorDraftError) throw error;
  if (error?.code === 'BINGO_CONTENT_INVALID') throw new CreatorDraftError(error.code, 422, error.message);
  throw error;
};

export function createCreatorDraftService({ repository, workService = null, uploadService = null, ids = () => crypto.randomUUID() }) {
  const requireRead = actor => {
    if (!actor?.scopes?.includes('works:read')) throw new CreatorDraftError('FORBIDDEN', 403, '当前设备不能读取创作草稿。');
  };
  const requireWrite = actor => {
    if (!actor?.profile?.canPublish || !actor?.scopes?.includes('works:write')) throw new CreatorDraftError('PUBLISH_NOT_ENABLED', 403, '当前账号尚未开通创作权限。');
  };
  return {
    async list(actor, studio) {
      requireRead(actor);
      if (studio && !CREATOR_STUDIOS.includes(studio)) throw new CreatorDraftError('STUDIO_NOT_SUPPORTED', 400, '不支持这种创作方式。');
      return repository.list(actor.userId, studio ?? null);
    },
    async get(actor, draftId) {
      requireRead(actor);
      const draft = await repository.get(actor.userId, draftId);
      if (!draft) throw new CreatorDraftError('DRAFT_NOT_FOUND', 404, '找不到这个创作草稿。');
      return { draft, etag: creatorDraftEtag(draft) };
    },
    async preview(actor, draftId) {
      requireRead(actor);
      const draft = await repository.get(actor.userId, draftId);
      if (!draft) throw new CreatorDraftError('DRAFT_NOT_FOUND', 404, '找不到这个创作草稿。');
      if (draft.studio !== 'bingo') throw new CreatorDraftError('STUDIO_NOT_SUPPORTED', 422, '这种草稿暂不支持即时预览。');
      try { return { draftId: draft.id, revision: draft.revision, html: renderBingoHtml(draft.content, { draftId: draft.id, revision: draft.revision }) }; }
      catch (error) { return asDraftError(error); }
    },
    async create(actor, body, idempotencyKey) {
      requireWrite(actor);
      if (!validKey(idempotencyKey)) throw new CreatorDraftError('IDEMPOTENCY_KEY_REQUIRED', 400, '创建草稿需要有效的 Idempotency-Key。');
      if (!CREATOR_STUDIOS.includes(body.studio)) throw new CreatorDraftError('STUDIO_NOT_SUPPORTED', 400, '不支持这种创作方式。');
      const normalizedBody = { ...body,content: validateStudioContent(body.studio,body.content) };
      const draft = await repository.createIdempotent({
        actor, idempotencyKey, requestHash: requestHash(normalizedBody), draftId: ids(), revisionId: ids(),
        body: { ...normalizedBody, schemaVersion: normalizedBody.schemaVersion ?? 1 },
      });
      return { draft, etag: creatorDraftEtag(draft) };
    },
    async update(actor, draftId, body, idempotencyKey, ifMatch) {
      requireWrite(actor);
      if (!validKey(idempotencyKey)) throw new CreatorDraftError('IDEMPOTENCY_KEY_REQUIRED', 400, '保存草稿需要有效的 Idempotency-Key。');
      if (!body || Object.keys(body).length === 0) throw new CreatorDraftError('SCHEMA_INVALID', 400, '至少需要保存一个字段。');
      const revision = expectedRevision(draftId, ifMatch);
      let normalizedBody = body;
      if (body.content !== undefined) {
        const current = await repository.get(actor.userId,draftId);
        if (!current) throw new CreatorDraftError('DRAFT_NOT_FOUND', 404, '找不到这个创作草稿。');
        normalizedBody = { ...body,content: validateStudioContent(current.studio,body.content) };
      }
      const draft = await repository.updateIdempotent({
        actor, draftId, revisionId: ids(), expectedRevision: revision, idempotencyKey,
        requestHash: requestHash({ draftId, body: normalizedBody, ifMatch }), body: normalizedBody,
      });
      return { draft, etag: creatorDraftEtag(draft) };
    },
    async build(actor, draftId, body, idempotencyKey, ifMatch) {
      requireWrite(actor);
      if (!workService || !uploadService) throw new CreatorDraftError('CREATOR_BUILD_UNAVAILABLE', 503, '创作构建服务暂时不可用。');
      if (!validKey(idempotencyKey)) throw new CreatorDraftError('IDEMPOTENCY_KEY_REQUIRED', 400, '构建草稿需要有效的 Idempotency-Key。');
      const revision = expectedRevision(draftId, ifMatch);
      let draft = await repository.get(actor.userId, draftId);
      if (!draft) throw new CreatorDraftError('DRAFT_NOT_FOUND', 404, '找不到这个创作草稿。');
      if (draft.revision !== String(revision)) throw new CreatorDraftError('DRAFT_REVISION_CONFLICT', 412, '草稿已更新，请保存并重新构建。');
      if (draft.studio !== 'bingo') throw new CreatorDraftError('STUDIO_NOT_SUPPORTED', 422, '这种草稿暂不支持构建。');
      let artifact;
      try { artifact = buildBingoPackage(draft.content, { draftId: draft.id, revision: draft.revision }); }
      catch (error) { return asDraftError(error); }
      let workId = draft.workId;
      if (!workId) {
        const stableKey = `creator-work-${crypto.createHash('sha256').update(`${actor.userId}:${draft.id}`).digest('hex')}`;
        const created = await workService.create(actor, {
          title: draft.title, description: draft.content.subtitle || '由 Bingo 创作工坊制作的互动表格。', instructions: '点击表格中的单元格标记属于你的项目。',
          kind: 'creative', estimatedMinutes: 3, tags: ['Bingo', '互动表格'], agentLabel: null, repositoryUrl: null, licenseSpdx: null,
        }, stableKey);
        workId = created.work.id;
        draft = await repository.bindWork(actor.userId, draft.id, workId);
      }
      const uploadKey = `creator-upload-${crypto.createHash('sha256').update(`${actor.userId}:${draft.id}:${revision}:${idempotencyKey}`).digest('hex')}`;
      const createdUpload = await uploadService.create(actor, workId, {
        fileName: `bingo-${draft.id}-r${revision}.zip`, declaredBytes: String(artifact.zip.length), sha256: artifact.sha256,
        releaseLabel: body.releaseLabel, autoPublish: true, targetKey: 'web', packageType: 'web_zip',
      }, uploadKey);
      let upload = await uploadService.get(actor, createdUpload.id);
      if (upload.state === 'created') {
        const grant = await uploadService.grant(actor, upload.id);
        upload = await uploadService.receive(upload.id, `Upload ${grant.token}`, Readable.from(artifact.zip));
      }
      if (upload.state === 'uploaded') upload = await uploadService.complete(actor, upload.id, `creator-complete-${idempotencyKey}`);
      return { draft, workId, upload, artifactSha256: artifact.sha256, artifactBytes: String(artifact.zip.length) };
    },
  };
}
