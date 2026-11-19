const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{spawnSync}=require('node:child_process');
test('login timeline diagnostics redact secrets and retain native frames without selecting old memory maps',{skip:!process.env.QQ_ADMIN_TEST_PYTHON},()=>{
 const code=`import importlib.util,sys,subprocess,json
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('watch',sys.argv[1]);u=importlib.util.module_from_spec(spec);spec.loader.exec_module(u)
secret='test-only-private-access-value'
sample='loginError: token="short-secret" https://example.test/qr?ticket=private '+secret+' '+('a'*64)+' account=123456789'
safe=u.redact(sample,{secret})
assert secret not in safe and 'short-secret' not in safe and 'example.test' not in safe and '123456789' not in safe and 'a'*64 not in safe
events=u.select_events('Read map line: irrelevant\\nNative stack:\\n$$00 pc 0000000006def064 /opt/qq/wrapper.node\\n$$01 pc 000077f678001b80 <unknown>\\n群聊 error private conversation\\n[Core] Login Error ErrType: 1 ErrCode: 3')
assert len(events)==4 and not any('conversation' in row or 'Read map' in row for row in events)
result=subprocess.run(['node','--check'],input=u.NODE_WATCH.encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE)
assert result.returncode==0,result.stderr
prefix="""const realFS=require('node:fs'),originalRead=realFS.readFileSync;realFS.readFileSync=(p,...args)=>p==='/config/config.json'?JSON.stringify({port:6700}):originalRead(p,...args);process.env.QQ_WEBUI_TOKEN='synthetic-only';let auth=0,status=0,health=0,clock=0;Date.now=()=>clock+=2000;const originalTimer=setTimeout;global.setTimeout=fn=>originalTimer(fn,0);global.fetch=async(url,options)=>{let data;if(url.endsWith('/auth/login')){auth++;data={Credential:'synthetic-credential'};}else if(url.endsWith('/QQLogin/CheckLoginStatus')){status++;const phase=['waiting_qrcode','initializing','ready','offline','waiting_qrcode'][Math.min(status-1,4)];data={loginPhase:phase,isLogin:phase==='ready',isOffline:phase==='offline',coreReady:phase==='ready',qrLoginAccepted:phase==='initializing',loginError:phase==='offline'?'synthetic disconnected':''};}else if(url.startsWith('http://worker:6700/health')){health++;return {ok:true,json:async()=>({service:'mooyu-qq-local',connected:status===3})};}else throw Error('unexpected endpoint');return {ok:true,json:async()=>({code:0,data})};};process.on('exit',()=>{if(auth!==1||status<5||health!==status)process.exitCode=1;});"""
observed=subprocess.run(['node','-e',prefix+u.NODE_WATCH],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
assert observed.returncode==0,observed.stderr
states=[json.loads(line) for line in observed.stdout.decode().splitlines()]
assert any(v.get('phase')=='ready' and v['oneBotConnected'] for v in states)
assert any(v.get('offline') for v in states)
assert states[-1]['phase']=='waiting_qrcode'
assert 'synthetic-credential' not in observed.stdout.decode()
assert 'RefreshQRcode' not in u.NODE_WATCH and 'GetQQLoginQrcode' not in u.NODE_WATCH and 'SetConfig' not in u.NODE_WATCH
assert 'DEEPSEEK' not in u.NODE_WATCH
print('LOGIN_TIMELINE_REDACTION_NATIVE_FRAMES_AND_READONLY_OK')
`;
 const r=spawnSync(process.env.QQ_ADMIN_TEST_PYTHON,['-c',code,path.resolve('deploy/qq/watch-login.py')],{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/LOGIN_TIMELINE_REDACTION_NATIVE_FRAMES_AND_READONLY_OK/);
});
