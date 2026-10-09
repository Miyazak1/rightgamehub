import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const CREATOR_PACKAGE_FORMAT = 'gamehub.creator-package';
export const CREATOR_PACKAGE_VERSION = 1;
export const CREATOR_DRAFT_STATE_FORMAT = 'gamehub.creator-draft-state';
export const CREATOR_DRAFT_STATE_VERSION = 1;

export class CreatorPackageError extends Error {
  constructor(code, message, report = null) {
    super(message);
    this.name = 'CreatorPackageError';
    this.code = code;
    this.report = report;
  }
}

const item = (severity,code,message,fix) => ({ severity,code,message,...(fix ? { fix } : {}) });
const result = (root,findings) => ({
  version: 1,root,ok: !findings.some(value => value.severity === 'error'),
  summary: { errors: findings.filter(value => value.severity === 'error').length,warnings: findings.filter(value => value.severity === 'warning').length,info: findings.filter(value => value.severity === 'info').length },findings,
});
const readJson = async file => JSON.parse(await fs.readFile(file,'utf8'));
const canonicalJson = value => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const digest = value => crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
const safePackagePath = value => typeof value === 'string'
  && value.length > 0
  && value.length <= 255
  && !path.isAbsolute(value)
  && !value.includes('\\')
  && value.split('/').every(part => part && part !== '.' && part !== '..');
const validTextList = (value, maximum = 30) => Array.isArray(value)
  && value.length >= 1
  && value.length <= maximum
  && value.every(entry => typeof entry === 'string' && entry.trim().length >= 1 && entry.length <= 80);

function inspectBingoSource(content, findings) {
  if (!content || Array.isArray(content) || typeof content !== 'object') {
    findings.push(item('error','BINGO_SOURCE_INVALID','Bingo source 必须是 JSON 对象。')); return;
  }
  if (typeof content.tableTitle !== 'string' || !content.tableTitle.trim() || content.tableTitle.length > 120) findings.push(item('error','BINGO_TITLE_INVALID','tableTitle 必须是 1 至 120 个字符。'));
  if (content.subtitle !== undefined && (typeof content.subtitle !== 'string' || content.subtitle.length > 160)) findings.push(item('error','BINGO_SUBTITLE_INVALID','subtitle 不能超过 160 个字符。'));
  if (!validTextList(content.columnHeaders)) findings.push(item('error','BINGO_COLUMNS_INVALID','columnHeaders 必须包含 1 至 30 个非空标题，每项不超过 80 个字符。'));
  if (!validTextList(content.rowHeaders)) findings.push(item('error','BINGO_ROWS_INVALID','rowHeaders 必须包含 1 至 30 个非空标题，每项不超过 80 个字符。'));
  const rows = Array.isArray(content.rowHeaders) ? content.rowHeaders.length : 0;
  const columns = Array.isArray(content.columnHeaders) ? content.columnHeaders.length : 0;
  if (content.cells !== undefined && (!content.cells || Array.isArray(content.cells) || typeof content.cells !== 'object')) findings.push(item('error','BINGO_CELLS_INVALID','cells 必须是坐标到文字的 JSON 对象。'));
  else for (const [coordinate,value] of Object.entries(content.cells ?? {})) {
    const match = /^(\d+):(\d+)$/u.exec(coordinate);
    if (!match || Number(match[1]) >= rows || Number(match[2]) < 1 || Number(match[2]) >= columns || typeof value !== 'string' || value.length > 200) {
      findings.push(item('error','BINGO_CELL_INVALID',`单元格 ${coordinate} 的坐标或文字无效。`));
    }
  }
  if (!findings.some(finding => finding.severity === 'error')) findings.push(item('info','BINGO_SOURCE_VALID','Bingo 结构化源码通过本地检查。'));
}

async function inspectAndLoad(root) {
  const projectRoot = path.resolve(root); const findings = [];
  const manifestPath = path.join(projectRoot,'creator-manifest.json');
  let manifest; let content = null; let sourcePath = null;
  try {
    const stat = await fs.lstat(manifestPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error();
    manifest = await readJson(manifestPath);
  } catch {
    findings.push(item('error','CREATOR_MANIFEST_INVALID','缺少有效的 creator-manifest.json。','从官方结构化创作包模板开始。'));
    return { report: result(projectRoot,findings),manifest:null,content:null,sourcePath:null };
  }
  if (manifest.format !== CREATOR_PACKAGE_FORMAT || manifest.version !== CREATOR_PACKAGE_VERSION) findings.push(item('error','CREATOR_FORMAT_UNSUPPORTED',`creator-manifest.json 必须声明 ${CREATOR_PACKAGE_FORMAT} v${CREATOR_PACKAGE_VERSION}。`));
  if (manifest.studio !== 'bingo') findings.push(item('error','CREATOR_STUDIO_UNSUPPORTED','当前本地校验器只支持 studio=bingo。'));
  if (manifest.schemaVersion !== 1) findings.push(item('error','CREATOR_SCHEMA_UNSUPPORTED','当前 Bingo schemaVersion 必须为 1。'));
  if (typeof manifest.title !== 'string' || !manifest.title.trim() || manifest.title.length > 120) findings.push(item('error','CREATOR_TITLE_INVALID','创作包标题必须是 1 至 120 个字符。'));
  if (!safePackagePath(manifest.source) || !manifest.source.startsWith('source/') || !manifest.source.endsWith('.json')) {
    findings.push(item('error','CREATOR_SOURCE_PATH_INVALID','source 必须指向包内 source/ 目录下的 JSON 文件。'));
  } else {
    sourcePath = path.resolve(projectRoot,...manifest.source.split('/'));
    if (!sourcePath.startsWith(`${projectRoot}${path.sep}`)) findings.push(item('error','CREATOR_SOURCE_PATH_INVALID','source 不能越过创作包根目录。'));
    else try {
      const stat = await fs.lstat(sourcePath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 1024 * 1024) throw new Error('source 文件必须是 2 字节至 1 MiB 的普通文件。');
      content = await readJson(sourcePath);
      if (manifest.studio === 'bingo') inspectBingoSource(content,findings);
    } catch (error) {
      findings.push(item('error','CREATOR_SOURCE_INVALID',`无法读取结构化源码：${error.message || '文件无效'}`));
    }
  }
  if (!findings.some(finding => finding.severity === 'error')) findings.push(item('info','CREATOR_PACKAGE_READY','创作包可以提交为平台待发布草稿；本报告不代表已经公开发布。'));
  return { report: result(projectRoot,findings),manifest,content,sourcePath };
}

export async function inspectCreatorPackage(root) {
  return (await inspectAndLoad(root)).report;
}

export async function loadCreatorPackage(root) {
  const loaded = await inspectAndLoad(root);
  if (!loaded.report.ok) throw new CreatorPackageError('CREATOR_PACKAGE_INVALID','创作包未通过本地检查。',loaded.report);
  return {
    root: loaded.report.root,
    manifest: loaded.manifest,
    sourcePath: loaded.sourcePath,
    content: loaded.content,
    draft: {
      studio: loaded.manifest.studio,
      schemaVersion: loaded.manifest.schemaVersion,
      title: loaded.manifest.title.trim(),
      content: loaded.content,
    },
    report: loaded.report,
  };
}

const statePathFor = root => path.join(root,'.gamehub','draft.json');
const validState = value => value
  && value.format === CREATOR_DRAFT_STATE_FORMAT
  && value.version === CREATOR_DRAFT_STATE_VERSION
  && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value.draftId ?? '')
  && /^\d+$/u.test(value.revision ?? '')
  && /^[a-f0-9]{64}$/u.test(value.contentSha256 ?? '')
  && typeof value.platformOrigin === 'string';

async function readDraftState(root) {
  const statePath = statePathFor(root);
  try {
    const stat = await fs.lstat(statePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 16 * 1024) throw new CreatorPackageError('CREATOR_STATE_INVALID','本地草稿状态文件不是安全的普通文件。');
    const state = await readJson(statePath);
    if (!validState(state)) throw new CreatorPackageError('CREATOR_STATE_INVALID','本地草稿状态文件格式无效；为避免重复或覆盖，提交已停止。');
    return state;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (error instanceof CreatorPackageError) throw error;
    throw new CreatorPackageError('CREATOR_STATE_INVALID',`无法读取本地草稿状态：${error.message || '文件无效'}`);
  }
}

async function writeDraftState(root,state) {
  const stateDirectory = path.join(root,'.gamehub');
  try {
    const existing = await fs.lstat(stateDirectory).catch(error => error?.code === 'ENOENT' ? null : Promise.reject(error));
    if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) throw new CreatorPackageError('CREATOR_STATE_PATH_INVALID','.gamehub 必须是创作包内的普通目录，不能是符号链接。');
    if (!existing) await fs.mkdir(stateDirectory,{ mode:0o700 });
    const target = statePathFor(root);
    const current = await fs.lstat(target).catch(error => error?.code === 'ENOENT' ? null : Promise.reject(error));
    if (current?.isSymbolicLink() || (current && !current.isFile())) throw new CreatorPackageError('CREATOR_STATE_PATH_INVALID','draft.json 必须是普通文件，不能是符号链接。');
    await fs.writeFile(target,`${JSON.stringify(state,null,2)}\n`,{ encoding:'utf8',mode:0o600,flag:current ? 'w' : 'wx' });
  } catch (error) {
    if (error instanceof CreatorPackageError) throw error;
    throw new CreatorPackageError('CREATOR_STATE_WRITE_FAILED',`平台草稿已保存，但本地关联状态写入失败：${error.message || '无法写入'}`);
  }
}

export async function submitCreatorPackage({ root, apiClient, platformOrigin }) {
  if (!apiClient || typeof apiClient.createCreatorDraft !== 'function') throw new CreatorPackageError('CREATOR_API_REQUIRED','缺少可用的平台 API 客户端。');
  const loaded = await loadCreatorPackage(root);
  let origin;
  try { origin = new URL(platformOrigin).origin; }
  catch { throw new CreatorPackageError('CREATOR_PLATFORM_INVALID','提交时必须提供有效的平台 HTTPS 地址或本机 loopback 地址。'); }
  if (!/^https:/u.test(origin) && !/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/u.test(origin)) throw new CreatorPackageError('CREATOR_PLATFORM_INVALID','平台地址必须使用 HTTPS，或本机 loopback HTTP。');
  const contentSha256 = digest(loaded.draft);
  const state = await readDraftState(loaded.root);
  if (state && state.platformOrigin !== origin) throw new CreatorPackageError('CREATOR_PLATFORM_MISMATCH',`这个创作包已关联 ${state.platformOrigin}，不会静默提交到另一个平台。`);
  let response; let action;
  if (state) {
    if (typeof apiClient.getCreatorDraft !== 'function' || typeof apiClient.updateCreatorDraft !== 'function') throw new CreatorPackageError('CREATOR_API_REQUIRED','API 客户端不支持安全更新草稿。');
    const remote = await apiClient.getCreatorDraft(state.draftId);
    if (!remote?.data?.id || String(remote.data.revision) !== state.revision) throw new CreatorPackageError('CREATOR_DRAFT_CONFLICT','平台草稿已在别处更新；为避免覆盖，提交已停止。请先在网页确认修订。');
    if (state.contentSha256 === contentSha256) return { draft:remote.data,report:loaded.report,manifest:loaded.manifest,action:'unchanged',state };
    response = await apiClient.updateCreatorDraft(state.draftId,{
      title: loaded.draft.title,
      schemaVersion: loaded.draft.schemaVersion,
      content: loaded.draft.content,
    },state.revision,{ headers:{ 'Idempotency-Key':`creator-package-update:${digest({ draftId:state.draftId,revision:state.revision,contentSha256 })}` } });
    action = 'updated';
  } else {
    const packageIdentity = digest({ root:loaded.root,platformOrigin:origin,contentSha256 });
    response = await apiClient.createCreatorDraft(loaded.draft,{ headers:{ 'Idempotency-Key':`creator-package-create:${packageIdentity}` } });
    action = 'created';
  }
  if (!response?.data?.id) throw new CreatorPackageError('CREATOR_SUBMISSION_INVALID','平台没有返回有效的草稿。');
  const nextState = {
    format: CREATOR_DRAFT_STATE_FORMAT,
    version: CREATOR_DRAFT_STATE_VERSION,
    platformOrigin: origin,
    draftId: response.data.id,
    revision: String(response.data.revision),
    studio: loaded.manifest.studio,
    schemaVersion: loaded.manifest.schemaVersion,
    contentSha256,
    updatedAt: new Date().toISOString(),
  };
  await writeDraftState(loaded.root,nextState);
  return { draft: response.data,report: loaded.report,manifest: loaded.manifest,action,state:nextState };
}
