import { validateFileExport, capabilityError } from '../../web-game-sdk/src/sharing-protocol.mjs';
export function createBrowserFileExporter(window,{allowAnchor=true}={}) {
  return {async download(input,{verify=async()=>{},signal}={}) {
    const file=validateFileExport(input),check=()=>{if(signal?.aborted)throw capabilityError('FILE_EXPORT_CANCELLED','导出已取消。');};
    check();
    try {
      if(typeof window?.showSaveFilePicker==='function') {
        // Called directly from the trusted platform button, preserving user activation.
        const handle=await window.showSaveFilePicker({suggestedName:file.filename,excludeAcceptAllOption:true,types:[{description:file.mimeType==='image/png'?'PNG 图片':'JSON 数据',accept:{[file.mimeType]:[file.mimeType==='image/png'?'.png':'.json']}}]});
        await verify();check();const writer=await handle.createWritable();
        try {check();await writer.write(file.data);check();await writer.close();}catch(error){await writer.abort().catch(()=>{});throw error;}
        return {status:'saved',filename:file.filename};
      }
      if(!allowAnchor||!window?.document||!window.URL?.createObjectURL)throw capabilityError('FILE_EXPORT_UNSUPPORTED','当前宿主没有安全保存接口，请在网页版打开。');
      await verify();check();
      const url=window.URL.createObjectURL(new window.Blob([file.data],{type:file.mimeType}));
      const anchor=window.document.createElement('a');anchor.href=url;anchor.download=file.filename;anchor.hidden=true;window.document.body.append(anchor);anchor.click();anchor.remove();
      const timer=setTimeout(()=>window.URL.revokeObjectURL(url),60000);timer.unref?.();
      return {status:'download_started',filename:file.filename};
    } catch(error) {
      if(error.name==='AbortError')throw capabilityError('FILE_EXPORT_CANCELLED','保存已取消。');
      if(typeof error.code==='string')throw error;
      throw capabilityError('FILE_EXPORT_FAILED','保存失败，请重新尝试。',true);
    }
  }};
}
