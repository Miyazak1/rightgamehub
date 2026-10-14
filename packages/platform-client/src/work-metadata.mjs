export const workKindLabels = { game: '游戏', creative: '互动作品', tool: '创意工具', courseware: '交互课件' };
export const workMetadataForm = work => ({ title: work.title ?? '', description: work.description ?? '', instructions: work.instructions ?? '', estimatedMinutes: String(work.estimatedMinutes ?? 3), tags: (work.tags || []).join('，'), agentLabel: work.agentLabel ?? '', repositoryUrl: work.repositoryUrl ?? '', licenseSpdx: work.licenseSpdx ?? '', remixSourceWorkId: work.remixSource?.workId ?? '', remixNote: work.remixNote ?? '' });
export function workMetadataPayload(form, { t } = {}) {
  const message = (key, fallback) => typeof t === 'function' ? t(key) : fallback;
  const title = form.title.trim(), description = form.description.trim(), instructions = form.instructions.trim();
  const tags = [...new Set(form.tags.split(/[,，]/).map(value => value.trim()).filter(Boolean))];
  const estimatedMinutes = Number(form.estimatedMinutes), agentLabel = form.agentLabel.trim() || null, repositoryUrl = form.repositoryUrl.trim() || null, licenseSpdx = form.licenseSpdx.trim() || null;
  const remixSourceWorkId = form.remixSourceWorkId?.trim() || null, remixNote = form.remixNote?.trim() || null;
  if (!title || title.length > 120) throw new Error(message('creator.validation.title', '作品名称需为 1–120 个字。'));
  if (!description || description.length > 4000 || instructions.length > 4000) throw new Error(message('creator.validation.description', '请填写作品介绍；介绍与玩法说明各不超过 4,000 个字。'));
  if (!Number.isInteger(estimatedMinutes) || estimatedMinutes < 1 || estimatedMinutes > 30) throw new Error(message('creator.validation.duration', '预计时长需为 1–30 分钟的整数。'));
  if (tags.length > 6 || tags.some(tag => tag.length > 20)) throw new Error(message('creator.validation.tags', '最多填写 6 个标签，每个不超过 20 个字。'));
  if (agentLabel?.length > 40 || licenseSpdx?.length > 40) throw new Error(message('creator.validation.agentLicense', 'Coding Agent 名称与许可证各不超过 40 个字。'));
  if (Boolean(repositoryUrl) !== Boolean(licenseSpdx)) throw new Error(message('creator.validation.openSourcePair', '开源地址和许可证需要同时填写。'));
  if (repositoryUrl && !/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/?$/.test(repositoryUrl)) throw new Error(message('creator.validation.repository', '请填写有效的 GitHub 仓库地址。'));
  if (Boolean(remixSourceWorkId) !== Boolean(remixNote)) throw new Error(message('creator.validation.remixPair', '选择二创来源后，请填写你做了哪些改编。'));
  if (remixNote && (remixNote.length < 10 || remixNote.length > 1000)) throw new Error(message('creator.validation.remixLength', '二创说明需为 10–1,000 个字。'));
  return { title, description, instructions, estimatedMinutes, tags, agentLabel, repositoryUrl, licenseSpdx, remixSourceWorkId, remixNote };
}
