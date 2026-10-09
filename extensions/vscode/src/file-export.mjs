import path from 'node:path';
import os from 'node:os';
import {validateFileExport,capabilityError,FILE_EXPORT_BYTES} from '../../../packages/web-game-sdk/src/sharing-protocol.mjs';
export async function exportNativeFile(input,{vscode,apiOrigin,signal,remote=false,fetchImpl=globalThis.fetch}) {
  if(remote)throw capabilityError('FILE_EXPORT_UNSUPPORTED','远程编辑器暂不支持本机导出，请使用网页版。');
  const uuid=/^[0-9a-f-]{36}$/iu;
  if(!input||!uuid.test(input.workId)||!uuid.test(input.releaseId)||typeof input.dataBase64!=='string'||input.dataBase64.length>Math.ceil(FILE_EXPORT_BYTES/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/u.test(input.dataBase64))throw capabilityError('FILE_EXPORT_INVALID','导出数据无效。');
  const bytes=Buffer.from(input.dataBase64,'base64');
  if(bytes.toString('base64')!==input.dataBase64)throw capabilityError('FILE_EXPORT_INVALID','导出编码无效。');
  const file=validateFileExport({filename:input.filename,mimeType:input.mimeType,data:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});
  const check=()=>{if(signal?.aborted)throw capabilityError('FILE_EXPORT_CANCELLED','游戏已结束或导出已取消。');};
  const verify=async()=>{check();const response=await fetchImpl(new URL('/v1/works/'+encodeURIComponent(input.workId)+'/launch?releaseId='+encodeURIComponent(input.releaseId),apiOrigin),{signal,redirect:'error',headers:{accept:'application/json','cache-control':'no-cache'}});if(!response.ok)throw capabilityError('BRIDGE_CAPABILITY_NOT_GRANTED','此版本已不可用。');const {data}=await response.json();if(data?.workId!==input.workId||data?.releaseId!==input.releaseId||data?.capabilities?.fileExport!==true)throw capabilityError('BRIDGE_CAPABILITY_NOT_GRANTED','此版本不允许导出。');check();};
  await verify();
  const uri=await vscode.window.showSaveDialog({defaultUri:vscode.Uri.file(path.join(os.homedir(),file.filename)),saveLabel:'保存游戏文件',filters:file.mimeType==='image/png'?{'PNG 图片':['png']}:{'JSON 数据':['json']}});
  if(!uri)throw capabilityError('FILE_EXPORT_CANCELLED','保存已取消。');
  if(uri.scheme!=='file')throw capabilityError('FILE_EXPORT_UNSUPPORTED','请选择本机文件路径。');
  validateFileExport({...file,filename:path.basename(uri.fsPath)});
  await verify();check();
  try{await vscode.workspace.fs.writeFile(uri,new Uint8Array(file.data));}catch{throw capabilityError('FILE_EXPORT_FAILED','文件写入失败，请重新尝试。',true);}
  return {status:'saved',filename:path.basename(uri.fsPath)};
}
