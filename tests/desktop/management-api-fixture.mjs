import {createIsolatedAccountApi} from './account-api-fixture.mjs';
export async function createManagementApiFixture({onMail}={}){
 const requests=[];let adminDenied=false,reportOpen=true;
 const work={id:'local-manager-work',title:'桌面管理验收作品',description:'隔离创作接口返回的作品',kind:'game',state:'draft',visibility:'private',revision:'1',targets:[],tags:[],coverUrl:null,creatorDisplayName:'桌面隔离测试用户'};
 const backend=await createIsolatedAccountApi({onMail,profileOverride:{role:'admin',canPublish:true},handleBusinessRequest:async(req,res,url,authenticate)=>{
   if(!/^\/v1\/(?:creator|admin|me\/(?:project-claims|assistant\/capabilities))/.test(url.pathname))return false;
   const json=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(status<400?{data}:{error:data}));return true;};
   const upload=req.method==='PUT'&&url.pathname.endsWith('/content');
   if(upload){if(req.headers.authorization!=='Upload selected-grant')return json({code:'UPLOAD_GRANT_INVALID'},401);}
   else await authenticate();
   requests.push({method:req.method,path:url.pathname});
   if(adminDenied&&url.pathname.startsWith('/v1/admin/'))return json({code:'ADMIN_REQUIRED'},403);
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks);
   if(upload)return json({id:'upload-one',state:'received',receivedBytes:bytes.length});
   const p=url.pathname;
   if(p==='/v1/creator/works')return json([work]);
   if(p==='/v1/creator/analytics'||p==='/v1/admin/analytics')return json({totals:{visitors:17,pageViews:321,starts:12},daily:[],sources:[],works:[],recent:[]});
   if(p==='/v1/admin/storage')return json({checkedAt:new Date().toISOString(),stores:[],level:'healthy',acceptingUploads:true,usedPercent:20,thresholds:{warnPercent:70,blockPercent:85},lastCleanup:{at:null}});
   if(p==='/v1/admin/reports')return json(reportOpen?[{id:'report-one',workId:work.id,workTitle:'治理验收待审作品',status:'open',reason:'copyright',detail:'隔离举报',createdAt:new Date().toISOString()}]:[]);
   if(p==='/v1/admin/reports/report-one/decision'){reportOpen=false;return json({id:'report-one',status:'dismissed'});}
   if(p==='/v1/admin/guess-baike/automation')return json({readyCount:3});
   if(p==='/v1/admin/source-imports/overview')return json({activeConnections:0,activeRepositories:0,imports24h:0,failedWebhooks24h:0});
   if(p==='/v1/me/assistant/capabilities')return json({available:false,capabilities:[]});
   if(p.endsWith('/source'))return json({provider:'manual'});
   if(p.includes('/grant'))return json({token:'selected-grant'});
   return json([]);
 }});
 return {...backend,requests,denyAdmin:value=>{adminDenied=value;}};
}
