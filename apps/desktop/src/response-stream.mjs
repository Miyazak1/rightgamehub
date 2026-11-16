export function boundedResponseStream(response,{maxBytes,guard=()=>{}}){
  const reader=response.body?.getReader();let total=0,finished=false;
  if(!reader)throw Error('DESKTOP_DOWNLOAD_RESPONSE_INVALID');
  const stop=async reason=>{if(finished)return;finished=true;await reader.cancel(reason).catch(()=>{});try{reader.releaseLock();}catch{}};
  return new ReadableStream({async pull(controller){
    try{guard();const part=await reader.read();guard();if(finished)return;
      if(part.done){finished=true;reader.releaseLock();controller.close();return;}
      total+=part.value.byteLength;if(total>maxBytes)throw Object.assign(Error('DESKTOP_DOWNLOAD_TOO_LARGE'),{code:'DESKTOP_DOWNLOAD_TOO_LARGE'});
      controller.enqueue(part.value);
    }catch(error){if(!finished){await stop(error);controller.error(error);}}
  },cancel:stop});
}
