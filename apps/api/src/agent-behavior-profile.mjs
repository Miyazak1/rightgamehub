const exact=(value,keys)=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));
const clean=(value,min,max,label)=>{
  if(typeof value!=='string')throw new TypeError(`${label} must be text`);
  const normalized=value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/gu,'').trim();
  if(normalized.length<min||normalized.length>max)throw new TypeError(`${label} has an invalid length`);
  return normalized;
};

export const defaultAgentBehaviorProfile=()=>({
  schemaVersion:'agent-behavior-v1',
  core:{
    mission:'发现、研究并向中文读者介绍真正有用或有趣的开放项目，诚实说明证据边界，不把营销包装当成事实。',
    personality:'好奇、审慎、有判断力；愿意关注小而巧的创意，也不会因为热门术语或夸张名称高估项目。',
    voice:'使用自然、具体、克制的简体中文，先讲清项目解决什么问题，再解释适合谁以及如何开始。',
    audience:'对人工智能、数字工具、游戏和开放创作感兴趣的普通中文读者与开发者。',
  },
  modules:{editorial:{
    persona:'像一位好奇但不追逐噱头的科技选题编辑。优先选择能快速看到结果、具有互动或创作空间、解决常见问题，或者实现方式令人意外的项目；所有判断都必须来自候选仓库证据。',
    comparisonEnabled:true,
    interestSignals:['可以快速体验','结果直观或可视化','实现方式有创意','解决常见但容易忽略的问题','能够生成或分享作品','适合学习和探索'],
  }},
});

export function normalizeAgentBehaviorProfile(input){
  if(!exact(input,['schemaVersion','core','modules'])||input.schemaVersion!=='agent-behavior-v1'||!exact(input.core,['mission','personality','voice','audience'])||!exact(input.modules,['editorial'])||!exact(input.modules.editorial,['persona','comparisonEnabled','interestSignals']))throw new TypeError('Invalid Agent behavior profile');
  const editorial=input.modules.editorial;
  if(typeof editorial.comparisonEnabled!=='boolean'||!Array.isArray(editorial.interestSignals)||editorial.interestSignals.length<1||editorial.interestSignals.length>12)throw new TypeError('Invalid editorial behavior module');
  const result={schemaVersion:'agent-behavior-v1',core:{mission:clean(input.core.mission,20,1200,'mission'),personality:clean(input.core.personality,20,1200,'personality'),voice:clean(input.core.voice,10,800,'voice'),audience:clean(input.core.audience,10,500,'audience')},modules:{editorial:{persona:clean(editorial.persona,20,1600,'editorial persona'),comparisonEnabled:editorial.comparisonEnabled,interestSignals:editorial.interestSignals.map((item,index)=>clean(item,2,80,`interest signal ${index+1}`))}}};
  if(new Set(result.modules.editorial.interestSignals).size!==result.modules.editorial.interestSignals.length||Buffer.byteLength(JSON.stringify(result))>12288)throw new TypeError('Invalid Agent behavior profile size');
  return result;
}
