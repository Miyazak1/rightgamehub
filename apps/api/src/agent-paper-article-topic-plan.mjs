import { draftClaimBindingGuide } from './agent-paper-draft-grounding.mjs';
import { draftClaimNarrativeRole } from './agent-paper-text-draft.mjs';

// Classify verified facts, not a paper ID, finding-key spelling, or an edited
// article. Unknown facts remain visible in their own section; none are dropped.
function topicFor(finding, editorialVersion) {
  const t = finding.text, role = draftClaimNarrativeRole(t);
  const topics = new Set(draftClaimBindingGuide([finding]).map(g => g.topic));
  if (/计划|未来工作|未来研究|后续研究|研究目标/u.test(t)) return ['outlook', 1];
  if (/结论|总结/u.test(t)) return ['outlook', 0];
  if (/位置编码|positional?\s+encoding/iu.test(t)) return ['position-output', /dropout|随机失活/iu.test(t) ? 2 : /选择|学习得到|固定/u.test(t) && !/为使|为了|注入/u.test(t) ? 1 : 0];
  if (/dropout|随机失活/iu.test(t)) return ['position-output', 2];
  if (topics.has('layer-specific-parameters')) return ['parameters', 1];
  if (topics.has('shared-embedding-output-weights')) return ['parameters', 2];
  if (/前馈/u.test(t) && !/两个子层|两.{0,4}子层/u.test(t)) return ['parameters', 0];
  if (topics.has('research-problem')) return ['problem', 0];
  if (topics.has('attention-recurrent-co-use')) return ['problem', 1];
  if (role === 'proposal') return ['problem', 2];
  if (/两个子层|残差|层归一化|掩蔽|遮蔽|输出嵌入偏移/u.test(t)) return ['layers', topics.has('encoder-self-attention') && !topics.has('decoder-self-attention') ? 0 : /输出嵌入偏移/u.test(t) && !/子层/u.test(t) ? 2 : 1];
  if (topics.has('attention-function-mapping')) return ['attention', 0];
  if (/矩阵|打包/u.test(t) && /查询|键|值/u.test(t)) return ['attention', 1];
  if (topics.has('attention-function-types')) return ['attention', 2];
  if (topics.has('encoder-decoder-attention')) return ['attention', 3];
  if (topics.has('encoder-self-attention')) return ['attention', 4];
  if (topics.has('decoder-self-attention')) return ['attention', 5];
  if (role === 'generation-order') return ['concepts', 1];
  if (/自注意力/u.test(t) && /定义|描述为|关联|表示/u.test(t)) return ['concepts', 0];
  if (editorialVersion >= 2 && /依赖关系|关联关系/u.test(t) && /距离/u.test(t)) return ['dependency-range', 0];
  return ['other', 0];
}

const order = ['problem', 'concepts', 'layers', 'attention', 'parameters', 'position-output', 'outlook', 'other'];
function residualHeading(finding) {
  const text = finding.text.replace(/^(?:论文作者|作者|论文|文中)(?:指出|说明|表示|报告|提出|强调|认为)?[，,:：]?\s*/u, '');
  const subject = text.match(/^([\p{Script=Han}]{2,24}?)(?:仅|只|通常|可以|能够)?(?:访问|读取|检索|将|把|使|用于|负责|允许|包含|采用|使用|保留|接收|返回|在|对|是)/u)?.[1];
  if (subject) return /(?:访问|读取|检索)/u.test(text.slice(subject.length, subject.length + 8)) ? `${subject}的访问范围` : `${subject}的说明`;
  // Use a literal Chinese subject/clause from the frozen fact. Never invent a
  // translated model name or replace unknown material with a category heading.
  const clause = text.split(/[。！？；;]/u)[0];
  if (/^[\p{Script=Han}\p{N}\p{P}\p{Zs}]{4,80}$/u.test(clause)) return clause;
  const phrase = text.match(/[\p{Script=Han}]{4,30}/u)?.[0];
  if (phrase) return `${phrase}的说明`;
  const error = new Error('AGENT_PAPER_ARTICLE_TOPIC_SUBJECT_REQUIRED'); error.code = error.message; throw error;
}
function headingFor(topic, facts, editorialVersion) {
  const text = facts.map(f => f.text).join('。');
  if (topic === 'problem') return /研究问题|约束|挑战/u.test(text) ? '研究问题与核心思路' : '论文提出的核心思路';
  if (topic === 'concepts') return /自注意力/u.test(text) && /自回归|先前生成/u.test(text) ? '自注意力与生成顺序' : /自注意力/u.test(text) ? '自注意力的含义' : '模型的生成顺序';
  if (topic === 'layers') return /编码器/u.test(text) && /解码器/u.test(text) ? '编码器与解码器的层内结构' : /编码器/u.test(text) ? '编码器的层内结构' : '解码器的层内结构';
  if (topic === 'attention') {
    const functions = /注意力函数|查询.{0,30}映射/u.test(text), connections = /来自|关注/u.test(text);
    return functions && connections ? '注意力函数与连接方式' : connections ? '注意力层的信息来源' : '注意力函数与计算组织';
  }
  if (topic === 'parameters') return /前馈/u.test(text) ? '前馈网络与参数安排' : '模型中的参数安排';
  if (topic === 'position-output') return /位置编码/u.test(text) && /dropout|随机失活/iu.test(text) ? '位置编码与子层输出处理' : /位置编码/u.test(text) ? '序列顺序与位置编码' : '子层输出的处理';
  if (topic === 'outlook') return /结论|总结/u.test(text) ? '结论与后续研究' : '作者提出的后续方向';
  if (topic === 'dependency-range') return `${/依赖关系/u.test(text) ? '依赖关系' : '关联关系'}与${/序列/u.test(text) ? '序列' : ''}距离`;
  if (editorialVersion >= 2) return residualHeading(facts[0]);
  return '其他可核对的主张';
}

export function buildPaperTopicSections(evidence, { editorialVersion = 1 } = {}) {
  const groups = new Map();
  const claims = evidence.findings.filter(f => f.kind === 'author_claim');
  for (const finding of claims) {
    const [topic, rank] = topicFor(finding, editorialVersion);
    const group = editorialVersion >= 2 && topic === 'other' ? `other:${residualHeading(finding)}` : topic;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push({ finding, rank });
  }
  const ordered = editorialVersion >= 2 ? [...order.filter(t => !['outlook', 'other'].includes(t)), 'dependency-range', ...[...groups.keys()].filter(t => t.startsWith('other:')), 'outlook'] : order;
  return ordered.filter(group => groups.has(group)).map((group, ordinal) => {
    const topic = group.startsWith('other:') ? 'other' : group;
    const facts = groups.get(group).sort((a, b) => a.rank - b.rank || a.finding.key.localeCompare(b.finding.key)).map(x => x.finding);
    return { key: `section-${String(ordinal + 1).padStart(2, '0')}`, topic, topicHeading: headingFor(topic, facts, editorialVersion),
      findingKeys: facts.map(f => f.key), minimumParagraphs: 1,
      paragraphs: facts.map(f => ({ findingKeys: [f.key] })) };
  });
}
