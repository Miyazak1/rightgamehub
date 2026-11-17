import {stableHash,stableJson} from './researcher-qa-protocol/stable-json.mjs';
import {AgentProviderRequestError} from './agent-provider-request.mjs';

const prefix=(text,limit)=>{
  let result='',bytes=0;
  for(const point of String(text)){const size=Buffer.byteLength(point);if(bytes+size>limit)break;result+=point;bytes+=size;}
  return result;
};
// This is a view of immutable run/tool evidence, never a replacement for it.
// Server-side gates always retain and validate the complete frozen evidence.
export function buildBlogModelRequest({system,payload,inputBudget=18000,temperature=0.25,kind='selection'}) {
  const view=structuredClone(payload),projection={schemaVersion:'blog-prompt-projection-v1',
    originalPayloadSha256:stableHash(payload),truncatedFieldCount:0,inputBudget};
  const truncated=new WeakMap();
  const clip=(object,key,limit)=>{
    if(typeof object?.[key]!=='string')return;
    const shortened=prefix(object[key],limit);
    if(shortened!==object[key]){
      object[key]=shortened;const fields=truncated.get(object)??new Set();
      if(!fields.has(key)){fields.add(key);projection.truncatedFieldCount++;}truncated.set(object,fields);
    }
  };
  const profile=view.agentBehavior;
  if(profile){
    for(const key of ['mission','personality','voice','audience'])clip(profile.core,key,600);
    clip(profile.modules?.editorial,'persona',800);
  }
  clip(view,'topicScope',600);
  if(Array.isArray(view.recentTitles)){
    projection.omittedRecentTitles=Math.max(0,view.recentTitles.length-10);
    view.recentTitles=view.recentTitles.slice(0,10).map(title=>prefix(title,180));
  }
  if(Array.isArray(view.activeEditorialCooldowns)){
    projection.omittedCooldownHints=Math.max(0,view.activeEditorialCooldowns.length-12);
    view.activeEditorialCooldowns=view.activeEditorialCooldowns.slice(0,12);
    for(const item of view.activeEditorialCooldowns)clip(item,'label',180);
  }
  const sources=view.candidates??view.verifiedSources??[];
  if(kind==='selection')for(const candidate of sources){
    candidate.materialCount=candidate.materials?.length??0;
    delete candidate.materials;
  }
  if(view.correction?.previousOutput!==undefined){
    const raw=view.correction.previousOutput,text=typeof raw==='string'?raw:stableJson(raw);
    if(Buffer.byteLength(text)>8000){
      view.correction.previousOutput=prefix(text,8000);
      view.correction.previousOutputSha256=stableHash(raw);
      view.correction.previousOutputTruncated=true;
      view.correction.instruction+=' 原回复预览已截取；必须根据已给定来源重新生成完整 JSON，不续写被截断片段。';
      projection.truncatedFieldCount++;
    }
  }
  view.projection=projection;
  const messages=()=>[{role:'system',content:system},{role:'user',content:stableJson(view)}];
  const tokens=()=>messages().reduce((sum,item)=>sum+Buffer.byteLength(item.content)+64,0);
  for(const limit of [1800,1000,600,300]){
    for(const source of sources){
      clip(source,'description',Math.min(500,limit));clip(source,'excerpt',limit);
      for(const material of source.materials??[])clip(material,'excerpt',limit);
    }
    if(tokens()<=inputBudget)return {messages:messages(),temperature};
  }
  throw new AgentProviderRequestError('AGENT_BLOG_PROMPT_BUDGET_EXCEEDED');
}
