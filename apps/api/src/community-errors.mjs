export class CommunityError extends Error {
  constructor(code, statusCode, message) {
    super(message);
    this.name = 'CommunityError';
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = statusCode >= 500;
  }
}

export const fail = (code, status, message) => { throw new CommunityError(code, status, message); };
