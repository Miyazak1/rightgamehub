"""Read-only, time-correlated QQ login diagnosis. No QR refresh or model call."""
import json,os,re,subprocess,sys,time
from pathlib import Path

NODE_WATCH=r"""
const fs=require('node:fs'),{createHash}=require('node:crypto');
(async()=>{
 const cfg=JSON.parse(fs.readFileSync('/config/config.json','utf8'));
 const base='http://127.0.0.1:6099/api';
 async function post(path,body,credential){
  const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(credential?{Authorization:'Bearer '+credential}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
  const v=await r.json();if(!r.ok||v.code!==0)throw Error('WEBUI_REQUEST_FAILED');return v.data;
 }
 const auth=await post('/auth/login',{hash:createHash('sha256').update(process.env.QQ_WEBUI_TOKEN+'.napcat').digest('hex')});
 if(typeof auth?.Credential!=='string')throw Error('WEBUI_AUTH_FAILED');
 let previous='';const deadline=Date.now()+45000;
 for(let i=0;i<23&&Date.now()<deadline;i++){
  const s=await post('/QQLogin/CheckLoginStatus',{},auth.Credential);
  let oneBotConnected=null;
  try{const r=await fetch('http://worker:'+cfg.port+'/health',{signal:AbortSignal.timeout(1000)});const h=await r.json();if(r.ok&&h.service==='mooyu-qq-local')oneBotConnected=h.connected===true;}catch{}
  const state={phase:s.loginPhase,loggedIn:s.isLogin===true,offline:s.isOffline===true,accepted:s.qrLoginAccepted===true,coreReady:s.coreReady===true,oneBotConnected,loginError:s.loginError??''};
  const signature=JSON.stringify(state);
  if(signature!==previous||i%5===0)console.log(JSON.stringify({at:new Date().toISOString(),...state}));
  previous=signature;if(i<22)await new Promise(r=>setTimeout(r,2000));
 }
})().catch(()=>{console.log(JSON.stringify({at:new Date().toISOString(),probeError:'QQ_LOGIN_OBSERVATION_INTERRUPTED'}));process.exitCode=1;});
"""

def redact(text,secrets):
    for value in sorted(secrets,key=len,reverse=True):
        if value:text=text.replace(value,'[REDACTED]')
    text=re.sub(r'https?://[^\s<>"\']+','[URL REDACTED]',text)
    text=re.sub(r'(?i)((?:token|password|secret|ticket|cookie|credential|authorization)["\s]*[:=]\s*)("[^"]*"|[^\s,}]+)',r'\1[REDACTED]',text)
    text=re.sub(r'[A-Za-z0-9_+/=-]{40,}','[OPAQUE REDACTED]',text)
    return re.sub(r'\b\d{8,}\b','[ID REDACTED]',text)

def select_events(text):
    pattern=re.compile(r'login|QRCode|登录|离线|下线|kick|Error|failed|fatal|handleSignal|Native stack|\$\$\d+.*\bpc\b|Unhandled|Signal|PacketHandler.*初始化|OneBot.*connect',re.I)
    return [line for line in text.splitlines() if pattern.search(line) and not re.search(r'群聊|私聊|收\s*<-|发\s*->',line)][-100:]

def main(report):
    if os.geteuid()!=0:raise RuntimeError('请使用 root 终端。')
    if report.is_symlink() or report.parent!=Path('/www/backup/gamehub') or not report.name.startswith('qq-login-watch-') or not report.is_dir():
        raise RuntimeError('检查目录不符合要求。')
    output=[];secrets=set()
    def capture(args,timeout=25):
        return subprocess.run(args,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=timeout,check=False)
    def discover(service):
        r=capture(['docker','ps','-aq','--filter','label=com.docker.compose.project=mooyu-qq','--filter','label=com.docker.compose.service='+service])
        if r.returncode:raise RuntimeError('容器查询失败。')
        rows=[]
        for cid in r.stdout.split():
            result=capture(['docker','inspect',cid])
            if result.returncode:raise RuntimeError('容器状态查询失败。')
            info=json.loads(result.stdout)[0]
            if (info['Config'].get('Labels') or {}).get('com.docker.compose.oneoff','false').lower()=='true':continue
            for item in info['Config'].get('Env',[]):
                key,sep,value=item.partition('=')
                if sep and value and re.search(r'TOKEN|SECRET|PASSWORD|KEY|CREDENTIAL',key,re.I):secrets.add(value)
            rows.append(info)
        if len(rows)!=1:raise RuntimeError(service+' 容器数量不符。')
        return rows[0]
    def emit(text):
        safe=redact(text,secrets);output.append(safe);print(safe,flush=True)
    def state(info):
        s=info['State'];return {'at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'status':s.get('Status'),'restarts':info.get('RestartCount'),'startedAt':s.get('StartedAt'),'oomKilled':s.get('OOMKilled'),'exitCode':s.get('ExitCode')}
    def budget(worker):
        result=capture(['docker','exec',worker['Id'],'node','apps/qq-channel/src/cli.mjs','/config/config.json','--status'])
        if result.returncode:return {'check':'budget','available':False}
        try:
            value=json.loads(result.stdout.strip().splitlines()[-1])
            return {'check':'budget','budget':value['budget'],'paperEnabled':value.get('paperEnabled')}
        except (ValueError,KeyError,IndexError):return {'check':'budget','available':False}
    try:
        gateway=discover('napcat');worker=discover('worker')
        emit('=== 观察前 ===');emit(json.dumps(state(gateway),ensure_ascii=False));emit(json.dumps(budget(worker),ensure_ascii=False))
        start=int(time.time())-1
        emit('开始约 45 秒观察。请现在到后台刷新一次二维码，扫码并确认登录；之后不要继续刷新，也不要发测试问题。')
        # The observer only authenticates to WebUI and reads status/health.
        # Raw transient state stays in memory until all credentials are redacted.
        try:
            result=capture(['docker','exec',gateway['Id'],'node','-e',NODE_WATCH],timeout=80)
            emit(result.stdout);emit('观察进程退出码：'+str(result.returncode))
        except subprocess.TimeoutExpired:
            emit('观察超时；没有执行重启或登录操作。')
        emit('=== 观察后 ===');emit(json.dumps(state(discover('napcat')),ensure_ascii=False));emit(json.dumps(budget(discover('worker')),ensure_ascii=False))
        logs=capture(['docker','logs','--timestamps','--since',str(start),'--tail','4000',gateway['Id']])
        emit('=== 本次观察期间事件（含原生栈帧，排除旧日志） ===')
        for line in select_events(logs.stdout):emit(line)
    finally:
        target=report/'timeline.redacted.txt'
        with target.open('x',encoding='utf8') as f:f.write('\n'.join(output)+'\n')
        print('脱敏报告：'+str(target),flush=True)

if __name__=='__main__':
    os.umask(0o077)
    try:
        if len(sys.argv)!=2:raise RuntimeError('需要检查目录参数。')
        main(Path(sys.argv[1]))
    except Exception:
        print('观察未完成；未执行配置修改或服务重启，请提供已生成的脱敏报告。',flush=True)
        sys.exit(1)
