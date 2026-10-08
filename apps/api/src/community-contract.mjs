import crypto from 'node:crypto';
import net from 'node:net';
import { fail } from './community-errors.mjs';

export const LIMITS = Object.freeze({title:120,text:4000,blocks:32,links:3,images:3,inputBytes:2097152,variantBytes:1212416,userBytes:52428800,totalBytes:2147483648,dailyUploads:20,dailyPosts:10,drafts:10,pending:3,queue:20,page:20});
export const CHANNELS = Object.freeze([{key:'game',name:'游戏'},{key:'ai',name:'AI'},{key:'computing',name:'计算机'}]);
export const hash = value => crypto.createHash('sha256').update(value).digest('hex');
export const uuid = value => typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const invalid = () => fail('SCHEMA_INVALID',400,'分享内容格式或长度无效。');
const only = (value,keys) => {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key))) invalid();
};
export function safeLink(value) {
  if(typeof value!=='string'||value.length>2048) invalid();
  let url;try{url=new URL(value);}catch{invalid();}
  const hostname=url.hostname.toLowerCase().replace(/\.$/,'');
  if(url.protocol!=='https:'||url.username||url.password||url.port||net.isIP(hostname.replace(/^\[|\]$/g,''))||!hostname.includes('.')||/(^|\.)(localhost|local|internal|test|invalid)$/.test(hostname)) invalid();
  return url.href;
}
export function normalizeContent(input) {
  only(input,['channel','title','blocks']);
  if(!CHANNELS.some(item=>item.key===input.channel)||typeof input.title!=='string'||!input.title.trim()||Array.from(input.title.trim()).length>LIMITS.title||!Array.isArray(input.blocks)||!input.blocks.length||input.blocks.length>LIMITS.blocks) invalid();
  let text=0,links=0,images=0;
  const assets=new Set();
  const blocks=input.blocks.map(block=>{
    if(block?.type==='paragraph') {
      only(block,['type','text']);if(typeof block.text!=='string'||!block.text.trim()) invalid();
      text+=Array.from(block.text.trim()).length;
      return {type:'paragraph',text:block.text.trim()};
    }
    if(block?.type==='link') {
      only(block,['type','url','label']);links++;
      if(block.label!==undefined&&(typeof block.label!=='string'||Array.from(block.label).length>160)) invalid();
      return {type:'link',url:safeLink(block.url),label:block.label?.trim()||''};
    }
    if(block?.type==='image') {
      only(block,['type','assetId','alt']);images++;
      if(!uuid(block.assetId)||assets.has(block.assetId)||typeof block.alt!=='string'||Array.from(block.alt).length>240) invalid();
      assets.add(block.assetId);return {type:'image',assetId:block.assetId,alt:block.alt.trim()};
    }
    invalid();
  });
  if(text>LIMITS.text||links>LIMITS.links||images>LIMITS.images) invalid();
  const content={channel:input.channel,title:input.title.trim(),blocks};
  if(Buffer.byteLength(JSON.stringify(content))>32768) invalid();
  return content;
}
export function expectedVersion(value) {
  if(typeof value!=='string'||!/^"[1-9][0-9]{0,17}"$/.test(value)) fail('PRECONDITION_REQUIRED',428,'请重新加载分享后再修改。');
  return value.slice(1,-1);
}
export function receiptKey(value) {
  if(typeof value!=='string'||value.length<8||value.length>128||!/^[A-Za-z0-9_-]+$/.test(value)) fail('IDEMPOTENCY_REQUIRED',400,'需要有效的请求标识。');
  return hash(value);
}
export function cursorFor(scope,row,anchor) {
  return Buffer.from(JSON.stringify({v:1,scope,at:row.sort_at,id:row.sort_id,anchor})).toString('base64url');
}
export function readCursor(value,scope) {
  if(!value) return null;
  try{
    if(value.length>800) invalid();
    const cursor=JSON.parse(Buffer.from(value,'base64url'));
    if(cursor.v!==1||cursor.scope!==scope||!uuid(cursor.id)||!Number.isFinite(Date.parse(cursor.at))||!Number.isFinite(Date.parse(cursor.anchor))) invalid();
    return cursor;
  }catch{fail('CURSOR_INVALID',400,'分页位置无效，请刷新列表。');}
}
