const MAX_LINES = 800;
const MAX_CHANGES = 80;

const cleanLine = value => String(value ?? '').replace(/\s+/gu, ' ').trim();

export function normalizeRadarText(value, { ignoreNoise = true } = {}) {
  let text = String(value ?? '').replace(/\r\n?/gu, '\n');
  if (ignoreNoise) {
    text = text
      .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/giu, '<timestamp>')
      .replace(/\b(?:updated|last updated|更新于|最后更新)\s*(?:just now|刚刚|\d+\s*(?:seconds?|minutes?|hours?|days?|秒|分钟|小时|天)(?:\s*ago|前)?)/giu, '<relative-time>')
      .replace(/\b\d{1,3}(?:,\d{3})+\s*(?:views?|reads?|浏览|阅读)\b/giu, '<view-count>');
  }
  return text.split('\n').map(cleanLine).filter(Boolean).join('\n');
}

const trimLines = value => normalizeRadarText(value, { ignoreNoise: false }).split('\n').filter(Boolean).slice(0, MAX_LINES);

function rawLineDiff(beforeLines, afterLines) {
  const rows = beforeLines.length + 1, cols = afterLines.length + 1;
  if (beforeLines.length * afterLines.length > 180000) {
    const beforeSet = new Set(beforeLines), afterSet = new Set(afterLines);
    return [
      ...beforeLines.filter(line => !afterSet.has(line)).map(text => ({ type: 'removed', text })),
      ...afterLines.filter(line => !beforeSet.has(line)).map(text => ({ type: 'added', text })),
    ];
  }
  const table = Array.from({ length: rows }, () => new Uint16Array(cols));
  for (let left = beforeLines.length - 1; left >= 0; left -= 1) {
    for (let right = afterLines.length - 1; right >= 0; right -= 1) {
      table[left][right] = beforeLines[left] === afterLines[right]
        ? table[left + 1][right + 1] + 1
        : Math.max(table[left + 1][right], table[left][right + 1]);
    }
  }
  const changes = []; let left = 0, right = 0;
  while (left < beforeLines.length || right < afterLines.length) {
    if (left < beforeLines.length && right < afterLines.length && beforeLines[left] === afterLines[right]) { left += 1; right += 1; continue; }
    if (right < afterLines.length && (left >= beforeLines.length || table[left][right + 1] >= table[left + 1][right])) changes.push({ type: 'added', text: afterLines[right++] });
    else if (left < beforeLines.length) changes.push({ type: 'removed', text: beforeLines[left++] });
  }
  return changes;
}

function pairModifications(changes) {
  const output = [];
  for (let index = 0; index < changes.length; index += 1) {
    const current = changes[index], next = changes[index + 1];
    if (current?.type === 'removed' && next?.type === 'added') {
      output.push({ type: 'modified', before: current.text, after: next.text }); index += 1;
    } else if (current?.type === 'added' && next?.type === 'removed') {
      output.push({ type: 'modified', before: next.text, after: current.text }); index += 1;
    } else output.push(current);
  }
  return output;
}

export function buildTextDiff(before, after) {
  const all = pairModifications(rawLineDiff(trimLines(before), trimLines(after)));
  const added = all.filter(item => item.type === 'added').length;
  const removed = all.filter(item => item.type === 'removed').length;
  const modified = all.filter(item => item.type === 'modified').length;
  return {
    added, removed, modified,
    changes: all.slice(0, MAX_CHANGES),
    omitted: Math.max(0, all.length - MAX_CHANGES),
  };
}

const contains = (text, needle) => normalizeRadarText(text, { ignoreNoise: false }).toLocaleLowerCase().includes(cleanLine(needle).toLocaleLowerCase());
const numbers = value => normalizeRadarText(value, { ignoreNoise: false }).match(/[-+]?\d[\d,.]*(?:%|‰|元|美元|万元|亿|mb|gb|tb)?/giu) || [];

export function evaluateChangeRule({ type = 'any', value = '' } = {}, before = '', after = '') {
  if (type === 'keyword_appears') {
    const matched = Boolean(cleanLine(value)) && !contains(before, value) && contains(after, value);
    return { matched, reason: matched ? `关键词“${cleanLine(value)}”首次出现` : `关键词“${cleanLine(value)}”未首次出现` };
  }
  if (type === 'keyword_disappears') {
    const matched = Boolean(cleanLine(value)) && contains(before, value) && !contains(after, value);
    return { matched, reason: matched ? `关键词“${cleanLine(value)}”已消失` : `关键词“${cleanLine(value)}”仍未消失` };
  }
  if (type === 'number_changes') {
    const matched = JSON.stringify(numbers(before)) !== JSON.stringify(numbers(after));
    return { matched, reason: matched ? '页面中的数字发生变化' : '页面中的数字没有变化' };
  }
  return { matched: true, reason: '页面正文发生变化' };
}
