import crypto from 'node:crypto';

export const AGENT_PAPER_INTAKE_LIMITS = Object.freeze({
  maxPdfBytes: 20 * 1024 * 1024,
  maxPages: 80,
  maxDoiMetadataBytes: 262144,
});

const ACTIVE_MARKERS = Object.freeze([
  ['/Encrypt', 'PDF_ENCRYPTED'],
  ['/JavaScript', 'PDF_JAVASCRIPT'],
  ['/Launch', 'PDF_LAUNCH_ACTION'],
  ['/EmbeddedFile', 'PDF_EMBEDDED_FILE'],
  ['/OpenAction', 'PDF_OPEN_ACTION'],
  ['/RichMedia', 'PDF_RICH_MEDIA'],
  ['/SubmitForm', 'PDF_SUBMIT_FORM'],
  ['/GoToE', 'PDF_EXTERNAL_ACTION'],
  ['/XFA', 'PDF_XFA_FORM'],
]);

export class AgentPaperIntakeSecurityError extends Error {
  constructor(code) { super(code); this.name = 'AgentPaperIntakeSecurityError'; this.code = code; }
}

const fail = code => { throw new AgentPaperIntakeSecurityError(code); };

export function normalizeDoi(value) {
  if (typeof value !== 'string') fail('PAPER_DOI_INVALID');
  let doi = value.trim().toLowerCase();
  doi = doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//u, '').replace(/^doi:\s*/u, '');
  try { doi = decodeURIComponent(doi); } catch { fail('PAPER_DOI_INVALID'); }
  if (doi.length < 7 || doi.length > 300 || !/^10\.\d{4,9}\/[!#$&'()*+,\-./0-9:;=?@a-z\[\]_{}]+$/u.test(doi)
    || /[\s\u0000-\u001f\u007f]/u.test(doi)) fail('PAPER_DOI_INVALID');
  return doi;
}

export function scanPrivatePaperPdf(bytes) {
  const value = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? []);
  if (value.byteLength < 16) fail('PDF_TOO_SMALL');
  if (value.byteLength > AGENT_PAPER_INTAKE_LIMITS.maxPdfBytes) fail('PDF_TOO_LARGE');
  const head = new TextDecoder('latin1').decode(value.subarray(0, Math.min(1024, value.byteLength)));
  if (!head.startsWith('%PDF-')) fail('PDF_MAGIC_INVALID');
  const tail = new TextDecoder('latin1').decode(value.subarray(Math.max(0, value.byteLength - 4096)));
  if (!tail.includes('%%EOF')) fail('PDF_EOF_MISSING');
  if (value[0] === 0x50 && value[1] === 0x4b) fail('PDF_POLYGLOT_ARCHIVE');
  const text = new TextDecoder('latin1').decode(value);
  for (const [marker, code] of ACTIVE_MARKERS) if (text.includes(marker)) fail(code);
  if (/\/AA(?:\s|\[|<)/u.test(text) || /\/JS(?:\s|\[|<)/u.test(text)) fail('PDF_ACTIVE_ACTION');
  const objectCount = (text.match(/\b\d+\s+\d+\s+obj\b/gu) ?? []).length;
  if (objectCount > 250000) fail('PDF_OBJECT_LIMIT');
  return Object.freeze({
    schemaVersion: 'paper-pdf-security-v1',
    verdict: 'passed',
    sniffedMediaType: 'application/pdf',
    bytes: value.byteLength,
    sha256: crypto.createHash('sha256').update(value).digest('hex'),
    objectCount,
    activeContentChecked: true,
  });
}

export function buildPaperLayoutCapabilityReport({ qualityAssessment, pageSignals }) {
  if (!qualityAssessment || !Array.isArray(pageSignals) || pageSignals.length < 1) {
    fail('PAPER_LAYOUT_CAPABILITY_INPUT_INVALID');
  }
  const count = key => pageSignals.filter(page => page?.[key] === true).length;
  const imagePages = pageSignals.filter(page => Number(page?.imageCount) > 0).length;
  const scannedPages = count('scannedCandidate');
  const tablePages = count('tableRisk');
  const formulaPages = count('formulaRisk');
  const multiColumnPages = count('multiColumn');
  const orderRiskPages = count('readingOrderRisk');
  const blocked = qualityAssessment.grade === 'blocked' || scannedPages > 0;
  const grade = blocked ? 'blocked' : (tablePages + formulaPages + imagePages + multiColumnPages > 0
    ? 'mixed-limited' : 'text-native');
  return Object.freeze({
    schemaVersion: 'paper-layout-capability-v1',
    policyVersion: 'private-pdf-layout-gate-v1',
    grade,
    pageCount: pageSignals.length,
    pageKinds: {
      textNative: pageSignals.length - scannedPages,
      scanned: scannedPages,
      multiColumn: multiColumnPages,
      tableRisk: tablePages,
      formulaRisk: formulaPages,
      imageBearing: imagePages,
      readingOrderRisk: orderRiskPages,
    },
    capabilities: {
      nativeTextEvidence: !blocked,
      multiColumnReflow: false,
      tableSemantics: false,
      formulaSemantics: false,
      ocr: false,
      visualEvidence: false,
    },
    permittedUses: blocked ? [] : qualityAssessment.permittedUses,
    failClosed: blocked || tablePages > 0 || formulaPages > 0 || orderRiskPages > 0,
  });
}
