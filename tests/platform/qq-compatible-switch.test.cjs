const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os'),cp=require('node:child_process');
const python=process.env.QQ_ADMIN_TEST_PYTHON;
test('compatible switch preserves credentials and mounts, rejects drift, and rolls back interrupted cutovers',{skip:!python},()=>{
 const script=String.raw`
import importlib.util,sys,copy,json,tempfile
from pathlib import Path
sys.dont_write_bytecode=True
def load(name,file):
 spec=importlib.util.spec_from_file_location(name,file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
m=load('compatible',sys.argv[1]);u=load('prior',sys.argv[2])
old={'Config':{'Env':['QQ_WEBUI_TOKEN='+('a'*64),'QQ_ACCESS_TOKEN=synthetic-$token','NODE_VERSION=22','OLD_DEFAULT=old','OPERATOR_SETTING=retained'],'Labels':{'com.docker.compose.service':'napcat'}},'Mounts':[{'Type':'volume','Destination':'/data','Name':'old_login','RW':True},{'Type':'bind','Destination':'/config/config.json','Source':'/www/mooyu-qq/config.json','RW':False}],'NetworkSettings':{'Networks':{'existing':{}}},'HostConfig':{'Tmpfs':{'/tmp':'size=128m'},'ReadonlyRootfs':True}}
old_image={'Config':{'Env':['NODE_VERSION=22','OLD_DEFAULT=old']}}
new_image={'Id':'new-image','Config':{'Env':['NODE_VERSION=20']}}
value=m.gateway_overlay(u,old,old_image,new_image,'new_login')
assert value['environment']['QQ_ACCESS_TOKEN']=='synthetic-$$token'
assert value['environment']['NODE_VERSION']=='20' and value['environment']['OLD_DEFAULT'] is None
assert value['environment']['OPERATOR_SETTING']=='retained' and value['command']==[]
assert value['user']=='1000:1000' and value['working_dir']=='/app'
assert all(value['environment'][key]=='false' for key in m.FLAGS)
render={'services':{'napcat':{**value,'read_only':True,'tmpfs':['/tmp:size=128m'],'networks':{'backend':{}},'volumes':value['volumes']+[{'type':'bind','source':'/www/mooyu-qq/config.json','target':'/config/config.json','read_only':True}]}},'networks':{'backend':{'name':'existing'}},'volumes':{m.VOLUME_ALIAS:{'name':'new_login'}}}
m.validate(u,render,[old],gateway=True)
for kind in ['bind','network','readonly','data','preload','entrypoint']:
 changed=copy.deepcopy(render);service=changed['services']['napcat']
 if kind=='bind':service['volumes'][1]['source']='/wrong/config'
 if kind=='network':service['networks']={}
 if kind=='readonly':service['read_only']=False
 if kind=='data':service['volumes'][0]['source']='wrong_volume'
 if kind=='preload':service['environment']['LD_PRELOAD']='old.so'
 if kind=='entrypoint':service['command']=['node','/old-entry.cjs']
 try:m.validate(u,changed,[old],gateway=True)
 except RuntimeError:pass
 else:raise AssertionError('accepted configuration drift: '+kind)
with tempfile.TemporaryDirectory(prefix='qq-switch-test-') as temp:
 record=Path(temp);original=record/'original-config';original.write_bytes(b'unchanged-private-config')
 infos={n:{'Id':n,'Image':'old-'+n,'State':{'Running':True}} for n in ['worker','gateway','postgres','api','web']}
 state={'record':str(record),'infos':infos,'file_hashes':{str(original):m.hashlib.sha256(original.read_bytes()).hexdigest()},'manifest':{'images':{'gateway':{'id':'new-gateway'}}},'old_volume':'old_login','clone_volume':'new_login'}
 u.run=lambda args,**kwargs:json.dumps([infos[args[-1]]]).encode() if args[:2]==['docker','inspect'] else b''
 u.qq_sql=lambda *args:'0'
 u.backup_qq=lambda pg,rec:(rec/'login-data.tar').write_bytes(b'synthetic-backup')
 u.LOGDIR=None
 m.node_volume=lambda *args,**kwargs:b'{}'
 calls=[];m.rollback=lambda helper,state,site=True:calls.append(site)
 def broken_compose(*args):raise RuntimeError('QQ_SYNTHETIC_START_FAILURE')
 m.compose=broken_compose
 try:m.apply(u,state)
 except RuntimeError as error:assert str(error)=='QQ_SYNTHETIC_START_FAILURE'
 else:raise AssertionError('failed cutover succeeded')
 assert calls==[False] and original.read_bytes()==b'unchanged-private-config'
 assert (record/'login-data.tar').read_bytes()==b'synthetic-backup'
 try:m.apply(u,state)
 except RuntimeError as error:assert str(error)=='QQ_APPLY_ALREADY_STARTED_DO_NOT_REPEAT'
 else:raise AssertionError('replayed cutover')
print('QQ_SWITCH_GUARDS_AND_FAILURE_RECOVERY_PASSED')
`;
 const result=cp.spawnSync(python,['-c',script,path.resolve('deploy/qq/switch-compatible.py'),path.resolve('deploy/qq/update-admin.py')],{encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(result.status,0,result.stderr+result.stdout);assert.match(result.stdout,/QQ_SWITCH_GUARDS_AND_FAILURE_RECOVERY_PASSED/);
});

test('actual Compose rendering keeps the token literal and replaces old image defaults and login mount',{skip:!python||process.env.QQ_COMPAT_TEST_DOCKER!=='1',timeout:45000},t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'qq-switch-compose-'));t.after(()=>{const p=path.resolve(folder);assert(p.startsWith(path.resolve(os.tmpdir())+path.sep));assert(path.basename(p).startsWith('qq-switch-compose-'));fs.rmSync(p,{recursive:true,force:true});});
 const script=String.raw`
import importlib.util,json,sys
sys.dont_write_bytecode=True
def load(name,file):
 spec=importlib.util.spec_from_file_location(name,file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
m=load('switch',sys.argv[1]);u=load('prior',sys.argv[2])
old={'Config':{'Env':['QQ_WEBUI_TOKEN='+('a'*64),'QQ_ACCESS_TOKEN=synthetic-$token','NODE_VERSION=22','OLD_IMAGE_VALUE=remove-me']}}
print(json.dumps(m.gateway_overlay(u,old,{'Config':{'Env':['NODE_VERSION=22','OLD_IMAGE_VALUE=remove-me']}},{'Id':'mooyu-qq-gateway:20261120-compatible-candidate','Config':{'Env':['NODE_VERSION=20']}},'new_login')))
`;
 const prepared=cp.spawnSync(python,['-c',script,path.resolve('deploy/qq/switch-compatible.py'),path.resolve('deploy/qq/update-admin.py')],{encoding:'utf8',windowsHide:true});assert.equal(prepared.status,0,prepared.stderr);const overlay=JSON.parse(prepared.stdout);
 const base={services:{napcat:{image:'mooyu-qq-gateway:20261120-compatible-candidate',read_only:true,environment:{QQ_ACCESS_TOKEN:'synthetic-$$token',NODE_VERSION:'22',OLD_IMAGE_VALUE:'remove-me'},volumes:[{type:'volume',source:'old-login',target:'/data'}]}},volumes:{'old-login':{external:true,name:'old_login'},'qq-compatible-login':{external:true,name:'new_login'}}};
 fs.writeFileSync(path.join(folder,'base.json'),JSON.stringify(base));fs.writeFileSync(path.join(folder,'overlay.json'),JSON.stringify({services:{napcat:overlay}}));const result=cp.spawnSync('docker',['compose','--project-name','qq-switch-fixture','-f',path.join(folder,'base.json'),'-f',path.join(folder,'overlay.json'),'config','--format','json'],{encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(result.status,0,result.stderr);const rendered=JSON.parse(result.stdout),gateway=rendered.services.napcat;
 assert.equal(gateway.environment.QQ_ACCESS_TOKEN,'synthetic-$$token');assert.equal(gateway.environment.NODE_VERSION,'20');assert(gateway.environment.OLD_IMAGE_VALUE==null);assert.equal(gateway.volumes.length,1);assert.equal(gateway.volumes[0].source,'qq-compatible-login');assert.equal(gateway.user,'1000:1000');assert.deepEqual(gateway.command,[]);
 const runtime={services:{napcat:{...gateway,environment:overlay.environment,volumes:[],network_mode:'none'}}};delete runtime.services.napcat.networks;delete runtime.services.napcat.depends_on;fs.writeFileSync(path.join(folder,'runtime.json'),JSON.stringify(runtime));
 const actual=cp.spawnSync('docker',['compose','--project-name','qq-switch-fixture','-f',path.join(folder,'runtime.json'),'run','--rm','--no-deps','--entrypoint','node','napcat','-e',"console.log(JSON.stringify({token:process.env.QQ_ACCESS_TOKEN,node:process.env.NODE_VERSION,old:process.env.OLD_IMAGE_VALUE??null}))"],{encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(actual.status,0,actual.stderr);const env=JSON.parse(actual.stdout.trim());assert.equal(env.token,'synthetic-$token');assert.equal(env.node,'20');assert.equal(env.old,null);
});

test('compatible profile merge preserves native and legacy files and rejects conflicting identities',{skip:!python||process.env.QQ_COMPAT_TEST_DOCKER!=='1',timeout:90000},t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'qq-switch-profile-'));t.after(()=>{const p=path.resolve(folder);assert(p.startsWith(path.resolve(os.tmpdir())+path.sep));assert(path.basename(p).startsWith('qq-switch-profile-'));fs.rmSync(p,{recursive:true,force:true});});
 const extract=String.raw`import importlib.util,sys;sys.dont_write_bytecode=True;s=importlib.util.spec_from_file_location('switch',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(m.PROFILE_CODE)`;
 const result=cp.spawnSync(python,['-c',extract,path.resolve('deploy/qq/switch-compatible.py')],{encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);const code=result.stdout;
 const fresh=path.join(folder,'new'),old=path.join(folder,'old');fs.mkdirSync(fresh,{recursive:true});fs.mkdirSync(old,{recursive:true});
 const native=path.join(fresh,'home/.config/QQ');fs.mkdirSync(native,{recursive:true});fs.mkdirSync(path.join(fresh,'qq'),{recursive:true});fs.writeFileSync(path.join(fresh,'qq/session.bin'),'synthetic-retained-session');fs.writeFileSync(path.join(native,'native.bin'),'synthetic-retained-native');
 const run=()=>cp.spawnSync('docker',['run','--rm','--network','none','--read-only','--user','0:0','--cap-drop','ALL','--cap-add','DAC_OVERRIDE','--cap-add','CHOWN','--cap-add','FOWNER','--security-opt','no-new-privileges:true','--memory','256m','--env','PROFILE_COPY=1','--mount',`type=bind,source=${old},target=/old,readonly`,'--mount',`type=bind,source=${fresh},target=/new`,'--entrypoint','node','mooyu-qq-gateway:20261120-compatible-candidate','-e',code],{encoding:'utf8',windowsHide:true,timeout:30000});
 const copied=run();assert.equal(copied.status,0,copied.stderr);assert.equal(JSON.parse(copied.stdout).copyMode,true);assert.equal(fs.readFileSync(path.join(native,'session.bin'),'utf8'),'synthetic-retained-session');assert.equal(fs.readFileSync(path.join(fresh,'qq/session.bin'),'utf8'),'synthetic-retained-session');assert.equal(fs.readFileSync(path.join(native,'native.bin'),'utf8'),'synthetic-retained-native');
 fs.writeFileSync(path.join(native,'session.bin'),'different-native-identity');const conflict=run();assert.notEqual(conflict.status,0);assert.match(conflict.stderr,/QQ_PROFILE_PATH_CONFLICT/);assert.equal(fs.readFileSync(path.join(native,'session.bin'),'utf8'),'different-native-identity');assert.equal(fs.readFileSync(path.join(fresh,'qq/session.bin'),'utf8'),'synthetic-retained-session');
});
