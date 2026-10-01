import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { RULE_BUILD_LIMITS,normalizeRuleBuildPlan } from './rule-build-policy.mjs';

const code=error=>typeof error?.code==='string'&&error.code.length<=100?error.code:'RULE_BUILD_FAILED';
const digestFile=async file=>crypto.createHash('sha256').update(await fsp.readFile(file)).digest('hex');
export function createMultiplayerRuleBuildWorker({repository,buildRunner,quarantineStore,workingRoot,enabled=true,builderImageDigest,ids=()=>crypto.randomUUID()}){
  const root=path.resolve(workingRoot);
  return Object.freeze({async runOnce({targetBuildId=null}={}){
    if(!enabled)return null;const claim=await repository.claimNext({leaseToken:ids(),targetBuildId});if(!claim)return null;
    await fsp.mkdir(root,{recursive:true});const working=await fsp.mkdtemp(path.join(root,'attempt-'));const sourcePath=path.join(working,'source.zip');let output=null;let objectKey=null;
    try{
      if(!builderImageDigest||claim.builderImageDigest!==builderImageDigest)throw Object.assign(new Error('Queued rule build does not match the deployed Builder image.'),{code:'RULE_BUILDER_IMAGE_CHANGED'});
      const original=quarantineStore.pathFor(claim.sourceObjectKey);if(await digestFile(original)!==claim.sourceSha256)throw Object.assign(new Error('Approved rule source digest changed.'),{code:'RULE_BUILD_SOURCE_DIGEST_MISMATCH'});await fsp.copyFile(original,sourcePath);
      await repository.markBuilding(claim,ids());
      const plan=normalizeRuleBuildPlan({templateKey:'rules-cjs-v1',templateVersion:'1',workId:claim.workId,modeKey:claim.modeKey,rulesetVersion:claim.rulesetVersion,sourceSha256:claim.sourceSha256});
      output=await buildRunner.run({inputPath:sourcePath,plan,onHeartbeat:()=>repository.renewLease({jobId:claim.jobId,leaseToken:claim.leaseToken})});
      objectKey=`quarantine/${ids()}/${ids()}.bin`;const stored=await quarantineStore.putStream(objectKey,fs.createReadStream(output.outputPath),RULE_BUILD_LIMITS.bundleBytes);
      if(stored.bytes!==output.report.bundleBytes||stored.sha256!==output.report.bundleSha256)throw Object.assign(new Error('Stored rule bundle does not match the Builder report.'),{code:'RULE_BUILDER_OUTPUT_INTEGRITY_INVALID'});
      return await repository.finish({claim,objectKey,report:output.report,eventId:ids()});
    }catch(error){if(objectKey)await quarantineStore.remove(objectKey).catch(()=>{});await repository.fail({claim,errorCode:code(error),eventId:ids()}).catch(()=>{});throw error;}
    finally{await output?.cleanup?.().catch(()=>{});await fsp.rm(working,{recursive:true,force:true}).catch(()=>{});}
  }});
}
