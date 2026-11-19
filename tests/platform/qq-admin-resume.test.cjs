const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{spawnSync}=require('node:child_process');
test('QQ admin resume preserves existing material and validates the no-HEALTHCHECK website before advancing source',{skip:!process.env.QQ_ADMIN_TEST_PYTHON},()=>{
const script=`import importlib.util,json,sys,tempfile,copy
from pathlib import Path
from types import SimpleNamespace
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('update',sys.argv[1]);u=importlib.util.module_from_spec(spec);spec.loader.exec_module(u)
original_run=u.run;original_sql=u.qq_sql;original_path=u.Path
with tempfile.TemporaryDirectory(prefix='qq-resume-') as temp:
 root=Path(temp)
 def mapped(value):
  text=str(value)
  return root/text.lstrip('/') if text.startswith('/www/') else Path(value)
 u.Path=mapped
 backup=mapped('/www/backup/gamehub');backup.mkdir(parents=True)
 prior=backup/'update-qq-admin-prior';prior.mkdir();(prior/'payload').mkdir()
 record=backup/'update-qq-admin-resume';record.mkdir();payload=record/'payload';payload.mkdir()
 admin=mapped('/www/mooyu-qq/admin');admin.mkdir(parents=True)
 for p in ['/www/gamehub/deploy/.env.prod','/www/mooyu-qq/.env','/www/mooyu-qq/worker.env','/www/mooyu-qq/config.json']:
  file=mapped(p);file.parent.mkdir(parents=True,exist_ok=True);file.write_text('test-only-original')
 flags={key:'false' for key in ['PAPER_STUDY_ENABLED','PAPER_STUDY_WORKER_ENABLED','PAPER_STUDY_MODELS_ENABLED','PAPER_STUDY_PUBLISH_ENABLED']}
 agent='11111111-1111-4111-8111-111111111111'
 def info(name):return {'Id':'container-'+name,'Image':'old-'+name,'Config':{'Env':[k+'='+v for k,v in {**flags,'APP_DOMAIN':'localhost','AGENT_BLOG_PUBLIC_RUNTIME_AGENT_USER_ID':agent}.items()],'Labels':{'com.docker.compose.service':name}},'State':{'Running':True,**({} if name=='web' else {'Health':{'Status':'healthy'}})},'Mounts':[],'NetworkSettings':{'Networks':{'retained':{}}},'HostConfig':{}}
 infos={name:info(name) for name in ['api','web','worker','postgres','napcat']};infos['napcat']['Config']['Env']=['QQ_WEBUI_TOKEN='+'a'*64]
 manifest={'baseCommit':'base','targetCommit':'target','sourceRef':'fixed-ref','images':[{'tag':'new-'+n,'id':'new-id-'+n} for n in ['api','web','worker']],**{n:'new-'+n for n in ['api','web','worker']}}
 for file in [payload/'release.json',prior/'payload/release.json']:file.write_text(json.dumps(manifest))
 (prior/'previous-images.json').write_text(json.dumps([{'service':n,'image':'old-'+n} for n in ['api','web','worker']]))
 secret=admin/'shared.secret';secret.write_text('a'*64+'\\n')
 network={'qq-admin-control':{'external':True,'name':'mooyu-qq-admin-control'}}
 qq_extra={'QQ_ADMIN_ENABLED':'true','QQ_ADMIN_AGENT_USER_ID':agent,'QQ_ADMIN_SECRET_FILE':'/run/secrets/qq-admin-shared','QQ_NAPCAT_TOKEN':'a'*64}
 api_extra={'QQ_ADMIN_ENABLED':'true','QQ_ADMIN_AGENT_USER_ID':agent,'QQ_ADMIN_SECRET_FILE':'/run/secrets/qq-admin-shared','QQ_ADMIN_ORIGIN':'http://qq-control:6780'}
 qq_value={'services':{'worker':u.overlay(infos['worker'],'new-worker',qq_extra,{'default':{}},secret)},'networks':network}
 site_value={'services':{'api':u.overlay(infos['api'],'new-api',api_extra,{'default':{}},secret),'web':u.overlay(infos['web'],'new-web')},'networks':network}
 for name,value in [('qq.override.json',qq_value),('site.override.json',site_value)]:(admin/name).write_text(json.dumps(value))
 retained={p:p.read_bytes() for p in admin.iterdir()}
 calls=[];sql=[];active={};fail_http=False
 u.recover_download_environment=lambda web:{'DESKTOP_DOWNLOADS_DIR':'/www/existing/desktop','AGENT_DOWNLOADS_DIR':'/www/existing/agent'}
 u.compose_files=lambda i:([str(root/('qq.json' if i['Config']['Labels']['com.docker.compose.service']=='worker' else 'site.json'))],str(root))
 def discover(project,service):
  result=copy.deepcopy(infos[service])
  if active.get(service):result['Image']='new-id-'+service
  return result
 u.discover=discover
 def run(args,**options):
  calls.append(args)
  if args[0]=='git':
   if args[-1]=='HEAD':return b'base'
   if 'status' in args:return b''
   if args[-1]=='FETCH_HEAD':return b'target'
   return b''
  if args[:3]==['docker','image','inspect']:return json.dumps([{'Id':'new-id-'+args[3].split('-')[-1]}]).encode()
  if args[:3]==['docker','network','inspect']:return json.dumps([{'Internal':True,'Labels':{'mooyu.qq.admin':'1'},'Containers':{}}]).encode()
  if 'pg_dump' in args:return b'-- test-only schema snapshot'
  if args[0]=='curl':
   if fail_http and active.get('web'):raise RuntimeError('test-only unreachable')
   return b'<html>synthetic</html>' if args[-1].endswith('/') else b'{"ready":true}'
  return b''
 u.run=run
 def query(pg,text):
  sql.append(text)
  if 'generating' in text:return '0'
  if 'to_regclass' in text:return 't'
  if 'max(revision)' in text:return '1'
  return '1'
 u.qq_sql=query
 def compose(project,files,cwd,env,args):
  calls.append(['COMPOSE',project,*args])
  if args[:1]==['config']:
   names=['worker'] if project=='mooyu-qq' else ['api','web']
   result={'services':{n:{'environment':u.environment(infos[n]),'networks':{'default':{}},'volumes':[]} for n in names},'networks':{'default':{'name':'retained'}},'volumes':{}}
   for file in files:
    if file.endswith('.override.json'):
     value=json.loads(Path(file).read_text())
     for n,v in value['services'].items():result['services'][n].update(v)
     result['networks'].update(value['networks'])
   return json.dumps(result).encode()
  if args[:1]==['up']:
   for name in ['api','web','worker']:
    if name in args:active[name]=any(file.endswith('.override.json') for file in files)
  return b''
 u.compose=compose
 clock=[0]
 u.time=SimpleNamespace(monotonic=lambda:(clock.__setitem__(0,clock[0]+10) or clock[0]),sleep=lambda _:None,time=lambda:123)
 u.update(payload,record,resume_record=prior)
 assert all(p.read_bytes()==v for p,v in retained.items())
 assert (admin/'installed.json').exists() and (record/'qq-before.sql').exists()
 assert (record/'rollback-site.json').exists() and (record/'rollback-qq.json').exists()
 assert len([c for c in calls if c[0]=='curl'])==4
 assert next(i for i,c in enumerate(calls) if c[0]=='curl')<next(i for i,c in enumerate(calls) if c[0]=='git' and 'merge' in c)
 assert not any(c[:2]==['docker','load'] for c in calls)
 assert not any('UPDATE ' in text or 'DELETE ' in text or 'TRUNCATE ' in text or 'DROP ' in text for text in sql)
 (admin/'installed.json').unlink();active.clear();calls.clear();sql.clear();record2=backup/'update-qq-admin-failed';record2.mkdir();payload2=record2/'payload';payload2.mkdir();(payload2/'release.json').write_text(json.dumps(manifest));fail_http=True
 try:u.update(payload2,record2,resume_record=prior)
 except RuntimeError:pass
 else:raise AssertionError('failed website accepted')
 assert not (admin/'installed.json').exists()
 assert not any(c[0]=='git' and 'merge' in c for c in calls)
 assert active.get('api') is False and active.get('web') is False and active.get('worker') is False
 assert all(p.read_bytes()==v for p,v in retained.items())
 for wrong in ['images','policy','multiple']:
  changed=copy.deepcopy(infos)
  if wrong=='images':changed['api']['Image']='unexpected-image'
  if wrong=='policy':u.qq_sql=lambda *_:'0'
  if wrong=='multiple':u.qq_sql=lambda *_:'2'
  try:u.verify_resume(prior,manifest,{n:changed[n] for n in ['api','web','worker']},infos['postgres'])
  except RuntimeError:pass
  else:raise AssertionError('unsafe resume accepted: '+wrong)
print('QQ_ADMIN_RESUME_SUCCESS_AND_FAILURE_PRESERVATION_OK')
`;
const r=spawnSync(process.env.QQ_ADMIN_TEST_PYTHON,['-c',script,path.resolve('deploy/qq/update-admin.py')],{encoding:'utf8',windowsHide:true,maxBuffer:1e6});assert.equal(r.status,0,r.stderr+'\n'+r.stdout);assert.match(r.stdout,/QQ_ADMIN_RESUME_SUCCESS_AND_FAILURE_PRESERVATION_OK/);
});

test('actual retained Caddy image without HEALTHCHECK passes HTTPS readiness and rejects a non-HTML homepage',{skip:process.env.QQ_ADMIN_TEST_DOCKER!=='1',timeout:90000},async t=>{
 const fs=require('node:fs'),os=require('node:os'),net=require('node:net'),crypto=require('node:crypto');
 const listener=net.createServer();try{await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(443,'127.0.0.1',resolve);});}catch(e){if(e.code==='EADDRINUSE'){t.skip('Local port 443 belongs to another task; it is preserved.');return;}throw e;}finally{if(listener.listening)await new Promise(resolve=>listener.close(resolve));}
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'qq-admin-caddy-')),name='qq-admin-caddy-'+crypto.randomBytes(5).toString('hex');
 const docker=(args,allow=false)=>{const r=spawnSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:30000});if(!allow)assert.equal(r.status,0,r.stderr);return r;};
 try{
  fs.writeFileSync(path.join(root,'index.html'),'<html><body>synthetic QQ admin deployment test</body></html>');
  fs.writeFileSync(path.join(root,'Caddyfile'),'https://localhost {\n tls internal\n handle /ready {\n respond "ready" 200\n }\n handle {\n root * /srv/fixture\n file_server\n }\n}\n');
  docker(['run','-d','--name',name,'-p','127.0.0.1:443:443','--mount',`type=bind,source=${root},target=/srv/fixture,readonly`,'mooyu-qq-admin-web:20261119','caddy','run','--config','/srv/fixture/Caddyfile','--adapter','caddyfile']);
  const cert=path.join(root,'test-only-root.crt');let ready=false;
  for(let i=0;i<40;i++){if(docker(['cp',name+':/data/caddy/pki/authorities/local/root.crt',cert],true).status===0){ready=true;break;}await new Promise(r=>setTimeout(r,500));}assert(ready,'test CA not generated');
  const code=`import importlib.util,sys\nfrom pathlib import Path\nsys.dont_write_bytecode=True\nspec=importlib.util.spec_from_file_location('web',sys.argv[1]);u=importlib.util.module_from_spec(spec);spec.loader.exec_module(u)\nroot=Path(sys.argv[2]);u.LOGDIR=root/'evidence';u.LOGDIR.mkdir();original=u.run\nu.run=lambda args,**opts:original(args[:-1]+['--cacert',str(root/'test-only-root.crt'),'--ssl-revoke-best-effort']+args[-1:],**opts) if args[0]=='curl' else original(args,**opts)\ninfo={'Config':{'Env':['APP_DOMAIN=localhost']},'State':{'Running':True}};u.discover=lambda *_:info\nassert u.wait_ready('synthetic','web',seconds=15)==info\n(root/'index.html').write_text('test-only not HTML')\ntry:u.probe_web(info)\nexcept RuntimeError:pass\nelse:raise AssertionError('non-HTML homepage accepted')\nprint('ACTUAL_CADDY_TLS_AND_NO_HEALTHCHECK_PROBE_OK')`;
  const result=spawnSync(process.env.QQ_ADMIN_TEST_PYTHON,['-c',code,path.resolve('deploy/qq/update-admin.py'),root],{encoding:'utf8',windowsHide:true,timeout:45000,maxBuffer:1e6});const logs=fs.existsSync(path.join(root,'evidence'))?fs.readdirSync(path.join(root,'evidence')).slice(-1).map(n=>fs.readFileSync(path.join(root,'evidence',n),'utf8')).join('\n'):'';assert.equal(result.status,0,result.stderr+'\n'+result.stdout+'\n'+logs);assert.match(result.stdout,/ACTUAL_CADDY_TLS_AND_NO_HEALTHCHECK_PROBE_OK/);
 }finally{docker(['rm','-f','-v',name],true);assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});}
});
