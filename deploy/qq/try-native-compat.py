"""One reversible compatibility trial: disable optional native Bypass only.

Preserve the image, data volume, original env files and all other services.
This is not a claim that post-login native crashes have been fixed.
"""
import copy,hashlib,importlib.util,json,os,re,subprocess,sys,time
from pathlib import Path

ENGINE_SHA='b91fcc2025b4a0b219b557ee904e9c3eb2245d021cbaa919eef6b31f0dcdc000'
FLAG='NAPCAT_DISABLE_BYPASS'
NATIVE={
    '/opt/node_addon.node':'8b9641da132519a2a1d072f1495f5e7f8c3732b73201a7b145d581973f8aa508',
    '/opt/qq/wrapper.node':'236ff3ebf29310c75a41394d80db4587411d43d66208c2a7d58b160d7b7b213b',
    '/opt/napcat/native/napi2native/napi2native.linux.x64.node':'42dcb6b65c2f8b065dc5a3b5b7ae906eec08c21142433c96636f68fb2c1fedfb',
    '/opt/napcat/native/packet/MoeHoo.linux.x64.node':'7caf9629c2ae8f25aa636bd0940c0d430bb30264617b9a6531800586d015b534'
}

def load_engine(report):
    file=Path('/www/gamehub/deploy/qq/update-admin.py')
    if hashlib.sha256(file.read_bytes()).hexdigest()!=ENGINE_SHA:raise RuntimeError('部署辅助脚本基线不符，停止。')
    spec=importlib.util.spec_from_file_location('qq_compat_engine',file);u=importlib.util.module_from_spec(spec);spec.loader.exec_module(u)
    u.LOGDIR=report
    u.STEP=max([int(p.stem.split('-')[1]) for p in report.glob('command-*.log')]+[0])
    return u

def gateway(u):
    ids=u.run(['docker','ps','-aq','--filter','label=com.docker.compose.project=mooyu-qq','--filter','label=com.docker.compose.service=napcat']).decode().split()
    rows=[]
    for cid in ids:
        info=json.loads(u.run(['docker','inspect',cid]))[0]
        if (info['Config'].get('Labels') or {}).get('com.docker.compose.oneoff','false').lower()!='true':rows.append(info)
    if len(rows)!=1:raise RuntimeError('需要唯一 NapCat 容器，停止。')
    return rows[0]

def overlay(u,info,disabled):
    values=u.environment(info)
    if disabled:values={**values,FLAG:'1'}
    return {'services':{'napcat':{'image':info['Image'],'environment':{k:v.replace('$','$$') for k,v in values.items()}}}}

def validate(u,rendered,info):
    expected={**u.environment(info),FLAG:'1'}
    value=rendered['services']['napcat']
    if value['image']!=info['Image'] or value['environment']!=expected:raise RuntimeError('网关镜像或环境未完整保留。')
    prior=copy.deepcopy(info)
    prior['Config']['Env']=[x for x in prior['Config']['Env'] if not x.startswith(FLAG+'=')]
    u.validate_snapshot(rendered,[prior])
    networks={rendered['networks'][name]['name'] for name in value.get('networks',{})}
    if networks!=set(info['NetworkSettings']['Networks']):raise RuntimeError('网关原网络发生变化。')
    old_ports={(binding.get('HostIp','0.0.0.0'),binding['HostPort'],int(key.split('/')[0]),key.split('/')[1]) for key,bindings in (info['HostConfig'].get('PortBindings') or {}).items() for binding in bindings or []}
    ports={(p.get('host_ip','0.0.0.0'),str(p['published']),p['target'],p.get('protocol','tcp')) for p in value.get('ports',[])}
    if ports!=old_ports:raise RuntimeError('网关原端口发生变化。')
    host=info['HostConfig']
    if bool(value.get('read_only',False))!=bool(host.get('ReadonlyRootfs',False)) or bool(value.get('init',False))!=bool(host.get('Init',False)):
        raise RuntimeError('网关文件系统或 init 设置发生变化。')
    for key,docker_key in [('cap_drop','CapDrop'),('cap_add','CapAdd'),('security_opt','SecurityOpt')]:
        if set(value.get(key) or [])!=set(host.get(docker_key) or []):raise RuntimeError('网关原隔离权限发生变化。')
    if int(value.get('mem_limit') or 0)!=int(host.get('Memory') or 0) or int(float(value.get('cpus') or 0)*1000000000)!=int(host.get('NanoCpus') or 0):
        raise RuntimeError('网关原资源限制发生变化。')

def fingerprint(file):
    h=hashlib.sha256()
    with file.open('rb') as f:
        while chunk:=f.read(1024*1024):h.update(chunk)
    return h.hexdigest()

def unchanged(hashes):
    if any(fingerprint(Path(p))!=digest for p,digest in hashes.items()):raise RuntimeError('原配置校验发生变化，停止。')

def wait_webui(u):
    deadline=time.monotonic()+45
    while time.monotonic()<deadline:
        current=gateway(u)
        if current['State']['Running']:
            try:
                value=json.loads(u.run(['docker','exec',current['Id'],'node','/opt/manage.mjs','status']).decode().strip())
                if 'loggedIn' in value:return current,value
            except RuntimeError:pass
        time.sleep(2)
    raise RuntimeError('网关状态接口未就绪。')

def rollback(u,report):
    state=json.loads((report/'state.private.json').read_text())
    current=gateway(u);before=json.loads((report/'gateway-before.private.json').read_text())
    allowed=[u.environment(before),{**u.environment(before),FLAG:'1'}]
    if current['Image']!=before['Image'] or u.environment(current) not in allowed:raise RuntimeError('网关已被其他操作修改，保留现状，停止自动恢复。')
    unchanged(state['hashes'])
    u.compose('mooyu-qq',state['files']+[str(report/'rollback.override.json')],state['cwd'],'/www/mooyu-qq/.env',['up','-d','--no-deps','--no-build','--pull','never','napcat'])
    _,status=wait_webui(u)
    print('已恢复原网关环境；原数据卷继续使用，未恢复旧数据快照。',flush=True)
    print(json.dumps(status),flush=True)

def apply(u,report):
    before=gateway(u)
    if not before['State']['Running']:raise RuntimeError('网关未运行，不能按本方案接续。')
    if u.environment(before).get(FLAG)=='1':raise RuntimeError('网关已经关闭 Bypass，停止，避免重复试验。')
    code="const fs=require('node:fs'),c=require('node:crypto');const paths="+json.dumps(list(NATIVE))+";console.log(JSON.stringify({supported:fs.readFileSync('/opt/napcat/napcat.mjs','utf8').includes('NAPCAT_DISABLE_BYPASS'),hashes:Object.fromEntries(paths.map(p=>[p,c.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]))}));"
    native=json.loads(u.run(['docker','exec',before['Id'],'node','-e',code]))
    if native.get('supported') is not True or native.get('hashes')!=NATIVE:raise RuntimeError('网关组件已变化，停止，避免把本次试验用于其他版本。')
    # Never interrupt an already-online account just to perform this trial.
    status=json.loads(u.run(['docker','exec',before['Id'],'node','/opt/manage.mjs','status']).decode().strip())
    if status.get('loggedIn') or status.get('phase') in ['qrcode_scanned','initializing','ready','reconnecting']:
        raise RuntimeError('QQ 当前在线或正在完成登录，本次不打断会话；请先提供当前状态。')
    files,cwd=u.compose_files(before)
    paths=[Path(p) for p in ['/www/gamehub/deploy/.env.prod','/www/mooyu-qq/.env','/www/mooyu-qq/worker.env','/www/mooyu-qq/config.json','/www/mooyu-qq/admin/shared.secret','/www/mooyu-qq/admin/qq.override.json','/www/mooyu-qq/admin/site.override.json','/www/mooyu-qq/admin/installed.json']]
    hashes={str(p):fingerprint(p) for p in paths}
    other={service:u.discover(project,service)['Id'] for project,service in [('gamehub-production','api'),('gamehub-production','web'),('mooyu-qq','worker'),('mooyu-qq','postgres')]}
    for project,service in [('gamehub-production','api'),('mooyu-qq','worker')]:
        env=u.environment(u.discover(project,service))
        if any(env.get(k,'false')!='false' for k in ['PAPER_STUDY_ENABLED','PAPER_STUDY_WORKER_ENABLED','PAPER_STUDY_MODELS_ENABLED','PAPER_STUDY_PUBLISH_ENABLED']):raise RuntimeError('论文开关未满足关闭要求。')
    target=Path('/www/mooyu-qq/admin/native-compat.override.json')
    if target.exists() or target.is_symlink():raise RuntimeError('已有兼容性覆盖文件，停止，保留原文件。')
    u.private_write(report/'gateway-before.private.json',json.dumps(before))
    u.private_write(report/'rollback.override.json',json.dumps(overlay(u,before,False)))
    u.private_write(target,json.dumps(overlay(u,before,True)))
    state={'files':files,'cwd':cwd,'hashes':hashes,'override':str(target),'otherContainers':other}
    u.private_write(report/'state.private.json',json.dumps(state))
    u.private_write(report/'rollback.sh',"#!/usr/bin/env bash\nset -Eeuo pipefail\nexec </dev/null\numask 077\nexec 9>>/www/backup/gamehub/.unified-release.lock\nflock -n 9 || exit 1\nexec > >(tee -a "+str(report/'rollback.log')+") 2>&1\npython3 "+str(report/'try-native-compat.py')+" --rollback "+str(report)+"\n")
    rendered=json.loads(u.compose('mooyu-qq',files+[str(target)],cwd,'/www/mooyu-qq/.env',['config','--format','json']))
    validate(u,rendered,before)
    # This tag is a retention marker, not a changed image.
    u.run(['docker','tag',before['Image'],'mooyu-qq-native-rollback:'+report.name])
    stopped=False
    try:
        stopped=True
        u.run(['docker','stop','--time','30',before['Id']])
        archive=report/'native-volume-before.tar.gz'
        args=['docker','run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--volumes-from',before['Id']+':ro','--entrypoint','tar',before['Image'],'-C','/data','-czf','-','.']
        with archive.open('xb') as output:
            result=subprocess.run(args,stdin=subprocess.DEVNULL,stdout=output,stderr=subprocess.PIPE,timeout=180,check=False)
        u.private_write(report/'native-backup.stderr.private.log',result.stderr.decode('utf8',errors='replace'))
        if result.returncode:raise RuntimeError('登录卷备份失败，恢复原网关，不继续试验。')
        u.private_write(report/'native-volume-before.sha256',fingerprint(archive)+'  '+archive.name+'\n')
        print('登录卷已在停止状态下备份并记录校验值。',flush=True)
        u.compose('mooyu-qq',files+[str(target)],cwd,'/www/mooyu-qq/.env',['up','-d','--no-deps','--no-build','--pull','never','napcat'])
        current,status=wait_webui(u)
        if current['Image']!=before['Image'] or u.environment(current)!={**u.environment(before),FLAG:'1'}:raise RuntimeError('兼容开关未按预期生效。')
        unchanged(hashes)
        for project,service in [('gamehub-production','api'),('gamehub-production','web'),('mooyu-qq','worker'),('mooyu-qq','postgres')]:
            if u.discover(project,service)['Id']!=other[service]:raise RuntimeError('其他服务实例发生变化，请先核对。')
        u.private_write(report/'trial.json',json.dumps({'flag':FLAG,'value':'1','sameImage':True,'paperEnabled':False,'postLoginVerified':False}))
        print('兼容性试验已启动：仅 NAPCAT_DISABLE_BYPASS=1 生效，原镜像、配置及其他服务保留。',flush=True)
        print('这只确认网关已启动，尚未证明扫码后的崩溃已解决。请继续同步观察一次扫码。',flush=True)
    except Exception:
        if stopped:
            try:rollback(u,report)
            except Exception:print('恢复未完全完成；备份及原环境已保留，请提供本次 deploy.log。',flush=True)
        raise

if __name__=='__main__':
    os.umask(0o077)
    try:
        if os.geteuid()!=0 or len(sys.argv)!=3 or sys.argv[1] not in ['--apply','--rollback']:raise RuntimeError('需要 root 和操作参数。')
        report=Path(sys.argv[2])
        if report.is_symlink() or report.parent!=Path('/www/backup/gamehub') or not report.name.startswith('qq-native-compat-') or not report.is_dir():raise RuntimeError('记录目录不符合要求。')
        u=load_engine(report)
        if sys.argv[1]=='--apply':apply(u,report)
        else:rollback(u,report)
    except Exception as error:
        print('操作停止：'+str(error),flush=True)
        sys.exit(1)
