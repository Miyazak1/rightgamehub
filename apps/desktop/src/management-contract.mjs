import {MANAGEMENT_METHODS as methods} from './management-methods.mjs';
export const MANAGEMENT_METHODS=Object.freeze({...methods,
  listCreatorDrafts:['text?'],previewCreatorDraft:['id'],buildCreatorDraft:['id','object','revision'],updateCreatorDraft:['id','object','revision'],
  setAdminAgentPublicSchedule:['id','boolean'],
  updateBlogDraft:['id','revision','object'],publishBlogArticle:['id','revision'],withdrawBlogArticle:['id','revision'],
  updateWork:['id','revision','object'],publishWorkRelease:['id','id','revision'],withdrawWork:['id','revision'],
  abortAdminMultiplayerMatch:['id','text'],reviewAdminMultiplayerRuleSubmission:['id','object'],
  uploadWorkCover:['id','file'],uploadContent:['id','file','text'],
});
const denied=()=>{throw Object.assign(Error('DESKTOP_BUSINESS_INPUT_INVALID'),{code:'DESKTOP_BUSINESS_INPUT_INVALID',status:400});};
function json(value,depth=0){
  if(depth>16)denied();
  if(value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return value;
  if(typeof value==='string'){if(value.length>262144)denied();return value;}
  if(Array.isArray(value)){if(value.length>1000)denied();return value.map(v=>json(v,depth+1));}
  if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))denied();
  const entries=Object.entries(value);if(entries.length>1000)denied();const result={};
  for(const [key,item]of entries){if(['__proto__','constructor','prototype'].includes(key))denied();if(item===undefined||key==='signal'&&typeof item?.addEventListener==='function')continue;result[key]=json(item,depth+1);}
  return result;
}
export function managementArgument(kind,value){
  if(kind.endsWith('?')&&value===undefined)return undefined;
  kind=kind.replace('?','');
  if(kind==='id'){if(typeof value!=='string'||!value.length||value.length>200||/[\u0000-\u001f\\/]/u.test(value))denied();return value;}
  if(kind==='text'){if(typeof value!=='string'||value.length>8192||value.includes('\0'))denied();return value;}
  if(kind==='number'){if(!Number.isSafeInteger(value)||value<0||value>1000000)denied();return value;}
  if(kind==='revision'){if(!(Number.isSafeInteger(value)&&value>=0)&&!(typeof value==='string'&&/^(?:0|[1-9]\d{0,18})$/u.test(value)))denied();return value;}
  if(kind==='boolean'){if(typeof value!=='boolean')denied();return value;}
  if(kind==='file'){if(!value||Object.keys(value).length!==1||typeof value.desktopUploadId!=='string'||!/^[a-f0-9-]{36}$/i.test(value.desktopUploadId))denied();return {desktopUploadId:value.desktopUploadId};}
  if(kind!=='object'||!value||typeof value!=='object'||Array.isArray(value))denied();
  const result=json(value);if(JSON.stringify(result).length>262144)denied();return result;
}
