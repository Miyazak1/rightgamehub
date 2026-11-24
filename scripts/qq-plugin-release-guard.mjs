// Mandatory application-level wrapper for FUTURE release integrations. It is
// deliberately separate from previously shipped/frozen update packages.
export const QQ_SAFE_FEATURE_ROLES=Object.freeze(['gamehub-production-api-1','gamehub-production-agent-interactions-1','gamehub-production-web-1','gamehub-production-agent-blog-public-scheduler-1']);
export function assertQQApplicationHealthy(value,now=Date.now()){
 const r=value?.runtime,age=now-Date.parse(r?.verifiedAt),sampleAge=now-Date.parse(r?.checkedAt);
 if(!r||r.snapshotVersion!==2||age<0||age>30000||!Number.isFinite(age)||sampleAge<0||sampleAge>30000||!Number.isFinite(sampleAge)||!['available','loggedIn','coreReady','accountMatches','groupReady','connected'].every(k=>r[k]===true)||r.restartRequired===true)throw Error('QQ_APPLICATION_BASELINE_NOT_READY');
}
export async function withQQReleaseGuard({roles,captureProtected,readQQ,apply,pause=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now}){
 if(!Array.isArray(roles)||!roles.length||new Set(roles).size!==roles.length||roles.some(r=>!QQ_SAFE_FEATURE_ROLES.includes(r)))throw Error('QQ_RELEASE_SCOPE_REFUSED');
 const before=await captureProtected();assertQQApplicationHealthy(await readQQ(),now());
 const result=await apply();let lastSample=null;
 for(let i=0;i<4;i++){
  await pause(10000);const sample=await readQQ();assertQQApplicationHealthy(sample,now());
  if(lastSample&&Date.parse(sample.runtime.checkedAt)<=Date.parse(lastSample))throw Error('QQ_RELEASE_OBSERVATION_NOT_ADVANCING');lastSample=sample.runtime.checkedAt;
  if(JSON.stringify(await captureProtected())!==JSON.stringify(before))throw Error('QQ_RELEASE_PROTECTED_STATE_CHANGED');
 }
 return {result,qqApplicationVerified:true,stableWindowMs:40000};
}
