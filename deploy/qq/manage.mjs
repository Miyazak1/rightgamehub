import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
const api='http://127.0.0.1:6099/api',command=process.argv[2]??'status';
try{
 if(!['status','connect'].includes(command))throw Error('QQ_MANAGE_USAGE');
 const config=JSON.parse(await readFile('/config/config.json','utf8'));
 const workerHost=config.deployment==='server'?'worker':'127.0.0.1';
 const auth=await fetch(api+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({hash:createHash('sha256').update(process.env.QQ_WEBUI_TOKEN+'.napcat').digest('hex')}),signal:AbortSignal.timeout(5000)}).then(r=>r.json());
 if(auth.code!==0||!auth.data?.Credential)throw Error('QQ_MANAGEMENT_AUTH_FAILED');
 async function post(endpoint,body={}){
  const response=await fetch(api+endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.data.Credential},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)}).then(r=>r.json());
  if(response.code!==0)throw Error('QQ_MANAGEMENT_REQUEST_FAILED');return response.data;
 }
 const status=await post('/QQLogin/CheckLoginStatus');
 let connected=false;
 try{connected=(await fetch('http://'+workerHost+':'+config.port+'/health',{signal:AbortSignal.timeout(2000)}).then(r=>r.json())).connected===true;}catch{}
 if(command==='status'){console.log(JSON.stringify({loggedIn:status.isLogin===true,coreReady:status.coreReady===true,phase:status.loginPhase??null,connected}));}
 else{
  if(!status.isLogin||!status.coreReady)throw Error('QQ_SCAN_AND_LOGIN_FIRST');
  const info=await post('/QQLogin/GetQQLoginInfo');if(String(info.uin)!==config.botId)throw Error('QQ_WRONG_ACCOUNT');
  const unwrap=value=>{if(value&&Object.hasOwn(value,'retcode')){if(value.status!=='ok'||value.retcode!==0)throw Error('QQ_GROUP_READ_FAILED');return value.data;}return value;};
  const group=unwrap(await post('/Debug/call',{action:'get_group_info',params:{group_id:Number(config.groupId)}}));
  if(String(group.group_id)!==config.groupId)throw Error('QQ_TEST_GROUP_NOT_CONFIRMED');
  const current=await post('/OB11Config/GetConfig');
  const entry={name:'mooyu-server',enable:true,url:'ws://'+workerHost+':'+config.port+'/onebot/v11',messagePostFormat:'array',reportSelfMessage:false,reconnectInterval:5000,heartInterval:30000,token:process.env.QQ_ACCESS_TOKEN,debug:false};
  if(!entry.token||entry.token.length<32)throw Error('QQ_ACCESS_TOKEN_REQUIRED');
  const clients=current.network?.websocketClients??[];
  if(clients.some(item=>item.enable&&item.name!==entry.name))throw Error('QQ_OTHER_CONNECTION_RETAINED');
  const backup='/data/napcat/config/onebot.before-server.json';
  try{await writeFile(backup,JSON.stringify(current,null,2),{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}
  await post('/OB11Config/SetConfig',{config:JSON.stringify({...current,network:{...current.network,websocketClients:[...clients.filter(item=>item.name!==entry.name),entry]}})});
  console.log(JSON.stringify({configured:true,groupId:config.groupId,allowedUsers:config.allowedUsers,paperEnabled:false}));
 }
}catch(error){console.error(/^[A-Z_]+$/.test(error.message)?error.message:'QQ_MANAGEMENT_FAILED');process.exitCode=1;}
