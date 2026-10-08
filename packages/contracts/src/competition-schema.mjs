const obj=(properties,required=Object.keys(properties))=>({type:'object',additionalProperties:false,properties,required});
const text={type:'string'},uuid={type:'string',format:'uuid'},integer={type:'integer'},nullable=schema=>({oneOf:[schema,{type:'null'}]}),ref=name=>({$ref:'#/components/schemas/'+name});
const metrics={type:'object',minProperties:1,maxProperties:4,additionalProperties:{type:'integer',minimum:-1e12,maximum:1e12}};
const verification={type:'string',enum:['client_reported','replay_verified']};
export const competitionSchemas={
  CompetitionBoard:obj({id:text,key:text,title:text,modeKey:text,rulesetVersion:integer,period:{type:'string',enum:['daily','all-time']},timeZone:text,verification,verifier:text,challengeScoped:{type:'boolean'},playerCenter:text,metrics:{type:'array',maxItems:4,items:obj({key:text,label:text,unit:text,min:integer,max:integer},['key','label','unit'])},ranking:{type:'array',maxItems:4,items:obj({metric:text,direction:{type:'string',enum:['asc','desc']}})}},['id','key','title','modeKey','rulesetVersion','period','timeZone','verification','metrics','ranking']),
  CompetitionStart:obj({boardId:uuid,requestId:uuid}),
  CompetitionFinish:obj({metrics,evidence:obj({format:{type:'string',const:'tile-merge-v1'},moves:{type:'string',pattern:'^[LURD]+$',minLength:1,maxLength:8192}})},[]),
  CompetitionRun:obj({id:uuid,boardId:uuid,status:{type:'string',enum:['issued','accepted','abandoned','invalidated']},periodKey:text,seed:{type:'integer',minimum:0,maximum:4294967295},expiresAt:{type:'string',format:'date-time'},metrics:nullable(metrics),channel:{type:'string',enum:['production','preview']},verification},['id','boardId','status','periodKey','seed','expiresAt','metrics','channel']),
  CompetitionAbandoned:obj({abandoned:{type:'boolean'}}),
  CompetitionDecision:obj({action:{type:'string',enum:['invalidate','restore']},reason:{type:'string',minLength:1,maxLength:500}}),
  CompetitionDecisionResult:obj({status:{type:'string',enum:['accepted','invalidated']}}),
  CompetitionLeaderboard:obj({workId:text,boardId:text,title:text,date:nullable(text),timeZone:text,puzzleId:nullable(text),verification,definition:ref('CompetitionBoard'),metrics:{type:'array',items:obj({key:text,label:text,unit:text,min:integer,max:integer,direction:{type:'string',enum:['asc','desc']}},['key','label','unit'])},entries:{type:'array',maxItems:50,items:ref('WorkLeaderboardEntry')},myEntry:nullable(ref('WorkLeaderboardEntry')),total:integer,limit:integer,offset:integer,hasMore:{type:'boolean'}}),
};
const param=(name,where,schema,required=false)=>({name,in:where,schema,required});
const session=param('X-GameHub-Session','header',{type:'string',pattern:'^[A-Za-z0-9_-]{43}$'},true);
const route=(method,path,operationId,response,extra={})=>({method,path,operationId,response,auth:'bearer',...extra});
export const competitionRoutes=[
  route('get','/v1/works/{workId}/leaderboards','listWorkLeaderboards','CompetitionBoard',{auth:'anonymous',pathWorkKey:true,responseArray:true}),
  route('get','/v1/works/{workId}/leaderboards/{boardId}','readCompetitionLeaderboard','CompetitionLeaderboard',{auth:'optional',pathWorkKey:true,parameters:[param('boardId','path',text,true),param('date','query',{type:'string',format:'date'}),param('puzzleId','query',{type:'string',maxLength:120}),param('limit','query',{type:'integer',minimum:1,maximum:50}),param('offset','query',{type:'integer',minimum:0,maximum:100000})]}),
  route('get','/v1/competition/modes','listCompetitionModes','CompetitionBoard',{parameters:[session],responseArray:true}),
  route('post','/v1/competition/runs','startCompetitionRun','CompetitionRun',{parameters:[session],request:'CompetitionStart'}),
  route('get','/v1/competition/runs/{runId}','getCompetitionRun','CompetitionRun',{pathId:'runId',parameters:[session]}),
  route('post','/v1/competition/runs/{runId}/finish','finishCompetitionRun','CompetitionRun',{pathId:'runId',parameters:[session],request:'CompetitionFinish'}),
  route('post','/v1/competition/runs/{runId}/abandon','abandonCompetitionRun','CompetitionAbandoned',{pathId:'runId',parameters:[session]}),
  route('post','/v1/admin/competition/runs/{runId}/decision','moderateCompetitionRun','CompetitionDecisionResult',{pathId:'runId',request:'CompetitionDecision'}),
];
