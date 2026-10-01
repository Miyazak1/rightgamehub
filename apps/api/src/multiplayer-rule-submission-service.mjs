import crypto from 'node:crypto';
import fs from 'node:fs/promises';

export class MultiplayerRuleSubmissionError extends Error {
  constructor(code, statusCode, message, retryable = false) {
    super(message);
    this.name = 'MultiplayerRuleSubmissionError';
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const token = () => crypto.randomBytes(32).toString('base64url');
const hashToken = value => crypto.createHash('sha256').update(value).digest();
const canonicalJson = value => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const requestHash = value => crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
const requireIdempotencyKey = value => {
  if (!/^[\x21-\x7e]{16,128}$/.test(value ?? '')) throw new MultiplayerRuleSubmissionError('IDEMPOTENCY_KEY_REQUIRED', 400, 'A valid Idempotency-Key is required.');
  return value;
};
const requireCreator = actor => {
  if (!actor?.profile?.canPublish || !actor.scopes?.includes('upload')) throw new MultiplayerRuleSubmissionError('FORBIDDEN', 403, '当前账号或设备没有提交规则包的权限。');
};
const requireAdmin = actor => {
  if (actor?.profile?.role !== 'admin') throw new MultiplayerRuleSubmissionError('ADMIN_REQUIRED', 403, '需要管理员权限。');
};

function validateEvidence(workId, body) {
  const bytes = Number(body.declaredBytes);
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_SOURCE_BYTES) throw new MultiplayerRuleSubmissionError('RULE_SOURCE_TOO_LARGE', 413, '规则源码 ZIP 必须小于 20 MB。');
  if (!/^[a-f0-9]{64}$/.test(body.sha256 ?? '')) throw new MultiplayerRuleSubmissionError('SCHEMA_INVALID', 400, '源码包 SHA-256 无效。');
  if (!/^[^\\/\0]{1,255}\.zip$/iu.test(body.fileName ?? '')) throw new MultiplayerRuleSubmissionError('SCHEMA_INVALID', 400, '规则源码文件必须是安全命名的 ZIP。');
  const submission = body.creatorSubmission;
  if (submission?.version !== 1 || submission.workId !== workId || submission.modeKey !== body.modeKey || submission.rulesetVersion !== body.rulesetVersion || submission.authority !== 'platform_authoritative') {
    throw new MultiplayerRuleSubmissionError('SUBMISSION_IDENTITY_MISMATCH', 422, 'creator-submission.json 与本次作品、模式或规则版本不一致。');
  }
  if (Number(submission.players?.min) !== Number(body.minPlayers) || Number(submission.players?.max) !== Number(body.maxPlayers)) {
    throw new MultiplayerRuleSubmissionError('SUBMISSION_PLAYERS_MISMATCH', 422, 'creator-submission.json 的玩家人数与模式配置不一致。');
  }
  const report = body.doctorReport;
  if (report?.version !== 1 || report.ok !== true || Number(report.summary?.errors) !== 0 || !Array.isArray(report.findings)) {
    throw new MultiplayerRuleSubmissionError('DOCTOR_REPORT_FAILED', 422, 'Creator Doctor 报告必须为通过状态且不能包含 error。');
  }
  return bytes;
}
async function verifyZipMagic(objectStore, objectKey) {
  const handle = await fs.open(objectStore.pathFor(objectKey), 'r');
  try {
    const signature = Buffer.alloc(4);
    const { bytesRead } = await handle.read(signature, 0, 4, 0);
    if (bytesRead !== 4 || !['504b0304','504b0506','504b0708'].includes(signature.toString('hex'))) throw new MultiplayerRuleSubmissionError('RULE_SOURCE_NOT_ZIP', 422, '上传内容不是有效的 ZIP 容器。');
  } finally { await handle.close(); }
}

export function createMultiplayerRuleSubmissionService({ repository, objectStore, storageCapacityService = null, ids = () => crypto.randomUUID() }) {
  return Object.freeze({
    async create(actor, workId, body, idempotencyKey) {
      requireCreator(actor);
      requireIdempotencyKey(idempotencyKey);
      const declaredBytes = validateEvidence(workId, body);
      const replay = await repository.replayCreate?.({ actor, idempotencyKey, requestHash: requestHash({ workId,body }) });
      if (replay) return replay;
      await storageCapacityService?.assertCanAccept({ packageType: 'rules_source_zip',declaredBytes });
      const submissionId = ids();
      return repository.createIdempotent({
        actor,workId,body,declaredBytes,submissionId,idempotencyKey,
        requestHash: requestHash({ workId,body }),eventId: ids(),expiryEventId: ids(),objectKey: `quarantine/${submissionId}/${ids()}.zip`,
      });
    },
    async grant(actor, submissionId) {
      requireCreator(actor);
      const plaintext = token();
      const result = await repository.createGrant({ actor,submissionId,grantId: ids(),tokenHash: hashToken(plaintext) });
      return { submissionId,token: plaintext,expiresAt: new Date(result.expiresAt).toISOString() };
    },
    async receive(submissionId, authorization, stream) {
      const match = /^Upload ([A-Za-z0-9_-]{32,})$/.exec(authorization ?? '');
      if (!match) throw new MultiplayerRuleSubmissionError('UPLOAD_GRANT_REQUIRED', 401, 'Upload grant is required.');
      const job = await repository.beginReceive({ submissionId,tokenHash: hashToken(match[1]) });
      try {
        const actual = await objectStore.putStream(job.objectKey,stream,job.declaredBytes);
        if (actual.bytes !== job.declaredBytes || actual.sha256 !== job.declaredSha256) throw new MultiplayerRuleSubmissionError('UPLOAD_HASH_MISMATCH', 422, '上传字节与声明的 SHA-256 不一致。');
        await verifyZipMagic(objectStore,job.objectKey);
        return await repository.finishReceive({ submissionId,actualBytes: actual.bytes,actualSha256: actual.sha256,eventId: ids(),actorUserId: job.ownerUserId });
      } catch (error) {
        await objectStore.remove(job.objectKey).catch(() => {});
        await repository.failReceive({ submissionId,errorCode: error.code ?? 'UPLOAD_FAILED',eventId: ids(),actorUserId: job.ownerUserId });
        if (error instanceof MultiplayerRuleSubmissionError) throw error;
        throw new MultiplayerRuleSubmissionError(error.code ?? 'UPLOAD_FAILED', error.code === 'UPLOAD_TOO_LARGE' ? 413 : 503, '规则源码包上传失败。', true);
      }
    },
    async submit(actor, submissionId, idempotencyKey) {
      requireCreator(actor);
      requireIdempotencyKey(idempotencyKey);
      return repository.submit({ actor,submissionId,eventId: ids(),expiryEventId: ids() });
    },
    listMine(actor, workId) { requireCreator(actor); return repository.listMine({ actor,workId }); },
    getMine(actor, submissionId) { requireCreator(actor); return repository.getMine({ actor,submissionId }); },
    adminList(actor, query) { requireAdmin(actor); return repository.adminList(query); },
    adminGet(actor, submissionId) { requireAdmin(actor); return repository.adminGet(submissionId); },
    async adminReview(actor, submissionId, body) {
      requireAdmin(actor);
      if (body.action !== 'start' && !(body.note?.trim())) throw new MultiplayerRuleSubmissionError('REVIEW_NOTE_REQUIRED', 400, '审核结论必须填写说明。');
      return repository.review({ actor,submissionId,action: body.action,note: body.note?.trim() ?? null,eventId: ids() });
    },
    async adminPackage(actor, submissionId) {
      requireAdmin(actor);
      const item = await repository.packageForAdmin(submissionId);
      return { ...item,path: objectStore.pathFor(item.objectKey) };
    },
  });
}
