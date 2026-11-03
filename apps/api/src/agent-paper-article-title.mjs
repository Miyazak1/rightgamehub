// This is a generation contract, not a title translator or output sanitizer.
// Normalize only for inspection; the original model title is always preserved.
export const PAPER_CHINESE_TITLE_POLICY = Object.freeze({
  language: 'zh-CN',
  characters: '至少一个汉字，只使用汉字、数字、标点和空格',
  subject: '概括本段已给事实的中文主题，不复制原论文英文名、模型英文名或缩写，不自行音译专名',
  englishNames: '仅正文和摘要可按所给事实保留英文专名，文章标题和小标题禁止',
  selfCheck: '返回前逐字检查 title 和 heading；含外文字母则在生成本次响应时重新构思中文主题标题',
});

export function isChinesePaperTitle(value) {
  if (typeof value !== 'string') return false;
  const inspected = value.normalize('NFKC');
  return /\p{Script=Han}/u.test(inspected) && /^[\p{Script=Han}\p{N}\p{P}\p{Zs}]+$/u.test(inspected);
}
