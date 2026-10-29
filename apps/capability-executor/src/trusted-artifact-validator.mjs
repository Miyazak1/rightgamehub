import fs from 'node:fs';
import {
  PAPER_LAYOUT_CONTRACT,
  validatePaperLayoutDecisionV1,
  validatePaperLayoutResultV1,
} from '../../../packages/agent-capabilities/src/paper-layout.mjs';
import { fail } from './errors.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));

async function readJsonArtifact(sourcePath, maxJsonBytes) {
  const stats = await fs.promises.lstat(sourcePath).catch(() => null);
  if (!stats?.isFile() || stats.isSymbolicLink() || stats.size < 2 || stats.size > maxJsonBytes) {
    fail('CAPABILITY_TRUSTED_ARTIFACT_INVALID', { safeFailure: true });
  }
  try { return JSON.parse(await fs.promises.readFile(sourcePath, 'utf8')); }
  catch { fail('CAPABILITY_TRUSTED_ARTIFACT_INVALID', { safeFailure: true }); }
}

function validateDecisionMetadata(metadata, decision) {
  if (!exact(metadata, ['route', 'textLayerPages', 'localLayoutPages', 'localOcrPages'])
    || metadata.route !== decision.route
    || metadata.textLayerPages !== decision.textLayerPages.length
    || metadata.localLayoutPages !== decision.localLayoutPages.length
    || metadata.localOcrPages !== decision.localOcrPages.length) {
    fail('CAPABILITY_TRUSTED_ARTIFACT_METADATA_INVALID', { safeFailure: true });
  }
}

function validateResultMetadata(metadata, result) {
  const ocrPageCount = result.pages.filter(page => page.method === 'local-ocr').length;
  if (!exact(metadata, ['grade', 'pageCount', 'ocrPageCount', 'engineName'])
    || metadata.grade !== result.quality.grade || metadata.pageCount !== result.pages.length
    || metadata.ocrPageCount !== ocrPageCount || metadata.engineName !== result.engine.name) {
    fail('CAPABILITY_TRUSTED_ARTIFACT_METADATA_INVALID', { safeFailure: true });
  }
}

export function createTrustedCapabilityArtifactValidator({
  maxJsonBytes = 64 * 1024 * 1024,
} = {}) {
  if (!Number.isSafeInteger(maxJsonBytes) || maxJsonBytes < 1024
    || maxJsonBytes > 256 * 1024 * 1024) {
    fail('CAPABILITY_TRUSTED_ARTIFACT_VALIDATOR_CONFIG_INVALID');
  }
  const validate = async ({ sourcePath, mediaType, contract, metadata } = {}) => {
    if (contract?.key !== PAPER_LAYOUT_CONTRACT.key) {
      return { kind: 'unregistered' };
    }
    if (!exact(contract, ['key', 'version'])
      || contract.version !== PAPER_LAYOUT_CONTRACT.version) {
      fail('CAPABILITY_TRUSTED_ARTIFACT_CONTRACT_INVALID', { safeFailure: true });
    }
    const value = await readJsonArtifact(sourcePath, maxJsonBytes);
    try {
      if (mediaType === 'application/vnd.mooyu.paper-layout-decision+json') {
        const decision = validatePaperLayoutDecisionV1(value);
        validateDecisionMetadata(metadata, decision);
        return { kind: 'paper-layout-decision', schemaVersion: decision.schemaVersion };
      }
      if (mediaType === 'application/vnd.mooyu.paper-layout+json') {
        const result = validatePaperLayoutResultV1(value);
        validateResultMetadata(metadata, result);
        return { kind: 'paper-layout-result', schemaVersion: result.schemaVersion,
          grade: result.quality.grade };
      }
    } catch (error) {
      if (error?.name === 'CapabilityExecutorError') throw error;
      fail('CAPABILITY_TRUSTED_ARTIFACT_CONTRACT_INVALID', { safeFailure: true, cause: error });
    }
    fail('CAPABILITY_TRUSTED_ARTIFACT_MEDIA_TYPE_INVALID', { safeFailure: true });
  };
  return { validate };
}
