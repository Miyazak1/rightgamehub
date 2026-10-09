import path from 'node:path';
import { createApiClient } from '../packages/platform-api-client/src/index.mjs';
import { submitCreatorPackage } from '../packages/creator-tools/src/creator-package.mjs';
import { createGcmCredentialStore } from '../extensions/harness/src/credential-store.mjs';

const args = process.argv.slice(2);
const valueAfter = flag => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
};
async function main() {
const target = args.find((value,index) => !value.startsWith('--') && (index === 0 || !['--base-url','--site-url'].includes(args[index - 1]))) ?? '.';
const baseUrl = new URL(valueAfter('--base-url') ?? process.env.GAMEHUB_API_BASE_URL ?? 'https://mooyu.fun').origin;
const siteUrl = new URL(valueAfter('--site-url') ?? baseUrl);

if (args.some(value => /token|secret|key/iu.test(value))) {
  throw new Error('提交命令不接受 token、secret 或 key 参数；请先在 GameHub Agent 宿主中登录。');
}

const credentials = await createGcmCredentialStore();
if (!credentials.available) throw new Error('系统凭据库不可用。请在支持 GameHub 安全凭据桥的 Agent 宿主中登录后重试。');

const apiClient = createApiClient({
  baseUrl,
  getAccessToken: async () => (await credentials.get())?.accessToken ?? null,
  getRefreshToken: async () => (await credentials.get())?.refreshToken ?? null,
  setTokens: tokens => credentials.set(tokens),
});
let existing = await credentials.get();
if (!existing) {
  const challenge = (await apiClient.startGitHubDevice({ clientKind:'harness',deviceLabel:'GameHub Agent Publisher' })).data;
  process.stderr.write(`需要登录 GameHub。请打开 ${challenge.verificationUri} 并输入代码 ${challenge.userCode}\n`);
  const expiresAt = Date.parse(challenge.expiresAt);
  let retryAfter = Math.max(1,Number(challenge.intervalSeconds) || 5);
  while (!existing && Date.now() < expiresAt) {
    await new Promise(resolve => setTimeout(resolve,retryAfter * 1000));
    try {
      const status = (await apiClient.pollGitHubDevice(challenge.challengeId)).data;
      if (status.status === 'complete' && status.tokens) {
        await credentials.set(status.tokens);
        existing = status.tokens;
      } else retryAfter = Math.max(1,Number(status.retryAfter) || retryAfter);
    } catch (error) {
      if (error?.status !== 429) throw error;
      retryAfter = Math.min(60,retryAfter + 5);
    }
  }
  if (!existing) throw new Error('GitHub 设备授权已超时，请重新执行提交命令。');
}
const submitted = await submitCreatorPackage({ root: path.resolve(target),apiClient,platformOrigin:baseUrl });
siteUrl.hash = `/creator/drafts/${submitted.draft.id}`;
const output = {
  ok: true,
  draftId: submitted.draft.id,
  title: submitted.draft.title,
  revision: submitted.draft.revision,
  action: submitted.action,
  previewUrl: siteUrl.href,
  status: 'draft',
};
if (args.includes('--json')) process.stdout.write(`${JSON.stringify(output,null,2)}\n`);
else {
  const actionLabel = output.action === 'updated' ? '已更新待发布草稿' : output.action === 'unchanged' ? '内容未变化，沿用待发布草稿' : '已创建待发布草稿';
  console.log(`${actionLabel}：${output.title}`);
  console.log(`草稿 ID：${output.draftId}`);
  console.log(`预览地址：${output.previewUrl}`);
  console.log('这一步不会自动公开发布。请在平台预览、构建并确认发布。');
}
}

main().catch(error => {
  const output = { ok:false,code:error?.code ?? 'CREATOR_SUBMIT_FAILED',message:String(error?.message || error),...(error?.report ? { report:error.report } : {}) };
  if (args.includes('--json')) process.stderr.write(`${JSON.stringify(output,null,2)}\n`);
  else {
    console.error(`提交失败：${output.message}`);
    for (const finding of error?.report?.findings?.filter(value => value.severity === 'error') ?? []) console.error(`- ${finding.message}`);
  }
  process.exitCode = 1;
});
