const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{spawnSync}=require('node:child_process');
const python=process.env.QQ_ADMIN_TEST_PYTHON;
test('QQ deployment refuses changed mounts/networks/env and rollback never erases newer administrator policy',{skip:!python},()=>{
 const script=`import importlib.util,copy,json,sys
from pathlib import Path
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('qq_update',sys.argv[1]);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
old={'Config':{'Env':['TOKEN=private-dollar-$value','PAPER_STUDY_ENABLED=false'],'Labels':{'com.docker.compose.service':'worker'}},'Mounts':[{'Type':'volume','Destination':'/data','Name':'existing_db','RW':True},{'Type':'bind','Destination':'/config','Source':'/www/mooyu-qq/config.json','RW':False},{'Type':'tmpfs','Destination':'/tmp','RW':True}],'NetworkSettings':{'Networks':{'existing_backend':{}}},'HostConfig':{'Tmpfs':{'/tmp':'size=32m'}}}
overlay=module.overlay(old,'new-image',{'QQ_ADMIN_ENABLED':'true'},{'default':{}},Path('/private/secret'))
assert overlay['environment']['TOKEN']=='private-dollar-$$value'
assert 'default' in overlay['networks'] and overlay['networks']['qq-admin-control']['aliases']==['qq-control']
rendered={'services':{'worker':{'environment':{'TOKEN':'private-dollar-$value','PAPER_STUDY_ENABLED':'false'},'volumes':[{'type':'volume','source':'data','target':'/data'},{'type':'bind','source':'/www/mooyu-qq/config.json','target':'/config','read_only':True}],'networks':{'default':{},'control':{}},'tmpfs':['/tmp:size=32m']}},'volumes':{'data':{'name':'existing_db'}},'networks':{'default':{'name':'existing_backend'},'control':{'name':'new_control'}}}
module.validate_snapshot(rendered,[old])
def denied(value):
 try: module.validate_snapshot(value,[old])
 except RuntimeError: return
 raise AssertionError('changed state was allowed')
for kind in ['env','volume','bind','readonly','network','tmpfs']:
 value=copy.deepcopy(rendered);worker=value['services']['worker']
 if kind=='env': worker['environment']['TOKEN']='changed'
 if kind=='volume': value['volumes']['data']['name']='wrong_db'
 if kind=='bind': worker['volumes'][1]['source']='/different/config'
 if kind=='readonly': worker['volumes'][1]['read_only']=False
 if kind=='network': del worker['networks']['default']
 if kind=='tmpfs': worker['tmpfs']=[]
 denied(value)
calls=[];sql=[]
module.compose=lambda *args: calls.append(args)
module.discover=lambda *args: {'Id':'test-only-postgres'}
revision='2'
def query(_pg,text):
 sql.append(text)
 if 'to_regclass' in text:return 't'
 if 'max(revision)' in text:return revision
 return ''
module.qq_sql=query
state={'site_files':['site.yml'],'site_cwd':'/www/gamehub','qq_files':['qq.yml'],'qq_cwd':'/www/mooyu-qq','qq_override':'new.json'}
module.rollback(state,Path('/private/record'))
assert len(calls)==1 and calls[0][0]=='gamehub-production'
assert not any('UPDATE' in text for text in sql)
calls.clear();sql.clear();revision='1';module.rollback(state,Path('/private/record'))
assert len(calls)==3 and calls[1][-1]==['stop','worker'] and calls[2][0]=='mooyu-qq'
assert any('c.revision=1' in text for text in sql)
assert not any('DROP ' in text or 'DELETE ' in text or 'TRUNCATE ' in text for text in sql)
from types import SimpleNamespace
real_path=module.Path
module.Path=lambda value: SimpleNamespace(is_absolute=lambda:value.startswith('/'),is_dir=lambda:True,is_symlink=lambda:False,resolve=lambda:value)
web={'Mounts':[{'Destination':'/srv/desktop-downloads','Source':'/www/retained/desktop','Type':'bind','RW':False},{'Destination':'/srv/agent-downloads','Source':'/www/retained/agent','Type':'bind','RW':False}]}
recovered=module.recover_download_environment(web)
assert recovered=={'DESKTOP_DOWNLOADS_DIR':'/www/retained/desktop','AGENT_DOWNLOADS_DIR':'/www/retained/agent'}
for kind in ['missing','duplicate','writable','volume','outside']:
 value=copy.deepcopy(web)
 if kind=='missing': value['Mounts'].pop()
 if kind=='duplicate': value['Mounts'].append(value['Mounts'][0])
 if kind=='writable': value['Mounts'][0]['RW']=True
 if kind=='volume': value['Mounts'][0]['Type']='volume'
 if kind=='outside': value['Mounts'][0]['Source']='/other/path'
 try:module.recover_download_environment(value)
 except RuntimeError:pass
 else:raise AssertionError('unsafe mount accepted: '+kind)
module.Path=real_path
state['compose_env']=recovered
module.COMPOSE_ENV.clear();module.rollback(state,Path('/private/record'))
assert module.COMPOSE_ENV==recovered
observed={}
module.subprocess.run=lambda args,**options:(observed.update(options) or SimpleNamespace(returncode=0,stdout=b'',stderr=b''))
module.run(['docker','compose','config'])
assert observed['env']['DESKTOP_DOWNLOADS_DIR']=='/www/retained/desktop'
print('QQ_DEPLOYMENT_GUARDS_AND_NONDESTRUCTIVE_ROLLBACK_OK')
`;
 const result=spawnSync(python,['-c',script,path.resolve('deploy/qq/update-admin.py')],{encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/QQ_DEPLOYMENT_GUARDS_AND_NONDESTRUCTIVE_ROLLBACK_OK/);
});

test('actual unified-downloads Compose overlay requires and preserves recovered bind directories',{skip:process.env.QQ_ADMIN_TEST_DOCKER!=='1'},()=>{
 const fs=require('node:fs'),os=require('node:os');const root=fs.mkdtempSync(path.join(os.tmpdir(),'qq-admin-compose-'));
 try{
  const base=path.join(root,'base.json'),envFile=path.join(root,'empty.env');fs.writeFileSync(base,JSON.stringify({services:{web:{image:'test-only:fixture'}}}));fs.writeFileSync(envFile,'');
  const args=['compose','--project-name','qq-admin-render-test','--project-directory',root,'--env-file',envFile,'-f',base,'-f',path.resolve('deploy/compose.unified-downloads.yml'),'config','--format','json'];
  const env={...process.env};delete env.DESKTOP_DOWNLOADS_DIR;delete env.AGENT_DOWNLOADS_DIR;
  const missing=spawnSync('docker',args,{env,encoding:'utf8',windowsHide:true});assert.notEqual(missing.status,0);assert.match(missing.stderr,/DOWNLOADS_DIR/);
  env.DESKTOP_DOWNLOADS_DIR=path.join(root,'desktop');env.AGENT_DOWNLOADS_DIR=path.join(root,'agent');fs.mkdirSync(env.DESKTOP_DOWNLOADS_DIR);fs.mkdirSync(env.AGENT_DOWNLOADS_DIR);
  const valid=spawnSync('docker',args,{env,encoding:'utf8',windowsHide:true});assert.equal(valid.status,0,valid.stderr);const mounts=JSON.parse(valid.stdout).services.web.volumes;
  assert.equal(mounts.length,2);for(const m of mounts){assert.equal(m.type,'bind');assert.equal(m.read_only,true);assert.notEqual(m.bind?.create_host_path,true);assert(m.target==='/srv/desktop-downloads'||m.target==='/srv/agent-downloads');}
 }finally{assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});}
});
