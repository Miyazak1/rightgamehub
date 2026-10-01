import crypto from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { buildRuleSourceBundle } from './rule-source-builder.mjs';
import { RULE_BUILD_LIMITS,normalizeRuleBuildPlan } from './rule-build-policy.mjs';

const pause=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
const invalid=(code,message)=>Object.assign(new Error(message),{ code });
const digestFile=async file=>crypto.createHash('sha256').update(await fsp.readFile(file)).digest('hex');
const readJson=async file=>{ const stat=await fsp.stat(file); if(!stat.isFile()||stat.size<2||stat.size>1024*1024)throw invalid('RULE_BUILDER_PROTOCOL_INVALID','Rule Builder response size is invalid.'); try{return JSON.parse(await fsp.readFile(file,'utf8'));}catch{throw invalid('RULE_BUILDER_PROTOCOL_INVALID','Rule Builder response is malformed.');} };

export const ruleBuilderMailboxPaths=root=>Object.freeze({ root:path.resolve(root),inputs:path.resolve(root,'inputs'),requests:path.resolve(root,'requests'),processing:path.resolve(root,'processing'),responses:path.resolve(root,'responses'),outputs:path.resolve(root,'outputs'),cancellations:path.resolve(root,'cancellations') });
export async function writeRuleBuilderResponse(root,id,value){ const {responses}=ruleBuilderMailboxPaths(root); await fsp.mkdir(responses,{recursive:true}); const target=path.join(responses,`${id}.json`); const temporary=`${target}.${process.pid}.partial`; await fsp.writeFile(temporary,JSON.stringify(value),{flag:'wx',mode:0o600}); await fsp.rename(temporary,target); }

export function createRuleBuildRunner({ mode='local',builderRoot,ids=()=>crypto.randomUUID(),clock=()=>new Date() }) {
  if(mode==='local') return Object.freeze({ async run({inputPath,plan,onHeartbeat=async()=>true}){ if(!(await onHeartbeat()))throw invalid('LEASE_LOST','Rule build lease was lost.'); const id=ids(); const outputPath=path.join(path.resolve(builderRoot),`local-${id}.cjs`); const report=await buildRuleSourceBundle({inputPath,outputPath,plan}); return {report,outputPath,cleanup:()=>fsp.rm(outputPath,{force:true})}; } });
  if(mode!=='isolated') throw new Error('Unsupported Rule Builder execution mode.');
  const paths=ruleBuilderMailboxPaths(builderRoot);
  return Object.freeze({ async run({inputPath,plan:rawPlan,onHeartbeat=async()=>true}){
    const id=ids(); if(!/^[0-9a-f-]{36}$/u.test(id))throw invalid('RULE_BUILDER_PROTOCOL_INVALID','Rule Builder request ID is invalid.'); const plan=normalizeRuleBuildPlan(rawPlan);
    await Promise.all(Object.values(paths).map(directory=>fsp.mkdir(directory,{recursive:true})));
    const input=path.join(paths.inputs,`${id}.zip`); const output=path.join(paths.outputs,`${id}.cjs`); const request=path.join(paths.requests,`${id}.json`); const response=path.join(paths.responses,`${id}.json`); const cancel=path.join(paths.cancellations,id); const temporary=`${request}.${process.pid}.partial`;
    const inputStat=await fsp.stat(inputPath); if(!inputStat.isFile()||inputStat.size>RULE_BUILD_LIMITS.archiveBytes)throw invalid('RULE_SOURCE_LIMIT_EXCEEDED','Rule source ZIP size is invalid.'); await fsp.copyFile(inputPath,input,fsConstants.COPYFILE_EXCL);
    await fsp.writeFile(temporary,JSON.stringify({version:1,id,inputRelative:`inputs/${id}.zip`,outputRelative:`outputs/${id}.cjs`,plan,expiresAt:new Date(clock().getTime()+RULE_BUILD_LIMITS.timeoutMs+15000).toISOString()}),{flag:'wx',mode:0o600}); await fsp.rename(temporary,request);
    let lastHeartbeat=Date.now(); const deadline=Date.now()+RULE_BUILD_LIMITS.timeoutMs+20000;
    try { while(Date.now()<deadline){ let result=null; try{result=await readJson(response);}catch(error){if(error.code!=='ENOENT')throw error;} if(result){ if(result.version!==1||result.id!==id||typeof result.ok!=='boolean')throw invalid('RULE_BUILDER_PROTOCOL_INVALID','Rule Builder response envelope is invalid.'); if(!result.ok)throw Object.assign(new Error(result.error?.message??'Rule build failed.'),{code:result.error?.code??'RULE_BUILD_FAILED'}); const stat=await fsp.stat(output); if(!stat.isFile()||stat.size!==result.report?.bundleBytes||await digestFile(output)!==result.report?.bundleSha256)throw invalid('RULE_BUILDER_OUTPUT_INTEGRITY_INVALID','Rule Builder output does not match its report.'); return {report:result.report,outputPath:output,cleanup:()=>fsp.rm(output,{force:true})}; } if(Date.now()-lastHeartbeat>=10000){lastHeartbeat=Date.now();if(!(await onHeartbeat())){await fsp.writeFile(cancel,'',{flag:'wx'}).catch(error=>{if(error.code!=='EEXIST')throw error;});throw invalid('LEASE_LOST','Rule build lease was lost.');}} await pause(100);} throw invalid('RULE_BUILD_TIMEOUT','Isolated Rule Builder timed out.'); }
    finally { await Promise.all([request,response,cancel,input,temporary].map(file=>fsp.rm(file,{force:true}).catch(()=>{}))); }
  } });
}
