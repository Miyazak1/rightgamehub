import { stableHash } from './researcher-qa-protocol/stable-json.mjs';

export class AgentProviderRequestError extends Error {
  constructor(code) { super({AGENT_PROVIDER_INPUT_BUDGET_EXCEEDED:'本次请求超出模型输入预算，未派发模型调用。',
    AGENT_BLOG_PROMPT_BUDGET_EXCEEDED:'本次资料无法在既定输入预算内编译，未派发本次模型调用。',
    AGENT_PROVIDER_REQUEST_TOO_LARGE:'本次模型请求超过存储容量，未派发模型调用。'}[code]??code);
    this.name='AgentProviderRequestError';this.code=code;this.retryable=false; }
}
const fail=code=>{throw new AgentProviderRequestError(code);};
export function compileAgentProviderRequest({request,modelPolicy,tokenCeiling,timeoutSeconds,estimatedInputTokens=0}) {
  if(!request||typeof request!=='object'||Array.isArray(request))fail('AGENT_PROVIDER_REQUEST_INVALID');
  let normalized,serialized;
  try{normalized=structuredClone(request);serialized=JSON.stringify(normalized);}catch{fail('AGENT_PROVIDER_REQUEST_INVALID');}
  const bytes=Buffer.byteLength(serialized);
  const inspect=(value,depth=0)=>{
    if(depth>32)fail('AGENT_PROVIDER_REQUEST_INVALID');
    if(typeof value==='string'&&(!value.isWellFormed()||value.includes('\0')))fail('AGENT_PROVIDER_TEXT_INVALID');
    if(typeof value==='number'&&!Number.isFinite(value))fail('AGENT_PROVIDER_REQUEST_INVALID');
    if(value&&typeof value==='object')for(const [key,item] of Object.entries(value)){
      if(!key.isWellFormed()||key.includes('\0'))fail('AGENT_PROVIDER_TEXT_INVALID');inspect(item,depth+1);
    }
  };
  inspect(normalized);
  if(bytes>524288)fail('AGENT_PROVIDER_REQUEST_TOO_LARGE');
  if(!Number.isSafeInteger(tokenCeiling)||tokenCeiling<1||tokenCeiling>modelPolicy.maxOutputTokens)fail('AGENT_PROVIDER_OUTPUT_BUDGET_EXCEEDED');
  if(!Number.isSafeInteger(timeoutSeconds)||timeoutSeconds<1||timeoutSeconds>3600)fail('AGENT_PROVIDER_TIMEOUT_INVALID');
  let upperBound=bytes;
  if(normalized.messages!==undefined){
    if(!Array.isArray(normalized.messages)||normalized.messages.length<1||normalized.messages.length>64)fail('AGENT_PROVIDER_REQUEST_INVALID');
    upperBound=0;
    for(const message of normalized.messages){
      if(!message||!['system','user','assistant'].includes(message.role)||typeof message.content!=='string'||!message.content.length)fail('AGENT_PROVIDER_REQUEST_INVALID');
      const size=Buffer.byteLength(message.content);
      if(size>262144)fail('AGENT_PROVIDER_MESSAGE_TOO_LARGE');
      // Byte-fallback upper bound with an explicit per-message framing reserve.
      // Covers system text and corrections, not just the business payload.
      upperBound+=size+64;
    }
  }
  const inputTokens=Math.max(upperBound,Number.isSafeInteger(estimatedInputTokens)?estimatedInputTokens:0);
  if(inputTokens>modelPolicy.maxInputTokens)fail('AGENT_PROVIDER_INPUT_BUDGET_EXCEEDED');
  return Object.freeze({schemaVersion:'agent-compiled-provider-request-v1',request:normalized,
    requestSha256:stableHash(normalized),sizeBytes:bytes,inputTokens,outputTokens:tokenCeiling,timeoutSeconds});
}
