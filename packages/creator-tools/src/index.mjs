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
