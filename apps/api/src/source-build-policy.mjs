import crypto from 'node:crypto';
import { validateAssetPath } from './web-package-policy.mjs';

export const SOURCE_BUILD_POLICY_VERSION = 1;
export const SOURCE_BUILD_LIMITS = Object.freeze({ archiveBytes: 100 * 1024 ** 2,outputBytes: 100 * 1024 ** 2,expandedBytes: 300 * 1024 ** 2,fileBytes: 100 * 1024 ** 2,files: 5000,timeoutMs: 5 * 60_000,logBytes: 64 * 1024 });
const lockfiles = Object.freeze(['pnpm-lock.yaml','package-lock.json','yarn.lock']);
const canonicalJson = value => { if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`; if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`; return JSON.stringify(value); };
export const sourceBuildConfigDigest = config => crypto.createHash('sha256').update(canonicalJson(config)).digest('hex');
export function normalizeSourceSubdirectory(value = '') { const normalized=String(value ?? '').replace(/^\/+|\/+$/gu,''); return normalized ? validateAssetPath(normalized) : ''; }
export function detectSourceBuildPlans({ rootNames = [], packageJson = null } = {}) {
  const names=[...new Set(rootNames.map(value=>String(value).toLowerCase()))]; const has=value=>names.includes(value); const plans=[];
  if (has('index.html') && !has('package.json')) plans.push(Object.freeze({ templateKey:'static-v1',templateVersion:'1',availability:'ready',outputDirectory:'.',label:'静态 HTML（不执行源码）',reason:'仓库根目录包含 index.html，且没有依赖安装描述。' }));
  if (has('package.json')) { const lockfile=lockfiles.find(has) ?? null; const dependencies={ ...(packageJson?.dependencies ?? {}),...(packageJson?.devDependencies ?? {}) }; const vite=has('vite.config.js')||has('vite.config.mjs')||has('vite.config.ts')||Object.hasOwn(dependencies,'vite'); if (vite) plans.push(Object.freeze({ templateKey:'vite-v1',templateVersion:'1',availability:lockfile?'planned':'blocked',outputDirectory:'dist',lockfile,label:'Vite 固定模板',reason:lockfile?'检测到 Vite 与锁文件；依赖代理 Builder 尚未开放。':'Vite 自动构建要求提交锁文件。' })); }
  return Object.freeze(plans);
}
export function normalizeStaticBuildPlan(input = {}) { if (input.templateKey!=='static-v1'||String(input.templateVersion ?? '1')!=='1') throw Object.assign(new Error('Only the static-v1 build template is currently executable.'),{ code:'BUILD_TEMPLATE_UNAVAILABLE' }); const plan=Object.freeze({ policyVersion:SOURCE_BUILD_POLICY_VERSION,templateKey:'static-v1',templateVersion:'1',subdirectory:normalizeSourceSubdirectory(input.subdirectory),outputDirectory:'.',installCommand:null,buildCommand:null }); return Object.freeze({ ...plan,configSha256:sourceBuildConfigDigest(plan) }); }
