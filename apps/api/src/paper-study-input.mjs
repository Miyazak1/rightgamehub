export const PAPER_STUDY_MAX_BYTES = 20 * 1024 * 1024;
const fail=(code,statusCode)=>{throw Object.assign(Error(code),{code,statusCode,status:statusCode,retryable:false});};
export function decodePaperStudyInput(input) {
  if (!input || Object.keys(input).some(k => !['pdfBase64', 'filename', 'title', 'rightsConfirmed', 'arxivId'].includes(k))
    || input.rightsConfirmed !== true || typeof input.filename !== 'string' || input.filename.length > 200
    || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 300
    || typeof input.pdfBase64 !== 'string' || input.pdfBase64.length > Math.ceil(PAPER_STUDY_MAX_BYTES / 3) * 4
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.pdfBase64)
    || input.arxivId !== undefined && (typeof input.arxivId !== 'string' || input.arxivId !== '' && !/^\d{4}\.\d{4,5}(?:v\d+)?$/.test(input.arxivId))) fail('PAPER_STUDY_IMPORT_INVALID', 400);
  const bytes = Buffer.from(input.pdfBase64, 'base64');
  if (bytes.toString('base64') !== input.pdfBase64 || bytes.length > PAPER_STUDY_MAX_BYTES || bytes.subarray(0, 5).toString() !== '%PDF-') fail('PAPER_STUDY_IMPORT_INVALID', 400);
  return bytes;
}
