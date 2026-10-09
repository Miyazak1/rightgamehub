import crypto from 'node:crypto';
import { createZipBuffer } from './zip-buffer-writer.mjs';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/gu, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

const cleanList = (value, name) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 30) throw Object.assign(new Error(`${name}必须包含 1 至 30 项。`), { code: 'BINGO_CONTENT_INVALID' });
  return value.map(item => {
    if (typeof item !== 'string' || !item.trim() || item.length > 80) throw Object.assign(new Error(`${name}包含无效文字。`), { code: 'BINGO_CONTENT_INVALID' });
    return item.trim();
  });
};

export function normalizeBingoContent(content) {
  if (!content || Array.isArray(content) || typeof content !== 'object') throw Object.assign(new Error('Bingo 内容必须是对象。'), { code: 'BINGO_CONTENT_INVALID' });
  const tableTitle = typeof content.tableTitle === 'string' ? content.tableTitle.trim() : '';
  const subtitle = typeof content.subtitle === 'string' ? content.subtitle.trim() : '';
  if (!tableTitle || tableTitle.length > 120 || subtitle.length > 160) throw Object.assign(new Error('Bingo 标题或说明不符合长度要求。'), { code: 'BINGO_CONTENT_INVALID' });
  const columnHeaders = cleanList(content.columnHeaders, '列标题');
  const rowHeaders = cleanList(content.rowHeaders, '行标题');
  const cells = {};
  if (content.cells !== undefined && (!content.cells || Array.isArray(content.cells) || typeof content.cells !== 'object')) throw Object.assign(new Error('Bingo 单元格内容无效。'), { code: 'BINGO_CONTENT_INVALID' });
  for (const [key, value] of Object.entries(content.cells ?? {})) {
    const match = /^(\d+):(\d+)$/u.exec(key);
    if (!match || Number(match[1]) >= rowHeaders.length || Number(match[2]) < 1 || Number(match[2]) >= columnHeaders.length || typeof value !== 'string' || value.length > 200) throw Object.assign(new Error('Bingo 单元格坐标或文字无效。'), { code: 'BINGO_CONTENT_INVALID' });
    cells[key] = value.trim();
  }
  return { tableTitle, subtitle, columnHeaders, rowHeaders, cells };
}

export function renderBingoHtml(content, { draftId = 'preview', revision = '0' } = {}) {
  const data = normalizeBingoContent(content);
  const identity = crypto.createHash('sha256').update(JSON.stringify({ draftId, revision, data })).digest('hex').slice(0, 20);
  const header = data.columnHeaders.map(item => `<th scope="col">${escapeHtml(item)}</th>`).join('');
  const body = data.rowHeaders.map((row, rowIndex) => `<tr><th scope="row">${escapeHtml(row)}</th>${data.columnHeaders.slice(1).map((_column, offset) => {
    const columnIndex = offset + 1; const label = data.cells[`${rowIndex}:${columnIndex}`] || '未填写';
    return `<td><button type="button" data-cell="${rowIndex}:${columnIndex}" aria-pressed="false">${escapeHtml(label)}</button></td>`;
  }).join('')}</tr>`).join('');
  const safeIdentity = JSON.stringify(identity).replace(/</gu, '\\u003c');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(data.tableTitle)}</title>
<style>:root{font-family:Inter,"PingFang SC","Microsoft YaHei",sans-serif;color:#151821;background:#f5f5f2}*{box-sizing:border-box}body{margin:0;padding:clamp(18px,4vw,56px)}main{max-width:1180px;margin:auto;background:#fff;border:1px solid #cfd2d8}header{display:flex;align-items:end;justify-content:space-between;gap:24px;padding:26px 30px;border-bottom:2px solid #151821}h1{margin:0;font-size:clamp(26px,4vw,48px);line-height:1.05}p{margin:8px 0 0;color:#626876}.progress{font:700 13px/1 monospace;white-space:nowrap}.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;min-width:720px;table-layout:fixed}th,td{border:1px solid #cfd2d8;padding:0;text-align:center}thead th{height:54px;background:#f1f2f4;font-size:13px;letter-spacing:.06em}tbody th{width:170px;padding:14px;background:#fafafa;text-align:left;font-size:14px}td button{appearance:none;width:100%;min-height:84px;border:0;background:#fff;color:#20242e;padding:12px;font:600 14px/1.45 inherit;cursor:pointer;transition:background .14s,color .14s}td button:hover{background:#fff4f4}td button.is-active{background:#ff5964;color:#fff}footer{padding:14px 30px;border-top:1px solid #cfd2d8;color:#777;font-size:12px}@media(max-width:680px){body{padding:0}main{border-width:0}header{align-items:flex-start;flex-direction:column;padding:20px}.table-wrap{border-top:1px solid #cfd2d8}footer{padding:12px 20px}}</style></head>
<body><main><header><div><h1>${escapeHtml(data.tableTitle)}</h1><p>${escapeHtml(data.subtitle)}</p></div><span class="progress" id="progress">0 / ${data.rowHeaders.length * Math.max(data.columnHeaders.length - 1, 0)}</span></header><div class="table-wrap"><table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></div><footer>点击格子标记属于你的项目 · 进度仅保存在当前浏览器</footer></main>
<script>(()=>{const key='gamehub:bingo:'+${safeIdentity};let selected=[];try{selected=JSON.parse(localStorage.getItem(key)||'[]')}catch{}const buttons=[...document.querySelectorAll('[data-cell]')];const paint=()=>{for(const button of buttons){const active=selected.includes(button.dataset.cell);button.classList.toggle('is-active',active);button.setAttribute('aria-pressed',String(active))}document.getElementById('progress').textContent=selected.length+' / '+buttons.length};for(const button of buttons)button.addEventListener('click',()=>{const cell=button.dataset.cell;selected=selected.includes(cell)?selected.filter(item=>item!==cell):[...selected,cell];try{localStorage.setItem(key,JSON.stringify(selected))}catch{}paint()});paint()})()</script></body></html>`;
}

export function buildBingoPackage(content, metadata = {}) {
  const html = renderBingoHtml(content, metadata);
  const manifest = JSON.stringify({ format: 'gamehub-bingo', version: 1, draftId: metadata.draftId ?? null, revision: String(metadata.revision ?? '0') }, null, 2);
  const zip = createZipBuffer([{ name: 'index.html', data: html }, { name: 'bingo.json', data: JSON.stringify(normalizeBingoContent(content), null, 2) }, { name: 'gamehub-bingo.json', data: manifest }]);
  return { html, zip, sha256: crypto.createHash('sha256').update(zip).digest('hex') };
}
