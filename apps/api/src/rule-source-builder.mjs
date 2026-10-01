import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import yauzl from 'yauzl';
import { inspectMultiplayerProject } from '@gamehub/creator-tools';
import { digestRulesBundle } from '@gamehub/rules-sdk';
import { RULE_BUILD_LIMITS,normalizeRuleBuildPlan } from './rule-build-policy.mjs';

const invalid = (code,message) => Object.assign(new Error(message),{ code });
const selectedFile = value => ['platform.json','creator-submission.json','rules/adapter.cjs','rules/tests.json'].includes(value) || /^(?!rules\/).*\.(?:html|js|mjs)$/u.test(value);
const safePath = value => {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') || Buffer.byteLength(value) > 1024) throw invalid('RULE_SOURCE_PATH_INVALID','Rule source contains an unsafe path.');
  const directory=value.endsWith('/'); const trimmed=directory?value.slice(0,-1):value; const parts=trimmed.split('/');
  if (!parts.length || parts.some(part=>!part||part==='.'||part==='..')) throw invalid('RULE_SOURCE_PATH_INVALID','Rule source contains an unsafe path.');
  return { directory,relative:parts.join('/') };
};
const readEntry = async (zip,entry,onBytes) => {
  const chunks=[]; let size=0; let checksum=0;
  for await (const chunk of await zip.openReadStreamPromise(entry)) {
    size+=chunk.length; onBytes(chunk.length);
    if (size>RULE_BUILD_LIMITS.fileBytes) throw invalid('RULE_SOURCE_LIMIT_EXCEEDED','Rule source file exceeds the limit.');
    checksum=crc32(chunk,checksum); chunks.push(chunk);
  }
  if (size!==entry.uncompressedSize || checksum!==entry.crc32) throw invalid('RULE_SOURCE_INTEGRITY_INVALID','Rule source entry failed its integrity check.');
  return Buffer.concat(chunks,size);
};

export async function buildRuleSourceBundle({ inputPath,outputPath,plan:rawPlan }) {
  const plan=normalizeRuleBuildPlan(rawPlan); const archive=await fsp.stat(inputPath);
  if (!archive.isFile() || archive.size<22 || archive.size>RULE_BUILD_LIMITS.archiveBytes) throw invalid('RULE_SOURCE_LIMIT_EXCEEDED','Rule source ZIP size is invalid.');
  const sourceSha256=crypto.createHash('sha256').update(await fsp.readFile(inputPath)).digest('hex');
  if (sourceSha256!==plan.sourceSha256) throw invalid('RULE_BUILD_SOURCE_DIGEST_MISMATCH','Rule source ZIP digest does not match the approved submission.');
  const projectRoot=await fsp.mkdtemp(path.join(os.tmpdir(),'gamehub-rule-build-')); const zip=await yauzl.openPromise(inputPath,{ lazyEntries:true,autoClose:true,strictFileNames:true,validateEntrySizes:true });
  let count=0; let expandedBytes=0; const seen=new Set();
  try {
    if (zip.entryCount>RULE_BUILD_LIMITS.files) throw invalid('RULE_SOURCE_LIMIT_EXCEEDED','Rule source contains too many entries.');
    for await (const entry of zip.eachEntry()) {
      if (++count>RULE_BUILD_LIMITS.files) throw invalid('RULE_SOURCE_LIMIT_EXCEEDED','Rule source contains too many entries.');
      const { directory,relative }=safePath(entry.fileName); const mode=entry.externalFileAttributes>>>16; const type=mode&0xf000;
      if ((type&&type!==(directory?0x4000:0x8000)) || entry.isEncrypted() || ![0,8].includes(entry.compressionMethod)) throw invalid('RULE_SOURCE_UNSUPPORTED','Rule source contains a link, special file, encryption, or unsupported compression.');
      if (directory || !selectedFile(relative)) continue;
      const folded=relative.toLocaleLowerCase('en-US'); if (seen.has(folded)) throw invalid('RULE_SOURCE_PATH_CONFLICT','Rule source contains duplicate or case-conflicting paths.'); seen.add(folded);
      if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize>RULE_BUILD_LIMITS.fileBytes) throw invalid('RULE_SOURCE_LIMIT_EXCEEDED','Rule source file exceeds the limit.');
      const data=await readEntry(zip,entry,bytes=>{ expandedBytes+=bytes; if(expandedBytes>RULE_BUILD_LIMITS.expandedBytes) throw invalid('RULE_SOURCE_LIMIT_EXCEEDED','Expanded rule source exceeds the limit.'); });
      const target=path.resolve(projectRoot,...relative.split('/')); if(!target.startsWith(`${projectRoot}${path.sep}`)) throw invalid('RULE_SOURCE_PATH_INVALID','Rule source path escapes its root.');
      await fsp.mkdir(path.dirname(target),{ recursive:true }); await fsp.writeFile(target,data,{ flag:'wx',mode:0o600 });
    }
    const report=await inspectMultiplayerProject(projectRoot);
    if (!report.ok) { const first=report.findings.find(item=>item.severity==='error'); throw invalid(first?.code ?? 'RULE_BUILD_VALIDATION_FAILED',first?.message ?? 'Rule source validation failed.'); }
    const submission=JSON.parse(await fsp.readFile(path.join(projectRoot,'creator-submission.json'),'utf8'));
    for (const field of ['workId','modeKey','rulesetVersion']) if (submission[field]!==plan[field]) throw invalid('RULE_BUILD_IDENTITY_MISMATCH',`Rule source ${field} does not match the approved submission.`);
    const bundle=await fsp.readFile(path.join(projectRoot,'rules','adapter.cjs'));
    if (!bundle.length || bundle.length>RULE_BUILD_LIMITS.bundleBytes) throw invalid('RULE_BUILD_OUTPUT_INVALID','Rule bundle size is invalid.');
    await fsp.mkdir(path.dirname(outputPath),{ recursive:true }); const temporary=`${outputPath}.${process.pid}.partial`; await fsp.writeFile(temporary,bundle,{ flag:'wx',mode:0o600 }); await fsp.rename(temporary,outputPath);
    return Object.freeze({ policyVersion:plan.policyVersion,templateKey:plan.templateKey,templateVersion:plan.templateVersion,configSha256:plan.configSha256,sourceSha256,fileCount:count,expandedBytes,bundleBytes:bundle.length,bundleSha256:digestRulesBundle(bundle),doctorSummary:report.summary });
  } finally { zip.close(); await fsp.rm(projectRoot,{ recursive:true,force:true }).catch(()=>{}); }
}
