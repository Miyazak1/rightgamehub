import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { createGameHubMcpWidget } from './gamehub-mcp-widget.mjs';

const toolError=message=>({isError:true,content:[{type:'text',text:message}]});

const inputSchema={
  url:z.string().url().max(2048).optional(),
  title:z.string().trim().min(1).max(120).optional(),
  condition:z.string().trim().max(500).optional(),
  ruleType:z.enum(['any','keyword_appears','keyword_disappears','number_changes']).default('any'),
  ruleValue:z.string().trim().max(200).optional(),
  intervalMinutes:z.number().int().min(15).max(10080).default(360),
  topicId:z.string().trim().regex(/^[A-Za-z0-9_-]+$/u).max(100).optional(),
  analysisType:z.enum(['metric-filter','metric-comparison','metric-trend','metric-matrix','metric-view','derived-metric','fact-timeline']).optional(),
  metricKey:z.string().trim().regex(/^[a-z0-9][a-z0-9._-]*$/u).max(80).optional(),
  methodVersion:z.string().trim().regex(/^[a-z0-9][a-z0-9._-]*$/u).max(80).optional(),
  metrics:z.array(z.object({metricKey:z.string().trim().regex(/^[a-z0-9][a-z0-9._-]*$/u).max(80),methodVersion:z.string().trim().regex(/^[a-z0-9][a-z0-9._-]*$/u).max(80)}).strict()).min(2).max(8).optional(),
  derivedMetricId:z.string().trim().regex(/^[A-Za-z0-9_-]+$/u).max(100).optional(),
  metricViewId:z.string().trim().regex(/^[A-Za-z0-9_-]+$/u).max(100).optional(),
  dimensionKey:z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u).max(40).optional(),
  dimensionValue:z.string().trim().min(1).max(120).optional(),
  subject:z.string().trim().min(1).max(240).optional(),
  predicateKey:z.string().trim().regex(/^[a-z0-9][a-z0-9._-]*$/u).max(80).optional(),
  scopeKey:z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u).max(40).optional(),
  scopeValue:z.string().trim().min(1).max(120).optional(),
  trendInterval:z.enum(['day','week','month']).default('month'),
  from:z.string().datetime().optional(),
  to:z.string().datetime().optional(),
};

function buildRadarView(origin,args){
  const {url:watchedUrl,title,condition,ruleType='any',ruleValue,intervalMinutes=360,topicId,analysisType,metricKey,methodVersion,metrics,derivedMetricId,metricViewId,dimensionKey,dimensionValue,subject,predicateKey,scopeKey,scopeValue,trendInterval='month',from,to}=args;
  if(watchedUrl&&topicId)return toolError('Provide url (prepare a public-page watch) or topicId (open an existing private research topic), not both.');
  if(analysisType&&!topicId)return toolError('Research analysis can only target an existing research topic.');
  if(topicId&&(title||condition||ruleValue))return toolError('Monitoring fields cannot be combined with a research-topic request.');
  if(!watchedUrl&&!topicId&&(title||condition||ruleValue))return toolError('Monitoring fields require url.');
  if(analysisType&&!['metric-matrix','metric-view','derived-metric','fact-timeline'].includes(analysisType)&&!metricKey)return toolError('Metric filter, comparison, and trend analysis require metricKey.');
  if(analysisType==='metric-matrix'&&(!metrics||new Set(metrics.map(item=>`${item.metricKey}:${item.methodVersion}`)).size!==metrics.length))return toolError('Metric matrix analysis requires 2–8 unique metricKey and methodVersion pairs.');
  if(analysisType!=='metric-matrix'&&metrics)return toolError('The metrics array is only valid for metric-matrix analysis.');
  if(analysisType==='metric-matrix'&&(metricKey||methodVersion||dimensionValue))return toolError('Metric matrix analysis uses metrics and dimensionKey, not single-metric fields or dimensionValue.');
  if(analysisType==='derived-metric'&&!derivedMetricId)return toolError('Derived metric analysis requires derivedMetricId.');
  if(analysisType!=='derived-metric'&&derivedMetricId)return toolError('derivedMetricId is only valid for derived-metric analysis.');
  if(analysisType==='derived-metric'&&(metricKey||methodVersion||metrics||dimensionKey||dimensionValue))return toolError('Derived metric analysis uses only a saved derivedMetricId and an optional time window.');
  if(analysisType==='metric-view'&&!metricViewId)return toolError('Saved metric view analysis requires metricViewId.');
  if(analysisType!=='metric-view'&&metricViewId)return toolError('metricViewId is only valid for metric-view analysis.');
  if(analysisType==='metric-view'&&(metricKey||methodVersion||metrics||derivedMetricId||dimensionKey||dimensionValue||from||to))return toolError('Saved metric view analysis uses only metricViewId; its frozen configuration supplies the query fields.');
  if(analysisType==='fact-timeline'&&(!dimensionKey||!predicateKey))return toolError('Fact timeline analysis requires dimensionKey and predicateKey.');
  if(analysisType==='fact-timeline'&&!/^[a-z0-9][a-z0-9._-]{0,79}$/u.test(dimensionKey))return toolError('Fact timeline dimensionKey must use the normalized lower-case fact key format.');
  if(analysisType==='fact-timeline'&&Boolean(scopeKey)!==Boolean(scopeValue))return toolError('Fact timeline scopeKey and scopeValue must be provided together.');
  if(analysisType==='fact-timeline'&&(metricKey||methodVersion||metrics||derivedMetricId||metricViewId||dimensionValue))return toolError('Fact timeline analysis uses fact fields, an optional scope pair, and an optional time window.');
  if(analysisType!=='fact-timeline'&&(subject||predicateKey||scopeKey||scopeValue))return toolError('Fact fields are only valid for fact-timeline analysis.');
  if(['metric-comparison','metric-trend','metric-matrix'].includes(analysisType)&&!dimensionKey)return toolError('Metric comparison, trend, and matrix analysis require dimensionKey.');
  if(analysisType==='metric-trend'&&!dimensionValue)return toolError('Metric trend analysis requires dimensionValue.');
  if(analysisType==='metric-filter'&&Boolean(dimensionKey)!==Boolean(dimensionValue))return toolError('Metric filtering requires dimensionKey and dimensionValue together.');
  if(from&&to&&new Date(from)>new Date(to))return toolError('The analysis time window must begin on or before it ends.');
  if((metricKey||methodVersion||metrics||derivedMetricId||metricViewId||dimensionKey||dimensionValue||subject||predicateKey||scopeKey||scopeValue||from||to)&&!analysisType)return toolError('Provide analysisType when analysis fields are present.');
  const query=watchedUrl?new URLSearchParams({url:watchedUrl,interval:String(intervalMinutes),ruleType}):topicId?new URLSearchParams({topicId}):new URLSearchParams();
  if(watchedUrl&&title)query.set('title',title);
  if(watchedUrl&&condition)query.set('condition',condition);
  if(watchedUrl&&ruleValue)query.set('ruleValue',ruleValue);
  if(analysisType){
    query.set('analysis',analysisType);
    if(metricKey)query.set('metricKey',metricKey);
    if(methodVersion)query.set('methodVersion',methodVersion);
    if(metrics)for(const item of metrics)query.append('metric',`${item.metricKey}:${item.methodVersion}`);
    if(derivedMetricId)query.set('derivedMetricId',derivedMetricId);
    if(metricViewId)query.set('metricViewId',metricViewId);
    if(dimensionKey)query.set('dimensionKey',dimensionKey);
    if(dimensionValue)query.set('dimensionValue',dimensionValue);
    if(subject)query.set('subject',subject);
    if(predicateKey)query.set('predicateKey',predicateKey);
    if(scopeKey)query.set('scopeKey',scopeKey);
    if(scopeValue)query.set('scopeValue',scopeValue);
    if(analysisType==='metric-trend')query.set('trendInterval',trendInterval);
    if(from)query.set('from',from);
    if(to)query.set('to',to);
  }
  const path=query.size?`/tools/change-radar?${query}`:'/tools/change-radar';
  const url=new URL('/mcp-app',origin);url.searchParams.set('gh_route',path);url.searchParams.set('gh_host','mcp-app');
  return{
    content:[{type:'text',text:watchedUrl?'The monitoring task is prepared. Ask the user to review and confirm it in the Change Radar sidebar.':analysisType?'The authenticated Change Radar sidebar is opening the requested topic and running a bounded read-only analysis. Use only evidence-linked results; missing values are unknown, not zero, and the analysis does not prove causation.':topicId?'The authenticated Change Radar sidebar is opening the requested private topic.':'The authenticated Change Radar sidebar is opening. Private research data is resolved only after the user signs in.'}],
    structuredContent:{view:{path,url:url.href}},
  };
}

export function createChangeRadarMcpServer({siteOrigin='https://mooyu.fun'}={}){
  const origin=new URL(siteOrigin).origin,widget=createGameHubMcpWidget(origin),uiResourceUri=widget.uri;
  const server=new McpServer({name:'change-radar',title:'Change Radar / 变更雷达',version:'0.1.0'});
  registerAppResource(server,'Change Radar hosted workspace',uiResourceUri,{description:'The hosted Change Radar workspace for long-running, evidence-linked monitoring and comparison.'},async()=>({contents:[{uri:uiResourceUri,mimeType:RESOURCE_MIME_TYPE,text:widget.html,_meta:{ui:{prefersBorder:false,domain:origin,csp:{frameDomains:[origin],resourceDomains:[origin],connectDomains:[origin]}},'openai/ui':{availableDisplayModes:['fullscreen']},'openai/widgetDescription':'Track a subject over time and inspect evidence-linked changes.','openai/widgetPrefersBorder':false,'openai/widgetDomain':origin,'openai/widgetCSP':{frame_domains:[origin],resource_domains:[origin],connect_domains:[origin]}}}]}));
  registerAppTool(server,'open_change_radar',{
    title:'Open Change Radar',
    description:'Open the standalone Change Radar sidebar, prepare a public-page watch, or inspect one authenticated research topic. Monitoring changes state only after the user reviews and confirms it in the sidebar.',
    inputSchema,
    outputSchema:{view:z.object({path:z.string(),url:z.string().url()})},
    annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false},
    _meta:{ui:{resourceUri:uiResourceUri,visibility:['model','app']},'openai/outputTemplate':uiResourceUri,'openai/toolInvocation/invoking':'Preparing Change Radar…','openai/toolInvocation/invoked':'Change Radar is ready for review.'},
  },async args=>buildRadarView(origin,args));
  return server;
}

export function registerChangeRadarMcpRoutes(app,{siteOrigin='https://mooyu.fun'}={}){
  const cors=reply=>reply.header('Access-Control-Allow-Origin','*').header('Access-Control-Allow-Methods','POST, GET, DELETE, OPTIONS').header('Access-Control-Allow-Headers','content-type, mcp-session-id, mcp-protocol-version').header('Access-Control-Expose-Headers','Mcp-Session-Id');
  const route='/mcp/change-radar';
  app.options(route,async(_request,reply)=>cors(reply).status(204).send());
  for(const method of ['POST','GET','DELETE'])app.route({method,url:route,handler:async(request,reply)=>{
    cors(reply).header('Cache-Control','no-store');
    const server=createChangeRadarMcpServer({siteOrigin}),transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
    reply.hijack();reply.raw.once('close',()=>{transport.close().catch(()=>{});server.close().catch(()=>{});});
    try{await server.connect(transport);await transport.handleRequest(request.raw,reply.raw,request.body);}
    catch(error){request.log?.error?.({err:error},'Change Radar MCP request failed');if(!reply.raw.headersSent)reply.raw.writeHead(500,{'content-type':'application/json'}).end(JSON.stringify({jsonrpc:'2.0',error:{code:-32603,message:'Internal server error'},id:null}));}
  }});
}
