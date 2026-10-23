import crypto from 'node:crypto';
import {normalizeBlogContent} from './blog-contract.mjs';

const endpoint='https://api.deepseek.com/chat/completions';
const modelsEndpoint='https://api.deepseek.com/models';
export class AgentBlogAutomationError extends Error{
  constructor(code,statusCode,message,{retryable=false}={}){super(message);this.name='AgentBlogAutomationError';this.code=code;this.statusCode=statusCode;this.retryable=retryable;}
}
const fail=(code,status,message,options)=>{throw new AgentBlogAutomationError(code,status,message,options);};
const wholeJson=value=>{if(typeof value!=='string'||Buffer.byteLength(value)>262144)fail('AGENT_BLOG_PROVIDER_OUTPUT_INVALID',502,'模型返回了无效内容。');try{const parsed=JSON.parse(value);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error();return parsed;}catch{fail('AGENT_BLOG_PROVIDER_OUTPUT_INVALID',502,'模型没有返回有效的结构化文章。');}};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));
const cleanUsage=usage=>({promptTokens:Math.max(0,Number(usage?.prompt_tokens)||0),completionTokens:Math.max(0,Number(usage?.completion_tokens)||0),totalTokens:Math.max(0,Number(usage?.total_tokens)||0)});
const responseText=payload=>payload?.choices?.[0]?.message?.content;
const modelView=model=>{
  const id=String(model?.id??'').trim();
  if(!/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(id))return null;
  const name=String(model?.name??id).replace(/[\r\n\t]+/g,' ').trim().slice(0,120)||id;
  return{id,name,contextWindow:Math.max(0,Number(model?.context_window)||0)||null,maxOutputTokens:Math.max(0,Number(model?.max_output_tokens)||0)||null};
};
const modelOrder=model=>model.id==='deepseek-flash'?0:model.id==='deepseek-v4-pro'?1:2;

async function providerRequest({apiKey,model,messages,fetchImpl,timeoutMs,maxTokens=5000}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetchImpl(endpoint,{method:'POST',signal:controller.signal,headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({model,messages,temperature:0.45,max_tokens:maxTokens,response_format:{type:'json_object'},stream:false})});
    const payload=await response.json().catch(()=>null);
    if(!response.ok){const status=response.status===401||response.status===403?401:response.status===429?429:502;fail(status===401?'AGENT_PROVIDER_KEY_REJECTED':status===429?'AGENT_PROVIDER_RATE_LIMITED':'AGENT_PROVIDER_FAILED',status,status===401?'模型供应商拒绝了当前 Key。':status===429?'模型供应商限流，请稍后重试。':'模型供应商暂时不可用。',{retryable:status!==401});}
    return{json:wholeJson(responseText(payload)),usage:cleanUsage(payload?.usage),requestId:response.headers?.get?.('x-request-id')??null};
  }catch(error){if(error instanceof AgentBlogAutomationError)throw error;if(error?.name==='AbortError')fail('AGENT_PROVIDER_TIMEOUT',504,'模型生成超时。',{retryable:true});fail('AGENT_PROVIDER_FAILED',502,'无法连接模型供应商。',{retryable:true});}
  finally{clearTimeout(timer);}
}

const generationSystem=`你是墨鱼工坊的官方机器人作者。只输出 JSON，不要输出 Markdown 代码围栏。
任务：从给定范围中自主选择一个大众可理解、非时政、非敏感、不过度冷门的中文主题，写成可公开发布的原创文章。
硬性规则：
1. 不写政治人物、政治事件、战争争议、现实公共政策、突发新闻或可能引发人身伤害的建议。
2. 不捏造日期、数据、引语、来源、产品功能或亲历。没有可靠依据的具体事实应改为一般性说明。
3. 标题必须纯中文标点与汉字，不得含英文字母；正文以简体中文为主。
4. 不提及提示词、模型、审核流程，不冒充真人经历。
5. 文章必须有清楚观点、具体解释和结尾，不得是空泛目录。
返回对象只能包含 title、summary、blocks。blocks 只能是：
{"type":"heading","level":2或3,"text":"..."}、{"type":"paragraph","text":"..."}、{"type":"list","ordered":false或true,"items":["..."]}。
摘要 40—180 字；正文 1200—3500 个中文字符；至少 6 个区块。`;
const reviewSystem=`你是独立发布守门员。只输出 JSON，不要输出其他文字。审核给定文章是否可以由官方机器人自动公开。
必须拒绝：时政或敏感议题；具体事实疑似捏造；冒充真人；医疗、法律、投资等高风险建议；仇恨、色情、暴力煽动；广告欺骗；标题含英文字母；内容空泛、重复或明显低质。
返回且只能返回：{"approved":布尔值,"qualityScore":0到1,"sensitiveRisk":"low|medium|high","factualRisk":"low|medium|high","reasonCodes":[最多8个大写下划线代码]}。只有全部风险为 low 且 qualityScore>=0.78 才可 approved=true。`;

export function createDeepSeekAgentBlogWriter({fetchImpl=globalThis.fetch,timeoutMs=120000}={}){
  if(typeof fetchImpl!=='function')throw new Error('A fetch implementation is required');
  const listModels=async apiKey=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(timeoutMs,15000));try{const response=await fetchImpl(modelsEndpoint,{signal:controller.signal,headers:{Authorization:`Bearer ${apiKey}`,Accept:'application/json'}});const payload=await response.json().catch(()=>null);if(response.status===401||response.status===403)fail('AGENT_PROVIDER_KEY_REJECTED',401,'模型供应商拒绝了当前 Key。');if(!response.ok)fail('AGENT_PROVIDER_FAILED',502,'暂时无法读取模型供应商的可用模型。',{retryable:true});const models=Array.isArray(payload?.data)?payload.data.map(modelView).filter(Boolean).filter((model,index,items)=>items.findIndex(item=>item.id===model.id)===index).sort((a,b)=>modelOrder(a)-modelOrder(b)||a.id.localeCompare(b.id)).slice(0,50):[];if(!models.length)fail('AGENT_PROVIDER_MODELS_INVALID',502,'模型供应商没有返回可用模型。',{retryable:true});return models;}catch(error){if(error instanceof AgentBlogAutomationError)throw error;if(error?.name==='AbortError')fail('AGENT_PROVIDER_TIMEOUT',504,'读取模型供应商可用模型超时。',{retryable:true});fail('AGENT_PROVIDER_FAILED',502,'无法连接模型供应商。',{retryable:true});}finally{clearTimeout(timer);}};
  return{
    listModels,
    async testKey(apiKey){return{ok:true,models:await listModels(apiKey)};},
    async generate({apiKey,model,topicScope,recentTitles=[]}){
      const generated=await providerRequest({apiKey,model,fetchImpl,timeoutMs,messages:[{role:'system',content:generationSystem},{role:'user',content:JSON.stringify({topicScope,recentTitles:recentTitles.slice(0,30)})}]});
      if(!exact(generated.json,['title','summary','blocks'])||!Array.isArray(generated.json.blocks))fail('AGENT_BLOG_PROVIDER_OUTPUT_INVALID',502,'模型返回的文章结构不符合要求。');
      const seed=`${generated.json.title}\0${Date.now()}\0${crypto.randomUUID()}`,slug=`agent-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${crypto.createHash('sha256').update(seed).digest('hex').slice(0,10)}`;
      const content=normalizeBlogContent({slug,locale:'zh-CN',title:generated.json.title,summary:generated.json.summary,blocks:generated.json.blocks,citations:[]});
      const reviewed=await providerRequest({apiKey,model,fetchImpl,timeoutMs,maxTokens:800,messages:[{role:'system',content:reviewSystem},{role:'user',content:JSON.stringify(content)}]});
      const review=reviewed.json;if(!exact(review,['approved','qualityScore','sensitiveRisk','factualRisk','reasonCodes'])||typeof review.approved!=='boolean'||!Number.isFinite(review.qualityScore)||!['low','medium','high'].includes(review.sensitiveRisk)||!['low','medium','high'].includes(review.factualRisk)||!Array.isArray(review.reasonCodes))fail('AGENT_BLOG_REVIEW_INVALID',502,'模型审核结果无效。');
      const approved=review.approved===true&&review.qualityScore>=0.78&&review.sensitiveRisk==='low'&&review.factualRisk==='low';
      return{content,review:{approved,qualityScore:Math.max(0,Math.min(1,review.qualityScore)),sensitiveRisk:review.sensitiveRisk,factualRisk:review.factualRisk,reasonCodes:review.reasonCodes.filter(code=>typeof code==='string'&&/^[A-Z0-9_]{2,64}$/.test(code)).slice(0,8)},usage:{generation:generated.usage,review:reviewed.usage},providerRequestIds:[generated.requestId,reviewed.requestId].filter(Boolean)};
    },
  };
}
