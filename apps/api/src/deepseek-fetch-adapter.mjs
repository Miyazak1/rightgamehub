import crypto from 'node:crypto';
import {assertPublicHttpUrl,normalizeFetchedText} from './change-radar-fetcher.mjs';

const endpoint='https://api.deepseek.com/v1/tools/fetch';
const maxResponseBytes=1024*1024;
const clean=(value,max)=>String(value??'').replace(/[\u0000-\u001f\u007f]/gu,' ').trim().slice(0,max);

export class DeepSeekFetchError extends Error{
  constructor(code,message,statusCode=502,{retryable=false}={}){super(message);this.name='DeepSeekFetchError';this.code=code;this.statusCode=statusCode;this.retryable=retryable;}
}

const parseError=async response=>{
  try{const body=await response.json();return clean(body?.error?.message,300);}catch{return'';}
};

async function readBoundedJson(response){
  const declared=Number(response.headers.get('content-length'));
  if(Number.isFinite(declared)&&declared>maxResponseBytes)throw new DeepSeekFetchError('RESEARCH_FETCH_RESPONSE_TOO_LARGE','抓取服务响应超过 1 MB。',502);
  if(!response.body?.getReader)return response.json();
  const reader=response.body.getReader(),chunks=[];let length=0;
  try{
    while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>maxResponseBytes)throw new DeepSeekFetchError('RESEARCH_FETCH_RESPONSE_TOO_LARGE','抓取服务响应超过 1 MB。',502);chunks.push(value);}
  }finally{reader.cancel().catch(()=>{});reader.releaseLock();}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new DeepSeekFetchError('RESEARCH_FETCH_RESPONSE_INVALID','抓取服务返回了无效 JSON。',502,{retryable:true});}
}

export function createDeepSeekFetchAdapter({apiKey,fetchImpl=globalThis.fetch,timeoutMs=15000,validateUrl=assertPublicHttpUrl,priceUsdMicrosPerRequest=750}={}){
  const secret=String(apiKey??'').trim();
  if(!secret)throw new Error('DEEPSEEK_API_KEY is required when DeepSeek fetch is enabled');
  if(typeof fetchImpl!=='function')throw new Error('A fetch implementation is required for DeepSeek fetch');
  if(!Number.isInteger(priceUsdMicrosPerRequest)||priceUsdMicrosPerRequest<0)throw new Error('DeepSeek fetch price must be a non-negative integer number of USD micros per successful request');
  return{
    provider:'deepseek-fetch',
    billing:{currency:'USD',unitPriceMicros:priceUsdMicrosPerRequest,unit:'request',priceSource:'runtime-config'},
    async fetch(input){
      const publicUrl=await validateUrl(input),url=publicUrl.href;
      if(url.length>8192)throw new DeepSeekFetchError('RESEARCH_FETCH_URL_INVALID','抓取地址超过 8192 个字符。',400);
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);let response;
      try{response=await fetchImpl(endpoint,{method:'POST',signal:controller.signal,headers:{authorization:`Bearer ${secret}`,'content-type':'application/json'},body:JSON.stringify({url})});}
      catch(error){if(error?.name==='AbortError')throw new DeepSeekFetchError('RESEARCH_FETCH_TIMEOUT','抓取服务响应超时。',504,{retryable:true});throw new DeepSeekFetchError('RESEARCH_FETCH_UNAVAILABLE','暂时无法连接抓取服务。',502,{retryable:true});}
      finally{clearTimeout(timer);}
      if(!response.ok){const detail=await parseError(response),retryable=[408,429].includes(response.status)||response.status>=500;throw new DeepSeekFetchError(`RESEARCH_FETCH_HTTP_${response.status}`,detail||`抓取服务返回 HTTP ${response.status}。`,response.status,{retryable});}
      const body=await readBoundedJson(response),bodyText=normalizeFetchedText(body?.content,'text/markdown');
      if(typeof body?.title!=='string'||typeof body?.content!=='string'||!bodyText)throw new DeepSeekFetchError('RESEARCH_FETCH_RESPONSE_INVALID','抓取服务没有返回可归档的 Markdown 正文。',502);
      return{protocol:'deepseek-fetch-v1',provider:'deepseek-fetch',title:clean(body.title,500)||null,finalUrl:url,statusCode:200,contentType:'text/markdown',bodyText,sha256:crypto.createHash('sha256').update(bodyText).digest('hex'),billable:true,billing:{currency:'USD',unitPriceMicros:priceUsdMicrosPerRequest,unit:'successful-request',priceSource:'runtime-config'}};
    },
  };
}
