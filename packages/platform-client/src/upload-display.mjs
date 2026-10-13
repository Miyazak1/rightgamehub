const ERROR_MESSAGES = Object.freeze({
  CAPABILITY_UNSUPPORTED: '请检查 ZIP 根目录 platform.json 的 capabilities：当前支持 fullscreen、pointerLock、multiplayer、localSave、competition、fileExport、shareLinks。能力名称区分大小写，未知名称会拒绝上传。',
  ENTRY_MISSING: 'ZIP 中没有可用的网页入口。若只有一个 HTML 文件，平台会自动识别；若包含多个 HTML，请把主入口命名为 index.html 并放在 ZIP 根目录。',
});
const ERROR_KEYS = Object.freeze({ CAPABILITY_UNSUPPORTED: 'creator.upload.error.capability', ENTRY_MISSING: 'creator.upload.error.entry' });

export function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export function uploadErrorMessage(code, { t } = {}) {
  if (!code) return t ? t('creator.upload.error.default') : '处理未完成，请检查文件后重试。';
  if (t && ERROR_KEYS[code]) return t(ERROR_KEYS[code]);
  return ERROR_MESSAGES[code] ?? (t ? t('creator.upload.error.code',{code}) : `处理未完成：${code}`);
}


const UPLOAD_STEPS = [
  ['created', '创建任务'], ['receiving', '上传文件'], ['uploaded', '文件接收'],
  ['queued', '等待检查'], ['validating', '结构校验'], ['scanning', '安全检查'],
  ['succeeded', '可发布'], ['published', '已发布'],
];
const STOPPED_STATES = new Set(['failed', 'expired', 'review_required']);
export const isUploadTerminalState = state => state === 'succeeded' || STOPPED_STATES.has(state);

// Publication is a separate result of validation; succeeded alone never means published.
export function uploadDisplay(upload, { phase = 'select', t } = {}) {
  const tr = (key, fallback, params) => t ? t(key, params) : fallback;
  const state = phase === 'receiving' && (!upload || upload.state === 'created') ? 'receiving' : upload?.state ?? 'created';
  const published = state === 'succeeded' && upload?.publicationOutcome === 'published';
  const terminal = isUploadTerminalState(state);
  let current = published ? 7 : UPLOAD_STEPS.findIndex(([id]) => id === state);
  if (state === 'published') current = -1; // Not an API UploadState; do not infer publication from an unknown state.
  let title = tr('creator.upload.status.unknown','等待确认状态'), description = tr('creator.upload.status.unknownBody','暂时无法确认处理进度，请重新读取任务状态。'), detail = tr('creator.upload.status.current','当前阶段'), tone = 'progress';
  if (state === 'created') { title = tr('creator.upload.status.created','等待上传'); description = tr('creator.upload.status.createdBody','选择文件并开始上传。'); detail = upload ? tr('creator.upload.status.taskCreated','任务已创建') : tr('creator.upload.status.chooseFile','等待选择文件'); }
  if (state === 'receiving') { title = tr('creator.upload.status.receiving','上传文件中'); description = tr('creator.upload.status.receivingBody','文件正在传输，传输完成后还需检查。'); }
  if (state === 'uploaded') { title = tr('creator.upload.status.uploaded','文件接收完成'); description = tr('creator.upload.status.uploadedBody','文件已收到，等待提交检查。'); }
  if (state === 'queued') { title = tr('creator.upload.status.queued','等待检查'); description = tr('creator.upload.status.queuedBody','文件已收到，正在等待检查。'); }
  if (state === 'validating') { title = tr('creator.upload.status.validating','结构校验中'); description = tr('creator.upload.status.validatingBody','正在检查文件结构与入口；通过后还需完成安全检查。'); }
  if (state === 'scanning') { title = tr('creator.upload.status.scanning','安全检查中'); description = tr('creator.upload.status.scanningBody','正在进行安全检查，检查完成后确认发布结果。'); }
  if (state === 'succeeded') {
    title = published ? tr('creator.upload.status.published','新版本已发布') : tr('creator.upload.status.succeeded','检查完成'); tone = published ? 'success' : 'warning';
    const outcomes = {
      published: ['新版本已经发布。', '发布完成'],
      draft: ['版本已通过检查并保留为草稿，尚未发布。', '保留草稿'],
      skipped_newer_intent: ['已有更新的发布操作，本版本已通过检查并保留为草稿，未替换线上版本。', '保留草稿'],
      blocked: ['版本已通过检查，但作品或目标平台已暂停，本版本未自动发布。', '发布受限'],
    };
    const outcomeKeys = { published:['creator.upload.outcome.published','creator.upload.outcome.publishedDetail'], draft:['creator.upload.outcome.draft','creator.upload.outcome.draftDetail'], skipped_newer_intent:['creator.upload.outcome.skipped','creator.upload.outcome.draftDetail'], blocked:['creator.upload.outcome.blocked','creator.upload.outcome.blockedDetail'] };
    [description, detail] = t && outcomeKeys[upload?.publicationOutcome] ? outcomeKeys[upload.publicationOutcome].map(key=>t(key)) : Object.hasOwn(outcomes, upload?.publicationOutcome) ? outcomes[upload.publicationOutcome] : [tr('creator.upload.outcome.unknown','版本已通过检查，但发布结果尚未确认，请到作品列表查看当前公开版本。'), tr('creator.upload.outcome.unknownDetail','结果待确认')];
  }
  if (state === 'failed') { title = tr('creator.upload.status.failed','处理失败'); description = uploadErrorMessage(upload?.errorCode,{t}); tone = 'error'; }
  if (state === 'expired') { title = tr('creator.upload.status.expired','上传已过期'); description = tr('creator.upload.status.expiredBody','上传任务已过期，请重新选择文件上传。'); tone = 'error'; }
  if (state === 'review_required') { title = tr('creator.upload.status.review','等待人工审核'); description = tr('creator.upload.status.reviewBody','本版本需要人工审核，审核通过前不会发布。'); tone = 'warning'; }
  if (!terminal && phase === 'hashing') { title = tr('creator.upload.status.preparing','准备文件'); description = tr('creator.upload.status.preparingBody','正在计算文件摘要。'); detail = tr('creator.upload.status.preparing','准备文件'); }
  if (!terminal && phase === 'error') { title = tr('creator.upload.status.confirm','状态需确认'); description = tr('creator.upload.status.confirmBody','本机操作中断，请重新读取服务端任务状态。'); detail = tr('creator.upload.status.confirm','状态需确认'); tone = 'warning'; }
  return {
    state, published, terminal, title, description, tone,
    steps: UPLOAD_STEPS.map(([id, label], index) => {
      const status = index < current || (published && index === current) ? 'complete' : index === current ? 'current' : 'pending';
      return { id, label: tr(`creator.upload.step.${id}`,label), status, detail: published && index === 7 ? tr('creator.upload.step.publishedDone','发布完成') : status === 'complete' ? tr('creator.upload.step.complete','已完成') : status === 'current' ? detail : id === 'published' ? tr('creator.upload.step.notPublished','未发布') : current < 0 ? tr('creator.upload.step.unconfirmed','未确认') : tr('creator.upload.step.pending','尚未到达') };
    }),
  };
}
