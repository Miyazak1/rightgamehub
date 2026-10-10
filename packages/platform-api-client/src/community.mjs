const segment=value=>encodeURIComponent(value);
const query=input=>{const params=new URLSearchParams(Object.entries(input).filter(([,v])=>v!==undefined&&v!==null&&v!==''));return params.size?'?'+params.toString():'';};
const postPath=id=>'/v1/community/posts/'+segment(id);
const mutation=(version,key)=>({'If-Match':'"'+version+'"','Idempotency-Key':key});
export function communityApi(request) {
  return {
    communityCapabilities:options=>request('/v1/community/capabilities',{...options,auth:true}),
    communityList:({kind='feed',...filters}={},options)=>request((kind==='feed'?'/v1/community/posts':'/v1/community/me/'+(kind==='mine'?'posts':'bookmarks'))+query(filters),{...options,auth:true}),
    communityPost:(id,{manage=false,...options}={})=>request((manage?'/v1/community/me/posts/': '/v1/community/posts/')+segment(id),{...options,auth:true}),
    communitySave:(id,body,{version,key,...options})=>request(id?postPath(id):'/v1/community/posts',{...options,method:id?'PATCH':'POST',body,auth:true,headers:mutation(version,key)}),
    communitySubmit:(post,{key,...options})=>request(postPath(post.id)+'/submit',{...options,method:'POST',auth:true,headers:mutation(post.version,key)}),
    communityWithdraw:(post,remove=false,options)=>request(postPath(post.id)+(remove?'':'/withdraw'),{...options,method:remove?'DELETE':'POST',auth:true,headers:{'If-Match':'"'+post.version+'"'}}),
    communityInteract:(id,type,active,options)=>request(postPath(id)+'/'+segment(type),{...options,method:active?'PUT':'DELETE',auth:true}),
    communityReport:(id,body,options)=>request(postPath(id)+'/reports',{...options,method:'POST',body,auth:true}),
    communityReview:({cursor,...options}={})=>request('/v1/admin/community/review'+query({cursor}),{...options,auth:true}),
    communityDecide:(post,body,{key,...options})=>request('/v1/admin/community/posts/'+segment(post.id)+'/decisions',{...options,method:'POST',body:{...body,revisionId:post.revisionId},auth:true,headers:mutation(post.version,key)}),
    communityMember:(userId,body,options)=>request('/v1/admin/community/members/'+segment(userId),{...options,method:'PUT',body,auth:true}),
    communityProjects:(filters={},options)=>request('/v1/community/projects'+query(filters),{...options,auth:true}),
    communityProject:(id,options)=>request('/v1/community/projects/'+segment(id),{...options,auth:true}),
    communityProjectCreate:(body,options)=>request('/v1/community/projects',{...options,method:'POST',body,auth:true}),
    communityProjectUpdate:(id,body,options)=>request('/v1/community/projects/'+segment(id),{...options,method:'PATCH',body,auth:true}),
    communityProjectApply:(id,body,options)=>request('/v1/community/projects/'+segment(id)+'/applications',{...options,method:'POST',body,auth:true}),
    communityProjectDecide:(id,applicationId,body,options)=>request('/v1/community/projects/'+segment(id)+'/applications/'+segment(applicationId)+'/decision',{...options,method:'POST',body,auth:true}),
    communityProjectLeave:(id,options)=>request('/v1/community/projects/'+segment(id)+'/leave',{...options,method:'POST',auth:true}),
    communityOverview:options=>request('/v1/community/overview',{...options,auth:true}),
    communityParticipation:options=>request('/v1/community/me/participation',{...options,auth:true}),
    communityParticipationNotificationRead:(id,options)=>request('/v1/community/me/participation/notifications/'+segment(id)+'/read',{...options,method:'POST',auth:true}),
    communityEvents:(filters={},options)=>request('/v1/community/events'+query(filters),{...options,auth:true}),
    communityEvent:(id,options)=>request('/v1/community/events/'+segment(id),{...options,auth:true}),
    communityEventCreate:(body,options)=>request('/v1/community/events',{...options,method:'POST',body,auth:true}),
    communityEventUpdate:(id,body,options)=>request('/v1/community/events/'+segment(id),{...options,method:'PATCH',body,auth:true}),
    communityEventRegister:(id,options)=>request('/v1/community/events/'+segment(id)+'/register',{...options,method:'POST',auth:true}),
    communityEventUnregister:(id,options)=>request('/v1/community/events/'+segment(id)+'/unregister',{...options,method:'POST',auth:true}),
    communityParties:(filters={},options)=>request('/v1/community/parties'+query(filters),{...options,auth:true}),
    communityParty:(id,options)=>request('/v1/community/parties/'+segment(id),{...options,auth:true}),
    communityPartyCreate:(body,options)=>request('/v1/community/parties',{...options,method:'POST',body,auth:true}),
    communityPartyJoin:(id,options)=>request('/v1/community/parties/'+segment(id)+'/join',{...options,method:'POST',auth:true}),
    communityPartyLeave:(id,options)=>request('/v1/community/parties/'+segment(id)+'/leave',{...options,method:'POST',auth:true}),
    communityPartyReady:(id,ready,options)=>request('/v1/community/parties/'+segment(id)+'/ready',{...options,method:'POST',body:{ready},auth:true}),
    communityPartyStart:(id,options)=>request('/v1/community/parties/'+segment(id)+'/start',{...options,method:'POST',auth:true}),
    communityPartyFinish:(id,state,options)=>request('/v1/community/parties/'+segment(id)+'/finish',{...options,method:'POST',body:{state},auth:true}),
    communityReserve:(postId,body,{key,...options})=>request(postPath(postId)+'/media',{...options,method:'POST',body,auth:true,headers:{'Idempotency-Key':key}}),
    communityUpload:(id,bytes,options)=>request('/v1/community/media/'+segment(id)+'/content',{...options,method:'PUT',auth:true,rawBody:bytes,headers:{'Content-Type':'application/octet-stream'}}),
    communityComplete:(id,options)=>request('/v1/community/media/'+segment(id)+'/complete',{...options,method:'POST',auth:true}),
    communityMediaStatus:(id,options)=>request('/v1/community/me/media/'+segment(id),{...options,auth:true}),
    async communityImage(id,{preview=false,variant='display',...options}={}) {
      try{
        const result=await request('/v1/community/media/'+segment(id)+'/'+segment(variant)+query({preview:preview||undefined}),{...options,auth:true,responseBytesLimit:variant==='thumb'?163840:1048576,headers:{Accept:'image/webp'}});
        if(result.contentType!=='image/webp')throw new Error('图片响应格式无效。');
        return {data:new Blob([result.data],{type:'image/webp'})};
      }catch(error){
        if(error.code?.startsWith('SAVE_')){error.code='MEDIA_RESPONSE_INVALID';error.message='图片超过下载限制或无法读取。';}
        throw error;
      }
    },
  };
}
