export class CapabilityExecutorError extends Error {
  constructor(code, options = {}) {
    super(code, options);
    this.name = 'CapabilityExecutorError';
    this.code = code;
    this.retryable = options.retryable === true;
    this.safeFailure = options.safeFailure === true;
  }
}

export const fail = (code, options) => { throw new CapabilityExecutorError(code, options); };
