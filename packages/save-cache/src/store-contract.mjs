export const CACHE_MAX_RECORD_BYTES = 7 * 1024 * 1024;
export const CACHE_MAX_BYTES = 64 * 1024 * 1024;
export const CACHE_MAX_SLOTS = 32;
export const cacheError = (code,message,retryable=false) => Object.assign(new Error(message),{code,retryable});
export const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
const name = value => typeof value==='string' && /^[a-z0-9._-]{1,64}$/.test(value) && !value.startsWith('_gamehub.');
const uuid = value => typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function cacheScope(input) {
  if(!input || Object.keys(input).some(key=>!['origin','owner','workId','channel','namespace','slot'].includes(key)))
    throw cacheError('SAVE_CACHE_SCOPE_INVALID','Invalid local save scope.');
  let origin; try { origin=new URL(input.origin); } catch {}
  if(!origin || origin.origin!==input.origin || !['https:','http:'].includes(origin.protocol)
    || origin.username || origin.password || (origin.protocol==='http:'&&!['localhost','127.0.0.1'].includes(origin.hostname))
    || !/^(user|anonymous):/.test(input.owner??'') || !uuid(input.owner.split(':')[1]) || input.owner.split(':').length!==2
    || !uuid(input.workId) || !['production','preview'].includes(input.channel)
    || !name(input.namespace) || !name(input.slot)) throw cacheError('SAVE_CACHE_SCOPE_INVALID','Invalid local save scope.');
  return Object.fromEntries(['origin','owner','workId','channel','namespace','slot'].map(key=>[key,input[key]]));
}
export const cacheKey = scope => JSON.stringify(Object.values(cacheScope(scope)));
export const cacheGroup = scope => JSON.stringify(Object.values(cacheScope(scope)).slice(0,4));
export function serializeRecord(value) {
  if(!value || value.format!==1) throw cacheError('SAVE_CACHE_CORRUPT','Unsupported local save record. Preserve and export the original data.');
  const text=JSON.stringify(value);
  if(new TextEncoder().encode(text).length>CACHE_MAX_RECORD_BYTES) throw cacheError('SAVE_LOCAL_QUOTA_EXCEEDED','Local save and recovery storage is full. Export a copy before replacing it.');
  return text;
}
