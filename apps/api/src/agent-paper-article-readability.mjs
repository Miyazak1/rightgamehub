const fail = code => { const e = new Error(code); e.code = code; e.retryable = false; throw e; };
const clean = text => text.replace(/[\p{P}\p{Z}\s]/gu, '');

// Literal subjects are planning hints, not replacement prose or new findings.
// In particular, keep a proposed method as the grammatical object being
// explained rather than repeatedly making its authors the sentence subject.
export function paragraphStatementSubjects(claims) {
  return claims.map((claim, i) => {
    const text = claim.text.replace(/^(?:论文作者|作者|论文|文中)(?:指出|说明|表示|认为)?[，,:：]?\s*/u, '');
    let subject = null;
    if (claim.narrativeRole === 'proposal') {
      const proposed = text.match(/(?:提出|介绍|构建|设计)(?:了)?\s*(.{2,80})/u)?.[1];
      if (proposed) {
        subject = proposed.match(/^(?:名为|称为)?[“「"]([^”」"]{2,30})[”」"]/u)?.[1]
          ?? proposed.match(/^([A-Za-z][A-Za-z0-9 .-]{0,50}?)(?=[，,。：:；;]|$)/u)?.[1]?.trim()
          ?? proposed.match(/^([^，,。；;]{2,40}?(?:模型|架构|框架|方法|系统|机制|方案|算法))/u)?.[1]
          ?? null;
      }
    } else {
      subject = text.match(/^([\p{Script=Han}A-Za-z][\p{Script=Han}A-Za-z0-9 -]{1,24}?)(?=通常|一般|已成为|成为|面临|存在|需要|受到|只|仅|允许|可以|能够|沿|在|是|包含|使用|采用|通过)/u)?.[1]?.trim() ?? null;
    }
    if (subject && !claim.text.includes(subject)) subject = null;
    return { claimPosition: i + 1, subject, narrativeRole: claim.narrativeRole,
      attribution: '论文作者', ...(claim.narrativeRole === 'proposal' ? { attributionForm: '对象的提出者归属，不以作者提出另起报告句' } : {}) };
  });
}

// Resolve a relation paragraph's opening from its visible primary fact only.
// Scope phrases are literal source spans; never borrow an object from another
// paragraph or expand a narrowed reference into its full architecture claim.
export function paragraphRelationSubjectPlan(claims, primaryClaimIndexes) {
  if (!claims.some(c => c.narrativeRole === 'method-relation')) return null;
  const steps = paragraphStatementSubjects(claims).map((step, i) => {
    const text = claims[i].text.replace(/^(?:论文作者|作者|论文|文中)(?:指出|说明|表示|认为)?[，,:：]?\s*/u, '');
    const scope = text.match(/^在([^，,。；;]{2,40}?)(?:中|内)[，,]/u)?.[1];
    const subject = scope ?? step.subject;
    return { ...step, subject: subject && claims[i].text.includes(subject) && !/^(?:这里|此处|其中|这|那|该|其|上述|前述|前者|后者)/u.test(subject) ? subject : null };
  });
  const opening = steps[primaryClaimIndexes[0] - 1]?.subject;
  if (!opening) return null;
  return { kind: 'component-relations', openingObject: opening, steps,
    instruction: '以 openingObject 这个本段主张中的字面对象起句，直接说明其连接、来源或范围；论文归属自然融入同一句的句中或句末，不以作者说明或按作者的说明作开场。其他对象逐项按所给事实转接，不用前者后者，不把来源、位置或组成关系改成作用或因果。subject 为 null 时保留原文明确对象，不猜补。' };
}

export function paragraphVoicePolicy(section) {
  return { opening: section.ordinal === 0 || section.topic === 'outlook' ? 'flexible' : 'object-first',
    ...(section.editorialVersion >= 2 ? { attributionScope: 'one-paper-per-paragraph', maxReportingStarts: 1,
      naturalAttribution: { instruction: '归属说明来源，不把作者当作描述发生的地点。以具体对象说明事实，将论文中、文中或作者提出的等归属融入同一句；定义保持作者定义的范围，方案保留提出关系，计划保留未来语气。一次归属可统领本段同源事实，不逐句更换报告套语，不删除归属以求流畅。',
        avoid: ['在论文作者那里被描述为', '在作者那儿被定义为', '在作者那边被解释为'] },
      reportingInstruction: '一次论文归属可统领本段同源事实；全段最多一处以作者或论文为主语的报告式分句，其他分句直接用具体对象说明。不能删除必要归属、未来计划或范围限定，不用代词替代不明对象。' } : {}),
    instruction: '先写本段具体对象，论文归属自然放入句中或句末；不要把作者说明当成每段固定起句，不能省略归属' };
}

export function paragraphOpeningObject(section, primaryClaims) {
  if (section.topic !== 'position-output') return null;
  const text = primaryClaims.map(c => c.text).join('。');
  // Prefer the operation being explained over another object mentioned as its
  // input (e.g. dropout applied to the sum of embeddings and position encodings).
  const dropout = text.match(/dropout|随机失活/iu);
  if (dropout) return dropout[0];
  return text.includes('位置编码') ? '位置编码' : null;
}

export function paragraphComponentRelations(claims, evidence) {
  const addition = claims.some(claim => {
    const finding = evidence.findings.find(f => f.key === claim.findingKey);
    return finding?.relations.some(r => r.relation === 'supports' &&
      /in addition to attention sub[- ]layers,[^.!?]{0,80}encoder and decoder[^.!?]{0,30}contains? a fully connected feed[- ]forward network/iu
        .test(evidence.evidence.find(e => e.id === r.evidenceId)?.quoteText.replace(/\s+/gu, ' ') ?? ''));
  });
  return addition ? [{ relation: 'additional-component', existing: '注意力子层', additional: '全连接前馈网络',
    scope: '编码器和解码器的每层',
    instruction: '说明同一层在注意力子层之外还包含前馈网络；这是附加组成关系，不把注意力子层当作每层这一范围的例外' }] : [];
}

export function assertParagraphComponentAddition(text, claims, evidence) {
  if (!paragraphComponentRelations(claims, evidence).length) return;
  if (/注意力子层[，,\s]*(?:除外|不在此列|不包括在内)|(?:除|除了)注意力子层(?:外|之外)[^。！？；;]{0,12}(?:其余|其他)(?:各)?层[^。！？；;]{0,30}前馈网络/u.test(text)) {
    fail('AGENT_PAPER_ARTICLE_COMPONENT_ADDITION_MISSTATED');
  }
}

export function assertParagraphVoice(text, policy) {
  // Only reject the figurative location + reporting frame, not literal places,
  // legitimate passive constructions, or attributed author opinions.
  if (policy.naturalAttribution && /在(?:论文)?作者(?:那里|那儿|那边)(?:被)?(?:描述|定义|说明|表述|理解|解释)(?:为|成)/u.test(text)) {
    fail('AGENT_PAPER_ARTICLE_AWKWARD_ATTRIBUTION');
  }
  if (policy.maxReportingStarts === 1) {
    const starts = [...text.matchAll(/(?:^|[。！？!?；;，,：:])\s*(?:(?:但|而|同时|随后|此外|不过)[，,]?\s*)?(?:论文作者|作者|论文|文中)(?:还|也|同时|进一步|明确|则)?(?:(?:指出|说明|表示|提出|定义|采用|使用|强调|认为|计划|总结|描述)(?!的)|在|将|把)/gu)];
    if (starts.length > 1) fail('AGENT_PAPER_ARTICLE_REPETITIVE_REPORTING_CLAUSES');
  }
  if (policy.opening !== 'object-first') return;
  if (/^(?:论文作者|作者|论文|文中)(?:指出|说明|表示|提出|计划|总结|将|把|对|使用|采用|定义|界定|描述)(?!的)|^(?:按|据|根据|按照)(?:论文)?作者(?:的)?(?:说明|表述)|^在论文中[，,]/u.test(text.trim())) {
    fail('AGENT_PAPER_ARTICLE_REPETITIVE_AUTHOR_OPENING');
  }
}

export function assertSummaryOpeningSeparation(summary, opening, primaryCount) {
  // Shared terminology and a short main-idea excerpt are legitimate. Refuse a
  // near-complete retelling only when the opening actually has multiple facts.
  if (primaryCount <= 1) return;
  const a = clean(summary), b = clean(opening);
  if (a.length < 20 || b.length < 20 || a.length / b.length < 0.7) return;
  const grams = Array.from({ length: b.length - 5 }, (_, i) => b.slice(i, i + 6));
  if (grams.filter(g => a.includes(g)).length / grams.length >= 0.7) {
    fail('AGENT_PAPER_ARTICLE_SUMMARY_OPENING_DUPLICATE');
  }
}

export function assertArchitectureContextTransition(text, hasArchitectureContext) {
  if (!hasArchitectureContext) return;
  for (const sentence of text.split(/[。！？!?；;]/u)) {
    if (/(?:作者|论文)(?:还|同时|也)?提出(?:了)?[^。！？；]{0,8}(?:放弃|摒弃|不采用|不使用|避开)循环/u.test(sentence)
      && !/模型|架构/u.test(sentence)) fail('AGENT_PAPER_ARTICLE_CONTEXT_TRANSITION_INVALID');
  }
}

export function assertParagraphDesignCausality(text, claims) {
  for (const sentence of text.split(/[。！？!?；;\n]/u).filter(Boolean)) {
    const links = [...sentence.matchAll(/(?:据此|因此|因而|为此|所以|从而|由此|在此基础上|基于(?:上述|这些|这一|该|此))[^。！？；;]{0,30}?(?:提出|选择|设计|构建|采用)|(?:为了|为解决)[^。！？；;]{0,45}?(?:提出|选择|设计|构建|采用)/gu)];
    for (const link of links) {
      // A nearby problem and proposal are insufficient. An explicit design
      // relation must be present in one assigned claim, not assembled across them.
      if (!claims.some(c => clean(c.text).includes(clean(sentence)))) fail('AGENT_PAPER_ARTICLE_DESIGN_CAUSALITY_UNSUPPORTED');
    }
  }
}
