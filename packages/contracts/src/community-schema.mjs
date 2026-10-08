const obj=(properties,required=Object.keys(properties))=>({type:'object',additionalProperties:false,properties,required});
const text={type:'string'},id={type:'string',format:'uuid'},bool={type:'boolean'},time={type:'string',format:'date-time'},uint={type:'string',pattern:'^(0|[1-9][0-9]*)$'};
const nullable=value=>({oneOf:[value,{type:'null'}]}),en=values=>({type:'string',enum:values}),ref=name=>({$ref:'#/components/schemas/'+name}),array=(item,maxItems)=>({type:'array',items:item,...(maxItems?{maxItems}:{})});
const channel=en(['game','ai','computing']),reason={type:'string',minLength:1,maxLength:1000};
const blocks={type:'array',minItems:1,maxItems:32,items:{oneOf:[
  obj({type:{const:'paragraph',type:'string'},text:{type:'string',minLength:1,maxLength:4000}}),
  obj({type:{const:'link',type:'string'},url:{type:'string',maxLength:2048,pattern:'^https://'},label:{type:'string',maxLength:160}},['type','url']),
  obj({type:{const:'image',type:'string'},assetId:id,alt:{type:'string',maxLength:240}}),
]}};
const post={
  id,author:obj({id,displayName:text,handle:nullable(text),avatar:ref('AccountAvatar')}),channel,title:{type:'string',minLength:1,maxLength:120},blocks,
  schemaVersion:{type:'integer',const:1},publicationState:en(['draft','published','withdrawn','deleted']),moderationState:en(['clear','hidden']),
  revisionId:id,reviewStatus:en(['draft','pending','approved','rejected','superseded']),reviewReason:nullable(text),version:uint,likeCount:uint,liked:bool,bookmarked:bool,publishedAt:nullable(time),updatedAt:time,
};
const mediaState=en(['reserved','uploaded','processing','ready','failed','deleting','deleted']);
export const communitySchemas={
  CommunityContent:obj({channel,title:post.title,blocks}),
  CommunityPost:obj(post),
  CommunityPage:obj({items:array(ref('CommunityPost'),20),nextCursor:nullable(text)}),
  CommunityCapabilities:obj({readEnabled:bool,postingEnabled:bool,imagesEnabled:bool,likesEnabled:bool,bookmarksEnabled:bool,commentsEnabled:{type:'boolean',const:false},canShare:bool,isAdmin:bool,reason:nullable(text),channels:array(obj({key:channel,name:text}),3),limits:{type:'object',additionalProperties:{type:'integer',minimum:1}}}),
  CommunityDeleted:obj({deleted:{type:'boolean',const:true}}),
  CommunityInteraction:obj({active:bool}),
  CommunityReportRequest:obj({category:en(['unsafe','harassment','copyright','spam','other']),details:reason}),
  CommunityReportResult:obj({received:{type:'boolean',const:true}}),
  CommunityReview:obj({items:array(obj({...post,publishedContent:nullable(obj({revisionId:id,title:text,blocks})),reports:array(obj({id,post_id:id,category:text,details:text,created_at:time}),100)}),50),nextCursor:nullable(text)}),
  CommunityDecision:obj({action:en(['approve','reject','hide','restore','dismiss_reports']),revisionId:id,reason}),
  CommunityMemberRequest:obj({allowed:bool,reason}),
  CommunityMemberResult:obj({allowed:bool}),
  CommunityMediaRequest:obj({bytes:{type:'integer',minimum:1,maximum:2097152},contentType:en(['image/jpeg','image/png','image/webp']),sha256:{type:'string',pattern:'^[a-f0-9]{64}$'}}),
  CommunityMediaResult:obj({id,state:mediaState}),
  CommunityMediaUploaded:obj({id,uploaded:{type:'boolean',const:true}}),
  CommunityMediaStatus:obj({id,state:mediaState,width:nullable({type:'integer',minimum:1}),height:nullable({type:'integer',minimum:1}),errorCode:nullable(text)}),
};
const parameter=(name,where,schema,required=false)=>({name,in:where,schema,required});
const paging=[parameter('cursor','query',{type:'string',maxLength:800})];
const version=[parameter('If-Match','header',{type:'string',pattern:'^"[1-9][0-9]{0,17}"$'},true)];
const receipt=[parameter('Idempotency-Key','header',{type:'string',minLength:8,maxLength:128,pattern:'^[A-Za-z0-9_-]+$'},true)];
const route=(method,path,operationId,response,options={})=>({method,path,operationId,response,auth:'bearer',...options});
const postPath='/v1/community/posts/{postId}',mediaPath='/v1/community/media/{assetId}';
export const communityRoutes=[
  route('get','/v1/community/capabilities','communityCapabilities','CommunityCapabilities',{auth:'optional'}),
  route('get','/v1/community/posts','communityList','CommunityPage',{auth:'optional',parameters:[...paging,parameter('channel','query',channel),parameter('author','query',id)]}),
  route('get','/v1/community/me/posts','communityOwnPosts','CommunityPage',{parameters:paging}),
  route('get','/v1/community/me/bookmarks','communityBookmarks','CommunityPage',{parameters:paging}),
  route('get','/v1/community/me/posts/{postId}','communityOwnPost','CommunityPost',{pathId:'postId'}),
  route('get',postPath,'communityPost','CommunityPost',{pathId:'postId',auth:'optional'}),
  route('post','/v1/community/posts','communityCreate','CommunityPost',{request:'CommunityContent',parameters:receipt}),
  route('patch',postPath,'communityEdit','CommunityPost',{pathId:'postId',request:'CommunityContent',parameters:[...version,...receipt]}),
  route('post',postPath+'/submit','communitySubmit','CommunityPost',{pathId:'postId',parameters:[...version,...receipt]}),
  route('post',postPath+'/withdraw','communityWithdraw','CommunityPost',{pathId:'postId',parameters:version}),
  route('delete',postPath,'communityDelete','CommunityDeleted',{pathId:'postId',parameters:version}),
  ...['like','bookmark'].flatMap(type=>['put','delete'].map(method=>route(method,postPath+'/'+type,'community'+type+method,'CommunityInteraction',{pathId:'postId'}))),
  route('post',postPath+'/reports','communityReport','CommunityReportResult',{pathId:'postId',request:'CommunityReportRequest'}),
  route('get','/v1/admin/community/review','communityReview','CommunityReview',{parameters:paging}),
  route('post','/v1/admin/community/posts/{postId}/decisions','communityDecide','CommunityPost',{pathId:'postId',request:'CommunityDecision',parameters:[...version,...receipt]}),
  route('put','/v1/admin/community/members/{userId}','communityMember','CommunityMemberResult',{pathId:'userId',request:'CommunityMemberRequest'}),
  route('post',postPath+'/media','communityReserve','CommunityMediaResult',{pathId:'postId',request:'CommunityMediaRequest',parameters:receipt}),
  route('put',mediaPath+'/content','communityUpload','CommunityMediaUploaded',{pathId:'assetId',communityImageBody:true}),
  route('post',mediaPath+'/complete','communityComplete','CommunityMediaResult',{pathId:'assetId'}),
  route('get','/v1/community/me/media/{assetId}','communityMediaStatus','CommunityMediaStatus',{pathId:'assetId'}),
  route('get',mediaPath+'/{variant}','communityImage',null,{pathId:'assetId',auth:'optional',binaryResponse:true,parameters:[parameter('variant','path',en(['thumb','display']),true),parameter('preview','query',bool)]}),
];
