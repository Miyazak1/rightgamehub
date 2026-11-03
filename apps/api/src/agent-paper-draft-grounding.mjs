import { stableHash } from './researcher-qa-protocol/stable-json.mjs';
import { assertSupportedDraftExplanations, textOnlyDraftExcerpt, textOnlyDraftWritingPlan } from './agent-paper-text-draft.mjs';
import { recurrenceFreeSignal, recurrenceFreeMentions } from './agent-paper-recurrence.mjs';

const fail = () => { const error = new Error('AGENT_PAPER_ARTICLE_FINDING_BINDING_INVALID');
  error.code = error.message; error.retryable = false; throw error; };

const components = [
  ['encoder-self-attention', /编码器(?:(?!解码器)[^。！？；，,]){0,20}自注意力|\bencoder\b[^.!?;,]{0,30}\bself[- ]attention\b/iu],
  ['decoder-self-attention', /解码器(?:(?!编码器)[^。！？；，,]){0,20}自注意力|\bdecoder\b[^.!?;,]{0,30}\bself[- ]attention\b/iu],
  ['encoder-decoder-attention', /编码器\s*[-—–－]\s*解码器[^。！？；，,]{0,8}注意力|编码器与解码器之间的注意力|\bencoder[-– ]decoder\s+attention\b/iu],
];
function componentNames(text) {
  // Do not interpret the decoder suffix of a cross-attention name as an
  // explicit decoder-self-attention subject in a short comparison sentence.
  const selfText = text.replace(/编码器\s*[-—–－]\s*解码器注意力|\bencoder[-– ]decoder\s+attention\b/giu, '交叉注意力');
  const names = new Set(components.filter(([name, pattern]) => pattern.test(
    name === 'encoder-decoder-attention' ? text : selfText)).map(([name]) => name));
  // Resolve only a same-sentence subject, never a previous paragraph or the
  // decoder suffix of encoder-decoder attention. A coordinated subject stays
  // ambiguous; an explicit later subject supersedes an earlier one.
  for (const sentence of selfText.split(/[。！？!?；;\n]/u)) {
    for (const reference of sentence.matchAll(/(?:其中|其)(?:的)?(?:多头)?自注意力(?:子层|层)?/gu)) {
      const prefix = sentence.slice(0, reference.index);
      const subjects = [...prefix.matchAll(/(?:^|[，,：:])\s*(?:(?:作者|论文|文中)(?:说明|指出)?[，,]?\s*)?(?:在)?(编码器|解码器)(?=一侧|方面|部分|同样|也|则|在|中|内|的|通过|使用|包含|由|有|与|和|及)/gu)];
      const subject = subjects.at(-1), tail = subject ? prefix.slice(subject.index) : '';
      const subjectTail = tail.replace(/(?:与|和)(?:编码器|解码器)(?:类似|相同)/gu, '');
      if (!subject || /(?:编码器(?:和|与|及)解码器|解码器(?:和|与|及)编码器)(?:都|均|分别|共同|各自|使用|包含|[，,])/u.test(tail)
        || new Set(subjectTail.match(/编码器|解码器/gu) ?? []).size > 1
        || prefix.length - subject.index > 120) names.add('ambiguous-self-attention-reference');
      else names.add(subject[1] === '编码器' ? 'encoder-self-attention' : 'decoder-self-attention');
    }
  }
  if (/编码器(?:和|与|及)解码器(?:各自)?(?:的|中|内部)?自注意力/u.test(text)) {
    names.add('encoder-self-attention'); names.add('decoder-self-attention');
  }
  return names;
}
export function assertDraftComponentBindings(text, claims) {
  const names = componentNames(text);
  if (names.has('ambiguous-self-attention-reference')) {
    const error = new Error('AGENT_PAPER_ARTICLE_COMPONENT_REFERENCE_AMBIGUOUS');
    error.code = error.message; error.retryable = false; throw error;
  }
  if (names.has('encoder-decoder-attention')
    && !names.has('encoder-self-attention') && !names.has('decoder-self-attention')
    && /(?:不同于|区别于|相比于?)[^。！？；;]{0,8}自注意力|与自注意力[^。！？；;]{0,10}(?:不同|相比|区别)/u.test(text)) {
    const error = new Error('AGENT_PAPER_ARTICLE_COMPONENT_COMPARISON_AMBIGUOUS');
    error.code = error.message; error.retryable = false; throw error;
  }
  const supported = componentNames(claims.map(f => f.text).join('。'));
  const missing = [...names].filter(name => !supported.has(name));
  if (missing.length) {
    const error = new Error('AGENT_PAPER_ARTICLE_COMPONENT_BINDING_INCOMPLETE');
    error.code = error.message; error.retryable = false; error.missingComponents = missing; throw error;
  }
}

// A targeted signature for the generic function definition, independent of
// model-chosen finding keys. Component-source claims cannot replace it.
const attentionMapping = /(?:查询|query)[^。！？!?]{0,90}(?:键值对|键和值|键、值|key[- ]?value)[^。！？!?]{0,60}(?:映射|maps?)[^。！？!?]{0,24}(?:输出|output)|(?:接收|接受|输入|takes?|receives?)[^。！？!?]{0,16}(?:查询|query)[^。！？!?]{0,45}(?:键值对|键和值|键、值|key[- ]?value)[^。！？!?]{0,35}(?:产生|生成|得到|返回|输出|produces?|returns?)[^。！？!?]{0,12}(?:输出|向量|output|vector)/iu;
export function assertDraftFunctionBinding(text, claims) {
  if (attentionMapping.test(text) && !claims.some(claim => attentionMapping.test(claim.text))) {
    const error = new Error('AGENT_PAPER_ARTICLE_FUNCTION_BINDING_INCOMPLETE');
    error.code = error.message; error.retryable = false; throw error;
  }
}

const parameterClaims = [
  ['layer-specific-parameters', /(?:不同层|层与层|各层|层间)[^。！？；;，,]{0,22}(?:不同参数|不同的参数|不同权重|各自[^。！？]{0,10}参数|参数[^。！？]{0,8}(?:不同|不共享))|(?:逐层|每层)(?:使用时|使用|采用|应用时)?[^。！？；;，,]{0,8}不同(?:的)?参数|(?:参数|权重)[^。！？；;，,]{0,16}(?:按层区分|因层而异|不跨层共享)/u],
  ['shared-embedding-output-weights', /(?:嵌入|embedding)[^。！？!?]{0,100}(?:共享|share)[^。！？!?]{0,20}(?:权重|矩阵|weight)|(?:共享|share)[^。！？!?]{0,20}(?:权重|矩阵|weight)[^。！？!?]{0,100}(?:嵌入|embedding)/iu],
];
export function assertDraftParameterBindings(text, claims) {
  const missing = parameterClaims.filter(([, pattern]) => pattern.test(text)
    && !claims.some(claim => pattern.test(claim.text))).map(([topic]) => topic);
  if (missing.length) {
    const error = new Error('AGENT_PAPER_ARTICLE_PARAMETER_BINDING_INCOMPLETE');
    error.code = error.message; error.retryable = false; error.missingParameterClaims = missing; throw error;
  }
}

const callbackTopics = [
  ['research-problem', /面临.{0,12}(?:问题|挑战|约束)|顺序计算.{0,20}(?:约束|限制)|(?:针对|回应|面对)(?:上述|这一|这个|该)(?:研究)?(?:问题|约束|限制)/u,
    '本段介绍或回顾研究问题时，绑定直接描述该问题的主张；针对上述问题等承接也必须绑定，方法主张和上段引用不能代替'],
  ['recurrence-free-architecture', recurrenceFreeSignal,
    '本段提到或对照无循环架构时，绑定架构主张'],
  ['generation-order', /自回归|autoregressive|(?:先前|此前|之前)(?:已经|已)?生成(?:的)?(?:符号|词元)|生成下一个(?:符号|词元)/iu,
    '本段提到自回归、已生成符号参与下一步时，绑定生成方式主张'],
  ['decoder-masking', /掩蔽|遮蔽|\bmask(?:ing|ed)?\b/iu,
    '本段提到掩蔽或回顾掩蔽与可访问范围的关系时，绑定掩蔽主张'],
];
export function assertDraftCallbackBindings(text, claims) {
  // Referencing an earlier explanation is still a factual use in this paragraph.
  // Match claim content, not key spelling, and never inherit earlier bindings.
  const missing = callbackTopics.filter(([, pattern]) => pattern.test(text)
    && !claims.some(claim => pattern.test(claim.text))).map(([topic]) => topic);
  const allowedPolarities = new Set(claims.flatMap(c => recurrenceFreeMentions(c.text)).map(m => m.polarity));
  if (recurrenceFreeMentions(text).some(m => !allowedPolarities.has(m.polarity)) && !missing.includes('recurrence-free-architecture')) {
    missing.push('recurrence-free-architecture');
  }
  if (missing.length) {
    const error = new Error('AGENT_PAPER_ARTICLE_CALLBACK_BINDING_INCOMPLETE');
    error.code = error.message; error.retryable = false; error.missingTopics = missing; throw error;
  }
}

const mechanismTopics = [
  ['feed-forward', /前馈|feed[- ]forward/iu], ['dropout', /dropout|随机失活/iu],
  ['position-encoding', /位置编码|positional?\s+encoding/iu], ['relu', /\bReLU\b/iu],
  ['residual-connection', /残差|residual/iu], ['layer-normalization', /层归一化|layer\s+norm/iu],
  ['machine-translation', /机器翻译|machine\s+translation/iu],
];
export function assertDraftTopicBindings(text, claims) {
  const missing = mechanismTopics.filter(([, pattern]) => pattern.test(text)
    && !claims.some(claim => pattern.test(claim.text))).map(([topic]) => topic);
  if (missing.length) {
    const error = new Error('AGENT_PAPER_ARTICLE_TOPIC_BINDING_INCOMPLETE');
    error.code = error.message; error.retryable = false; error.missingTopics = missing; throw error;
  }
}

// This index helps the writer locate relevant existing claims. It neither adds
// paragraph bindings nor certifies semantic entailment; validators still reject
// omissions. Finding keys come from this analysis, never hard-coded paper IDs.
export function draftClaimBindingGuide(findings) {
  const claims = findings.filter(f => f.kind === 'author_claim');
  return [
    ...components.map(([topic]) => [topic, text => componentNames(text).has(topic), '本段介绍或对照这个注意力组件时，选取直接支持所写来源、范围或组成的主张；其他组件的主张不能代替']),
    ['attention-function-mapping', text => attentionMapping.test(text), '本段复述查询与键值对映射为输出时，绑定函数定义主张；函数类别不能代替定义'],
    ['attention-function-types', text => /加性注意力[^。！？]{0,30}点积|additive\s+attention[^.!?]{0,60}dot[- ]product/iu.test(text)],
    ['attention-recurrent-co-use', text => /注意力[^。！？]{0,160}(?:通常|往往|除少数情况外)[^。！？]{0,30}循环(?:网络)?[^。！？]{0,12}(?:结合|搭配)/u.test(text)],
    ...callbackTopics.map(([topic, pattern, requiredWhen]) => [topic, text => pattern.test(text), requiredWhen]),
    ...mechanismTopics.map(([topic, pattern]) => [topic, text => pattern.test(text)]),
    ...parameterClaims.map(([topic, pattern]) => [topic, text => pattern.test(text)]),
  ].map(([topic, matches, requiredWhen]) => ({ topic, findingKeys: claims.filter(f => matches(f.text)).map(f => f.key),
    ...(requiredWhen ? { requiredWhen } : {}) }))
    .filter(entry => entry.findingKeys.length);
}

export function draftComparisonBindingGuide(findings) {
  const guide = new Map(draftClaimBindingGuide(findings).map(entry => [entry.topic, entry]));
  return [
    ['encoder-self-attention', 'encoder-decoder-attention'],
    ['encoder-self-attention', 'decoder-self-attention'],
    ['decoder-self-attention', 'encoder-decoder-attention'],
    ['recurrence-free-architecture', 'generation-order'],
    ['research-problem', 'recurrence-free-architecture'],
    ['decoder-masking', 'decoder-self-attention'],
    ['layer-specific-parameters', 'shared-embedding-output-weights'],
    ['attention-function-mapping', 'attention-function-types'],
    ['layer-specific-parameters', 'feed-forward'],
    ['dropout', 'residual-connection'],
  ].filter(topics => topics.every(topic => guide.has(topic))).map(topics => ({
    topics, claimOptionsByTopic: topics.map(topic => ({ topic, findingKeys: [...guide.get(topic).findingKeys] })),
    instruction: '本段若对照或关联这两边，分别从两组中选取直接支持句子的主张并绑定；不写这项对照时无需添加',
  }));
}

export function assertDraftNarrationStyle(blocks) {
  const paragraphs = blocks.filter(block => block.type === 'paragraph');
  // Detect repeated labels about the prose rather than ban an isolated useful
  // explanation. Technical vocabulary shared by paragraphs is not a template.
  const labels = /(?:这一|这条|这些)主张(?:描述|说明|交代|限定)的是|(?:这里|这一(?:描述|定义|主张))的?(?:作用范围|对象)是|论文在这里(?:交代|限定|说明)的是/u;
  const labelled = paragraphs.filter(block => labels.test(block.text)).length;
  if (labelled >= 4 && labelled / paragraphs.length >= 0.5) {
    const error = new Error('AGENT_PAPER_ARTICLE_REPETITIVE_NARRATION');
    error.code = error.message; error.retryable = false; throw error;
  }
}

export function assertDraftSectionRepetition(blocks, { maximumRepeatedRecaps = 1 } = {}) {
  let previous = [], repeatedRecaps = 0;
  const clean = text => Array.from(text.replace(/[\p{P}\p{Z}\s]/gu, ''));
  const grams = chars => Array.from({ length: Math.max(0, chars.length - 5) }, (_, i) => chars.slice(i, i + 6).join(''));
  for (const block of blocks) {
    if (block.type === 'heading') { previous = []; continue; }
    if (block.type !== 'paragraph') continue;
    const current = grams(clean(block.text)), seen = new Set(grams(clean(previous.join('。'))));
    const overlap = current.length ? current.filter(value => seen.has(value)).length / current.length : 0;
    // High verbatim reuse is rejected directly. Moderate reuse needs an explicit
    // recap lead-in in multiple sections; shared technical terms alone are fine.
    if (previous.length && overlap >= 0.72 && current.length >= 75) repetition();
    if (/^(?:综上|总的来说|综合|将.{0,20}放在一起|把.{0,20}(?:放在一起|连起来看)|这一组主张)/u.test(block.text)
      && overlap >= 0.18) repeatedRecaps++;
    previous.push(block.text);
  }
  if (repeatedRecaps > maximumRepeatedRecaps) repetition();
}
function repetition() {
  const error = new Error('AGENT_PAPER_ARTICLE_REPETITIVE_SECTION_RECAP');
  error.code = error.message; error.retryable = false; throw error;
}

// Model-only findingKeys are removed from visible blocks. Their verified source
// bindings stay in the composition artifact and are checked again at verify.
export function bindDraftParagraphs(blocks, evidence, { normalized = false, bindings = [], requiredFindingKeys = null, strictTopics = false } = {}) {
  if (normalized && !Array.isArray(bindings)) fail();
  assertDraftSectionRepetition(blocks);
  const plan = textOnlyDraftWritingPlan(evidence);
  if (plan.depth === 'expanded') assertDraftNarrationStyle(blocks);
  const required = requiredFindingKeys !== null || plan.paragraphFindingKeysRequired;
  const byKey = new Map(evidence.findings.filter(f => f.kind === 'author_claim').map(f => [f.key, f]));
  const byId = new Map(evidence.evidence.map(e => [e.id, e]));
  if (requiredFindingKeys !== null && (!Array.isArray(requiredFindingKeys)
    || new Set(requiredFindingKeys).size !== requiredFindingKeys.length
    || requiredFindingKeys.some(key => !byKey.has(key)))) fail();
  const allClaims = [...byKey.values()].map(f => f.text).join(' ');
  if (byKey.size !== evidence.findings.filter(f => f.kind === 'author_claim').length) fail();
  const output = [], seen = new Set(), usedKeys = new Set();
  for (const [blockIndex, block] of blocks.entries()) {
    if (block.type !== 'paragraph') {
      assertSupportedDraftExplanations(block.text ?? (block.items ?? []).join(' '), allClaims);
      assertDraftComponentBindings(block.text ?? (block.items ?? []).join(' '), [...byKey.values()]);
      assertDraftFunctionBinding(block.text ?? (block.items ?? []).join(' '), [...byKey.values()]);
      assertDraftParameterBindings(block.text ?? (block.items ?? []).join(' '), [...byKey.values()]);
      assertDraftCallbackBindings(block.text ?? (block.items ?? []).join(' '), [...byKey.values()]);
      if (strictTopics) assertDraftTopicBindings(block.text ?? (block.items ?? []).join(' '), [...byKey.values()]);
      continue;
    }
    const record = normalized ? bindings.find(b => b.blockIndex === blockIndex) : null;
    const keys = normalized ? record?.findingKeys : block.findingKeys;
    if (keys === undefined && !required) {
      assertSupportedDraftExplanations(block.text, allClaims);
      assertDraftComponentBindings(block.text, [...byKey.values()]);
      assertDraftFunctionBinding(block.text, [...byKey.values()]);
      assertDraftParameterBindings(block.text, [...byKey.values()]);
      assertDraftCallbackBindings(block.text, [...byKey.values()]);
      if (strictTopics) assertDraftTopicBindings(block.text, [...byKey.values()]);
      continue;
    }
    if (!Array.isArray(keys) || keys.length < 1 || keys.length > 16 || new Set(keys).size !== keys.length
      || keys.some(key => !byKey.has(key))) fail();
    const claims = keys.map(key => byKey.get(key));
    assertDraftComponentBindings(block.text, claims);
    assertDraftFunctionBinding(block.text, claims);
    assertDraftParameterBindings(block.text, claims);
    assertDraftCallbackBindings(block.text, claims);
    if (strictTopics) assertDraftTopicBindings(block.text, claims);
    for (const claim of claims) {
      const source = claim.relations.filter(r => r.relation === 'supports')
        .map(r => byId.get(r.evidenceId)).filter(Boolean).map(e => textOnlyDraftExcerpt(e.quoteText)).join(' ');
      assertSupportedDraftExplanations(claim.text, source);
    }
    keys.forEach(key => usedKeys.add(key));
    assertSupportedDraftExplanations(block.text, claims.map(f => f.text).join(' '));
    const ids = [...new Set(claims.flatMap(f => f.relations.filter(r => r.relation === 'supports')
      .map(r => r.evidenceId)))].sort();
    if (!ids.length || ids.some(id => !byId.has(id))) fail();
    const binding = { blockIndex, findingKeys: [...keys], evidence: ids.map(id => {
      const item = byId.get(id);
      return { id, quoteHash: item.quoteHash, pages: [...item.locator.pages] };
    }) };
    if (normalized && stableHash(binding) !== stableHash(record)) fail();
    seen.add(blockIndex); output.push(binding);
  }
  if (normalized && (bindings.length !== output.length || bindings.some(b => !seen.has(b.blockIndex)))) fail();
  const requiredKeys = requiredFindingKeys ?? plan.sections.flatMap(section => section.findingKeys);
  if (required && requiredKeys.some(key => !usedKeys.has(key))) {
    const error = new Error('AGENT_PAPER_ARTICLE_FINDING_COVERAGE_INSUFFICIENT');
    error.code = error.message; error.retryable = false; throw error;
  }
  return output;
}
