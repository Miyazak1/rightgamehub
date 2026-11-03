export const PAPER_STUDY_METHODS = Object.freeze({ listPaperStudies: [], importPaperStudy: ['paper-import'],
  getPaperStudy: ['id'], getPaperStudySource: ['id'], analyzePaperStudy: ['id'], generatePaperStudyDraft: ['id'] });
export const PAPER_STUDY_IMPORT_LIMIT = Math.ceil(20 * 1024 * 1024 / 3) * 4;
export function paperStudyImport(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !['pdfBase64', 'filename', 'title', 'rightsConfirmed', 'arxivId'].includes(k))
    || typeof value.pdfBase64 !== 'string' || value.pdfBase64.length > PAPER_STUDY_IMPORT_LIMIT || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.pdfBase64)
    || typeof value.filename !== 'string' || value.filename.length > 200 || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 300 || value.rightsConfirmed !== true
    || value.arxivId !== undefined && (typeof value.arxivId !== 'string' || value.arxivId !== '' && !/^\d{4}\.\d{4,5}(?:v\d+)?$/.test(value.arxivId)))
    throw Object.assign(Error('PAPER_STUDY_IMPORT_INVALID'), { code: 'PAPER_STUDY_IMPORT_INVALID', status: 400 });
  return { pdfBase64: value.pdfBase64, filename: value.filename, title: value.title, rightsConfirmed: true, ...(value.arxivId ? {arxivId:value.arxivId} : {}) };
}
