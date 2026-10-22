const endpoint='https://api.deepseek.com/v1/tools/search';
const clean=(value,max)=>String(value??'').replace(/\s+/gu,' ').trim().slice(0,max);

export class DeepSeekSearchError extends Error{
  constructor(code,message,statusCode=502,{retryable=false}={}){super(message);this.name='DeepSeekSearchError';this.code=code;this.statusCode=statusCode;this.retryable=retryable;}
}

const parseError=async response=>{
  try{const body=await response.json();return clean(body?.error?.message,300);}catch{return'';}
};

export function createDeepSeekSearchAdapter({apiKey,fetchImpl=globalThis.fetch,timeoutMs=12000,priceUsdMicrosPerRequest=750}={}){
  const secret=String(apiKey??'').trim();
  if(!secret)throw new Error('DEEPSEEK_API_KEY is required when DeepSeek search is enabled');
  if(typeof fetchImpl!=='function')throw new Error('A fetch implementation is required for DeepSeek search');
  if(!Number.isInteger(priceUsdMicrosPerRequest)||priceUsdMicrosPerRequest<0)throw new Error('DeepSeek search price must be a non-negative integer number of USD micros per successful request');
  return{
    provider:'deepseek-search',
    billing:{currency:'USD',unitPriceMicros:priceUsdMicrosPerRequest,unit:'request',priceSource:'runtime-config'},
    async search({query,count=5,oriQuestion=null}={}){
      const normalizedQuery=clean(query,128),requestedCount=Number(count);
      if(!normalizedQuery)throw new DeepSeekSearchError('RESEARCH_SEARCH_QUERY_INVALID','搜索词不能为空。',400);
      if(!Number.isInteger(requestedCount)||requestedCount<1||requestedCount>10)throw new DeepSeekSearchError('RESEARCH_SEARCH_COUNT_INVALID','每次发现请求仅允许返回 1 到 10 条结果。',400);
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
      let response;
      try{
        response=await fetchImpl(endpoint,{method:'POST',signal:controller.signal,headers:{authorization:`Bearer ${secret}`,'content-type':'application/json'},body:JSON.stringify({query:normalizedQuery,count:requestedCount,ori_question:oriQuestion?clean(oriQuestion,128):undefined,need_content:false})});
      }catch(error){
        if(error?.name==='AbortError')throw new DeepSeekSearchError('RESEARCH_SEARCH_TIMEOUT','搜索服务响应超时。',504,{retryable:true});
        throw new DeepSeekSearchError('RESEARCH_SEARCH_UNAVAILABLE','暂时无法连接搜索服务。',502,{retryable:true});
      }finally{clearTimeout(timer);}
      if(!response.ok){
        const detail=await parseError(response),retryable=[408,429].includes(response.status)||response.status>=500;
        throw new DeepSeekSearchError(`RESEARCH_SEARCH_HTTP_${response.status}`,detail||`搜索服务返回 HTTP ${response.status}。`,response.status,{retryable});
      }
      let body;
      try{body=await response.json();}catch{throw new DeepSeekSearchError('RESEARCH_SEARCH_RESPONSE_INVALID','搜索服务返回了无效 JSON。',502,{retryable:true});}
      if(!Array.isArray(body?.results))throw new DeepSeekSearchError('RESEARCH_SEARCH_RESPONSE_INVALID','搜索服务响应缺少结果数组。',502,{retryable:true});
      const results=body.results.slice(0,requestedCount).map((item,index)=>({
        rank:index+1,
        title:clean(item?.title,500)||'未命名搜索结果',
        url:clean(item?.url,2048),
        snippet:clean(item?.snippet,2000),
        siteName:clean(item?.site_name,240)||null,
        publishedAt:item?.date?String(item.date):null,
        rerankScore:Number.isFinite(Number(item?.rerank_score))?Math.max(0,Math.min(3,Number(item.rerank_score))):null,
        authority:Number.isInteger(Number(item?.authority))?Math.max(-1,Math.min(4,Number(item.authority))):null,
      })).filter(item=>item.url);
      return{protocol:'deepseek-search-preview-v1',provider:'deepseek-search',query:normalizedQuery,results,billable:results.length>0,billing:{currency:'USD',unitPriceMicros:priceUsdMicrosPerRequest,unit:'successful-request',priceSource:'runtime-config'}};
    },
  };
}
