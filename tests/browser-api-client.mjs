import { createApiClient as createClient } from '../packages/platform-api-client/src/index.mjs';
export * from '../packages/platform-api-client/src/index.mjs';

// The host and HTTP transport must describe the same fixture session. The real
// application no longer infers a login by calling /me without a host token.
export function createApiClient(options = {}) {
  const api = createClient(options);
  const bootstrap = api.bootstrapSession;
  api.bootstrapSession = (refreshToken, requestOptions) => bootstrap(refreshToken, {
    ...requestOptions, headers: { ...requestOptions?.headers, 'X-Mooyu-Fixture-Session': '1' },
  });
  api.fixtureAccount = {
    getAccessToken: options.getAccessToken ?? (() => null),
    getRefreshToken: options.getRefreshToken ?? (() => null),
  };
  return api;
}
