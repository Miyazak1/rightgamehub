import { validateFileExport, validateShare, capabilityError } from '@gamehub/web-game-sdk/sharing-protocol';
export function createFileExportHandlers({apiClient,descriptor,exportFile,signal,checkIdentity,fileExportState={busy:false,requests:[]}}) {
  const requests=fileExportState.requests;
  const verify=async()=>{
    if(signal?.aborted)throw capabilityError('BRIDGE_CLOSED','游戏已结束。');
    await checkIdentity?.();
    const {data}=await apiClient.getLaunch(descriptor.workId,descriptor.releaseId,{signal});
    if(data.workId!==descriptor.workId||data.releaseId!==descriptor.releaseId||data.capabilities?.fileExport!==true)throw capabilityError('BRIDGE_CAPABILITY_NOT_GRANTED','该版本未获准导出文件。');
    if(signal?.aborted)throw capabilityError('BRIDGE_CLOSED','游戏已结束。');
  };
  return {handlers:{'files.download':async input=>{
    if(!exportFile)throw capabilityError('FILE_EXPORT_UNSUPPORTED','当前宿主不支持安全导出，请在网页版打开。');
    const now=Date.now();while(requests.length&&requests[0]<now-60000)requests.shift();
    if(fileExportState.busy||requests.length>=5)throw capabilityError('FILE_EXPORT_BUSY','请完成当前导出，或稍后重试。',true);
    fileExportState.busy=true;requests.push(now);
    try {const file=validateFileExport(input);await verify();return await exportFile(file,{signal,verify,descriptor});} catch(error) {if(typeof error.code==='string')throw error;throw capabilityError('FILE_EXPORT_FAILED','导出失败，请重试。',true);} finally {fileExportState.busy=false;}
  }}};
}
export function createShareLinkHandlers({apiClient,descriptor,initialShareCode,getGameSession,signal}) {
  return {handlers:{
    'shares.create':async input=>{
      const safe=validateShare(input),session=await getGameSession('shareLinks');
      return (await apiClient.createGameShare(session,safe,{signal})).data;
    },
    'shares.current':async input=>{
      if(Object.keys(input).length)throw capabilityError('BRIDGE_REQUEST_INVALID','shares.current 不接受参数。');
      if(!initialShareCode)return null;
      const {data}=await apiClient.getGameShare(initialShareCode,{signal});
      if(data.workId!==descriptor.workId||data.releaseId!==descriptor.releaseId)throw capabilityError('SHARE_CONTEXT_MISMATCH','分享不属于当前游戏版本。');
      return data;
    },
  }};
}
