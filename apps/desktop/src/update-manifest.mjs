import crypto from 'node:crypto';

const fail=()=>{throw Object.assign(Error('DESKTOP_UPDATE_UNTRUSTED'),{code:'DESKTOP_UPDATE_UNTRUSTED'});};
export const updateVersion=value=>typeof value==='string'&&value.length<64&&/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-preview\.[1-9]\d*)?$/.test(value);
export const canonicalUpdate=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
export const updateKeyId=publicKey=>crypto.createHash('sha256').update((publicKey?.type==='public'?publicKey:crypto.createPublicKey(publicKey)).export({type:'spki',format:'der'})).digest('hex').slice(0,32);
export function updateTrust(value,{localTest=false}={}) {
  if(!value)return null;
  if(value.schemaVersion!==1||!['preview','stable'].includes(value.channel)||!Array.isArray(value.keys)||!value.keys.length||value.keys.length>3)fail();
  const url=new URL(value.feed);
  if(url.username||url.password||url.search||url.hash||url.pathname!==`/downloads/desktop/updates/${value.channel}.json`)fail();
  const local=localTest&&url.protocol==='http:'&&url.hostname==='127.0.0.1';
  if(localTest?!local:url.origin!=='https://mooyu.fun')fail();
  const ids=new Set();const keys=value.keys.map(row=>{try{const key=crypto.createPublicKey(row.publicKey);if(key.asymmetricKeyType!=='ed25519'||updateKeyId(key)!==row.id||ids.has(row.id))fail();ids.add(row.id);return {id:row.id,publicKey:key.export({type:'spki',format:'pem'}).toString()};}catch{fail();}});
  return {schemaVersion:1,channel:value.channel,feed:url.href,product:local?'mooyu-desktop-acceptance':'mooyu-desktop',keys};
}
export function verifyUpdateEnvelope(envelope,trust,{now=Date.now()}={}) {
  if(!trust||!envelope?.payload||typeof envelope.signature!=='string'||! /^[A-Za-z0-9+/]{86}==$/.test(envelope.signature))fail();
  const key=trust.keys.find(row=>row.id===envelope.keyId);if(!key)fail();
  const p=envelope.payload;
  if(!crypto.verify(null,Buffer.from(canonicalUpdate(p)),key.publicKey,Buffer.from(envelope.signature,'base64')))fail();
  if(p.schemaVersion!==1||p.product!==trust.product||p.platform!=='windows'||p.arch!=='x64'||p.channel!==trust.channel||!updateVersion(p.version)||p.version.includes('-preview.')!==(p.channel==='preview'))fail();
  const released=Date.parse(p.releasedAt),expires=Date.parse(p.expiresAt);
  if(!Number.isFinite(released)||!Number.isFinite(expires)||released>now+300000||expires<=now||expires-released>7*86400000||expires<=released)fail();
  const a=p.installer,expected=`/downloads/desktop/${p.version}/MooyuWorkshop-${p.version}-x64-Setup.exe`;
  if(!a||a.path!==expected||!Number.isSafeInteger(a.size)||a.size<2||a.size>1024**3||! /^[a-f0-9]{64}$/.test(a.sha256)||! /^[a-f0-9]{64}$/.test(a.exeSha256)||! /^[A-Za-z0-9+/]{86}==$/.test(a.sha512))fail();
  return {payload:structuredClone(p),fingerprint:crypto.createHash('sha256').update(canonicalUpdate(p)).digest('hex')};
}
export async function fetchUpdateEnvelope(fetchImpl,trust,{signal,now}={}) {
  const response=await fetchImpl(trust.feed,{signal:AbortSignal.any([AbortSignal.timeout(15000),...(signal?[signal]:[])]),redirect:'error',credentials:'omit',cache:'no-store',headers:{Accept:'application/json'}});
  if(!response.ok||response.redirected||!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')??''))fail();
  const reader=response.body.getReader(),chunks=[];let length=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>32768)fail();chunks.push(value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  return verifyUpdateEnvelope(JSON.parse(Buffer.concat(chunks).toString('utf8')),trust,{now});
}
