export class SocialError extends Error {
  constructor(code, statusCode, message) { super(message); this.name = 'SocialError'; this.code = code; this.statusCode = statusCode; this.retryable = false; }
}
