import fs from 'node:fs/promises';
import path from 'node:path';
import { createApiClient } from '../packages/platform-api-client/src/index.mjs';
import { coursewareSubmissionStatus,publishCoursewareSubmission,submitCoursewareProject } from '../packages/creator-tools/src/index.mjs';
import { submitCreatorPackage } from '../packages/creator-tools/src/creator-package.mjs';
import { createGcmCredentialStore } from '../extensions/harness/src/credential-store.mjs';

const args = process.argv.slice(2);
const commands = new Set(['submit','status','publish']);
const command = commands.has(args[0]) ? args[0] : 'submit';
const commandOffset = commands.has(args[0]) ? 1 : 0;
const valueFlags = new Set(['--base-url','--site-url','--release-label']);
const valueAfter = flag => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
};
const positional = args.slice(commandOffset).filter((value,index,values) => !value.startsWith('--') && !valueFlags.has(values[index - 1]));

async function exists(file) {
  try { return (await fs.stat(file)).isFile(); } catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

async function main() {
  const target = path.resolve(positional[0] ?? '.');
  const baseUrl = new URL(valueAfter('--base-url') ?? process.env.GAMEHUB_API_BASE_URL ?? 'https://mooyu.fun').origin;
  const siteUrl = new URL(valueAfter('--site-url') ?? baseUrl);
  const isCourseware = await exists(path.join(target,'mooyu-courseware.json'));

  if (args.some(value => /token|secret|key/iu.test(value))) throw new Error('提交命令不接受 token、secret 或 key 参数；请先在墨鱼工坊 Agent 宿主中登录。');
  if (!isCourseware && command !== 'submit') throw new Error(`${command} 目前只适用于包含 mooyu-courseware.json 的交互课件项目。`);

  const credentials = await createGcmCredentialStore();
  if (!credentials.available) throw new Error('系统凭据库不可用。请在支持墨鱼工坊安全凭据桥的 Agent 宿主中登录后重试。');
  const apiClient = createApiClient({
    baseUrl,
    getAccessToken: async () => (await credentials.get())?.accessToken ?? null,
    getRefreshToken: async () => (await credentials.get())?.refreshToken ?? null,
    setTokens: tokens => credentials.set(tokens),
  });
  let existing = await credentials.get();
  if (!existing) {
    const challenge = (await apiClient.startGitHubDevice({ clientKind:'harness',deviceLabel:'墨鱼工坊 Agent Publisher' })).data;
    process.stderr.write(`需要登录墨鱼工坊。请打开 ${challenge.verificationUri} 并输入代码 ${challenge.userCode}\n`);
    const expiresAt = Date.parse(challenge.expiresAt);
    let retryAfter = Math.max(1,Number(challenge.intervalSeconds) || 5);
    while (!existing && Date.now() < expiresAt) {
      await new Promise(resolve => setTimeout(resolve,retryAfter * 1000));
      try {
        const status = (await apiClient.pollGitHubDevice(challenge.challengeId)).data;
        if (status.status === 'complete' && status.tokens) { await credentials.set(status.tokens); existing = status.tokens; }
        else retryAfter = Math.max(1,Number(status.retryAfter) || retryAfter);
      } catch (error) {
        if (error?.status !== 429) throw error;
        retryAfter = Math.min(60,retryAfter + 5);
      }
    }
    if (!existing) throw new Error('GitHub 设备授权已超时，请重新执行提交命令。');
  }

  let output;
  if (isCourseware && command === 'submit') {
    const submitted = await submitCoursewareProject(target,{ apiClient,platformUrl:baseUrl,releaseLabel:valueAfter('--release-label') ?? 'courseware-draft' });
    output = { ok:true,type:'courseware',command,action:submitted.action,workId:submitted.workId,uploadId:submitted.upload.id,validationState:submitted.upload.state,publicationOutcome:submitted.upload.publicationOutcome ?? 'pending',creatorUrl:new URL('/creator',siteUrl.origin).href };
  } else if (isCourseware && command === 'status') {
    const status = await coursewareSubmissionStatus(target,{ apiClient,platformUrl:baseUrl });
    output = { ok:true,type:'courseware',command,workId:status.state.workId,uploadId:status.state.uploadId,releaseId:status.upload.releaseId ?? null,validationState:status.upload.state,publicationOutcome:status.upload.publicationOutcome ?? null,errorCode:status.upload.errorCode ?? null,readyToPublish:status.ready };
  } else if (isCourseware && command === 'publish') {
    const published = await publishCoursewareSubmission(target,{ apiClient,platformUrl:baseUrl });
    output = { ok:true,type:'courseware',command,workId:published.work.id,releaseId:published.releaseId,targetKey:published.targetKey,status:'published',publicUrl:new URL(`/w/${published.work.id}`,siteUrl.origin).href };
  } else {
    const submitted = await submitCreatorPackage({ root:target,apiClient,platformOrigin:baseUrl });
    output = { ok:true,type:'creator-draft',command,action:submitted.action,draftId:submitted.draft.id,title:submitted.draft.title,revision:submitted.draft.revision,status:'draft',previewUrl:new URL(`/creator/drafts/${submitted.draft.id}`,siteUrl.origin).href };
  }

  if (args.includes('--json')) { process.stdout.write(`${JSON.stringify(output,null,2)}\n`); return; }
  if (output.type === 'courseware' && command === 'submit') {
    console.log(output.action === 'unchanged' ? '课件内容未变化，沿用现有私有提交。' : '课件已经提交到平台验证队列。');
    console.log(`作品 ID：${output.workId}`); console.log(`上传任务：${output.uploadId}`); console.log(`验证状态：${output.validationState}`);
    console.log('这一步不会公开发布。验证完成后先运行 status；只有你明确决定公开时才运行 publish。');
  } else if (output.type === 'courseware' && command === 'status') {
    console.log(`验证状态：${output.validationState}`); console.log(`发布状态：${output.publicationOutcome ?? 'pending'}`);
    if (output.errorCode) console.log(`失败代码：${output.errorCode}`);
    console.log(output.readyToPublish ? '已通过验证，可以在明确确认后运行 publish。' : '尚不可发布，请等待验证完成或修复验证错误。');
  } else if (output.type === 'courseware' && command === 'publish') {
    console.log('课件已经公开发布。'); console.log(`作品 ID：${output.workId}`); console.log(`公开地址：${output.publicUrl}`);
  } else {
    const actionLabel = output.action === 'updated' ? '已更新待发布草稿' : output.action === 'unchanged' ? '内容未变化，沿用待发布草稿' : '已创建待发布草稿';
    console.log(`${actionLabel}：${output.title}`); console.log(`草稿 ID：${output.draftId}`); console.log(`预览地址：${output.previewUrl}`);
    console.log('这一步不会自动公开发布。请在平台预览、构建并确认发布。');
  }
}

main().catch(error => {
  const output = { ok:false,command,code:error?.code ?? 'CREATOR_SUBMIT_FAILED',message:String(error?.message || error),...(error?.report ? { report:error.report } : {}),...(error?.details ? { details:error.details } : {}) };
  if (args.includes('--json')) process.stderr.write(`${JSON.stringify(output,null,2)}\n`);
  else {
    console.error(`${command === 'publish' ? '发布' : command === 'status' ? '查询' : '提交'}失败：${output.message}`);
    for (const finding of error?.report?.findings?.filter(value => value.severity === 'error') ?? error?.details?.findings?.filter(value => value.severity === 'error') ?? []) console.error(`- ${finding.message}`);
  }
  process.exitCode = 1;
});
