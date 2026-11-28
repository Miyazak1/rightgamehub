// Run inside the existing QQ worker, once. Uses its installed controller and
// permits only one management authentication plus native/group reads.
import {NapCatControl} from '/app/apps/qq-channel/src/napcat-control.mjs';
const control=new NapCatControl({token:process.env.QQ_NAPCAT_TOKEN,accessToken:'diagnostic-unused'});
const config={botId:'3922489710',groupId:'905757031'},original=control.post.bind(control),trace=[];
let authRequests=0;
const stages=new Map([['/auth/login','management-auth'],['/QQLogin/CheckLoginStatus','login'],['/QQLogin/GetQQLoginInfo','account']]);
control.post=async(endpoint,body={},auth=true,signal)=>{
 const stage=endpoint==='/Debug/call'?new Map([['get_group_info','group-info'],['get_group_member_info','group-member'],['get_group_list','group-list']]).get(body?.action):stages.get(endpoint);
 if(!stage||endpoint==='/Debug/call'&&(body.action!=='get_group_list'&&body.params?.group_id!==Number(config.groupId)||body.action==='get_group_member_info'&&body.params?.user_id!==Number(config.botId)))throw Error('DIAGNOSTIC_READ_SCOPE_REQUIRED');
 if(stage==='management-auth'&&++authRequests>1)throw Error('DIAGNOSTIC_AUTH_LIMIT');
 const row={stage,start:Date.now(),elapsedMs:null,result:'started'};trace.push(row);
 try{
  const value=await original(endpoint,body,auth,signal);row.result='ok';
  if(stage==='login')row.native={loggedIn:value?.isLogin===true,coreReady:value?.coreReady===true};
  if(stage==='account')row.expectedAccount=String(value?.uin)===config.botId;
  const unwrapped=value&&Object.hasOwn(value,'retcode')?value.data:value;
  if(stage==='group-info')row.groupMatches=String(unwrapped?.group_id)===config.groupId;
  if(stage==='group-member')row.memberMatches=String(unwrapped?.user_id)===config.botId;
  if(stage==='group-list')row.expectedGroupPresent=Array.isArray(unwrapped)?unwrapped.some(g=>String(g?.group_id)===config.groupId):null;
  return value;
 }catch(e){row.result=/^QQ_[A-Z0-9_]{1,70}$/u.test(e?.code??'')?e.code:'READ_FAILED';row.deadlineAborted=signal?.aborted===true;throw e;}
 finally{row.elapsedMs=Date.now()-row.start;delete row.start;}
};
try{
 const snapshot=await control.inspect(config);await new Promise(resolve=>setTimeout(resolve,0));
 const keys=['available','loggedIn','coreReady','accountMatches','groupReady','groupState','phase','observation','checkedAt','verifiedAt','probeFailure'];
 console.log(JSON.stringify({result:'EXISTING_WORKER_SINGLE_SAMPLE_TRACE',trace,runtime:Object.fromEntries(keys.filter(k=>snapshot[k]!==undefined).map(k=>[k,snapshot[k]])),managementAuthRequests:authRequests,qqLoginRequested:false,qrRequested:false,configurationWritten:false,servicesRestarted:false,oldTasksRetried:false,rawCredentialsPrinted:false},null,2));
}catch{console.log(JSON.stringify({result:'BOUNDED_SAMPLE_TRACE_FAILED',trace,managementAuthRequests:authRequests,qqLoginRequested:false,qrRequested:false,configurationWritten:false,servicesRestarted:false}));process.exitCode=1;}
