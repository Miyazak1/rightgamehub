export const DESKTOP_DOWNLOAD_PREFIX='/downloads/desktop';
export const DESKTOP_MANIFEST_URL=DESKTOP_DOWNLOAD_PREFIX+'/manifest.json';
export const desktopPreviewVersion=value=>typeof value==='string'&&/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-preview\.[1-9]\d*$/.test(value)&&value.length<=64;
const invalid=()=>{throw Error('DESKTOP_DOWNLOAD_MANIFEST_INVALID');};
export function validateDesktopDownloadManifest(value) {
  const release=value?.windowsX64;
  if(value?.schemaVersion!==1||value.product!=='mooyu-desktop'||value.channel!=='preview'||!release||!desktopPreviewVersion(release.version))invalid();
  const filename=`MooyuWorkshop-${release.version}-x64-Setup.exe`,base=`${DESKTOP_DOWNLOAD_PREFIX}/${release.version}`;
  if(release.platform!=='windows'||release.arch!=='x64'||release.filename!==filename||release.url!==`${base}/${filename}`||release.checksumUrl!==`${base}/SHA256SUMS.txt`||release.signature!=='unsigned'||!Number.isSafeInteger(release.sizeBytes)||release.sizeBytes<2||release.sizeBytes>1024**3||!/^[a-f0-9]{64}$/.test(release.sha256??''))invalid();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(release.releaseDate??'')||!Number.isFinite(Date.parse(release.releaseDate+'T00:00:00Z'))||new Date(release.releaseDate+'T00:00:00Z').toISOString().slice(0,10)!==release.releaseDate)invalid();
  for(const locale of ['zh-CN','en'])if(!Array.isArray(release.notes?.[locale])||release.notes[locale].length<1||release.notes[locale].length>8||release.notes[locale].some(text=>typeof text!=='string'||!text.trim()||text.length>300))invalid();
  // Return only public, displayable fields; never forward a build report object.
  return {schemaVersion:1,product:'mooyu-desktop',channel:'preview',windowsX64:{version:release.version,platform:'windows',arch:'x64',filename,url:release.url,checksumUrl:release.checksumUrl,signature:'unsigned',sizeBytes:release.sizeBytes,sha256:release.sha256,releaseDate:release.releaseDate,notes:{'zh-CN':[...release.notes['zh-CN']],en:[...release.notes.en]}}};
}
export async function loadDesktopDownloadManifest(fetchImpl=globalThis.fetch,{signal}={}) {
  const response=await fetchImpl(DESKTOP_MANIFEST_URL,{signal,redirect:'error',credentials:'omit',cache:'no-store',headers:{Accept:'application/json'}});
  if(!response.ok||response.redirected||!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')??''))throw Error('DESKTOP_DOWNLOAD_UNAVAILABLE');
  const reader=response.body?.getReader();let text='';
  if(reader){const chunks=[];let size=0;try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>32768)throw Error('DESKTOP_DOWNLOAD_MANIFEST_TOO_LARGE');chunks.push(value);}const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}text=new TextDecoder().decode(bytes);}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}}
  else {text=await response.text();if(text.length>32768)throw Error('DESKTOP_DOWNLOAD_MANIFEST_TOO_LARGE');}
  return validateDesktopDownloadManifest(JSON.parse(text));
}
