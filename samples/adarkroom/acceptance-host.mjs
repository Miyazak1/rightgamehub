import {createIndexedDbSaveStore} from '../../packages/save-cache/src/indexeddb-store.mjs';
import {PlayerCore} from '../../packages/player-core/src/index.mjs';
import {createWebGameHost} from '../../packages/platform-client/src/web-game-host.mjs';
import {createApiClient} from '../../packages/platform-api-client/src/index.mjs';
const origin='http://127.0.0.1:3086',mount=document.getElementById('game'),host=window.__fixtureHost??'web';
const localMode=new URLSearchParams(location.search).get('local')==='1'&&host==='web';
const saveCache=localMode?createIndexedDbSaveStore({name:'gamehub.adr-acceptance.s2'}):null;
let identity=null,core=null,session=null,generation=0,offline=new URLSearchParams(location.search).get('offline')==='1';
const status=document.getElementById('host-status');
async function open(){
  const epoch=++generation;
  identity=null;core?.dispose();core=null;
  const account=document.getElementById('account').value;
  const response=await fetch(origin+'/fixture/session?account='+account+'&host='+host);
  if(!response.ok)throw new Error('Fixture session failed');
  const current=await response.json();if(epoch!==generation)return;
  session=current;identity=current.identity;
  const api=createApiClient({baseUrl:origin,getAccessToken:()=>current.token,fetchImpl:(...args)=>offline?Promise.reject(new TypeError("Simulated offline network")):fetch(...args)});
  core=new PlayerCore({runtimeDomain:'localhost',allowLocalhost:true,createBridge:context=>createWebGameHost({
    ...context,apiClient:api,getAccountIdentity:()=>identity,...(localMode?{saveCache,saveOrigin:origin,getSaveOwner:()=>"user:"+current.identity.split("/")[0]}:{}),onCloudSaveStatus:value=>{
      if(epoch===generation)status.textContent=host+' · '+account+' · '+value.state+(value.revision?' · 修订 '+value.revision:'');
    }
  })});
  core.mount(mount,current.descriptor);
}
async function seed(name){
  if(!session)throw new Error('请先等待测试账号连接。');
  const epoch=generation,current=session;
  core?.dispose();
  const r=await fetch(origin+'/fixture/seed',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+current.token},body:JSON.stringify({name})});
  if(!r.ok)throw new Error((await r.json()).error?.message??'Seed failed');
  if(epoch===generation)await open();
}
const action=fn=>()=>Promise.resolve().then(fn).catch(error=>{status.textContent=error.message;});
document.getElementById('account').onchange=action(open);document.getElementById('refresh').onclick=action(open);
for(const name of ['new','mid','pre-ending'])document.getElementById('seed-'+name).onclick=action(()=>seed(name));
if(localMode){
  const button=document.createElement('button');button.id='network';button.textContent=offline?'恢复网络':'模拟断网';
  button.onclick=()=>{offline=!offline;button.textContent=offline?'恢复网络':'模拟断网';const url=new URL(location.href);url.searchParams.set('offline',offline?'1':'0');history.replaceState(null,'',url);};
  document.querySelector('header').append(button);
}
open().catch(error=>{status.textContent=error.message;});
