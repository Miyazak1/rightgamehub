// Read-only release decisions. Schema, login volumes, grants and history are never changed here.
export function assessAgentPluginRelease(snapshot,{operation='upgrade'}={}){
 if(!['upgrade','rollback'].includes(operation)||!snapshot||typeof snapshot!=='object')throw Error('RELEASE_SNAPSHOT_INVALID');
 const counts=['runningInteractions','runningScheduleFires','pendingDeliveries','uncertainDeliveries','unfinishedImagePages'];
 for(const key of counts)if(!Number.isSafeInteger(snapshot[key])||snapshot[key]<0)throw Error('RELEASE_SNAPSHOT_INVALID');
 const blockers=[];
 for(const key of ['backupsVerified','imageIdsPinned','loginVolumeVerified','channelSecretAligned','paperDisabled'])if(snapshot[key]!==true)blockers.push(key);
 if(!snapshot.admissionPaused)blockers.push('admissionNotPaused');
 for(const key of counts)if(snapshot[key])blockers.push(key);
 if(operation==='upgrade')for(const key of ['apiSupportsPluginV1','apiSupportsImageV1','executorSupportsPluginV1','workerSupportsImageV1','chineseFontVerified','migration166Verified','workerSchemaVerified'])if(snapshot[key]!==true)blockers.push(key);
 if(operation==='rollback'&&snapshot.oldPluginVersionsRetained!==true)blockers.push('oldPluginVersionsNotRetained');
 return {operation,ready:blockers.length===0,blockers,mutationsPerformed:false,dropTables:false,resetCounters:false,replaceLoginVolume:false};
}
