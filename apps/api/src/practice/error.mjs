export class PracticeError extends Error {
  constructor(code, statusCode, message) { super(message); this.code = code; this.statusCode = statusCode; this.retryable = statusCode === 429 || statusCode >= 500; }
}
export const rejectPractice = (code, status, message) => { throw new PracticeError(code, status, message); };
