import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {createRuntime} from '../apps/api/src/runtime.mjs';

const root=path.resolve(import.meta.dirname,'..'),stateRoot=path.join(root,'.runtime/community-installed');
const databaseUrl=process.env.GAMEHUB_COMMUNITY_DATABASE_URL;
const parsed=new URL(databaseUrl??'http://missing');
if(!['localhost','127.0.0.1'].includes(parsed.hostname)||!['postgres:','postgresql:'].includes(parsed.protocol)||parsed.pathname!=='/community_test')throw Error('Use the dedicated loopback community_test database.');
await fs.mkdir(stateRoot,{recursive:true});
const emails=['share-a@gamehub.test','share-review@gamehub.test'],mailboxPath=path.join(stateRoot,'mailbox.json'),mailbox={};
await fs.writeFile(mailboxPath,'{}\n',{mode:0o600});
const runtime=createRuntime({env:{
  NODE_ENV:'test',DATABASE_URL:databaseUrl,OTP_HMAC_KEY:crypto.randomBytes(32).toString('hex'),
  API_HOST:'127.0.0.1',API_PORT:'3087',CLOUD_SAVE_ENABLED:'false',
  COMMUNITY_ENABLED:'true',COMMUNITY_POSTING_ENABLED:'true',COMMUNITY_IMAGES_ENABLED:'true',
  COMMUNITY_MEDIA_ROOT:path.join(stateRoot,'media'),COMMUNITY_PROCESSOR_ROOT:path.join(stateRoot,'processor'),
  TRUST_EDITOR_WEBVIEWS:'true',CORS_ORIGINS:'http://127.0.0.1:3087',LOGIN_EMAIL_ALLOWLIST:emails.join(','),
  GUESS_BAIKE_AUTOMATION_ENABLED:'false',
  QUARANTINE_ROOT:path.join(stateRoot,'quarantine'),RUNTIME_ROOT:path.join(stateRoot,'runtime'),
  VALIDATOR_ROOT:path.join(stateRoot,'validator'),AVATAR_ROOT:path.join(stateRoot,'avatars'),COVER_ROOT:path.join(stateRoot,'covers'),
},loadTrustedRules:false,mailer:{async sendVerificationCode(message){
  mailbox[message.email]={code:message.code,expiresAt:message.expiresAt};
  const temp=mailboxPath+'.'+crypto.randomUUID()+'.tmp';
  await fs.writeFile(temp,JSON.stringify(mailbox,null,2),{mode:0o600});await fs.rename(temp,mailboxPath);
}}});
let stopping=false,timer,processing=false;
async function stop(){
  if(stopping)return;stopping=true;clearInterval(timer);
  while(processing)await new Promise(resolve=>setTimeout(resolve,50));
  await runtime.app.close();
}
try{
  await runtime.migrations.apply();const userIds=[];
  for(const [i,email] of emails.entries()){
    const pool=runtime.database.pool;
    let id=(await pool.query("SELECT user_id FROM auth_identities WHERE provider='email' AND subject=$1",[email])).rows[0]?.user_id;
    if(!id){
      id=crypto.randomUUID();
      await pool.query("INSERT INTO users(id,display_name,role,social_visibility,profile_handle) VALUES($1,$2,$3,'public',$4)",[id,i?'分享测试审核员':'分享测试玩家',i?'admin':'user','share'+id.replaceAll('-','').slice(0,12)]);
      await pool.query("INSERT INTO auth_identities(id,user_id,provider,subject) VALUES($1,$2,'email',$3)",[crypto.randomUUID(),id,email]);
    }
    userIds.push(id);
  }
  const require=createRequire(new URL('../extensions/harness/package.json',import.meta.url)),{build}=require('esbuild');
  const web=path.join(stateRoot,'web');await fs.mkdir(web,{recursive:true});
  await build({absWorkingDir:root,entryPoints:['apps/web/src/main.jsx'],outfile:path.join(web,'app.js'),bundle:true,format:'iife',platform:'browser',target:['chrome110'],loader:{'.png':'dataurl'},nodePaths:[path.join(root,'extensions/harness/node_modules'),path.join(root,'packages/platform-client/node_modules')],define:{'import.meta.env.DEV':'false'},logLevel:'silent'});
  runtime.app.get('/',async(request,reply)=>reply.type('text/html').send('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GameHub 分享安装版验收</title><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script></html>'));
  for(const [name,type] of [['app.js','text/javascript'],['app.css','text/css']]){
    const bytes=await fs.readFile(path.join(web,name));runtime.app.get('/'+name,async(request,reply)=>reply.type(type).send(bytes));
  }
  const profilePath=path.join(stateRoot,'cursor-profile'),extensionsPath=path.join(stateRoot,'cursor-extensions');
  await fs.mkdir(path.join(profilePath,'User'),{recursive:true});await fs.mkdir(extensionsPath,{recursive:true});
  await fs.writeFile(path.join(profilePath,'User/settings.json'),JSON.stringify({
    'gamehub.apiUrl':'http://127.0.0.1:3087','gamehub.browserUrl':'http://127.0.0.1:3087/',
    'gamehub.autoUpdate':false,'workbench.startupEditor':'none','window.title':'GameHub 分享安装版验收',
    'extensions.autoUpdate':false,'extensions.autoCheckUpdates':false,
  },null,2));
  const workspacePath=path.join(stateRoot,'sharing-acceptance.code-workspace');
  await fs.writeFile(workspacePath,JSON.stringify({folders:[],settings:{}},null,2));
  const extension=JSON.parse(await fs.readFile(path.join(root,'extensions/vscode/package.json'),'utf8'));
  await runtime.app.listen({host:'127.0.0.1',port:3087});
  timer=setInterval(async()=>{
    if(processing||stopping)return;processing=true;
    try{await runtime.communityMediaService.runOnce();}catch(error){console.error('Local media worker:',error.code??error.name);}finally{processing=false;}
  },250);
  await fs.writeFile(path.join(stateRoot,'session.json'),JSON.stringify({emails,userIds,mailboxPath,profilePath,extensionsPath,workspacePath,url:'http://127.0.0.1:3087/',vsixPath:path.join(root,'artifacts/'+extension.name+'-'+extension.version+'.vsix')},null,2));
  console.log('Community installed acceptance ready at http://127.0.0.1:3087. Real email auth; cloud saves disabled. Local codec is for UI checks only, not capacity measurement.');
  process.once('SIGINT',()=>stop().then(()=>process.exit(0)));process.once('SIGTERM',()=>stop().then(()=>process.exit(0)));
}catch(error){await stop().catch(()=>{});throw error;}
