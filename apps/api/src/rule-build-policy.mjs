import crypto from 'node:crypto';

export const RULE_BUILD_POLICY_VERSION = 1;
export const RULE_BUILD_LIMITS = Object.freeze({
  archiveBytes: 20 * 1024 * 1024,
  expandedBytes: 64 * 1024 * 1024,
  fileBytes: 4 * 1024 * 1024,
  files: 1000,
  bundleBytes: 1024 * 1024,
  timeoutMs: 60_000,
  logBytes: 64 * 1024,
});

const workPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const modePattern = /^[a-z][a-z0-9_]{1,63}$/u;
const versionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const digestPattern = /^[a-f0-9]{64}$/u;
const canonicalJson = value => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};

export function normalizeRuleBuildPlan(input = {}) {
  if (input.templateKey !== 'rules-cjs-v1' || String(input.templateVersion ?? '1') !== '1') throw Object.assign(new Error('Only rules-cjs-v1 is available.'), { code: 'RULE_BUILD_TEMPLATE_UNAVAILABLE' });
  if (!workPattern.test(input.workId ?? '') || !modePattern.test(input.modeKey ?? '') || !versionPattern.test(input.rulesetVersion ?? '')) throw Object.assign(new Error('Rule build identity is invalid.'), { code: 'RULE_BUILD_IDENTITY_INVALID' });
  if (!digestPattern.test(input.sourceSha256 ?? '')) throw Object.assign(new Error('Rule build source digest is invalid.'), { code: 'RULE_BUILD_SOURCE_INVALID' });
  const plan = Object.freeze({
    policyVersion: RULE_BUILD_POLICY_VERSION,
    templateKey: 'rules-cjs-v1',
    templateVersion: '1',
    workId: input.workId,
    modeKey: input.modeKey,
    rulesetVersion: input.rulesetVersion,
    sourceSha256: input.sourceSha256,
  });
  return Object.freeze({ ...plan,configSha256: crypto.createHash('sha256').update(canonicalJson(plan)).digest('hex') });
}
