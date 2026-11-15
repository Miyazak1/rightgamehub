import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { normalizeLearningQuery } from './practice/insights.mjs';
import { rejectPractice } from './practice/error.mjs';
import { AgentCapabilityError } from './agent-capability-service.mjs';

const search=z.object({query:z.string().trim().max(100).default(''),kinds:z.array(z.enum(['game','official-tool','tool','courseware','collection'])).max(5).optional(),
  tags:z.array(z.string().max(40)).max(8).optional(),maxEstimatedMinutes:z.number().int().min(1).max(1440).optional(),
  limit:z.number().int().min(1).max(12).default(6),locale:z.enum(['zh-CN','en']).default('zh-CN')}).strict();
const target=z.object({capabilityId:z.string().min(3).max(180),locale:z.enum(['zh-CN','en']).default('zh-CN')}).strict();
export const platformAgentToolDescriptions=[
  {name:'search_capabilities',arguments:{query:'搜索词，最长100字符',kinds:'可选 game/official-tool/tool/courseware/collection 数组',tags:'可选标签数组',maxEstimatedMinutes:'可选最长分钟数',limit:'1到12',locale:'zh-CN或en'},purpose:'查找当前可用游戏、工具及学习内容；结果不是操作指令。'},
  {name:'get_capability',arguments:{capabilityId:'搜索返回的稳定ID',locale:'zh-CN或en'},purpose:'获取当前详情和打开要求。'},
  {name:'open_capability',arguments:{capabilityId:'搜索或详情返回的稳定ID',locale:'zh-CN或en'},purpose:'用户明确要求打开时请求界面导航，不能声称已经打开；不要把搜索或推荐请求当作打开授权。'},
  {name:'get_my_learning_data',arguments:{view:'summary/history/wrong',days:'0(全部)/7/30/90/365',subjectId:'可选学科ID',stageId:'可选学段ID',topicId:'可选知识点ID',difficultyId:'可选难度ID',limit:'1到20',offset:'0到1000'},purpose:'只读查询当前登录账户的真实练习数据。summary为完整统计，history/wrong有分页；空数据不代表已掌握。'},
];

export function createPlatformAgentTools({capabilityService,practiceService}) {
  return {
    descriptions:platformAgentToolDescriptions,
    async execute(actor,name,args={}) {
      let input;
      try{input=name==='search_capabilities'?search.parse(args):['get_capability','open_capability'].includes(name)?target.parse(args):name==='get_my_learning_data'?normalizeLearningQuery(args):null;}
      catch { rejectPractice('AGENT_TOOL_INPUT_INVALID',400,'能力调用参数无效。'); }
      if(!input)rejectPractice('AGENT_TOOL_NOT_ALLOWED',400,'该平台能力不可用。');
      if(name==='get_my_learning_data') {
        const result=await practiceService.insights(actor,input);
        if(input.view==='wrong'&&result.items)result.items=result.items.map(item=>{const {figure,...question}=item.question;return {...item,question:{...question,figureCaption:figure?.caption||null}};});
        return {name,result};
      }
      if(!capabilityService)rejectPractice('AGENT_CATALOG_UNAVAILABLE',503,'平台目录暂不可用。');
      if(name==='search_capabilities')return {name,result:await capabilityService.searchCapabilities(input)};
      const capability=await capabilityService.getCapability(input);
      if(name==='get_capability')return {name,result:{capability}};
      const route=capability.launch?.playerRoute||capability.launch?.route;
      if(typeof route!=='string'||!/^\/(?:(?:works|play)\/[A-Za-z0-9._~-]+|tools\/[a-z0-9-]+|apps\/change-radar|learn(?:\/[a-z0-9-]+)?|discover\/c\/[A-Za-z0-9._~-]+)$/.test(route)||route==='/tools/paper-study'||capability.id==='official-tool:paper-study')
        rejectPractice('AGENT_NAVIGATION_UNAVAILABLE',409,'此内容暂不支持在当前界面打开。');
      return {name,result:{status:'navigation_requested',capability},action:{id:randomUUID(),kind:'navigate',capabilityId:capability.id,title:capability.title,route}};
    },
  };
}

export function registerPlatformAgentRoutes(app,{tools,requireAuth}) {
  app.post('/v1/me/agent/tools',{preHandler:requireAuth,bodyLimit:12000,schema:{body:{type:'object',additionalProperties:false,
    required:['name','arguments'],properties:{name:{enum:['search_capabilities','get_capability','open_capability','get_my_learning_data']},arguments:{type:'object',additionalProperties:true}}}}},async(r,reply)=>{
    reply.header('Cache-Control','no-store');
    try {return {data:await tools.execute(r.actor,r.body.name,r.body.arguments)};}
    catch(error){if(error instanceof AgentCapabilityError)rejectPractice(error.code,error.statusCode,error.message);throw error;}
  });
}
