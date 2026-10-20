const MAX_EXCEL_COLUMN = 16384;
const CELL_REFERENCE = /(^|[^\p{L}\p{N}_.])(?:(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))!)?(\$?)([A-Z]{1,3})(\$?)(\d+)(?::(\$?)([A-Z]{1,3})(\$?)(\d+))?(?![\p{L}\p{N}_.])/giu;

export function columnToNumber(value) {
  let result = 0;
  for (const char of String(value || '').toUpperCase()) {
    const digit = char.charCodeAt(0) - 64;
    if (digit < 1 || digit > 26) return 0;
    result = result * 26 + digit;
  }
  return result;
}

export function numberToColumn(value) {
  let number = Number(value), result = '';
  if (!Number.isInteger(number) || number < 1) return '';
  while (number) {
    number -= 1;
    result = String.fromCharCode(65 + number % 26) + result;
    number = Math.floor(number / 26);
  }
  return result;
}

export function parseCellAddress(value) {
  const match = /^\$?([A-Z]{1,3})\$?(\d+)$/iu.exec(String(value || '').trim());
  if (!match) return null;
  const column = columnToNumber(match[1]), row = Number(match[2]);
  return column > MAX_EXCEL_COLUMN || row < 1 ? null : { address: `${match[1].toUpperCase()}${row}`, column, row };
}

const cellKey = (sheet, address) => `${sheet}!${String(address).toUpperCase()}`;
const withoutStrings = formula => String(formula || '').replace(/"(?:[^"]|"")*"/gu, value => ' '.repeat(value.length));
const normalizeSheet = value => String(value || '').replace(/''/gu, "'");

function scanReferences(formula, currentSheet) {
  const source = String(formula || ''), searchable = withoutStrings(source), references = [];
  CELL_REFERENCE.lastIndex = 0;
  let match;
  while ((match = CELL_REFERENCE.exec(searchable))) {
    const prefix = match[1] || '', start = match.index + prefix.length, end = CELL_REFERENCE.lastIndex;
    const explicitSheet = normalizeSheet(match[2] || match[3] || ''), sheet = explicitSheet || currentSheet;
    const startColumn = columnToNumber(match[5]), startRow = Number(match[7]);
    const endColumn = match[9] ? columnToNumber(match[9]) : startColumn, endRow = match[11] ? Number(match[11]) : startRow;
    if (!startColumn || !endColumn || startColumn > MAX_EXCEL_COLUMN || endColumn > MAX_EXCEL_COLUMN || startRow < 1 || endRow < 1) continue;
    if (!explicitSheet && !match[9] && searchable.slice(end).trimStart().startsWith('(')) continue;
    references.push({
      start, end, sheet, explicitSheet: Boolean(explicitSheet),
      startCell: { column: startColumn, row: startRow, absoluteColumn: Boolean(match[4]), absoluteRow: Boolean(match[6]) },
      endCell: { column: endColumn, row: endRow, absoluteColumn: Boolean(match[8]), absoluteRow: Boolean(match[10]) },
      isRange: Boolean(match[9]), raw: source.slice(start, end),
    });
  }
  return references;
}

function expandReference(reference, maxRangeCells = 1000) {
  const minColumn = Math.min(reference.startCell.column, reference.endCell.column), maxColumn = Math.max(reference.startCell.column, reference.endCell.column);
  const minRow = Math.min(reference.startCell.row, reference.endCell.row), maxRow = Math.max(reference.startCell.row, reference.endCell.row);
  const size = (maxColumn - minColumn + 1) * (maxRow - minRow + 1);
  if (size > maxRangeCells) return [cellKey(reference.sheet, `${numberToColumn(reference.startCell.column)}${reference.startCell.row}`), cellKey(reference.sheet, `${numberToColumn(reference.endCell.column)}${reference.endCell.row}`)];
  const result = [];
  for (let row = minRow; row <= maxRow; row += 1) for (let column = minColumn; column <= maxColumn; column += 1) result.push(cellKey(reference.sheet, `${numberToColumn(column)}${row}`));
  return result;
}

const canonicalPoint = (point, origin) => {
  const row = point.absoluteRow ? `R${point.row}` : `R[${point.row - origin.row}]`;
  const column = point.absoluteColumn ? `C${point.column}` : `C[${point.column - origin.column}]`;
  return `${row}${column}`;
};

export function canonicalizeFormula(formula, cell) {
  const source = String(formula || '').replace(/^=/u, ''), origin = parseCellAddress(cell.address) || { row: cell.row, column: cell.column };
  let cursor = 0, result = '';
  for (const reference of scanReferences(source, cell.sheet)) {
    result += source.slice(cursor, reference.start);
    const sheet = reference.explicitSheet ? `SHEET(${reference.sheet.toUpperCase()})!` : '';
    result += `${sheet}${canonicalPoint(reference.startCell, origin)}${reference.isRange ? `:${canonicalPoint(reference.endCell, origin)}` : ''}`;
    cursor = reference.end;
  }
  result += source.slice(cursor);
  return result.replace(/\s+/gu, '').toUpperCase();
}

const formatSheet = value => /^[A-Za-z_][A-Za-z0-9_.]*$/u.test(value) ? `${value}!` : `'${String(value).replace(/'/gu, "''")}'!`;
const shiftedPoint = (point, rowDelta, columnDelta) => `${point.absoluteColumn ? '$' : ''}${numberToColumn(point.column + (point.absoluteColumn ? 0 : columnDelta))}${point.absoluteRow ? '$' : ''}${point.row + (point.absoluteRow ? 0 : rowDelta)}`;

export function shiftFormula(formula, fromAddress, toAddress, currentSheet = '') {
  const from = parseCellAddress(fromAddress), to = parseCellAddress(toAddress);
  if (!from || !to) return formula;
  const rowDelta = to.row - from.row, columnDelta = to.column - from.column, source = String(formula || '');
  let cursor = 0, result = '';
  for (const reference of scanReferences(source, currentSheet)) {
    result += source.slice(cursor, reference.start);
    const start = shiftedPoint(reference.startCell, rowDelta, columnDelta), end = shiftedPoint(reference.endCell, rowDelta, columnDelta);
    result += `${reference.explicitSheet ? formatSheet(reference.sheet) : ''}${start}${reference.isRange ? `:${end}` : ''}`;
    cursor = reference.end;
  }
  return result + source.slice(cursor);
}

function issue(code, severity, cell, detail = {}) {
  return { id: `${code}:${cell.sheet}:${cell.address}`, code, severity, sheet: cell.sheet, address: cell.address, formula: cell.formula || '', ...detail };
}

export function analyzeWorkbook(workbook) {
  const cells = workbook.sheets.flatMap(sheet => sheet.cells.map(cell => ({ ...cell, sheet: sheet.name })));
  const allCells = new Map(cells.map(cell => [cellKey(cell.sheet, cell.address), cell]));
  const formulas = cells.filter(cell => cell.formula).map(cell => {
    const references = scanReferences(cell.formula, cell.sheet), precedentKeys = [...new Set(references.flatMap(reference => expandReference(reference)))];
    return { ...cell, key: cellKey(cell.sheet, cell.address), pattern: canonicalizeFormula(cell.formula, cell), references, precedentKeys };
  });
  const formulaByKey = new Map(formulas.map(cell => [cell.key, cell])), dependents = new Map(), issues = [], issueIds = new Set();
  const addIssue = value => { if (!issueIds.has(value.id)) { issueIds.add(value.id); issues.push(value); } };

  for (const cell of formulas) {
    for (const key of cell.precedentKeys) {
      const list = dependents.get(key) || [];
      list.push(cell.key); dependents.set(key, list);
      if (key === cell.key) addIssue(issue('self-reference', 'error', cell));
    }
    if (/#REF!/iu.test(cell.formula)) addIssue(issue('broken-reference', 'error', cell));
    if (/\[[^\]]+\]/u.test(withoutStrings(cell.formula))) addIssue(issue('external-workbook', 'warning', cell));
  }

  const columns = new Map();
  for (const cell of formulas) {
    const key = `${cell.sheet}:${cell.column}`, list = columns.get(key) || [];
    list.push(cell); columns.set(key, list);
  }
  for (const list of columns.values()) {
    list.sort((a, b) => a.row - b.row);
    for (let index = 1; index < list.length - 1; index += 1) {
      const before = list[index - 1], current = list[index], after = list[index + 1];
      if (before.row + 1 === current.row && current.row + 1 === after.row && before.pattern === after.pattern && current.pattern !== before.pattern) addIssue(issue('pattern-outlier', 'review', current, { neighbors: [before.address, after.address] }));
    }
    for (let index = 0; index < list.length - 1; index += 1) {
      const before = list[index], after = list[index + 1];
      if (after.row !== before.row + 2 || before.pattern !== after.pattern) continue;
      const address = `${numberToColumn(before.column)}${before.row + 1}`, middle = allCells.get(cellKey(before.sheet, address));
      if (middle && !middle.formula && String(middle.value ?? '').trim()) addIssue(issue('formula-replaced', 'review', { ...middle, sheet: before.sheet }, { neighbors: [before.address, after.address] }));
    }
  }

  const severityOrder = { error: 0, warning: 1, review: 2 };
  issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || a.sheet.localeCompare(b.sheet) || a.address.localeCompare(b.address, undefined, { numeric: true }));
  return {
    workbook,
    formulas,
    issues,
    formulaByKey,
    dependents,
    stats: {
      sheets: workbook.sheets.length,
      cells: cells.length,
      formulas: formulas.length,
      references: formulas.reduce((sum, cell) => sum + cell.references.length, 0),
      issues: issues.length,
    },
    relations(sheet, address) {
      const key = cellKey(sheet, address), cell = formulaByKey.get(key);
      return {
        precedents: (cell?.precedentKeys || []).map(value => ({ key: value, cell: allCells.get(value) || null })),
        dependents: (dependents.get(key) || []).map(value => ({ key: value, cell: formulaByKey.get(value) || null })),
      };
    },
  };
}

const comparableFormula = value => String(value || '').replace(/^=/u, '').replace(/\s+/gu, '').toUpperCase();

export function compareWorkbooks(baseline, current) {
  const collect = workbook => new Map(workbook.sheets.flatMap(sheet => sheet.cells.filter(cell => cell.formula).map(cell => [cellKey(sheet.name, cell.address), { ...cell, sheet: sheet.name }])));
  const before = collect(baseline), after = collect(current), keys = [...new Set([...before.keys(), ...after.keys()])].sort(), changes = [];
  for (const key of keys) {
    const previous = before.get(key), next = after.get(key);
    if (!previous) changes.push({ key, type: 'added', sheet: next.sheet, address: next.address, before: '', after: next.formula });
    else if (!next) changes.push({ key, type: 'removed', sheet: previous.sheet, address: previous.address, before: previous.formula, after: '' });
    else if (comparableFormula(previous.formula) !== comparableFormula(next.formula)) changes.push({ key, type: 'changed', sheet: next.sheet, address: next.address, before: previous.formula, after: next.formula });
  }
  return {
    changes,
    stats: {
      added: changes.filter(item => item.type === 'added').length,
      removed: changes.filter(item => item.type === 'removed').length,
      changed: changes.filter(item => item.type === 'changed').length,
    },
  };
}

export function buildSpreadsheetAuditReport({ analysis, comparison = null, currentName = '当前工作簿', baselineName = '基准工作簿' }) {
  const lines = [
    '# Excel 公式审计报告', '', `- 当前文件：${currentName}`, `- 工作表：${analysis.stats.sheets}`, `- 公式：${analysis.stats.formulas}`, `- 引用关系：${analysis.stats.references}`, `- 待复核：${analysis.stats.issues}`, '', '## 待复核项目', '',
  ];
  if (!analysis.issues.length) lines.push('未发现明显的公式结构问题。仍建议人工核对业务含义。');
  else for (const item of analysis.issues) lines.push(`- [${item.severity.toUpperCase()}] ${item.sheet}!${item.address} · ${item.code}${item.formula ? ` · \`${item.formula}\`` : ''}`);
  if (comparison) {
    lines.push('', '## 版本公式变化', '', `基准文件：${baselineName}`, `新增 ${comparison.stats.added} · 删除 ${comparison.stats.removed} · 修改 ${comparison.stats.changed}`, '');
    if (!comparison.changes.length) lines.push('两份工作簿的公式没有差异。');
    else for (const change of comparison.changes) lines.push(`- [${change.type.toUpperCase()}] ${change.sheet}!${change.address}\n  - 之前：${change.before || '—'}\n  - 现在：${change.after || '—'}`);
  }
  lines.push('', '> 本报告只检查公式结构和引用关系，不判断业务规则是否正确。');
  return lines.join('\n');
}
