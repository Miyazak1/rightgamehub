const {ui,UI}=require('./policy.cjs');
function externalUrl(value){
  if(typeof value!=='string'||value.length>4096||/[\u0000-\u0020]/u.test(value))throw Error('DESKTOP_LINK_DENIED');
  const url=new URL(value);
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw Error('DESKTOP_LINK_DENIED');
  return url.href;
}
function downloadable(url){
  if(typeof url!=='string')return false;
  if(url.startsWith('blob:'+UI+'/'))return true;
  if(!ui(url))return false;
  return ['/__desktop-media','/__desktop-file'].includes(new URL(url).pathname);
}
module.exports={externalUrl,downloadable};
