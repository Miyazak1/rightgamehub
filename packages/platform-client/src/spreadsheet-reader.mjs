import JSZip from 'jszip';
import {parseCellAddress,shiftFormula} from './spreadsheet-audit.mjs';

export const SPREADSHEET_ACCEPT = '.xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12';
export const SPREADSHEET_LIMITS = Object.freeze({ fileBytes: 40 * 1024 * 1024, expandedBytes: 180 * 1024 * 1024, cells: 300000, formulas: 120000 });

const failure = (code, message = code) => Object.assign(new Error(message), { code });
const localNameElements = (document, name) => [...document.getElementsByTagNameNS('*', name)];

function parseXml(text, path) {
  if (typeof DOMParser === 'undefined') throw failure('SPREADSHEET_BROWSER_REQUIRED');
  const document = new DOMParser().parseFromString(text, 'application/xml');
  if (document.getElementsByTagName('parsererror').length) throw failure('SPREADSHEET_XML_INVALID', path);
  return document;
}

function resolveZipPath(base, target) {
  if (String(target).startsWith('/')) return String(target).replace(/^\/+/, '');
  const parts = String(base).split('/'); parts.pop();
  for (const part of String(target).replace(/\\/gu, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop(); else parts.push(part);
  }
  return parts.join('/');
}

async function readXml(zip, path, optional = false) {
  const entry = zip.file(path);
  if (!entry) {
    if (optional) return null;
    throw failure('SPREADSHEET_STRUCTURE_INVALID', path);
  }
  return parseXml(await entry.async('text'), path);
}

const textContent = node => node?.textContent || '';

async function readSharedStrings(zip) {
  const document = await readXml(zip, 'xl/sharedStrings.xml', true);
  if (!document) return [];
  return localNameElements(document, 'si').map(item => localNameElements(item, 't').map(textContent).join(''));
}

function parseCellValue(node, sharedStrings) {
  const type = node.getAttribute('t') || '', value = localNameElements(node, 'v')[0]?.textContent ?? '';
  if (type === 's') return sharedStrings[Number(value)] ?? '';
  if (type === 'inlineStr') return localNameElements(node, 't').map(textContent).join('');
  if (type === 'b') return value === '1' ? 'TRUE' : 'FALSE';
  return value;
}

async function parseSheet(zip, descriptor, sharedStrings, counters) {
  const document = await readXml(zip, descriptor.path), cells = [], sharedFormulas = new Map();
  for (const node of localNameElements(document, 'c')) {
    const parsedAddress = parseCellAddress(node.getAttribute('r'));
    if (!parsedAddress) continue;
    counters.cells += 1;
    if (counters.cells > SPREADSHEET_LIMITS.cells) throw failure('SPREADSHEET_CELL_LIMIT');
    const formulaNode = localNameElements(node, 'f')[0], formulaType = formulaNode?.getAttribute('t') || '', sharedIndex = formulaNode?.getAttribute('si') || '';
    let formula = formulaNode?.textContent ? `=${formulaNode.textContent}` : '';
    if (formulaType === 'shared' && sharedIndex) {
      if (formula) sharedFormulas.set(sharedIndex, { formula, address: parsedAddress.address });
      else {
        const master = sharedFormulas.get(sharedIndex);
        if (master) formula = shiftFormula(master.formula, master.address, parsedAddress.address, descriptor.name);
      }
    }
    if (formula) {
      counters.formulas += 1;
      if (counters.formulas > SPREADSHEET_LIMITS.formulas) throw failure('SPREADSHEET_FORMULA_LIMIT');
    }
    cells.push({ ...parsedAddress, formula, formulaType, value: parseCellValue(node, sharedStrings) });
  }
  return { name: descriptor.name, state: descriptor.state, cells };
}

export async function readSpreadsheetFile(file, { onProgress } = {}) {
  if (!file) throw failure('SPREADSHEET_FILE_REQUIRED');
  if (!/\.(xlsx|xlsm)$/iu.test(file.name || '')) throw failure('SPREADSHEET_TYPE_UNSUPPORTED');
  if (file.size > SPREADSHEET_LIMITS.fileBytes) throw failure('SPREADSHEET_FILE_TOO_LARGE');
  let zip;
  try { zip = await JSZip.loadAsync(await file.arrayBuffer()); }
  catch { throw failure('SPREADSHEET_ZIP_INVALID'); }
  const expandedBytes = Object.values(zip.files).reduce((sum, entry) => sum + Number(entry?._data?.uncompressedSize || 0), 0);
  if (expandedBytes > SPREADSHEET_LIMITS.expandedBytes) throw failure('SPREADSHEET_EXPANDED_TOO_LARGE');

  const [workbookDocument, relationshipDocument, sharedStrings] = await Promise.all([
    readXml(zip, 'xl/workbook.xml'),
    readXml(zip, 'xl/_rels/workbook.xml.rels'),
    readSharedStrings(zip),
  ]);
  const relationships = new Map(localNameElements(relationshipDocument, 'Relationship').map(node => [node.getAttribute('Id'), resolveZipPath('xl/workbook.xml', node.getAttribute('Target') || '')]));
  const descriptors = localNameElements(workbookDocument, 'sheet').map(node => ({
    name: node.getAttribute('name') || 'Sheet', state: node.getAttribute('state') || 'visible',
    path: relationships.get(node.getAttribute('r:id') || node.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')),
  })).filter(item => item.path && /worksheets\//u.test(item.path));
  if (!descriptors.length) throw failure('SPREADSHEET_NO_WORKSHEETS');
  const counters = { cells: 0, formulas: 0 }, sheets = [];
  for (let index = 0; index < descriptors.length; index += 1) {
    onProgress?.({ sheet: index + 1, total: descriptors.length, name: descriptors[index].name });
    sheets.push(await parseSheet(zip, descriptors[index], sharedStrings, counters));
  }
  return {
    name: file.name,
    size: file.size,
    sheets,
    hasMacros: Boolean(zip.file('xl/vbaProject.bin')),
    stats: { ...counters, expandedBytes },
  };
}
