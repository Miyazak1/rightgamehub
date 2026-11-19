const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{spawnSync}=require('node:child_process');
test('native compatibility trial changes one flag, preserves mounts/ports and only restores the gateway',{skip:!process.env.QQ_ADMIN_TEST_PYTHON},()=>{
const code=`import importlib.util,copy,json,tempfile,sys
from pathlib import Path
from types import SimpleNamespace
sys.dont_write_bytecode=True
def load(name,file):
 spec=importlib.util.spec_from_file_location(name,file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
u=load('engine',sys.argv[1]);v=load('trial',sys.argv[2])
before={'Id':'synthetic-gateway','Image':'same-image','Config':{'Env':['TOKEN=synthetic-dollar-$x','NAPCAT_DISABLE_BYPASS=0'],'Labels':{'com.docker.compose.service':'napcat'}},'Mounts':[{'Type':'volume','Destination':'/data','Name':'existing_login','RW':True},{'Type':'bind','Destination':'/config/config.json','Source':'/www/mooyu-qq/config.json','RW':False}],'NetworkSettings':{'Networks':{'existing_network':{}}},'HostConfig':{'PortBindings':{'6099/tcp':[{'HostIp':'127.0.0.1','HostPort':'16099'}]}}}
new=v.overlay(u,before,True);old=v.overlay(u,before,False)
assert old['services']['napcat']['environment']['NAPCAT_DISABLE_BYPASS']=='0'
assert new['services']['napcat']['environment']['NAPCAT_DISABLE_BYPASS']=='1'
assert new['services']['napcat']['environment']['TOKEN']=='synthetic-dollar-$$x'
assert set(new['services'])=={'napcat'} and new['services']['napcat']['image']=='same-image'
rendered={'services':{'napcat':{'image':'same-image','environment':{'TOKEN':'synthetic-dollar-$x','NAPCAT_DISABLE_BYPASS':'1'},'volumes':[{'type':'volume','source':'login','target':'/data'},{'type':'bind','source':'/www/mooyu-qq/config.json','target':'/config/config.json','read_only':True}],'networks':{'default':{}},'ports':[{'host_ip':'127.0.0.1','published':'16099','target':6099,'protocol':'tcp'}]}},'volumes':{'login':{'name':'existing_login'}},'networks':{'default':{'name':'existing_network'}}}
v.validate(u,rendered,before)
for kind in ['environment','image','volume','port','network','readonly','capability','memory','cpu']:
 r=copy.deepcopy(rendered)
 if kind=='environment':r['services']['napcat']['environment']['TOKEN']='changed'
 if kind=='image':r['services']['napcat']['image']='other-image'
 if kind=='volume':r['volumes']['login']['name']='empty-new-volume'
 if kind=='port':r['services']['napcat']['ports'][0]['host_ip']='0.0.0.0'
 if kind=='network':r['services']['napcat']['networks']['extra']={};r['networks']['extra']={'name':'other_network'}
 if kind=='readonly':r['services']['napcat']['read_only']=True
 if kind=='capability':r['services']['napcat']['cap_add']=['SYS_ADMIN']
 if kind=='memory':r['services']['napcat']['mem_limit']=12345678
 if kind=='cpu':r['services']['napcat']['cpus']=2
 try:v.validate(u,r,before)
 except RuntimeError:pass
 else:raise AssertionError('unsafe trial accepted '+kind)
with tempfile.TemporaryDirectory(prefix='qq-native-guards-') as temporary:
 report=Path(temporary);config=report/'original.env';config.write_text('original-preserved')
 (report/'state.private.json').write_text(json.dumps({'files':['original-compose.yml'],'cwd':'/www/mooyu-qq','hashes':{str(config):v.fingerprint(config)}}))
 (report/'gateway-before.private.json').write_text(json.dumps(before))
 now=copy.deepcopy(before);now['Config']['Env']=['TOKEN=synthetic-dollar-$x','NAPCAT_DISABLE_BYPASS=1']
 v.gateway=lambda _:now;v.wait_webui=lambda _:(now,{'loggedIn':False,'phase':'waiting_qrcode'})
 calls=[];u.compose=lambda *args:calls.append(args)
 v.rollback(u,report)
 assert len(calls)==1 and calls[0][0]=='mooyu-qq' and calls[0][-1][-1]=='napcat'
 assert config.read_text()=='original-preserved'
 calls.clear();now['Config']['Env'].append('OTHER_NEW_SETTING=changed')
 try:v.rollback(u,report)
 except RuntimeError:pass
 else:raise AssertionError('external env change overwritten')
 assert calls==[]
 now['Config']['Env'].pop();config.write_text('operator-new-change')
 try:v.rollback(u,report)
 except RuntimeError:pass
 else:raise AssertionError('external config change ignored')
 assert calls==[]
print('NATIVE_COMPAT_SINGLE_FLAG_AND_NONDESTRUCTIVE_ROLLBACK_OK')
`;
const r=spawnSync(process.env.QQ_ADMIN_TEST_PYTHON,['-c',code,path.resolve('deploy/qq/update-admin.py'),path.resolve('deploy/qq/try-native-compat.py')],{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr+'\n'+r.stdout);assert.match(r.stdout,/NATIVE_COMPAT_SINGLE_FLAG_AND_NONDESTRUCTIVE_ROLLBACK_OK/);
});

test('actual unchanged gateway starts with Bypass disabled and its stopped login volume can be backed up read-only',{skip:process.env.QQ_ADMIN_TEST_DOCKER!=='1',timeout:120000},async()=>{
const fs=require('node:fs'),os=require('node:os'),crypto=require('node:crypto');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'qq-native-image-')),nonce=crypto.randomBytes(5).toString('hex'),name='qq-native-trial-'+nonce,volume=name+'-data';
const image='mooyu-qq-gateway:20261119-verified';
const docker=(args,allow=false)=>{const r=spawnSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:30000});if(!allow)assert.equal(r.status,0,r.stderr);return r;};
try{
 const config=path.join(root,'config.json');fs.writeFileSync(config,JSON.stringify({deployment:'server',enabled:true,botId:'100000001',groupId:'200000001',allowedUsers:['300000001'],port:6700}));
 docker(['volume','create',volume]);
 const token=crypto.randomBytes(32).toString('hex');
 docker(['run','-d','--name',name,'--init','--read-only','--tmpfs','/tmp:size=128m,nosuid','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','1g','--cpus','1','--mount',`type=volume,source=${volume},target=/data`,'--mount',`type=bind,source=${config},target=/config/config.json,readonly`,'-e','HOME=/data/home','-e','NAPCAT_WORKDIR=/data/napcat','-e','NAPCAT_QQ_DATA_DIR=/data/qq','-e','NAPCAT_DISABLE_MULTI_PROCESS=1','-e','NAPCAT_DISABLE_BYPASS=1','-e','QQ_WEBUI_TOKEN='+token,'-e','QQ_ACCESS_TOKEN='+token,image]);
 let ready=false;
 for(let i=0;i<30;i++){const r=docker(['exec',name,'node','/opt/manage.mjs','status'],true);if(r.status===0){const s=JSON.parse(r.stdout.trim());assert.equal(s.loggedIn,false);ready=true;break;}await new Promise(r=>setTimeout(r,1000));}assert(ready,'test gateway WebUI not ready');
 await new Promise(r=>setTimeout(r,5000));
 const info=JSON.parse(docker(['inspect',name]).stdout)[0];assert.equal(info.State.Running,true);assert.equal(info.RestartCount,0);assert(info.Config.Env.includes('NAPCAT_DISABLE_BYPASS=1'));
 docker(['stop','--time','20',name]);
 const archive=path.join(root,'native-backup.tar.gz'),fd=fs.openSync(archive,'wx',0o600);
 try{const r=spawnSync('docker',['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--volumes-from',name+':ro','--entrypoint','tar',image,'-C','/data','-czf','-','.'],{stdio:['ignore',fd,'pipe'],encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(r.status,0,r.stderr);}finally{fs.closeSync(fd);}
 const listing=spawnSync('tar',['-tzf',archive],{encoding:'utf8',windowsHide:true});assert.equal(listing.status,0,listing.stderr);assert.match(listing.stdout,/napcat\/config\/webui.json/);assert(fs.statSync(archive).size>0);
}finally{docker(['rm','-f','-v',name],true);docker(['volume','rm',volume],true);assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});}
});
