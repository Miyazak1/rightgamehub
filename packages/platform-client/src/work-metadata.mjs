export const workKindLabels = { game: '游戏', creative: '互动作品', tool: '创意工具' };
export const workMetadataForm = work => ({ title: work.title ?? '', description: work.description ?? '', instructions: work.instructions ?? '', estimatedMinutes: String(work.estimatedMinutes ?? 3), tags: (work.tags || []).join('，'), agentLabel: work.agentLabel ?? '', repositoryUrl: work.repositoryUrl ?? '', licenseSpdx: work.licenseSpdx ?? '' });
export function workMetadataPayload(form) {
  const title = form.title.trim(), description = form.description.trim(), instructions = form.instructions.trim();
  const tags = [...new Set(form.tags.split(/[,，]/).map(value => value.trim()).filter(Boolean))];
  const estimatedMinutes = Number(form.estimatedMinutes), agentLabel = form.agentLabel.trim() || null, repositoryUrl = form.repositoryUrl.trim() || null, licenseSpdx = form.licenseSpdx.trim() || null;
  if (!title || title.length > 120) throw new Error('作品名称需为 1–120 个字。');
  if (!description || description.length > 4000 || instructions.length > 4000) throw new Error('请填写作品介绍；介绍与玩法说明各不超过 4,000 个字。');
  if (!Number.isInteger(estimatedMinutes) || estimatedMinutes < 1 || estimatedMinutes > 30) throw new Error('预计时长需为 1–30 分钟的整数。');
  if (tags.length > 6 || tags.some(tag => tag.length > 20)) throw new Error('最多填写 6 个标签，每个不超过 20 个字。');
  if (agentLabel?.length > 40 || licenseSpdx?.length > 40) throw new Error('Coding Agent 名称与许可证各不超过 40 个字。');
  if (Boolean(repositoryUrl) !== Boolean(licenseSpdx)) throw new Error('开源地址和许可证需要同时填写。');
  if (repositoryUrl && !/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/?$/.test(repositoryUrl)) throw new Error('请填写有效的 GitHub 仓库地址。');
  return { title, description, instructions, estimatedMinutes, tags, agentLabel, repositoryUrl, licenseSpdx };
}
