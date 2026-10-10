import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { validateRulesAdapter, RULES_BUNDLE_MAX_BYTES } from '@gamehub/rules-sdk';

export const CREATOR_DOCTOR_REPORT_VERSION = 1;
export const MULTIPLAYER_TEMPLATE_VERSION = '0.1.0';
const identityPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const modePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const requiredFiles = ['platform.json','index.html','creator-submission.json','rules/adapter.cjs','rules/tests.json'];
const item = (severity,code,message,fix) => ({ severity,code,message,...(fix ? { fix } : {}) });
const stable = value => JSON.stringify(value);
const copy = value => structuredClone(value);
async function sourceFiles(directory,prefix='') {
  const output=[];
  for (const entry of await fs.readdir(directory,{withFileTypes:true})) {
    if (entry.isSymbolicLink()) continue;
    const relative=prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) { if (entry.name !== 'rules') output.push(...await sourceFiles(path.join(directory,entry.name),relative)); }
    else if (/\.(?:html|js|mjs)$/u.test(entry.name)) output.push(relative);
  }
  return output;
}

async function readJson(file) { return JSON.parse(await fs.readFile(file,'utf8')); }
async function loadAdapter(file) {
  const bytes = await fs.readFile(file);
  if (!bytes.length || bytes.length > RULES_BUNDLE_MAX_BYTES) throw new Error('规则 bundle 必须大于 0 且不超过 1 MiB。');
  const module = { exports: {} };
  const sandbox = Object.assign(Object.create(null), { module,exports: module.exports,structuredClone,TextEncoder });
  new vm.Script(`'use strict';\n${bytes.toString('utf8')}`, { filename: file }).runInNewContext(sandbox,{ timeout: 1_000 });
  return { adapter: module.exports?.rulesAdapter ?? module.exports?.default ?? module.exports,bytes };
}
const result = (root,findings) => ({
  version: CREATOR_DOCTOR_REPORT_VERSION,root,ok: !findings.some(value => value.severity === 'error'),
  summary: { errors: findings.filter(value => value.severity === 'error').length,warnings: findings.filter(value => value.severity === 'warning').length,info: findings.filter(value => value.severity === 'info').length },findings,
});

async function testAdapter(adapter,spec,findings) {
  const players = spec.players;
  if (!Array.isArray(players) || players.length !== 2 || players.some(player => typeof player?.userId !== 'string')) {
    findings.push(item('error','TEST_PLAYERS_INVALID','rules/tests.json 必须提供两个带 userId 的测试玩家。')); return;
  }
  const initialInput = { players: copy(players),seed: spec.seed ?? 'creator-doctor-seed',now: new Date('2026-01-01T00:00:00.000Z') };
  const first = await adapter.createInitialState(copy(initialInput));
  const second = await adapter.createInitialState(copy(initialInput));
  const firstHash=adapter.hashState(first),secondHash=adapter.hashState(second);
  if (!/^[a-f0-9]{64}$/u.test(firstHash)) findings.push(item('error','STATE_HASH_INVALID','hashState() 必须返回 64 位小写 SHA-256 十六进制。'));
  if (firstHash !== secondHash || stable(adapter.serializeState(first)) !== stable(adapter.serializeState(second))) findings.push(item('error','RULES_NON_DETERMINISTIC','相同玩家、seed 与时间生成了不同初始状态。','移除 Math.random、Date.now、网络和文件读取。'));
  else findings.push(item('info','RULES_DETERMINISTIC','固定输入的初始状态与哈希一致。'));
  const turn = adapter.getTurn(first);
  const actor = players.find(player => player.userId === turn?.userId);
  const other = players.find(player => player.userId !== turn?.userId);
  if (!actor || !other) findings.push(item('error','TURN_INVALID','getTurn() 没有返回测试玩家中的行动者。'));
  else {
    const context = { state: copy(first),command: spec.validCommand,actorUserId: actor.userId,players: copy(players),now: new Date('2026-01-01T00:00:01.000Z') };
    const allowed = await adapter.validateCommand(copy(context));
    if (allowed === false || allowed?.valid === false) findings.push(item('error','VALID_COMMAND_REJECTED','测试向量中的合法命令被拒绝。'));
    const left = await adapter.applyCommand(copy(context));
    const right = await adapter.applyCommand(copy(context));
    if (stable(left) !== stable(right) || adapter.hashState(left.state) !== adapter.hashState(right.state)) findings.push(item('error','COMMAND_NON_DETERMINISTIC','从同一状态重复计算同一命令得到不同结果。'));
    else findings.push(item('info','COMMAND_REPLAY_STABLE','同一基线上的重复命令计算结果一致；线上 commandId 去重由平台事务保证。'));
    if ((spec.privateLeakSentinels ?? []).some(secret=>stable(left.event ?? {}).includes(String(secret)))) findings.push(item('error','PUBLIC_EVENT_LEAK','公开事件包含私密测试哨兵。','公开 event 只发送所有玩家都能看到的结果。'));
    else findings.push(item('info','PUBLIC_EVENT_SCOPED','命令产生的公开事件未包含私密测试哨兵。'));
    const denied = await adapter.validateCommand({ ...copy(context),actorUserId: other.userId });
    if (denied !== false && denied?.valid !== false) findings.push(item('error','OUT_OF_TURN_ACCEPTED','非当前玩家的命令未被规则拒绝。'));
    else findings.push(item('info','OUT_OF_TURN_REJECTED','非当前玩家命令已拒绝。'));
  }
  const views = players.map(player => adapter.getPlayerView(first,player.userId));
  const spectator = adapter.getSpectatorView(first);
  const sentinels = spec.privateLeakSentinels ?? [];
  const leak = sentinels.some((secret,owner) => stable(spectator).includes(String(secret)) || views.some((view,index) => index !== owner && stable(view).includes(String(secret))));
  if (leak) findings.push(item('error','PRIVATE_VIEW_LEAK','观战视图或另一位玩家视图包含私密测试哨兵。','在服务端 getPlayerView/getSpectatorView 中裁剪，不能只用 CSS 隐藏。'));
  else findings.push(item('info','PRIVATE_VIEW_SCOPED','测试哨兵未出现在无权视图中。'));
  for (const [method,code] of [['handleResign','RESIGN_TERMINAL_MISSING'],['handleTimeout','TIMEOUT_TERMINAL_MISSING']]) {
    const output = await adapter[method]({ state: copy(first),actorUserId: players[0].userId,players: copy(players),turnUserId: turn?.userId,now: new Date('2026-01-01T00:01:00.000Z') });
    if (!output?.completed || !output?.result || !Array.isArray(output?.playerResults)) findings.push(item('error',code,`${method}() 未生成完整终局。`));
  }
}

export async function inspectMultiplayerProject(root) {
  const projectRoot = path.resolve(root); const findings = [];
  for (const relative of requiredFiles) {
    try { if (!(await fs.stat(path.join(projectRoot,relative))).isFile()) throw new Error(); }
    catch { findings.push(item('error','FILE_MISSING',`缺少 ${relative}。`,'从官方联网模板恢复该文件。')); }
  }
  if (findings.length) return result(projectRoot,findings);
  let manifest,submission,spec;
  try { manifest = await readJson(path.join(projectRoot,'platform.json')); } catch { findings.push(item('error','MANIFEST_INVALID','platform.json 不是有效 JSON。')); }
  if (manifest) {
    if (manifest.version !== 1 || typeof manifest.entry !== 'string') findings.push(item('error','MANIFEST_INVALID','platform.json 必须使用 version 1 并声明入口。'));
    if (!manifest.capabilities?.includes('multiplayer')) findings.push(item('error','MULTIPLAYER_CAPABILITY_MISSING','platform.json 未声明 multiplayer capability。','将 "multiplayer" 加入 capabilities。'));
    else findings.push(item('info','MULTIPLAYER_CAPABILITY_OK','已声明 multiplayer capability。'));
    try { await fs.stat(path.join(projectRoot,manifest.entry)); } catch { findings.push(item('error','ENTRY_MISSING','manifest 声明的客户端入口不存在。')); }
  }
  try { submission = await readJson(path.join(projectRoot,'creator-submission.json')); } catch { findings.push(item('error','SUBMISSION_INVALID','creator-submission.json 不是有效 JSON。')); }
  try { spec = await readJson(path.join(projectRoot,'rules/tests.json')); } catch { findings.push(item('error','TEST_SPEC_INVALID','rules/tests.json 不是有效 JSON。')); }
  if (submission) {
    if (!identityPattern.test(submission.workId ?? '') || !modePattern.test(submission.modeKey ?? '') || !modePattern.test(submission.rulesetVersion ?? '')) findings.push(item('error','RULES_IDENTITY_INVALID','workId、modeKey 或 rulesetVersion 格式不合法。'));
    if (submission.authority !== 'platform_authoritative') findings.push(item('error','AUTHORITY_INVALID','authority 必须是 platform_authoritative。'));
    if (!submission.views?.player || !submission.views?.spectator || !submission.views?.publicEvents) findings.push(item('error','VIEW_POLICY_MISSING','提交说明必须描述玩家视图、观战视图与公开事件。'));
  }
  for (const relative of await sourceFiles(projectRoot)) {
    const source = await fs.readFile(path.join(projectRoot,...relative.split('/')),'utf8');
    if (/\b(?:Bearer|accessToken|refreshToken|realtimeTicket)\b|localStorage\s*\.\s*(?:token|accessToken)/iu.test(source)) findings.push(item('error','CLIENT_SECRET_REFERENCE',`${relative} 疑似直接持有平台凭据。`,'只使用 @gamehub/web-game-sdk；token、ticket 和 WebSocket 地址必须留在可信父页面。'));
  }
  if (!findings.some(value => value.code === 'CLIENT_SECRET_REFERENCE')) findings.push(item('info','CLIENT_SECRET_BOUNDARY_OK','客户端未命中平台 token/ticket 的明显持有模式。'));
  if (submission && spec) try {
    const { adapter,bytes } = await loadAdapter(path.join(projectRoot,'rules/adapter.cjs'));
    validateRulesAdapter(adapter);
    const mismatch = ['workId','modeKey','rulesetVersion'].find(field => adapter[field] !== submission[field]);
    if (mismatch) findings.push(item('error','RULES_IDENTITY_MISMATCH',`规则导出的 ${mismatch} 与 creator-submission.json 不一致。`));
    else findings.push(item('info','RULES_IDENTITY_OK','规则导出身份与提交说明一致。'));
    findings.push(item('info','RULES_BUNDLE_DIGEST',`规则 bundle ${bytes.length} 字节，SHA-256 ${crypto.createHash('sha256').update(bytes).digest('hex')}。`));
    await testAdapter(adapter,spec,findings);
  } catch (error) { findings.push(item('error','RULES_LOAD_FAILED',`规则适配器无法检查：${error.message}`,'确保导出单个 CommonJS rulesAdapter，且不依赖 require/process。')); }
  findings.push(item('warning','HEURISTIC_LIMIT','Creator Doctor 是合规与明显泄漏检查，不是安全证明；发布前仍需平台代码审核、受控构建与双账号验收。'));
  return result(projectRoot,findings);
}

const staticTextExtensions = new Set(['.html','.htm','.css','.js','.mjs','.json','.txt','.md','.xml','.svg','.twee','.bitsy','.puzzlescript']);
const staticForbiddenExtensions = new Set(['.exe','.dll','.msi','.bat','.cmd','.ps1','.com','.scr','.sys','.dylib','.so','.app','.apk','.jar','.zip','.rar','.7z']);
const staticSecretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{20,}\b/u,
  /\b(?:access|refresh|api)[_-]?token\s*[:=]\s*["'][^"']{12,}["']/iu,
  /\bapi[_-]?key\s*[:=]\s*["'][^"']{12,}["']/iu,
];

export async function inspectStaticWebProject(root) {
  const projectRoot = path.resolve(root); const findings = []; const files = [];
  let totalBytes = 0;
  const walk = async (directory,prefix='') => {
    let entries;
    try { entries = await fs.readdir(directory,{ withFileTypes:true }); }
    catch (error) { findings.push(item('error','WEB_PROJECT_UNREADABLE',`无法读取 ${prefix || '项目目录'}：${error.message}`)); return; }
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) { findings.push(item('error','WEB_SYMLINK_FORBIDDEN',`${relative} 是符号链接。`,'将目标内容复制为项目内普通文件。')); continue; }
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.gamehub') continue;
        await walk(path.join(directory,entry.name),relative);
        continue;
      }
      if (!entry.isFile()) { findings.push(item('error','WEB_FILE_TYPE_INVALID',`${relative} 不是普通文件。`)); continue; }
      const absolute = path.join(directory,entry.name); const stat = await fs.stat(absolute);
      totalBytes += stat.size; files.push({ relative,absolute,size:stat.size,extension:path.extname(entry.name).toLowerCase() });
      if (files.length > 2_000) { findings.push(item('error','WEB_FILE_COUNT_EXCEEDED','项目文件超过 2000 个。','删除构建缓存、源码依赖和无关文件，只保留浏览器运行所需资源。')); return; }
    }
  };
  await walk(projectRoot);
  const entry = files.find(file => file.relative === 'index.html');
  if (!entry) findings.push(item('error','WEB_ENTRY_MISSING','项目根目录缺少 index.html。','把可玩的网页入口放在项目根目录并命名为 index.html。'));
  else if (entry.size < 16 || entry.size > 5 * 1024 * 1024) findings.push(item('error','WEB_ENTRY_SIZE_INVALID','index.html 必须是 16 字节至 5 MiB 的普通文件。'));
  if (totalBytes > 128 * 1024 * 1024) findings.push(item('error','WEB_PROJECT_TOO_LARGE','项目文件总量超过 128 MiB。','移除源素材、编辑器缓存和未使用资源。'));
  for (const file of files) {
    if (staticForbiddenExtensions.has(file.extension)) findings.push(item('error','WEB_EXECUTABLE_FORBIDDEN',`${file.relative} 不是网页发布物允许的文件类型。`,'网页包只应包含浏览器可读取的静态资源。'));
    if (/^(?:\.env(?:\.|$)|credentials?|secrets?)(?:\.|$)/iu.test(path.basename(file.relative))) findings.push(item('error','WEB_SECRET_FILE',`${file.relative} 看起来是凭据文件。`,'从发布目录删除凭据，并立即轮换已经暴露的密钥。'));
    if (!staticTextExtensions.has(file.extension) || file.size > 1024 * 1024) continue;
    let source;
    try { source = await fs.readFile(file.absolute,'utf8'); } catch { continue; }
    if (staticSecretPatterns.some(pattern => pattern.test(source))) findings.push(item('error','WEB_SECRET_REFERENCE',`${file.relative} 疑似包含密钥或令牌。`,'从成品中移除凭据，并使用平台提供的受限能力桥。'));
    if (/<(?:script|link)\b[^>]*(?:src|href)\s*=\s*["']https?:\/\//iu.test(source)) findings.push(item('warning','WEB_REMOTE_RUNTIME',`${file.relative} 引用了远程脚本或样式。`,'将运行依赖保存到项目内，确保离线和隔离环境可运行。'));
    if (/\b(?:file:\/\/\/|[A-Z]:\\Users\\|\/home\/[^/]+\/)/u.test(source)) findings.push(item('warning','WEB_LOCAL_PATH_REFERENCE',`${file.relative} 可能包含本机绝对路径。`,'改用项目内相对路径。'));
  }
  if (!findings.some(finding => finding.severity === 'error')) findings.push(item('info','WEB_PROJECT_READY',`本地网页项目包含 ${files.length} 个文件、${totalBytes} 字节，可以继续压缩并上传平台校验。`));
  findings.push(item('warning','LOCAL_DOCTOR_LIMIT','本地 Doctor 只检查发布结构和明显泄漏；平台仍会重新解包、扫描并在隔离环境中验证。'));
  return result(projectRoot,findings);
}

export {
  CREATOR_PACKAGE_FORMAT,
  CREATOR_PACKAGE_VERSION,
  CREATOR_DRAFT_STATE_FORMAT,
  CREATOR_DRAFT_STATE_VERSION,
  CreatorPackageError,
  inspectCreatorPackage,
  loadCreatorPackage,
  submitCreatorPackage,
} from './creator-package.mjs';
