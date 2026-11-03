import { stableHash } from './researcher-qa-protocol/stable-json.mjs';

export const TEXT_DRAFT_NOTICE = '阅读范围：本文是仅依据可用正文生成的待审草稿，未核验复杂表格、公式及图示；不构成对实验数值、效果比较或推导的确认。发布前须人工核对原文。';
const STRUCTURAL_REASONS = new Set(['MULTI_COLUMN_LAYOUT', 'TABLE_STRUCTURE_UNSUPPORTED',
  'FORMULA_STRUCTURE_UNSUPPORTED', 'IMAGE_CONTENT_UNREAD']);
const fail = () => { const error = new Error('AGENT_PAPER_TEXT_DRAFT_INSUFFICIENT');
  error.code = error.message; error.retryable = false; throw error; };
// A scope notice does not make unsupported later historical impact acceptable.
const historicalImpact = /后来.{0,24}(?:成为|得到广泛应用)|影响深远|深远影响|奠定了.{0,12}基础|改变了.{0,12}格局/u;
// Only a complete, clause-initial caution about a generic model comparison is
// exempt. Arbitrary negation, concrete results and double negatives are not.
const comparisonDisclaimer = /(^|[。！？!?；;，,：:\n])\s*(?:不能|不可|不应)(?:直接)?(?:读成|解读为|理解为|视为)对(?:某种|某个|某一|该|这种|一种)?模型(?:全面|普遍|必然)?优于(?:其他|其它|现有|已有|所有其他)?模型的(?:定论|结论)(?=$|[。！？!?；;，,：:\n])/gu;
const ambiguousMaskDirection = text => /解码器|自回归|掩蔽/u.test(text)
  && (/向[左右].{0,8}(?:信息流|信息传递)/u.test(text)
    || [...text.matchAll(/(?:阻止|阻断|禁止|切断).{0,24}?(?:信息流|信息传递)/gu)]
      .some(match => !/后续|未来|未生成|尚未生成/u.test(match[0])));

// Co-use describes an observed arrangement, not an inability to work alone.
// This targets that known overreach; it is not a general entailment checker.
function assertsIndependentSequenceInability(text) {
  const denial = /(?:不能|无法|未能|不可能|不具备|而非|而不是|并非|不是|不)(?:能)?(?:独立|单独)(?:地)?[^。！？!?；;，,]{0,16}(?:序列建模|序列转换|序列转导)/gu;
  return [...String(text ?? '').matchAll(denial)].some(match => {
    const prefix = text.slice(0, match.index).split(/[。！？!?；;，,\n]/u).at(-1);
    const caution = /(?:不能|不可|不应|不要)(?:把|将|从)[^。！？；，,]{0,45}(?:理解为|改写成|推断为|推出|推断出|解读为)[^。！？；，,]{0,8}$|(?:并不|不)(?:意味着|代表|能说明|足以说明|能推出)[^。！？；，,]{0,8}$/u.exec(prefix);
    // Do not exempt a double negation that asserts the denied capability.
    return !caution || /(?:并非|不是|不能说|不代表|不意味着)\s*$/u.test(prefix.slice(0, caution.index));
  });
}

export function assertDraftCoUseScope(text, support) {
  if (!assertsIndependentSequenceInability(text)) return;
  const sourceSupportsInability = (String(support ?? '').match(/[^。！？!?；;\n]+/gu) ?? []).some(sentence =>
    !/可能|假设|是否|尚不清楚|没有证据|不能断定|不支持|(?:并非|不是)(?:不能|无法|未能)|(?:does\s+not|doesn't)\s+mean|\bnot\s+(?:claim|establish|imply)|\b(?:may|might|could|whether|hypothes\w*|uncertain)\b/iu.test(sentence)
    && (assertsIndependentSequenceInability(sentence)
      || /\b(?:cannot|can\s+not|unable\s+to)\s+(?:independently|alone)\s+(?:perform|carry\s+out)\s+sequence\s+(?:modeling|transduction)\b/iu.test(sentence)));
  if (!sourceSupportsInability) {
    const error = new Error('AGENT_PAPER_TEXT_DRAFT_UNSUPPORTED_EXPLANATION');
    error.code = error.message; error.retryable = false; throw error;
  }
}

export function assertSupportedDraftExplanations(text, support) {
  assertDraftGenerationDistinction(text, support);
  assertDraftCoUseScope(text, support);
  // A sequential-computation constraint does not by itself support a claim
  // about training parallelism. Require the relevant source statement, too.
  for (const [claim, source] of [
    [/顺序计算[^。！？]{0,20}(?:约束|限制)/u, /\bconstraint\s+of\s+sequential\s+computation\b|顺序计算[^。！？]{0,20}(?:约束|限制)/iu],
    [/训练[^。！？]{0,20}(?:无法|不能|不允许)[^。！？]{0,10}并行/u, /precludes\s+parallelization\s+within\s+training|训练[^。！？]{0,20}(?:无法|不能|不允许)[^。！？]{0,10}并行/iu],
  ]) {
    if (claim.test(text) && !source.test(support)) {
      const error = new Error('AGENT_PAPER_TEXT_DRAFT_UNSUPPORTED_EXPLANATION');
      error.code = error.message; error.retryable = false; throw error;
    }
  }
  for (const topic of [/加权(?:组合|求和|和)|对值.{0,6}加权|weighted\s+(?:sum|combination)/iu,
    /正则化|regulari[sz]ation/iu, /非线性|non[- ]?linear/iu, /辅助(?:组件|机制|角色|作用|手段)/u,
    /单层.{0,12}(?:全局依赖|全局联系|所有位置)/u,
    /残差连接.{0,18}(?:有助于|帮助|促进).{0,18}(?:信息|特征).{0,18}(?:传递|流动|提取)/u,
    /(?:逐步)?提取(?:输入序列的)?特征/u,
    /注意力(?:机制)?(?:本身)?.{0,8}对顺序不敏感/u]) {
    if (topic.test(text) && !topic.test(support)) {
      const error = new Error('AGENT_PAPER_TEXT_DRAFT_UNSUPPORTED_EXPLANATION');
      error.code = error.message; error.retryable = false; throw error;
    }
  }
  const architecturePurpose = /(?:解释|说明|阐明).{0,12}(?:为何|为什么).{0,12}(?:注意力|自注意力).{0,12}(?:而非|代替|取代|替代)循环/u;
  const purposeSupport = (support.match(/[^。！？!?；;]+/gu) ?? []).some(sentence =>
    !/未|没有|不曾|并非|不是|不能|不应|可能|假设/u.test(sentence)
    && /(?:为何|为什么|因为|为了|原因|因此|目的是).{0,48}(?:注意力|自注意力).{0,20}(?:而非|代替|取代|替代)循环|(?:注意力|自注意力).{0,20}(?:而非|代替|取代|替代)循环.{0,32}(?:因为|为了|目的是|原因)/u.test(sentence));
  if (architecturePurpose.test(text) && !purposeSupport) {
    const error = new Error('AGENT_PAPER_TEXT_DRAFT_UNSUPPORTED_EXPLANATION');
    error.code = error.message; error.retryable = false; throw error;
  }
  // This detects a known unsupported explanation, not arbitrary entailment.
  const topic = /过拟合|拟合过度|overfitting/iu;
  const purpose = /(?:控制|防止|避免|减少|缓解|抑制|prevent\w*|avoid\w*|reduc\w*|control\w*|mitigat\w*).{0,35}(?:过拟合|拟合过度|overfitting)/iu;
  const declaresPurpose = purpose.test(text);
  const method = /dropout|随机失活|丢弃法/iu;
  const sourceSupportsPurpose = (support.match(/[^.!?。！？;；]+[.!?。！？;；]?/gu) ?? []).some(sentence =>
    purpose.test(sentence)
    && !/\b(?:not|never|no|without|may|might|could|whether|hypothesis)\b|未|没有|不|尚未|可能|假设/iu.test(sentence)
    && (!method.test(text) || method.test(sentence)));
  if (topic.test(text) && (!topic.test(support) || (declaresPurpose && !sourceSupportsPurpose))) {
    const error = new Error('AGENT_PAPER_TEXT_DRAFT_UNSUPPORTED_EXPLANATION');
    error.code = error.message; error.retryable = false; throw error;
  }
}

export function assertDraftGenerationDistinction(text, support) {
  // Detect a known architecture/generation confusion, not arbitrary entailment.
  // Explicitly supported non-autoregressive papers remain valid. Parallel
  // training or encoder computation is not itself a claim about generation.
  const split = value => String(value ?? '').split(/[。！？!?；;，,\n]/u);
  const caution = prefix => {
    const match = /(?:不能|不应|不可)(?:把|将)[^，。；]{1,32}(?:理解为|理解成|视为|等同于)[^，。；]{0,4}$|(?:不能|不应|不可)(?:直接)?(?:理解为|理解成|视为|等同于)[^，。；]{0,4}$|(?:并不|不)(?:意味着|等于|代表|说明)[^，。；]{0,4}$|(?:并未|未|没有|并没有)(?:把|将)[^，。；]{1,32}(?:等同于|视为|理解为|理解成)[^，。；]{0,4}$/u.exec(prefix);
    // A negative explanation is allowed, but a negation of that explanation
    // must not turn a positive non-autoregressive assertion into an exemption.
    return !!match && !/(?:并非|不是|不能说|不代表|不意味着)\s*$/u.test(prefix.slice(0, match.index));
  };
  const nonAutoregressive = /非自回归|\bnon[- ]autoregressive\b/giu;
  const sequentialDenial = /(?:模型|输出|生成过程)[^。！？；，,]{0,10}(?:不再|无需|不必|不用)(?:按顺序|按步骤|逐步|一步一步|顺序地|依次){1,3}(?:处理序列|生成|产生|输出)|(?:输出|生成过程)(?:没有|不存在)(?:先后|顺序|步骤)/gu;
  const positive = (clause, pattern) => [...clause.matchAll(pattern)].some(match =>
    !caution(clause.slice(0, match.index))
    && !/(?:并非|不是)(?:一个|一种)?\s*$|\b(?:not|never|no|without)(?:\s+\w+){0,3}\s*$/iu.test(clause.slice(0, match.index)));
  const explicitSupport = split(support).some(clause =>
    !/假设|如果|可能|\b(?:may|might|could|whether)\b/iu.test(clause)
    && positive(clause, nonAutoregressive));
  if (explicitSupport) return;
  const unsupported = split(text).some(clause => positive(clause, nonAutoregressive)
    || (positive(clause, sequentialDenial)
      && !(/训练|编码器/u.test(clause) && !/生成|输出/u.test(clause))));
  if (unsupported) {
    const error = new Error('AGENT_PAPER_TEXT_DRAFT_GENERATION_CONFLATION');
    error.code = error.message; error.retryable = false; throw error;
  }
}

export function textOnlyDraftExcerpt(text) {
  // Intake chunks may start/end in a sentence. Send only bounded complete
  // sentences, retaining the original evidence row/hash for the audit trail.
  let source = text;
  let omittedPrevious = false;
  if (/^\p{Ll}/u.test(source)) {
    source = source.replace(/^.*?[.!?。！？](?:\s|$)/u, '');
    omittedPrevious = true;
  }
  const sentences = source.match(/.+?[.!?。！？](?=\s|$)/gsu) ?? [];
  let result = '';
  for (const sentence of sentences) {
    // Reference numbers are not measurements. Other digits (including model
    // names and hyperparameters) keep the whole sentence outside this mode.
    const withoutReferences = sentence.replace(/\[\d+(?:\s*,\s*\d+)*\]/gu, '');
    if (/\d|%|百分|百分点/u.test(withoutReferences)) { omittedPrevious = true; continue; }
    if (/[=∑∫√±×÷≤≥≈∞∂∇−{}<>\\^|]/u.test(sentence)
      // Spatial direction depends on diagram/convention context. Omit the
      // complete sentence rather than translate it into a guessed time order.
      || /\b(?:leftward|rightward|left-to-right|right-to-left)\b.{0,32}\binformation\s+flow\b/iu.test(sentence)
      || /向[左右].{0,12}(?:信息流|信息传递)/u.test(sentence)
      || /\b(?:results|experiments)\b.{0,40}\b(?:show\w*|demonstrat\w*|confirm\w*|achiev\w*|indicat\w*|suggest\w*)\b/iu.test(sentence)
      || /state.of.the.art|significant|\b(?:improv\w*|outperform\w*|performance|faster|hours|gpus|accuracy|bleu|operations|complexity|resolution|expensive|superior|best|perplexit\w*)\b|\b(?:This makes it|by a factor|sequence length|kernel size|representation dimension|d\s+(?:model|k|v)|h times)\b|\b(?:O|LayerNorm|Sublayer|softmax)\s*\(/iu.test(sentence)) {
      omittedPrevious = true; continue;
    }
    if (omittedPrevious && /^\s*(?:(?:This|These|Those|It|They|Such|Therefore|Thus|Hence|Consequently|As a result|For this reason)\b|因此|因而|这表明|这说明|由此可见|这些结果|这一结果)/iu.test(sentence)) continue;
    if (result.length + sentence.length + 1 > 1200) break;
    result += `${result ? ' ' : ''}${sentence.trim()}`;
    omittedPrevious = false;
  }
  return result;
}

export function isTextOnlyDraftQuality(paper) {
  const m = paper.metrics_json;
  return paper.reliability_grade === 'limited-text'
    && stableHash(paper.permitted_uses) === stableHash(['analysis'])
    && Array.isArray(paper.reason_codes) && paper.reason_codes.length > 0
    && paper.reason_codes.every(reason => STRUCTURAL_REASONS.has(reason))
    && m?.textCoverageBp === 10000 && m?.evidenceCoverageBp === 10000
    && m?.orderRiskPageCount === 0 && m?.emptyPageCount === 0
    && m?.scannedPageCount === 0 && m?.lowDensityPageCount === 0;
}

export function isNarrativeDraftEvidence(item) {
  const text = item?.quoteText;
  const ids = item?.locator?.blockIds;
  const literalContinuation = Array.isArray(ids) && ids.length === 2
    && /^Each layer (?:has|contains|comprises) (?:two|three|several) sub-layers\./u.test(text ?? '')
    && ids.every(id => /^p\d+-b\d+$/u.test(id))
    && ids[0].split('-b')[0] === ids[1].split('-b')[0]
    && Number(ids[1].split('-b')[1]) === Number(ids[0].split('-b')[1]) + 1;
  if (typeof text !== 'string' || text.length < 160 || text.length > 12000
    || stableHash(text) !== item.quoteHash || !item.allowedUses?.includes('analysis')
    || item.locator?.kind !== 'paper.layout' || !Array.isArray(item.locator.pages)
    || item.locator.pages.length !== 1 || !Number.isSafeInteger(item.locator.pages[0])
    || item.locator.pages[0] < 1 || !Array.isArray(item.locator.blockIds)
    || (item.locator.blockIds.length !== 1 && !literalContinuation) || item.locator.objectLabel != null) return false;
  // Archived intakes may contain page chunks instead of isolated paragraphs.
  // Discard mixed chunks in their entirety; never relabel all PDF text as prose.
  if (/[=∑∫√±×÷≤≥≈∞∂∇_{}<>\\^|\uFFFD\u0000-\u0008]/u.test(text)
    || /^\s*Type\s+Sentence\b/iu.test(text)
    || ((text.match(/\bOur model\b/giu)?.length ?? 0) >= 2 && /\bTruth\b/iu.test(text))
    || /\b(?:table|figure|fig\.?|equation|eq\.?|appendix|references|bibliography|bleu|accuracy|benchmark|outperform|arxiv|conference)\b/iu.test(text)
    || /work performed|author contributions|acknowledg/iu.test(text)
    || /(?:公式|参考文献|表\s*\d|图\s*\d|百分点|准确率)/u.test(text)
    || (text.match(/\d/gu)?.length ?? 0) / text.length > .025
    || (text.match(/[.!?。！？](?:\s|$)/gu)?.length ?? 0) < 1
    || textOnlyDraftExcerpt(text).length < 120) return false;
  return true;
}

export function selectTextOnlyDraftEvidence(evidence, paper) {
  if (!isTextOnlyDraftQuality(paper)) fail();
  const selected = evidence.filter(isNarrativeDraftEvidence);
  if (selected.length < 2 || selected.reduce((n, item) => n + textOnlyDraftExcerpt(item.quoteText).length, 0) < 1200) fail();
  const readingScope = {
    schemaVersion: 'paper-text-only-draft-scope-v1', mode: 'text-only-draft',
    originalGrade: 'limited-text', reasonCodes: [...paper.reason_codes],
    parseAssessmentSha256: paper.assessment_sha256, layoutSha256: paper.layout_sha256,
    selectedEvidence: selected.map(item => ({ id: item.id, quoteHash: item.quoteHash,
      ...(item.locator.sectionPath?.length || item.locator.blockIds.length > 1 ? { locatorSha256: stableHash(item.locator) } : {}) })),
    manualReviewRequired: true, publicPublicationEnabled: false,
  };
  return { evidence: selected.map((item, i) => ({ ...item, index: i + 1 })), readingScope };
}

export function validateTextOnlyDraftScope(scope, evidence) {
  if (!scope || scope.schemaVersion !== 'paper-text-only-draft-scope-v1'
    || Object.keys(scope).some(key => !['schemaVersion', 'mode', 'originalGrade', 'reasonCodes',
      'parseAssessmentSha256', 'layoutSha256', 'selectedEvidence', 'manualReviewRequired', 'publicPublicationEnabled'].includes(key))
    || scope.mode !== 'text-only-draft' || scope.originalGrade !== 'limited-text'
    || scope.manualReviewRequired !== true || scope.publicPublicationEnabled !== false
    || !/^[a-f0-9]{64}$/u.test(scope.parseAssessmentSha256 ?? '')
    || !/^[a-f0-9]{64}$/u.test(scope.layoutSha256 ?? '')
    || !Array.isArray(scope.reasonCodes) || !scope.reasonCodes.length
    || new Set(scope.reasonCodes).size !== scope.reasonCodes.length
    || scope.reasonCodes.some(reason => !STRUCTURAL_REASONS.has(reason))
    || !Array.isArray(scope.selectedEvidence) || scope.selectedEvidence.length < 2
    || scope.selectedEvidence.length > 96
    || new Set(scope.selectedEvidence.map(item => item.id)).size !== scope.selectedEvidence.length
    || scope.selectedEvidence.some(item => !/^[a-f0-9-]{36}$/iu.test(item.id ?? '')
      || Object.keys(item).some(key => !['id', 'quoteHash', 'locatorSha256'].includes(key))
      || !/^[a-f0-9]{64}$/u.test(item.quoteHash ?? '')
      || (Object.hasOwn(item, 'locatorSha256') && !/^[a-f0-9]{64}$/u.test(item.locatorSha256)))
    || evidence.some(item => !isNarrativeDraftEvidence(item)
      || !scope.selectedEvidence.some(bound => bound.id === item.id && bound.quoteHash === item.quoteHash
        && (bound.locatorSha256 ? bound.locatorSha256 === stableHash(item.locator)
          : !(item.locator.sectionPath?.length > 0 || item.locator.blockIds.length > 1))))) fail();
  return structuredClone(scope);
}

export function assertTextOnlyDraftFindings(findings) {
  if (!Array.isArray(findings) || !findings.some(item => item.kind === 'author_claim')
    || findings.some(item => !['author_claim', 'unknown'].includes(item.kind)
      || historicalImpact.test(item.text ?? '')
      || /\d|百分|百分点|倍于|优于|超过|最好|显著提升|操作数|计算复杂度|时间复杂度|空间复杂度|outperform|accuracy|bleu/iu.test(item.text ?? ''))) fail();
}

export function assertTextOnlyDraftFindingContext(findings, evidence) {
  const insufficient = () => { const error = new Error('AGENT_PAPER_TEXT_DRAFT_CONTEXT_INSUFFICIENT');
    error.code = error.message; error.retryable = false; throw error; };
  for (const finding of findings) {
    if (finding.kind !== 'author_claim') continue;
    if (ambiguousMaskDirection(finding.text)) insufficient();
    const supports = new Set(finding.relations.filter(r => r.relation === 'supports')
      .map(r => r.evidenceIndex));
    const context = evidence.filter(e => supports.has(e.index)).map(e => {
      const label = e.locator.sectionPath?.at(-1) ?? '';
      // A broad heading such as "Encoder and Decoder Stacks" names both
      // components but does not identify the subject of a clipped paragraph.
      return `${textOnlyDraftExcerpt(e.quoteText)} ${/^(?:Encoder|Decoder)$/iu.test(label) ? label : ''}`;
    }).join(' ');
    assertSupportedDraftExplanations(finding.text, context);
    assertDraftEncoderLayerScope(finding.text, context);
    for (const [subject, source] of [[/编码器/u, /\bencoder\b|编码器/iu],
      [/解码器/u, /\bdecoder\b|解码器/iu]]) {
      if (subject.test(finding.text) && !source.test(context)) insufficient();
    }
  }
}

export function assertDraftEncoderLayerScope(text, support) {
  const layer = /编码器(?:的|内|中)?[，,]?\s*(?:每一?层|各层|每个层|层内|层中|层(?=包含|包括|由|有|具|采用))/u;
  const twoSubLayers = /编码器[^。！？]{0,80}(?:两个|两|二个)子层/u.test(text);
  const wholeParts = /编码器(?:整体)?由[^。！？]{0,45}自注意力[^。！？]{0,45}前馈[^。！？]{0,18}组成|编码器(?:整体)?(?:只有|仅有|仅包含)[^。！？]{0,50}子层/u.test(text);
  const perLayer = layer.test(text);
  if (!twoSubLayers && !wholeParts && !(perLayer && /子层|自注意力|前馈/u.test(text))) return;
  const sourcePerLayer = layer.test(support)
    || /Each layer (?:has|contains|comprises) (?:two|three|several) sub-layers/iu.test(support);
  const sourceWhole = /\b(?:the\s+)?encoder\s+(?:consists\s+of|comprises|contains)\s+(?:two|three)\s+sub-layers/iu.test(support);
  if (perLayer ? !sourcePerLayer : sourcePerLayer || !sourceWhole) {
    const error = new Error('AGENT_PAPER_TEXT_DRAFT_HIERARCHY_INSUFFICIENT');
    error.code = error.message; error.retryable = false; throw error;
  }
}

export function textOnlyDraftWritingPlan(evidence) {
  const claims = evidence.findings.filter(item => item.kind === 'author_claim');
  const claimCount = new Set(claims.map(item => item.text.trim())).size;
  const supportingIds = new Set(claims.flatMap(item => item.relations
    .filter(relation => relation.relation === 'supports').map(relation => relation.evidenceId)));
  const supporting = evidence.evidence.filter(item => supportingIds.has(item.id));
  const pages = new Set(supporting.flatMap(item => item.locator.pages));
  const sourceCharacters = supporting.reduce((total, item) =>
    total + textOnlyDraftExcerpt(item.quoteText).length, 0);
  // A longer prompt cannot manufacture missing evidence. Keep sparse archived
  // analyses usable as brief notes instead of padding them to article length.
  const expanded = claimCount >= 6 && pages.size >= 3 && sourceCharacters >= 4500;
  const sections = [];
  if (expanded) {
    const count = Math.min(7, Math.max(4, Math.ceil(claimCount / 4)));
    const unique = [...new Map(claims.map(item => [item.text.trim(), item])).values()];
    // Bring an extracted, supported research problem forward, even when the
    // model returned it after the methods. Never manufacture a missing claim.
    unique.sort((a, b) => Number(draftClaimNarrativeRole(b.text) === 'research-problem')
      - Number(draftClaimNarrativeRole(a.text) === 'research-problem'));
    for (let i = 0; i < count; i += 1) {
      const group = unique.slice(Math.floor(i * unique.length / count), Math.floor((i + 1) * unique.length / count));
      // Give every paragraph new material instead of asking a third paragraph
      // to summarize the same group again. Relations may still cite other keys.
      const paragraphCount = Math.min(3, group.length);
      const paragraphKeys = Array.from({ length: paragraphCount }, (_, index) =>
        group.slice(Math.floor(index * group.length / paragraphCount),
          Math.floor((index + 1) * group.length / paragraphCount)));
      sections.push({ key: `section-${String(i + 1).padStart(2, '0')}`,
        findingKeys: group.map(item => item.key), minimumParagraphs: 1,
        paragraphs: paragraphKeys.map((items, index) => ({
          focus: 'explain-distinct-claims-without-recap',
          findingKeys: items.map(item => item.key),
          developmentTasks: ['用连贯中文解释已有事实，不输出写作步骤或主张分类', '把术语放回已核验的具体信息来源、操作或位置关系中讲清楚',
            '需要衔接其他部件时直接说明有依据的联系，并重新绑定；没有依据则自然转入下一事实'],
        })) });
    }
  }
  return { schemaVersion: 'paper-text-draft-writing-plan-v1',
    scopeNoticeHandledByServer: true,
    authorAttributionRequiredPerParagraph: true,
    depth: expanded ? 'expanded' : 'brief', lengthPolicy: 'content-first-v1',
    sections, paragraphFindingKeysRequired: expanded,
    qualityPriorities: ['讲清提供的核心主张', '解释有证据支持的概念和关系', '逐段事实可追溯', '保留阅读范围与人工审核'],
    supportedClaimCount: claimCount, sourcePageCount: pages.size, sourceCharacters };
}

export function draftClaimNarrativeRole(text) {
  if (/研究问题|研究动机|面临.{0,12}(?:问题|挑战|约束)|顺序计算.{0,20}(?:约束|限制)/u.test(text)) return 'research-problem';
  if (/提出[^。！？]{0,90}(?:架构|方法|模型)|propos\w*.{0,90}(?:model|method|architecture)/iu.test(text)) return 'proposal';
  if (/自回归|先前生成/u.test(text)) return 'generation-order';
  if (/查询|键值|来自|位置编码|掩蔽/u.test(text)) return 'method-relation';
  return 'supported-fact';
}

export function textOnlyDraftReadingGuide(evidence) {
  // These are navigation hints over the exact safe excerpts, not extra facts
  // or mandatory conclusions. The model must still supply supported findings.
  const excerpts = evidence.map(e => ({ index: e.index, text: textOnlyDraftExcerpt(e.quoteText) }));
  return {
    schemaVersion: 'paper-text-draft-reading-guide-v1', candidateEvidenceOnly: true,
    researchProblemEvidenceIndexes: excerpts.filter(e => /\b(?:constraint|challenge|problem|limitation)s?\b|研究问题|研究动机|约束|挑战/iu.test(e.text)).map(e => e.index),
    methodRelationEvidenceIndexes: excerpts.filter(e => /\b(?:come\s+from|comes\s+from|in\s+order\s+to|to\s+this\s+end|combined\s+with|depend\s+only)\b|来自|为此|结合|依赖/iu.test(e.text)).map(e => e.index),
    instruction: '先核对候选正文中的研究问题，再提取方法与明确关系。候选索引只指示阅读位置，不证明任何结论；无明确依据时不提取。顺序计算约束不自动支持训练无法并行、性能收益或作者选择某方法的因果解释。',
  };
}

export function assertTextOnlyDraftComposition(content) {
  const blocks = content.blocks.filter(block => ['paragraph', 'list'].includes(block.type));
  // Headings can carry factual claims too; author attribution is only required
  // in prose/list items, so neutral section labels remain valid.
  const fields = [content.title, content.summary, ...content.blocks.flatMap(b => b.items ?? [b.text])];
  const text = fields.join(' ');
  // This is a validation-only copy, evaluated per field to prevent a disclaimer
  // in one block from excusing a positive claim in another. Keep stored text.
  const comparisonText = fields.map(value => String(value ?? '').replace(comparisonDisclaimer,
    match => match.replace('优于', '[比较]'))).join(' ');
  if (historicalImpact.test(text)
    || fields.some(value => ambiguousMaskDirection(String(value ?? '')))
    || /\d|百分|百分点|操作数|计算复杂度|时间复杂度|空间复杂度|outperform|accuracy|bleu/iu.test(text)
    || /倍于|优于|超过|最好|显著提升/iu.test(comparisonText)
    || blocks.some(block => !(block.items ?? [block.text]).every(value => value === TEXT_DRAFT_NOTICE
      || /作者|论文|文中/u.test(value)))) fail();
}

export function assertTextOnlyDraftProseClarity(value) {
  const text = String(value ?? '');
  // A statement explicitly bounded to the material visible in this reading is
  // different from a claim that the paper itself omitted the subject. Inspect
  // each negative clause so one scoped caveat cannot excuse another assertion.
  // Only locatives/adverbs may intervene between the negation and its verb.
  // "没有改变结构，论文继续讨论" is not a denial of discussion.
  const absence = /(?:(?:论文|原文|作者|文中)[^。！？!?；;]{0,20}|(?:这一|这条|该|上述)(?:描述|定义|主张|说明)(?:本身)?[^。！？!?；;]{0,64}|(?:定义|主张|描述)本身[^。！？!?；;]{0,32})(?:没有|并未|未曾|尚未|未)((?:(?:在[^，,。！？!?；;]{1,14}?(?:之间|之外|之中|范围内|中|内|处|里))|直接|明确|额外|具体|详细|完整|充分|进一步|专门|系统|清楚|仔细|深入|正面|曾经|再|还){0,3})(?:讨论|提及|涉及|解释|说明|说|提供|给出|展开|详述|阐述)/gu;
  const scope = /(?:本次|此次)(?:可见|读取|选取|阅读|提供|筛选|选入).{0,6}(?:范围|正文|证据|材料)/u;
  const negativeDescription = /(?:论文|原文|作者|文中)([^。！？!?；;]{0,35}?)(?:没有|并未|未曾|尚未|未)(?:直接|明确|曾经)?(?:把|将)[^。！？!?；;，,]{1,40}(?:描述为|描述成|表述为|写成|称为|界定为)/gu;
  const unboundedAbsence = [...text.matchAll(absence), ...text.matchAll(negativeDescription)].some(match => !scope.test(match[1]));
  // Reject ambiguous references, rather than pretending to infer whether their
  // antecedents were reversed. Authors should name the two objects explicitly.
  const code = /前者|后者|\b(?:former|latter)\b/iu.test(text)
    ? 'AGENT_PAPER_ARTICLE_AMBIGUOUS_REFERENCE'
    : unboundedAbsence
      ? 'AGENT_PAPER_ARTICLE_SOURCE_ABSENCE_UNSUPPORTED' : null;
  if (code) { const error = new Error(code); error.code = code; error.retryable = false; throw error; }
}
