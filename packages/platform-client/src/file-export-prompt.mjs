import { capabilityError } from '@gamehub/web-game-sdk/sharing-protocol';
/** Trusted parent UI: iframe requests never trigger an automatic filesystem write. */
export function promptFileExport(host,file,{signal,verify,descriptor},document=globalThis.document) {
  if(!host.files?.download||!document?.createElement) return Promise.reject(capabilityError('FILE_EXPORT_UNSUPPORTED','此宿主暂不支持文件导出，请在网页版打开。'));
  return new Promise((resolve,reject)=>{
    const controller=new AbortController(),dialog=document.createElement('dialog');dialog.className='game-export-dialog';dialog.setAttribute('aria-label','保存游戏文件');
    const title=document.createElement('h2');title.textContent='保存游戏文件';
    const description=document.createElement('p');description.textContent=file.filename+' · '+Math.ceil(file.data.byteLength/1024)+' KiB';
    const save=document.createElement('button'),cancel=document.createElement('button');save.textContent='选择位置并保存';cancel.textContent='取消';
    dialog.append(title,description,save,cancel);
    let done=false;const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.abort();dialog.close?.();dialog.remove();error?reject(error):resolve(result);};
    const abort=()=>finish(capabilityError('FILE_EXPORT_CANCELLED','导出已取消。'));
    const timer=setTimeout(()=>finish(capabilityError('FILE_EXPORT_TIMEOUT','保存等待超时，请重试。',true)),120000);
    signal?.addEventListener('abort',abort,{once:true});
    cancel.onclick=abort;dialog.addEventListener('cancel',event=>{event.preventDefault();abort();});
    save.onclick=()=>{if(done)return;save.disabled=true;host.files.download(file,{signal:controller.signal,verify,descriptor}).then(result=>finish(null,result),error=>finish(error));};
    if(signal?.aborted){abort();return;}
    (document.querySelector('.app')??document.body).append(dialog);dialog.showModal();cancel.focus();
  });
}
