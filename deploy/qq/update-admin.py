"""Install only the API, website and QQ worker; retain all live DBs/configs.

The release is offline and immutable. Docker inspect/Compose secrets stay in
memory or private mode-0600 rollback files, never in terminal output.
"""
import hashlib,json,os,re,secrets,subprocess,sys,time
from pathlib import Path
LOGDIR=None
STEP=0
COMPOSE_ENV={}

def fail(message):
    raise RuntimeError(message)

def run(args, *, data=None, capture=True):
    global STEP
    result=subprocess.run(args,input=data,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=180,check=False,env={**os.environ,**COMPOSE_ENV})
    diagnostic=''
    if LOGDIR is not None:
        STEP+=1
        diagnostic='command-%03d.log'%STEP
        # Some Compose output contains secrets. Keep full evidence private and
        # print only a step number/exit status, never command arguments.
        private_write(LOGDIR/diagnostic,'exit='+str(result.returncode)+'\nSTDOUT\n'+result.stdout.decode('utf8',errors='replace')+'\nSTDERR\n'+result.stderr.decode('utf8',errors='replace'))
        print('检查步骤 %03d：%s，退出码 %s'%(STEP,args[0],result.returncode),flush=True)
    if result.returncode:
        # Never echo a command/environment: private Compose snapshots contain keys.
        fail('命令未完成：'+args[0]+'；私有诊断：'+diagnostic)
    if not capture:
        print(result.stdout.decode('utf8',errors='replace'),end='',flush=True)
    return result.stdout

def private_write(path,value):
    path=Path(path)
    if path.exists() or path.is_symlink(): fail('目标文件已存在，拒绝覆盖：'+path.name)
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w',encoding='utf8') as handle: handle.write(value)

def environment(info):
    return dict(item.split('=',1) for item in info['Config'].get('Env',[]) if '=' in item)

def recover_download_environment(web):
    result={}
    for variable,target in [('DESKTOP_DOWNLOADS_DIR','/srv/desktop-downloads'),('AGENT_DOWNLOADS_DIR','/srv/agent-downloads')]:
        mounts=[m for m in web.get('Mounts',[]) if m.get('Destination')==target]
        if len(mounts)!=1 or mounts[0].get('Type')!='bind' or mounts[0].get('RW',True):
            fail('无法确认当前只读下载目录：'+variable)
        source=mounts[0].get('Source','');directory=Path(source)
        if not directory.is_absolute() or not directory.is_dir() or directory.is_symlink() or not str(directory.resolve()).startswith('/www/'):
            fail('当前下载目录路径不安全：'+variable)
        # Live bind mounts are authoritative. Ignore conflicting shell values;
        # never guess paths, create directories or rewrite the production env.
        result[variable]=source
    return result

def discover(project,service):
    ids=run(['docker','ps','-q','--filter','label=com.docker.compose.project='+project,'--filter','label=com.docker.compose.service='+service]).decode().split()
    rows=[]
    for identifier in ids:
        info=json.loads(run(['docker','inspect',identifier]))[0]
        labels=info['Config'].get('Labels') or {}
        if labels.get('com.docker.compose.oneoff','False').lower()=='true': continue
        if labels.get('com.docker.compose.project')!=project or labels.get('com.docker.compose.service')!=service or not info['State']['Running']: fail('容器身份不一致。')
        rows.append(info)
    if len(rows)!=1: fail('需要唯一运行容器：'+project+'/'+service)
    return rows[0]

def compose_files(info):
    labels=info['Config']['Labels'];files=labels.get('com.docker.compose.project.config_files','').split(',')
    cwd=labels.get('com.docker.compose.project.working_dir','')
    if not Path(cwd).is_dir(): fail('原 Compose 工作目录不可用。')
    for value in files:
        file=Path(value)
        if not file.is_absolute() or not file.is_file() or file.is_symlink() or not str(file.resolve()).startswith(('/www/gamehub/','/www/backup/gamehub/','/www/mooyu-qq/')): fail('原 Compose 配置路径不安全。')
    return files,cwd

def compose(project,files,cwd,env_file,args):
    command=['docker','compose','--project-name',project,'--project-directory',cwd,'--env-file',env_file]
    for file in files: command+=['-f',str(file)]
    return run(command+args)

def probe_web(info):
    domain=environment(info).get('APP_DOMAIN','')
    if not re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?',domain):
        fail('网站域名不符合本机探测要求。')
    # Probe the existing public listener directly, without DNS/proxies and
    # without weakening TLS verification. A missing Docker HEALTHCHECK is not
    # itself a failure, but Running alone is not a readiness signal either.
    command=['curl','--silent','--show-error','--fail','--noproxy','*','--connect-timeout','3','--max-time','8','--resolve',domain+':443:127.0.0.1']
    run(command+['https://'+domain+'/ready'])
    html=run(command+['https://'+domain+'/'])
    if b'<html' not in html.lower(): fail('网站首页未返回 HTML。')

def wait_ready(project,service,seconds=120):
    until=time.monotonic()+seconds
    while time.monotonic()<until:
        try:
            info=discover(project,service)
            health=info['State'].get('Health')
            if service=='web' and (health is None or health.get('Status')=='healthy'):
                probe_web(info)
                return info
            if service!='web' and health and health.get('Status')=='healthy': return info
        except RuntimeError: pass
        time.sleep(2)
    fail('服务未在时限内健康：'+service)

def qq_sql(pg,sql):
    return run(['docker','exec','-i',pg['Id'],'psql','-U','mooyu_qq','-d','mooyu_qq_local_server','-At','-v','ON_ERROR_STOP=1'],data=sql.encode()).decode().strip()

def backup_qq(pg,record):
    target=record/'qq-before.sql'
    if target.exists(): fail('备份文件已存在。')
    sql=run(['docker','exec',pg['Id'],'pg_dump','-U','mooyu_qq','-d','mooyu_qq_local_server','--schema=mooyu_qq','--no-owner','--no-acl'])
    private_write(target,sql.decode('utf8'))
    private_write(record/'qq-before.sha256',hashlib.sha256(sql).hexdigest()+'  qq-before.sql\n')

def overlay(info,image,extra_env=None,extra_network=None,secret=None):
    values={**environment(info),**(extra_env or {})}
    value={'image':image,'environment':{key:value.replace('$','$$') for key,value in values.items()}}
    if extra_network:
        # Preserve each existing network alias, adding one isolated control net.
        value['networks']={**extra_network,'qq-admin-control':{'aliases':['qq-control']} if info['Config']['Labels']['com.docker.compose.service']=='worker' else {}}
    if secret: value['volumes']=[{'type':'bind','source':str(secret),'target':'/run/secrets/qq-admin-shared','read_only':True}]
    return value

def validate_snapshot(rendered,old_infos):
    for old in old_infos:
        service=old['Config']['Labels']['com.docker.compose.service'];new=rendered['services'][service]
        for key,value in environment(old).items():
            if key in ['QQ_ADMIN_ENABLED','QQ_ADMIN_AGENT_USER_ID','QQ_ADMIN_SECRET_FILE','QQ_ADMIN_ORIGIN','QQ_NAPCAT_TOKEN']: continue
            if new.get('environment',{}).get(key)!=value: fail('原运行环境发生变化：'+service+'/'+key)
        mounts={m['target']:m for m in new.get('volumes',[])}
        for previous in old.get('Mounts',[]):
            if previous['Type']=='tmpfs': continue
            mount=mounts.get(previous['Destination'])
            if not mount or mount.get('type')!=previous['Type'] or bool(mount.get('read_only',False))==bool(previous.get('RW',True)): fail('原数据挂载属性未保留：'+service)
            if previous['Type']=='bind' and mount['source']!=previous['Source']: fail('原挂载路径未保留：'+service)
            if previous['Type']=='volume' and rendered['volumes'][mount['source']]['name']!=previous['Name']: fail('原数据卷未保留：'+service)
        new_networks={rendered['networks'][key]['name'] for key in new.get('networks',{})}
        if not set(old['NetworkSettings']['Networks']).issubset(new_networks): fail('原网络未保留：'+service)
        old_tmp=set((old['HostConfig'].get('Tmpfs') or {}).keys())
        new_tmp={item.split(':',1)[0] for item in new.get('tmpfs',[])}
        if not old_tmp.issubset(new_tmp): fail('原临时文件挂载未保留：'+service)

def rollback(state,record):
    COMPOSE_ENV.update(state.get('compose_env',{}))
    print('更新未通过，恢复原网站镜像；不回退或删除数据库。',flush=True)
    compose('gamehub-production',state['site_files']+[str(record/'rollback-site.json')],state['site_cwd'],'/www/gamehub/deploy/.env.prod',['up','-d','--no-deps','--no-build','--pull','never','api','web'])
    # Preserve administrator changes even if a website verification subsequently
    # fails. Only an untouched initial policy can safely return to an old worker.
    pg=discover('mooyu-qq','postgres')
    table=qq_sql(pg,"SELECT to_regclass('mooyu_qq.control_settings') IS NOT NULL;")
    if table=='t':
        revisions=qq_sql(pg,'SELECT coalesce(max(revision),1) FROM mooyu_qq.control_settings;')
        if revisions!='1':
            print('QQ 设置已有新版本，保留新 worker 和审计，避免旧版本忽略新权限。',flush=True)
            return
        compose('mooyu-qq',state['qq_files']+[str(state['qq_override'])],state['qq_cwd'],'/www/mooyu-qq/.env',['stop','worker'])
        qq_sql(pg,"UPDATE mooyu_qq.settings s SET policy_hash=c.bootstrap_hash FROM mooyu_qq.control_settings c WHERE c.channel_id=s.channel_id AND c.revision=1 AND s.policy_hash='managed:'||c.bootstrap_hash;")
    compose('mooyu-qq',state['qq_files']+[str(record/'rollback-qq.json')],state['qq_cwd'],'/www/mooyu-qq/.env',['up','-d','--no-deps','--no-build','--pull','never','worker'])

def verify_resume(resume_record,manifest,infos,pg):
    root=Path('/www/backup/gamehub')
    if resume_record.is_symlink() or resume_record.parent!=root or not resume_record.name.startswith('update-qq-admin-'):
        fail('接续记录路径不安全。')
    previous=json.loads((resume_record/'previous-images.json').read_text())
    expected={item['service']:item['image'] for item in previous}
    if set(expected)!={'api','web','worker'} or any(info['Image']!=expected[name] for name,info in infos.items()):
        fail('当前镜像与原回滚材料不一致，停止。')
    prior=json.loads((resume_record/'payload/release.json').read_text())
    if prior['baseCommit']!=manifest['baseCommit'] or prior['images']!=manifest['images']:
        fail('接续包与原业务镜像基线不符。')
    # Only resume the exact untouched policy reported after automatic rollback.
    # Never discard later operator edits or a successful installation marker.
    result=qq_sql(pg,"SELECT count(*) FROM mooyu_qq.control_settings c JOIN mooyu_qq.settings s USING(channel_id) WHERE c.revision=1 AND c.login_revision=1 AND s.policy_hash=c.bootstrap_hash;")
    total=qq_sql(pg,'SELECT count(*) FROM mooyu_qq.control_settings;')
    if result!='1' or total!='1': fail('QQ 设置已改变，不能自动接续首次升级。')

def retain_json(path,value):
    if path.is_symlink() or not path.is_file() or json.loads(path.read_text())!=value:
        fail('已有管理覆盖文件与当前配置不符，停止，保留原文件。')

def update(payload,record,resume_record=None):
    global LOGDIR
    LOGDIR=record
    manifest=json.loads((payload/'release.json').read_text())
    if run(['git','-C','/www/gamehub','rev-parse','HEAD']).decode().strip()!=manifest['baseCommit']: fail('线上源码版本与本次基线不同，停止，保留已有修改。')
    if run(['git','-C','/www/gamehub','status','--porcelain']).strip(): fail('线上工作区有修改，停止；不会 reset 或 clean。')
    run(['git','-C','/www/gamehub','bundle','verify',str(payload/'source.bundle')])
    run(['git','-C','/www/gamehub','fetch',str(payload/'source.bundle'),manifest['sourceRef']])
    if run(['git','-C','/www/gamehub','rev-parse','FETCH_HEAD']).decode().strip()!=manifest['targetCommit']: fail('离线源码目标不符。')
    run(['git','-C','/www/gamehub','merge-base','--is-ancestor',manifest['baseCommit'],manifest['targetCommit']])
    admin=Path('/www/mooyu-qq/admin')
    if resume_record is None and admin.exists(): fail('已有 QQ 管理配置，停止，避免覆盖。')
    if resume_record is not None and (not admin.is_dir() or admin.is_symlink() or (admin/'installed.json').exists()):
        fail('当前管理安装状态不允许接续。')
    site_env=Path('/www/gamehub/deploy/.env.prod');qq_env=Path('/www/mooyu-qq/.env')
    hashes={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in [site_env,qq_env,Path('/www/mooyu-qq/worker.env'),Path('/www/mooyu-qq/config.json')]}
    api,web,worker,pg,napcat=[discover(p,s) for p,s in [('gamehub-production','api'),('gamehub-production','web'),('mooyu-qq','worker'),('mooyu-qq','postgres'),('mooyu-qq','napcat')]]
    if resume_record is not None:
        verify_resume(resume_record,manifest,{'api':api,'web':web,'worker':worker},pg)
        probe_web(web)
        for name in ['shared.secret','qq.override.json','site.override.json']:
            file=admin/name
            if file.is_symlink() or not file.is_file(): fail('管理材料不完整：'+name)
            hashes[str(file)]=hashlib.sha256(file.read_bytes()).hexdigest()
    COMPOSE_ENV.update(recover_download_environment(web))
    site_files,site_cwd=compose_files(api);web_files,_=compose_files(web)
    if site_files!=web_files: fail('网站 API 与网页的 Compose 配置不一致，停止。')
    qq_files,qq_cwd=compose_files(worker)
    site_render=json.loads(compose('gamehub-production',site_files,site_cwd,str(site_env),['config','--format','json']))
    qq_render=json.loads(compose('mooyu-qq',qq_files,qq_cwd,str(qq_env),['config','--format','json']))
    if any(value.get('network_mode') for value in [site_render['services']['api'],qq_render['services']['worker']]): fail('当前网络模式与独立控制网络不兼容，停止。')
    api_env=environment(api);agent=api_env.get('AGENT_BLOG_PUBLIC_RUNTIME_AGENT_USER_ID','')
    if not re.fullmatch(r'[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[1-5][a-fA-F0-9]{3}-[89abAB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}',agent): fail('未取得现有小墨鱼网站账号绑定，停止。')
    flags=['PAPER_STUDY_ENABLED','PAPER_STUDY_WORKER_ENABLED','PAPER_STUDY_MODELS_ENABLED','PAPER_STUDY_PUBLISH_ENABLED']
    if any(environment(info).get(key,'false')!='false' for info in [api,worker] for key in flags): fail('论文开关不符合关闭要求，停止。')
    if qq_sql(pg,"SELECT count(*) FROM mooyu_qq.messages WHERE status IN ('generating','sending','needs-review');")!='0': fail('QQ 有正在执行或结果待确认的任务，请稍后更新，保留历史。')
    # Retain original images plus a minimal source-controlled offline rollback.
    private_write(record/'rollback-site.json',json.dumps({'services':{'api':overlay(api,api['Image']),'web':overlay(web,web['Image'])}},ensure_ascii=False))
    private_write(record/'rollback-qq.json',json.dumps({'services':{'worker':overlay(worker,worker['Image'])}},ensure_ascii=False))
    backup_qq(pg,record)
    previous=[]
    for label,info in [('api',api),('web',web),('worker',worker)]:
        tag='mooyu-qq-admin-rollback:'+record.name+'-'+label
        run(['docker','tag',info['Image'],tag]);previous.append({'service':label,'image':info['Image'],'tag':tag})
    private_write(record/'previous-images.json',json.dumps(previous))
    if resume_record is None: run(['docker','load','--input',str(payload/'images.tar')],capture=False)
    for item in manifest['images']:
        if json.loads(run(['docker','image','inspect',item['tag']]))[0]['Id']!=item['id']: fail('导入镜像身份不符，停止。')
    network='mooyu-qq-admin-control'
    if resume_record is None:
        if run(['docker','network','ls','-q','--filter','name=^'+network+'$']).strip(): fail('控制网络已存在，停止，避免误用。')
        run(['docker','network','create','--internal','--label','mooyu.qq.admin=1',network])
        admin.mkdir(mode=0o700)
        secret=admin/'shared.secret';private_write(secret,secrets.token_hex(32)+'\n');os.chown(secret,0,1000);os.chmod(secret,0o640)
    else:
        net=json.loads(run(['docker','network','inspect',network]))[0]
        if net.get('Internal') is not True or (net.get('Labels') or {}).get('mooyu.qq.admin')!='1' or net.get('Containers'):
            fail('既有控制网络状态不符合回滚后的空闲状态。')
        secret=admin/'shared.secret'
        if not re.fullmatch(r'[a-f0-9]{64}\n?',secret.read_text()): fail('既有控制密钥格式不符。')
    qq_extra={'QQ_ADMIN_ENABLED':'true','QQ_ADMIN_AGENT_USER_ID':agent,'QQ_ADMIN_SECRET_FILE':'/run/secrets/qq-admin-shared','QQ_NAPCAT_TOKEN':environment(napcat)['QQ_WEBUI_TOKEN']}
    api_extra={'QQ_ADMIN_ENABLED':'true','QQ_ADMIN_AGENT_USER_ID':agent,'QQ_ADMIN_SECRET_FILE':'/run/secrets/qq-admin-shared','QQ_ADMIN_ORIGIN':'http://qq-control:6780'}
    control_network={'qq-admin-control':{'external':True,'name':network}}
    qq_override=admin/'qq.override.json';site_override=admin/'site.override.json'
    qq_value={'services':{'worker':overlay(worker,manifest['worker'],qq_extra,qq_render['services']['worker'].get('networks',{'default':{}}),secret)},'networks':control_network}
    site_value={'services':{'api':overlay(api,manifest['api'],api_extra,site_render['services']['api'].get('networks',{'backend':{}}),secret),'web':overlay(web,manifest['web'])},'networks':control_network}
    if resume_record is None:
        private_write(qq_override,json.dumps(qq_value,ensure_ascii=False))
        private_write(site_override,json.dumps(site_value,ensure_ascii=False))
    else:
        retain_json(qq_override,qq_value);retain_json(site_override,site_value)
    state={'site_files':site_files,'site_cwd':site_cwd,'qq_files':qq_files,'qq_cwd':qq_cwd,'qq_override':str(qq_override),'compose_env':dict(COMPOSE_ENV)}
    private_write(record/'rollback-state.json',json.dumps(state))
    private_write(record/'rollback.sh',"#!/usr/bin/env bash\nset -Eeuo pipefail\nexec </dev/null\numask 077\nexec 9>>/www/backup/gamehub/.unified-release.lock\nflock -n 9 || exit 1\npython3 "+str(payload/'update-admin.py')+" --rollback "+str(record)+"\n")
    # Compose array/map merges must retain the original service data mounts,
    # runtime env and existing networks. Validate before replacing any process.
    for project,files,cwd,env_file,old_infos in [('mooyu-qq',qq_files+[str(qq_override)],qq_cwd,str(qq_env),[worker]),('gamehub-production',site_files+[str(site_override)],site_cwd,str(site_env),[api,web])]:
        rendered=json.loads(compose(project,files,cwd,env_file,['config','--format','json']))
        validate_snapshot(rendered,old_infos)
    try:
        compose('mooyu-qq',qq_files+[str(qq_override)],qq_cwd,str(qq_env),['up','-d','--no-deps','--no-build','--pull','never','worker'])
        ready=wait_ready('mooyu-qq','worker')
        run(['docker','exec',ready['Id'],'node','apps/qq-channel/src/cli.mjs','/config/config.json','--status'],capture=False)
        compose('gamehub-production',site_files+[str(site_override)],site_cwd,str(site_env),['up','-d','--no-deps','--no-build','--pull','never','api','web'])
        current=wait_ready('gamehub-production','api');wait_ready('gamehub-production','web')
        # A real authenticated internal round trip validates signature, binding,
        # DB state and gateway status without exposing tokens or generating text.
        probe="import {createAgentQQAdminService} from './apps/api/src/agent-qq-admin-service.mjs';import pg from './apps/api/node_modules/pg/lib/index.js';const p=new pg.Pool({connectionString:process.env.DATABASE_URL});try{const id=process.env.QQ_ADMIN_AGENT_USER_ID;const r=(await p.query('SELECT operator_user_id FROM agent_accounts WHERE user_id=$1',[id])).rows[0];const s=createAgentQQAdminService({pool:p,env:process.env});const v=await s.execute({userId:r.operator_user_id,profile:{role:'admin'}},id,'status');console.log(JSON.stringify({revision:v.revision,settingsEnabled:v.settings.enabled,states:v.status.states,budget:v.status.budget,runtime:v.runtime,paperEnabled:v.paperEnabled}));}finally{await p.end();}"
        run(['docker','exec',current['Id'],'node','--input-type=module','-e',probe],capture=False)
        for file,digest in hashes.items():
            if hashlib.sha256(Path(file).read_bytes()).hexdigest()!=digest: fail('原配置内容变化，停止。')
        # Host code advances only after successful runtime checks. The bundle
        # contains reviewed code, no settings, history, tokens or other worktrees.
        run(['git','-C','/www/gamehub','merge','--ff-only',manifest['targetCommit']])
        private_write(admin/'installed.json',json.dumps({'commit':manifest['targetCommit'],'record':str(record),'createdAt':time.time()}))
        print('QQ 后台更新完成。原历史、预算、网站数据与配置保留，论文关闭。',flush=True)
    except Exception:
        try: rollback(state,record)
        except Exception: print('自动恢复未完全完成；保留了原镜像、配置及全部数据库，请先提供本次日志。',flush=True)
        raise

if __name__=='__main__':
    try:
        if len(sys.argv)==3 and sys.argv[1]=='--rollback':
            record=Path(sys.argv[2]);LOGDIR=record
            STEP=max([int(p.stem.split('-')[1]) for p in record.glob('command-*.log')]+[0])
            rollback(json.loads((record/'rollback-state.json').read_text()),record)
        elif len(sys.argv)==4 and sys.argv[1]=='--resume':
            record=Path(sys.argv[3]);update(record/'payload',record,resume_record=Path(sys.argv[2]))
        elif len(sys.argv)==3: update(Path(sys.argv[1]),Path(sys.argv[2]))
        else: fail('参数无效。')
    except Exception as error:
        print('更新停止：'+str(error),flush=True)
        sys.exit(1)
