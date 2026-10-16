import { isAllowedParentOrigin } from './protocol.mjs';

const unavailable = status => ['disabled','withdrawn','suspended','revoked'].includes(status);

export function resolveEmbedRelease({ descriptor, requestedReleaseId = null, parentOrigin, allowLoopback = false } = {}) {
  if (!descriptor || descriptor.schemaVersion !== 1 || descriptor.embedStatus !== 'public' || unavailable(descriptor.embedStatus) || !['fixed','current'].includes(descriptor.channel) || typeof descriptor.releaseDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(descriptor.releaseDigest)) throw Object.assign(new Error('Courseware release is unavailable.'), { code:'EMBED_RELEASE_UNAVAILABLE' });
  const policy = descriptor.sourcePolicy ?? { mode:'disabled' };
  if (policy.mode === 'disabled' || !isAllowedParentOrigin(parentOrigin,{allowLoopback,allowlist:policy.mode === 'allowlist' ? policy.origins : null})) throw Object.assign(new Error('Parent origin is not allowed.'), { code:'EMBED_ORIGIN_DENIED' });
  if (requestedReleaseId && requestedReleaseId !== descriptor.releaseId) throw Object.assign(new Error('Fixed release does not match.'), { code:'EMBED_RELEASE_UNAVAILABLE' });
  return Object.freeze({ workId:descriptor.workId,releaseId:descriptor.releaseId,releaseDigest:descriptor.releaseDigest,channel:requestedReleaseId ? 'fixed' : descriptor.channel });
}
