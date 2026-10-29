import { verifyCapabilityArtifactOpenPayload } from
  '../../../packages/host-contract/src/capability-artifact-open.mjs';
import { fail } from './errors.mjs';

const MAX_RENDERED_BYTES = 2 * 1024 * 1024;
const exactResult = value => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === 2 && Object.hasOwn(value, 'opened')
  && Object.hasOwn(value, 'cancelled') && typeof value.opened === 'boolean'
  && typeof value.cancelled === 'boolean' && value.opened !== value.cancelled;

export function createDesktopCapabilityArtifactHost({ nativeArtifactUi,
  now = Date.now, cryptoImpl = globalThis.crypto,
  maxRenderedBytes = MAX_RENDERED_BYTES } = {}) {
  if (!nativeArtifactUi || typeof nativeArtifactUi.previewJson !== 'function'
    || typeof nativeArtifactUi.saveJson !== 'function' || typeof now !== 'function'
    || !cryptoImpl?.subtle || !Number.isSafeInteger(maxRenderedBytes)
    || maxRenderedBytes < 1024 || maxRenderedBytes > MAX_RENDERED_BYTES) {
    fail('CAPABILITY_DESKTOP_ARTIFACT_HOST_CONFIG_INVALID');
  }

  const open = async payload => {
    const { directive, artifact } = await verifyCapabilityArtifactOpenPayload(payload,
      { now: now(), cryptoImpl });
    const content = `${JSON.stringify(artifact.content, null, 2)}\n`;
    if (Buffer.byteLength(content, 'utf8') > maxRenderedBytes) {
      fail('CAPABILITY_DESKTOP_ARTIFACT_RENDER_TOO_LARGE');
    }
    const request = Object.freeze({ title: directive.name, suggestedName: `${directive.name}.json`,
      mediaType: directive.mediaType, content, readOnly: true,
      requestedMode: directive.openMode });
    const result = directive.openMode === 'download'
      ? await nativeArtifactUi.saveJson(request)
      : await nativeArtifactUi.previewJson(request);
    if (!exactResult(result) || directive.openMode !== 'download' && result.opened !== true) {
      fail('CAPABILITY_DESKTOP_ARTIFACT_UI_RESULT_INVALID');
    }
    return { opened: result.opened, cancelled: result.cancelled };
  };
  return Object.freeze({ open });
}
