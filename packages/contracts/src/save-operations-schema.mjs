const obj=(properties,required=Object.keys(properties))=>({type:'object',additionalProperties:false,properties,required});
const id={type:'string',format:'uuid'},text={type:'string'},uint={type:'string',pattern:'^(0|[1-9][0-9]{0,18})$'},count={type:'integer',minimum:0},bool={type:'boolean'},time={type:'string',format:'date-time'};
const nullable=s=>({oneOf:[s,{type:'null'}]}),en=values=>({type:'string',enum:values}),ref=name=>({$ref:'#/components/schemas/'+name});
const channel=en(['production','preview']),reason={type:'string',minLength:1,maxLength:1000,pattern:'\\S'};
const capacity={retainedBytes:uint,maxPayloadBytes:uint,writesPaused:bool,version:uint};
const auditInput={operationId:id,reason};
export const saveOperationsSchemas={
  SaveHealthQuery:obj({afterWorkId:id},[]),
  SavePolicyParams:obj({policyId:id}),
  SavePolicyControl:obj({id,workId:id,namespace:text,status:en(['draft','review','active','retired']),writesPaused:bool,version:uint,schemaMin:count,schemaMax:count,maxSlots:count,maxDocumentBytes:count,maxLiveBytes:count,maxHistoryBytes:count,historyVersions:count,historyDays:count}),
  SaveTraffic:obj({channel,operation:en(['read','write','delete','restore','receipt']),requests:count,successes:count,errors:{type:'array',items:obj({code:text,count})},p50MsUpperBound:nullable(count),p95MsUpperBound:nullable(count),p99MsUpperBound:nullable(count)}),
  SaveHealthWork:obj({workId:id,title:text,policies:{type:'array',items:ref('SavePolicyControl')},usage:{type:'array',items:obj({channel,liveSlots:count,liveBytes:uint,historyBytes:uint,lastReconciledAt:nullable(time)})},traffic:{type:'array',items:ref('SaveTraffic')}}),
  SaveHealthPage:obj({items:{type:'array',maxItems:50,items:ref('SaveHealthWork')},nextAfterWorkId:nullable(id),windowHours:{type:'integer',const:24}}),
  SaveCapacityControl:obj(capacity),
  SaveCapacityOverview:obj({...capacity,databaseBytes:uint,saveTableBytes:uint,diskFreeBytes:nullable(uint),storage:obj({required:bool,allowed:bool,code:text,observedAt:nullable(time),totalBytes:nullable(uint),walBytes:nullable(uint)}),maintenance:nullable(obj({lastTickAt:time,lastRunAt:nullable(time),status:en(['ok','idle','busy','error']),code:text,errorScopes:count})),telemetryDropped:count}),
  SavePolicyPauseRequest:obj({...auditInput,expectedVersion:uint,writesPaused:bool}),
  SaveCapacityRequest:obj({...auditInput,expectedVersion:uint,writesPaused:bool,maxPayloadBytes:{type:'integer',minimum:1,maximum:5368709120}}),
  SaveMaintenanceCursor:obj({userId:id,channel}),
  SaveMaintenanceRequest:obj({...auditInput,mode:en(['inspect','repair','cleanup']),after:obj({userId:id,channel})},['operationId','reason','mode']),
  SaveMaintenanceResult:obj({scopes:count,mismatchScopes:count,repairedScopes:count,purgedPayloads:count,sampledPayloads:count,invalidPayloads:count,missingCurrentPayloads:count,next:nullable(ref('SaveMaintenanceCursor'))}),
  SaveAdminAuditPage:obj({items:{type:'array',maxItems:50,items:obj({id,actorUserId:id,action:en(['policy_pause','capacity','inspect','repair','cleanup']),workId:nullable(id),reason,requestId:text,beforeState:{type:'object',additionalProperties:true},result:{type:'object',additionalProperties:true},createdAt:time})}}),
};
export const saveOperationsRoutes=[
  {method:'get',path:'/v1/creator/save-health',operationId:'getCreatorSaveHealth',auth:'bearer',saveHealthPage:true,response:'SaveHealthPage'},
  {method:'get',path:'/v1/admin/save-operations/health',operationId:'getAdminSaveHealth',auth:'bearer',saveHealthPage:true,response:'SaveHealthPage'},
  {method:'get',path:'/v1/admin/save-operations/capacity',operationId:'getSaveCapacity',auth:'bearer',response:'SaveCapacityOverview'},
  {method:'patch',path:'/v1/admin/save-operations/capacity',operationId:'setSaveCapacity',auth:'bearer',request:'SaveCapacityRequest',response:'SaveCapacityControl'},
  {method:'patch',path:'/v1/admin/save-operations/policies/{policyId}',operationId:'pauseSavePolicy',auth:'bearer',pathId:'policyId',request:'SavePolicyPauseRequest',response:'SavePolicyControl'},
  {method:'post',path:'/v1/admin/save-operations/works/{workId}/maintenance',operationId:'maintainGameSaves',auth:'bearer',pathId:'workId',request:'SaveMaintenanceRequest',response:'SaveMaintenanceResult'},
  {method:'get',path:'/v1/admin/save-operations/audit',operationId:'getSaveAdminAudit',auth:'bearer',response:'SaveAdminAuditPage'},
];
