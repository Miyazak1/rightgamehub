"use strict";

// Minimal RFC 4180-compliant CSV parser.
// Handles quoted fields, commas inside quotes, escaped double-quotes ("").
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  // Normalise line endings so we only deal with \n.
  const src = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  while (i < src.length) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        // Escaped quote ("") → emit one literal ".
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        // Otherwise close the quoted section.
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    // Not in quotes.
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ''; i++; continue; }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    field += ch;
    i++;
  }

  // Flush the last field/row.
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);

  return rows;
}

// Required columns — anything else is silently accepted.
const REQUIRED = ['id', 'category', 'type', 'primaryQuestion', 'primaryAnswer'];

// Parses CSV text into an array of question objects, ready for validate.js.
// Returns { questions: [...], warnings: [] } — never throws on bad data, just
// adds to warnings so the caller gets a full picture of all problems at once.
function parseCsvQuestions(text) {
  const warnings = [];
  const rows = parseCSV(text);

  if (rows.length < 2) {
    return { questions: [], warnings: ['CSV has no data rows (only a header or is empty).'] };
  }

  const header = rows[0].map((h) => h.trim());

  // Check every required column is present.
  for (const col of REQUIRED) {
    if (!header.includes(col)) {
      warnings.push('Missing required column: "' + col + '"');
    }
  }

  const idx = {};
  header.forEach((h, i) => { idx[h] = i; });

  const questions = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const get = (col) => (idx[col] !== undefined ? (row[idx[col]] || '').trim() : '');

    const id = get('id');
    if (!id) { warnings.push('Row ' + (r + 1) + ': empty id, skipped.'); continue; }

    const type = get('type').toLowerCase();
    if (!['main', 'tiebreaker', 'backup'].includes(type)) {
      warnings.push('Row ' + (r + 1) + ' (id=' + id + '): unknown type "' + get('type') + '", defaulting to "main".');
    }

    questions.push({
      id,
      category:          get('category'),
      type:              ['main', 'tiebreaker', 'backup'].includes(type) ? type : 'main',
      theme:             get('theme'),
      primaryQuestion:   get('primaryQuestion'),
      primaryAnswer:     get('primaryAnswer'),
      secondaryQuestion: get('secondaryQuestion'),
      secondaryAnswer:   get('secondaryAnswer'),
      imagePath:         get('imagePath'),
      draw:              get('draw') ? parseInt(get('draw'), 10) : null
    });
  }

  return { questions, warnings };
}

module.exports = { parseCsvQuestions };
