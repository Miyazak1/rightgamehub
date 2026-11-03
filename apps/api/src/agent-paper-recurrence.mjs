// A bounded lexical signal, not semantic entailment. Preserve the original
// matched wording for input projection and distinguish an outer denial from
// a genuinely recurrence-free assertion.
const expression = /无循环|不(?:再)?(?:用|含|包含|含有|使用|采用|采纳|依赖|靠)(?:了)?循环(?:(?:神经)?网络|结构)?|(?:没有|并未|未)(?:使用|采用|包含)(?:了)?循环(?:(?:神经)?网络|结构)?|(?:放弃|摒弃|避开|绕开|舍弃|去除)(?:了)?循环(?:(?:神经)?网络|结构)?|而非循环(?:(?:神经)?网络|结构)?|以注意力(?:机制)?(?:代替|替代|取代)(?:了)?循环(?:(?:神经)?网络|结构)?/giu;

export function recurrenceFreeMentions(value) {
  const text = String(value ?? ''), result = [];
  for (const match of text.matchAll(expression)) {
    const prefix = text.slice(0, match.index).split(/[。！？!?；;\n]/u).at(-1);
    const suffix = text.slice(match.index + match[0].length);
    // Circular dependencies and a location inside a loop are different claims.
    // Do not bridge arbitrary intervening words to manufacture an alias.
    if (/^(?:中的|内的|里的|依赖|引用|队列|语句|次数|条件)/u.test(suffix)
      || /(?:是否|能否|如果|假如|若|可能|或许)[^。！？!?；;]{0,18}$/u.test(prefix)) continue;
    const denied = /(?:并非|并不是|不是|没有|并未|未|不|不能|无法|未能|不曾)(?:真正|成功|完全|再|已经)?\s*$/u.test(prefix);
    result.push({ text: match[0], polarity: denied ? 'denied' : 'asserted' });
  }
  return result;
}

export function recurrenceFreeFacet(text) {
  return recurrenceFreeMentions(text).find(m => m.polarity === 'asserted')?.text ?? null;
}

export const recurrenceFreeSignal = Object.freeze({ test: text => recurrenceFreeFacet(text) !== null });
