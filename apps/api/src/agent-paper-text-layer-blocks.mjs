// Preserve PDF item order. Geometry is used only to stop paragraphs, never to
// invent a reading order or reconstruct a table, formula or figure.
export function paragraphTextLayerBlocks(items, { page, width, height, maxChars = 1800 }) {
  const visible = items.filter(item => typeof item?.str === 'string' && item.str.trim());
  if (!visible.length) return null;
  const positions = visible.map(item => {
    const t = item.transform;
    if (!Array.isArray(t) || t.length < 6 || !t.every(Number.isFinite)
      || !Number.isFinite(item.width) || item.width <= 0) return null;
    const size = Math.hypot(t[2], t[3]);
    // Rotated, vertical or off-page text needs a different parser.
    if (size < 3 || size > 48 || Math.abs(t[1]) > .1 || Math.abs(t[2]) > .1
      || t[0] <= 0 || t[3] <= 0 || t[4] < 0 || t[4] + item.width > width + 1
      || t[5] < 0 || t[5] > height) return null;
    return { text: item.str.trim(), x: t[4], y: t[5], right: t[4] + item.width, size,
      end: item.hasEOL === true };
  });
  if (positions.some(position => !position)) return null;
  const lines = [];
  let line = null;
  const flush = () => { if (line) lines.push(line); line = null; };
  for (const item of positions) {
    if (line && (Math.abs(item.y - line.y) > Math.max(2, line.size * .25)
      || item.x < line.right - 2)) flush();
    if (!line) line = { text: '', x: item.x, right: item.right, y: item.y,
      size: item.size, fragmented: false };
    if (line.text && item.x - line.right > line.size * 3) line.fragmented = true;
    line.text += (line.text ? ' ' : '') + item.text;
    line.right = Math.max(line.right, item.right);
    line.size = Math.max(line.size, item.size);
    if (item.end) flush();
  }
  flush();
  const kind = text => /^(?:Figure|Fig\.|Table)\s+\d/iu.test(text) ? 'caption'
    : /^(?:References|Bibliography)\b|^\[\d+\]\s+\p{Lu}/u.test(text) ? 'reference'
      : /[=∑∫√±×÷≤≥≈∞∂∇_{}<>\\^|]/u.test(text) ? 'formula' : 'paragraph';
  const groups = [];
  let group = null, previous = null;
  for (const current of lines) {
    const currentKind = current.fragmented ? 'table' : kind(current.text);
    const boundary = !previous || currentKind !== 'paragraph' || group.kind !== 'paragraph'
      || current.fragmented || previous.fragmented
      || previous.y - current.y < -2
      || previous.y - current.y > Math.max(previous.size, current.size) * 1.65
      || Math.abs(current.size - previous.size) > 1.5
      || Math.abs(current.x - previous.x) > current.size * 2
      || (/[.!?。！？]$/u.test(previous.text) && current.x - group.x > current.size * .7)
      || group.text.length + current.text.length + 1 > maxChars;
    if (boundary) {
      group = { ...current, kind: currentKind, top: current.y + current.size, bottom: current.y };
      groups.push(group);
    } else {
      group.text += ' ' + current.text;
      group.x = Math.min(group.x, current.x);
      group.right = Math.max(group.right, current.right);
      group.top = Math.max(group.top, current.y + current.size);
      group.bottom = Math.min(group.bottom, current.y);
    }
    previous = current;
  }
  // Do not introduce oversized/unbounded blocks when a PDF item is unusually long.
  if (groups.some(group => group.text.length > maxChars)) return null;
  return groups.map((group, index) => ({ id: `p${page}-b${index + 1}`, kind: group.kind,
    bbox: [group.x, Math.max(0, height - group.top), Math.min(width, group.right), height - group.bottom],
    text: group.text, confidence: .9, extractionMethod: 'text-layer' }));
}

// Only literal labels in preceding blocks on the same page are context. Never
// infer a subject from a diagram, neighbouring column or an earlier page.
export function textLayerSectionPaths(pages) {
  const paths = new Map();
  for (const page of pages) {
    let heading = null, label = null;
    for (const block of page.blocks) {
      const section = block.text.match(/^\d+(?:\.\d+)*\s+([A-Z][A-Za-z -]{2,80})$/u);
      if (section) { heading = section[1]; label = null; }
      const explicit = block.text.match(/^([A-Z][A-Za-z -]{2,48}):\s/u);
      if (explicit && !['table', 'caption', 'reference'].includes(block.kind)) label = explicit[1];
      if (['caption', 'table', 'reference'].includes(block.kind)) { heading = null; label = null; }
      paths.set(block.id, [heading, label].filter(Boolean));
    }
  }
  return paths;
}

// Recover a literal sentence cut at a line-kind boundary. The preceding line
// can also contain a formula; only its complete qualitative sentence tail is
// retained. Both source blocks remain in the locator, with no inferred text.
export function textLayerHierarchyContinuations(pages) {
  const continuations = new Map();
  for (const page of pages) for (let i = 1; i < page.blocks.length; i++) {
    const previous = page.blocks[i - 1], current = page.blocks[i];
    if (current.kind !== 'paragraph' || ['table', 'caption', 'reference'].includes(previous.kind)
      || Math.abs(previous.bbox[0] - current.bbox[0]) > 24
      || current.bbox[1] - previous.bbox[3] < -2 || current.bbox[1] - previous.bbox[3] > 24) continue;
    const tail = previous.text.match(/(?:^|[.!?]\s+)(Each layer (?:has|contains|comprises) (?:two|three|several))\s*$/u);
    if (!tail || !/^sub-layers[.!?](?:\s|$)/u.test(current.text)) continue;
    continuations.set(current.id, { quoteText: `${tail[1]} ${current.text}`, blockIds: [previous.id, current.id] });
  }
  return continuations;
}
