"""Two-stage switch for the verified 55b2f7e8 release; no original config edits.

plan leaves running services alone. apply backs up the stopped login volume,
uses a fresh clone, and restores original images/volume if readiness fails.
All command output and rollback material remain in a private record directory.
"""
import copy, hashlib, json, os, re, subprocess, sys, time, types
from pathlib import Path

BASE = '9f98c06f8be98f990724a3b7427d9dd93ffc7e5a'
TARGET = '55b2f7e8144a4f279facd888bb208079a3459dc9'
FLAGS = ['PAPER_STUDY_ENABLED', 'PAPER_STUDY_WORKER_ENABLED',
         'PAPER_STUDY_MODELS_ENABLED', 'PAPER_STUDY_PUBLISH_ENABLED']
ROOT = Path('/www/backup/gamehub/qq-compatible-55b2f7e8')
VOLUME_ALIAS = 'qq-compatible-login'

PROFILE_CODE = r"""
const fs=require('fs'),path=require('path'),crypto=require('crypto');
function inventory(root,prefix=''){
 const out={};if(!fs.existsSync(root))return out;
 if(fs.lstatSync(root).isSymbolicLink())throw Error('QQ_PROFILE_LINK_REQUIRES_REVIEW');
 for(const e of fs.readdirSync(root,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
  const file=path.join(root,e.name),key=path.join(prefix,e.name);
  if(e.isSymbolicLink())throw Error('QQ_PROFILE_LINK_REQUIRES_REVIEW');
  if(e.isDirectory())Object.assign(out,inventory(file,key));
  else if(e.isFile()){
   const hash=crypto.createHash('sha256'),fd=fs.openSync(file,'r'),buffer=Buffer.alloc(1024*1024);let n;
   try{while((n=fs.readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,n));}finally{fs.closeSync(fd);}
   out[key]=hash.digest('hex');
  }else throw Error('QQ_PROFILE_SPECIAL_FILE_REQUIRES_REVIEW');
 }return out;
}
try{
 const root=process.env.PROFILE_COPY==='1'?'/new':'/old',legacy=inventory(root+'/qq'),native=inventory(root+'/home/.config/QQ');
 const overlap=Object.keys(legacy).filter(p=>Object.hasOwn(native,p)),conflicts=overlap.filter(p=>legacy[p]!==native[p]);
 if(conflicts.length)throw Error('QQ_PROFILE_PATH_CONFLICT');
 if(process.env.PROFILE_COPY==='1'&&Object.keys(legacy).length){
  const source=root+'/qq',dest=root+'/home/.config/QQ';
  fs.mkdirSync(dest,{recursive:true});
  const owner=fs.statSync(source);fs.chownSync(root+'/home',owner.uid,owner.gid);fs.chownSync(root+'/home/.config',owner.uid,owner.gid);fs.chownSync(dest,owner.uid,owner.gid);
  fs.cpSync(source,dest,{recursive:true,preserveTimestamps:true,force:false,errorOnExist:true,
   filter:(s,d)=>fs.statSync(s).isDirectory()||!fs.existsSync(d)});
  function ownership(s,d){const st=fs.statSync(s);fs.chownSync(d,st.uid,st.gid);fs.chmodSync(d,st.mode&0o7777);if(st.isDirectory())for(const name of fs.readdirSync(s))ownership(path.join(s,name),path.join(d,name));}
  ownership(source,dest);
  const actual=inventory(dest);for(const [p,hash]of Object.entries({...native,...legacy}))if(actual[p]!==hash)throw Error('QQ_PROFILE_COPY_HASH_MISMATCH');
  if(JSON.stringify(inventory(source))!==JSON.stringify(legacy))throw Error('QQ_PROFILE_LEGACY_CHANGED');
 }
 console.log(JSON.stringify({legacyFiles:Object.keys(legacy).length,nativeOriginalFiles:Object.keys(native).length,overlappingIdenticalFiles:overlap.length,conflictingFiles:0,copyMode:process.env.PROFILE_COPY==='1'}));
}catch(error){console.error(/^QQ_[A-Z_]+$/.test(error.message)?error.message:'QQ_PROFILE_CHECK_FAILED');process.exitCode=1;}
"""


def fail(code):
    raise RuntimeError(code)


def login_volume(gateway):
    # The verified live container is authoritative; Compose may add underscores
    # or use an explicitly named external volume. Never guess its name.
    mounts = [m for m in gateway['Mounts'] if m['Destination'] == '/data']
    if len(mounts) != 1 or mounts[0]['Type'] != 'volume' or mounts[0].get('RW') is not True:
        fail('QQ_ORIGINAL_LOGIN_VOLUME_MISMATCH')
    name = mounts[0].get('Name', '')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*', name):
        fail('QQ_ORIGINAL_LOGIN_VOLUME_MISMATCH')
    return name


def load_helper(record=None):
    # Read the already verified Git object, not an untracked Python file/cache.
    if record:
        code = (record / 'legacy-helper.py').read_bytes()
    else:
        result = subprocess.run(['git', '-C', '/www/gamehub', 'show',
                                 BASE + ':deploy/qq/update-admin.py'],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
        if result.returncode:
            fail('QQ_BASE_HELPER_UNAVAILABLE')
        code = result.stdout
    module = types.ModuleType('qq_existing_deployment_helper')
    exec(compile(code, '<verified-qq-deployment-helper>', 'exec'), module.__dict__)
    if record:
        module.LOGDIR = record
        module.STEP = max([int(p.stem.split('-')[1]) for p in record.glob('command-*.log')] + [0])
    return module, code


def write(u, file, value):
    u.private_write(file, json.dumps(value, ensure_ascii=False, indent=2))


def compose(u, state, side, extra, args):
    project, env_file = ('mooyu-qq', '/www/mooyu-qq/.env') if side == 'qq' else ('gamehub-production', '/www/gamehub/deploy/.env.prod')
    return u.compose(project, state[side + '_files'] + [str(extra)],
                     state[side + '_cwd'], env_file, args)


def gateway_overlay(u, old, old_image, new_image, volume):
    env = u.environment(old)
    old_defaults = u.environment(old_image)
    new_defaults = u.environment(new_image)
    # Replace image-owned defaults, retaining operator settings and credentials.
    for key, value in old_defaults.items():
        if env.get(key) == value:
            env.pop(key, None)
            if key in new_defaults:
                env[key] = new_defaults[key]
            else:
                env[key] = None
    env.update(HOME='/data/home', NAPCAT_WORKDIR='/data/napcat',
               NAPCAT_QQ_DATA_DIR='', LD_LIBRARY_PATH='', LD_PRELOAD='',
               NAPCAT_DISABLE_MULTI_PROCESS='1', NAPCAT_DISABLE_BYPASS='1', NAPCAT_DISABLE_PIPE='1')
    for key in FLAGS:
        env[key] = 'false'
    for key in ['QQ_WEBUI_TOKEN', 'QQ_ACCESS_TOKEN']:
        if not env.get(key):
            fail('QQ_GATEWAY_CREDENTIAL_CONFIG_MISSING')
    return {'image': new_image['Id'], 'environment': {k: v.replace('$', '$$') if v is not None else None for k, v in env.items()},
            'entrypoint': ['node', '/opt/gateway-entry-compatible.cjs'], 'command': [],
            'working_dir': '/app', 'user': '1000:1000', 'volumes': [{'type': 'volume', 'source': VOLUME_ALIAS, 'target': '/data'}]}


def validate(u, render, old_infos, gateway=False):
    # Compose serializes literal '$' as '$$' so config output is reloadable.
    # Compare decoded values against Docker's actual container environment.
    render = copy.deepcopy(render)
    for service in render['services'].values():
        for key, value in service.get('environment', {}).items():
            if isinstance(value, str):
                service['environment'][key] = value.replace('$$', '$')
    for old in old_infos:
        original = copy.deepcopy(old)
        if gateway:
            # Only /data and image/runtime defaults intentionally change.
            original['Mounts'] = [m for m in old['Mounts'] if m['Destination'] != '/data']
            original['Config']['Env'] = []
        u.validate_snapshot(render, [original])
        service = old['Config']['Labels']['com.docker.compose.service']
        new = render['services'][service]
        if not gateway:
            for key, value in u.environment(old).items():
                if new.get('environment', {}).get(key) != value:
                    fail('QQ_EXISTING_ENVIRONMENT_CHANGED')
        else:
            if new.get('working_dir') != '/app' or new.get('entrypoint') != ['node', '/opt/gateway-entry-compatible.cjs'] or new.get('command') != []:
                fail('QQ_CANDIDATE_ENTRYPOINT_MISMATCH')
            for key in ['NAPCAT_QQ_DATA_DIR', 'LD_LIBRARY_PATH', 'LD_PRELOAD']:
                if new.get('environment', {}).get(key) != '':
                    fail('QQ_CANDIDATE_MIXED_RUNTIME')
            mounts = [m for m in new.get('volumes', []) if m['target'] == '/data']
            if len(mounts) != 1 or mounts[0]['source'] != VOLUME_ALIAS or mounts[0].get('read_only', False):
                fail('QQ_CANDIDATE_LOGIN_MOUNT_MISMATCH')
        if old['HostConfig'].get('ReadonlyRootfs') and not new.get('read_only'):
            fail('QQ_READONLY_SETTING_CHANGED')


def node_volume(u, image, volume, code, destination=None, record=None):
    args = ['docker', 'run', '--rm', '--network', 'none', '--read-only', '--user', '0:0',
            '--cap-drop', 'ALL', '--cap-add', 'DAC_OVERRIDE', '--cap-add', 'CHOWN', '--cap-add', 'FOWNER',
            '--security-opt', 'no-new-privileges:true', '--memory', '384m', '--cpus', '0.5',
            '--entrypoint', 'node', '--mount', 'type=volume,source=' + volume + ',target=/old,readonly']
    if destination:
        args += ['--mount', 'type=volume,source=' + destination + ',target=/new', '--env', 'PROFILE_COPY=1']
    if record:
        args += ['--mount', 'type=bind,source=' + str(record) + ',target=/backup']
    return u.run(args + [image, '-e', code])


def history(u, pg):
    return json.loads(u.qq_sql(pg, "SELECT coalesce(json_agg(json_build_array(channel_id,message_id,fingerprint,md5(coalesce(reply,'')))),'[]') FROM mooyu_qq.messages WHERE status='delivered';"))


def ensure_history(u, pg, before):
    after = {tuple(row) for row in history(u, pg)}
    if not {tuple(row) for row in before}.issubset(after):
        fail('QQ_EXISTING_HISTORY_CHANGED')


def prepare(package):
    if package != ROOT / 'payload' or package.is_symlink():
        fail('QQ_PACKAGE_PATH_MISMATCH')
    manifest = json.loads((package / 'release.json').read_text())
    if manifest['baseCommit'] != BASE or manifest['targetCommit'] != TARGET or set(manifest['images']) != {'api', 'web', 'worker', 'gateway'}:
        fail('QQ_RELEASE_MISMATCH')
    u, code = load_helper()
    if u.run(['git', '-C', '/www/gamehub', 'rev-parse', 'HEAD']).decode().strip() != BASE:
        fail('QQ_SERVER_SOURCE_BASE_CHANGED')
    record = ROOT / ('cutover-' + time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()) + '-' + os.urandom(3).hex())
    record.mkdir(mode=0o700)
    u.LOGDIR = record
    u.private_write(record / 'legacy-helper.py', code.decode())
    infos = {name: u.discover(project, service) for name, project, service in [
        ('gateway', 'mooyu-qq', 'napcat'), ('worker', 'mooyu-qq', 'worker'),
        ('postgres', 'mooyu-qq', 'postgres'), ('api', 'gamehub-production', 'api'), ('web', 'gamehub-production', 'web')]}
    images = {}
    for name, item in manifest['images'].items():
        images[name] = json.loads(u.run(['docker', 'image', 'inspect', item['tag']]))[0]
        if images[name]['Id'] != item['id']:
            fail('QQ_RELEASE_IMAGE_MISMATCH')
        if name != 'gateway' and infos[name]['Image'] != item['baseId']:
            fail('QQ_CURRENT_IMAGE_BASE_CHANGED')
    if any(u.environment(infos[name]).get(key, 'false') != 'false' for name in ['api', 'worker'] for key in FLAGS):
        fail('QQ_PAPER_MUST_REMAIN_DISABLED')
    if u.qq_sql(infos['postgres'], "SELECT count(*) FROM mooyu_qq.messages WHERE status IN ('generating','sending','needs-review');") != '0':
        fail('QQ_BUSY_OR_UNCERTAIN_SEND')
    gateway = infos['gateway']
    old_volume = login_volume(gateway)
    volume_info = json.loads(u.run(['docker', 'volume', 'inspect', old_volume]))[0]
    if volume_info.get('Name') != old_volume:
        fail('QQ_ORIGINAL_LOGIN_VOLUME_MISMATCH')
    users = u.run(['docker', 'ps', '-q', '--no-trunc', '--filter', 'volume=' + old_volume]).decode().split()
    if set(users) != {gateway['Id']}:
        fail('QQ_LOGIN_VOLUME_HAS_OTHER_RUNNING_USERS')
    clone = 'mooyu-qq-compatible-55b2f7e8-' + record.name.rsplit('-', 1)[-1]
    if u.run(['docker', 'volume', 'ls', '-q', '--filter', 'name=^' + clone + '$']).strip():
        fail('QQ_NEW_VOLUME_ALREADY_EXISTS')
    profile = json.loads(node_volume(u, images['gateway']['Id'], old_volume, PROFILE_CODE))
    u.COMPOSE_ENV.update(u.recover_download_environment(infos['web']))
    gateway_files, qq_cwd = u.compose_files(gateway)
    worker_files, worker_cwd = u.compose_files(infos['worker'])
    if worker_cwd != qq_cwd:
        fail('QQ_COMPOSE_WORKING_DIR_MISMATCH')
    site_files, site_cwd = u.compose_files(infos['api'])
    if u.compose_files(infos['web']) != (site_files, site_cwd):
        fail('QQ_SITE_COMPOSE_MISMATCH')
    state = {'record': str(record), 'package': str(package), 'manifest': manifest, 'infos': infos,
             'qq_files': list(dict.fromkeys(gateway_files + worker_files)), 'qq_cwd': qq_cwd,
             'site_files': site_files, 'site_cwd': site_cwd, 'compose_env': u.COMPOSE_ENV,
             'old_volume': old_volume, 'clone_volume': clone, 'profile': profile}
    # Capture image-owned defaults too, so old inherited Compose layers cannot
    # silently replace the running service environment during the switch.
    write(u, record / 'baseline-qq.json', {'services': {
        'napcat': u.overlay(gateway, gateway['Image']),
        'worker': u.overlay(infos['worker'], infos['worker']['Image'])}})
    state['qq_files'].append(str(record / 'baseline-qq.json'))
    # Confirm combining different live service file lists preserves both services.
    base_qq = json.loads(u.compose('mooyu-qq', state['qq_files'], qq_cwd, '/www/mooyu-qq/.env', ['config', '--format', 'json']))
    validate(u, base_qq, [gateway, infos['worker']])
    old_image = json.loads(u.run(['docker', 'image', 'inspect', gateway['Image']]))[0]
    qq_override = {'services': {'napcat': gateway_overlay(u, gateway, old_image, images['gateway'], clone),
                                'worker': u.overlay(infos['worker'], images['worker']['Id'])},
                   'volumes': {VOLUME_ALIAS: {'external': True, 'name': clone}}}
    site_override = {'services': {name: u.overlay(infos[name], images[name]['Id']) for name in ['api', 'web']}}
    rollback_qq = {'services': {'worker': u.overlay(infos['worker'], infos['worker']['Image']),
                               'napcat': u.overlay(gateway, gateway['Image'])}}
    rollback_gateway = rollback_qq['services']['napcat']
    rollback_gateway.update(entrypoint=gateway['Config'].get('Entrypoint'), command=gateway['Config'].get('Cmd'),
                            working_dir=gateway['Config'].get('WorkingDir', ''), volumes=base_qq['services']['napcat'].get('volumes', []))
    for name, value in [('qq.override.json', qq_override), ('site.override.json', site_override),
                        ('rollback-qq.json', rollback_qq), ('rollback-site.json', {'services': {n: u.overlay(infos[n], infos[n]['Image']) for n in ['api', 'web']}})]:
        write(u, record / name, value)
    qq = json.loads(compose(u, state, 'qq', record / 'qq.override.json', ['config', '--format', 'json']))
    site = json.loads(compose(u, state, 'site', record / 'site.override.json', ['config', '--format', 'json']))
    validate(u, qq, [infos['worker']]); validate(u, qq, [gateway], gateway=True)
    validate(u, site, [infos['api'], infos['web']])
    if qq['volumes'][VOLUME_ALIAS].get('name') != clone:
        fail('QQ_CLONE_VOLUME_RENDER_MISMATCH')
    # Retain existing files byte-for-byte, including every historical overlay.
    paths = list(dict.fromkeys(state['qq_files'] + site_files + [
        '/www/mooyu-qq/.env', '/www/mooyu-qq/worker.env', '/www/mooyu-qq/config.json', '/www/gamehub/deploy/.env.prod']))
    for name in ['api', 'worker']:
        secrets = [m for m in infos[name]['Mounts'] if m['Destination'] == '/run/secrets/qq-admin-shared']
        if len(secrets) != 1 or secrets[0]['Type'] != 'bind' or secrets[0]['RW'] or Path(secrets[0]['Source']).is_symlink():
            fail('QQ_EXISTING_CONTROL_SECRET_MOUNT_MISMATCH')
        if secrets[0]['Source'] not in paths:
            paths.append(secrets[0]['Source'])
    state['file_hashes'] = {}
    for index, file in enumerate(paths):
        value = Path(file).read_bytes()
        state['file_hashes'][file] = hashlib.sha256(value).hexdigest()
        u.private_write(record / ('original-config-%03d' % index), value.decode())
    state['history'] = history(u, infos['postgres'])
    write(u, record / 'plan.private.json', state)
    print(json.dumps({'result': 'PLAN_READY', 'record': str(record), 'profile': profile,
                      'originalLoginVolume': old_volume,
                      'existingDeliveredMessages': len(state['history']), 'servicesChanged': False,
                      'paperEnabled': False}, ensure_ascii=False), flush=True)


def verify_files(state):
    for file, expected in state['file_hashes'].items():
        if hashlib.sha256(Path(file).read_bytes()).hexdigest() != expected:
            fail('QQ_ORIGINAL_CONFIG_CHANGED')


def rollback(u, state, site=True):
    record = Path(state['record'])
    compose(u, state, 'qq', record / 'qq.override.json', ['stop', '--timeout', '30', 'worker', 'napcat'])
    if site:
        compose(u, state, 'site', record / 'rollback-site.json', ['up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'api', 'web'])
    compose(u, state, 'qq', record / 'rollback-qq.json', ['up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'napcat', 'worker'])
    verify_files(state)
    print('已恢复原镜像与原登录卷；数据库、新副本和备份全部保留。', flush=True)


def apply(u, state):
    record, infos = Path(state['record']), state['infos']
    if (record / 'apply-started.json').exists():
        fail('QQ_APPLY_ALREADY_STARTED_DO_NOT_REPEAT')
    verify_files(state)
    for name, old in infos.items():
        current = json.loads(u.run(['docker', 'inspect', old['Id']]))[0]
        if current['Id'] != old['Id'] or current['Image'] != old['Image'] or not current['State']['Running']:
            fail('QQ_LIVE_CONTAINER_CHANGED')
    pg = infos['postgres']
    if u.qq_sql(pg, "SELECT count(*) FROM mooyu_qq.messages WHERE status IN ('generating','sending','needs-review');") != '0':
        fail('QQ_BUSY_OR_UNCERTAIN_SEND')
    write(u, record / 'apply-started.json', {'at': time.time()})
    site_changed = False
    try:
        # Stop by verified IDs: never restart/recreate the database or other jobs.
        u.run(['docker', 'stop', '--time', '40', infos['worker']['Id']])
        u.run(['docker', 'stop', '--time', '30', infos['gateway']['Id']])
        u.backup_qq(pg, record)
        image = state['manifest']['images']['gateway']['id']
        backup_code = "const cp=require('child_process');for(const args of [['-cpf','/backup/login-data.tar','-C','/old','.'],['-df','/backup/login-data.tar','-C','/old']]){const r=cp.spawnSync('tar',args,{encoding:'utf8'});if(r.status!==0)process.exit(1);}"
        node_volume(u, image, state['old_volume'], backup_code, record=record)
        with (record / 'login-data.tar').open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        u.private_write(record / 'login-data.sha256', digest + '  login-data.tar\n')
        u.run(['docker', 'volume', 'create', '--label', 'mooyu.qq.compatible=55b2f7e8', state['clone_volume']])
        extract = "const cp=require('child_process'),fs=require('fs');if(fs.readdirSync('/new').length)process.exit(2);for(const args of [['-xpf','/backup/login-data.tar','-C','/new'],['-df','/backup/login-data.tar','-C','/new']]){const r=cp.spawnSync('tar',args,{encoding:'utf8'});if(r.status!==0)process.exit(1);}"
        node_volume(u, image, state['old_volume'], extract, destination=state['clone_volume'], record=record)
        copied = json.loads(node_volume(u, image, state['old_volume'], PROFILE_CODE, destination=state['clone_volume']))
        write(u, record / 'login-copy-verification.json', copied)
        compose(u, state, 'qq', record / 'qq.override.json', ['up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'napcat', 'worker'])
        u.wait_ready('mooyu-qq', 'worker')
        # WebUI must answer before website replacement; QQ may await human QR.
        ready_probe = "const c=require('crypto');(async()=>{const token=process.env.QQ_WEBUI_TOKEN;const auth=await(await fetch('http://127.0.0.1:6099/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({hash:c.createHash('sha256').update(token+'.napcat').digest('hex')})})).json();if(auth.code!==0||!auth.data?.Credential)process.exit(1);const r=await(await fetch('http://127.0.0.1:6099/api/QQLogin/CheckLoginStatus',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.data.Credential},body:'{}'})).json();if(r.code!==0)process.exit(1);console.log(JSON.stringify({available:true,loggedIn:r.data.isLogin===true,phase:r.data.loginPhase}));})().catch(()=>process.exit(1));"
        gateway = u.discover('mooyu-qq', 'napcat')
        available = False
        for _ in range(30):
            try:
                u.run(['docker', 'exec', gateway['Id'], 'node', '-e', ready_probe]); available = True; break
            except RuntimeError:
                time.sleep(2)
        if not available:
            fail('QQ_NEW_GATEWAY_NOT_READY')
        site_changed = True
        compose(u, state, 'site', record / 'site.override.json', ['up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'api', 'web'])
        u.wait_ready('gamehub-production', 'api'); u.wait_ready('gamehub-production', 'web')
        status_probe = "import {createAgentQQAdminService} from './apps/api/src/agent-qq-admin-service.mjs';import pg from './apps/api/node_modules/pg/lib/index.js';const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});try{const id=process.env.QQ_ADMIN_AGENT_USER_ID;const row=(await pool.query('SELECT operator_user_id FROM agent_accounts WHERE user_id=$1',[id])).rows[0];const service=createAgentQQAdminService({pool,env:process.env});const view=await service.execute({userId:row.operator_user_id,profile:{role:'admin'}},id,'status');if(view.runtime.available!==true||view.paperEnabled!==false)process.exitCode=1;console.log(JSON.stringify({available:view.runtime.available,phase:view.runtime.phase,paperEnabled:view.paperEnabled}));}finally{await pool.end();}"
        api = u.discover('gamehub-production', 'api')
        u.run(['docker', 'exec', api['Id'], 'node', '--input-type=module', '-e', status_probe])
        for name, project, service in [('api', 'gamehub-production', 'api'), ('web', 'gamehub-production', 'web'), ('worker', 'mooyu-qq', 'worker'), ('gateway', 'mooyu-qq', 'napcat')]:
            current = u.discover(project, service)
            if current['Image'] != state['manifest']['images'][name]['id']:
                fail('QQ_SWITCHED_IMAGE_MISMATCH')
            if name == 'gateway' and not any(m.get('Destination') == '/data' and m.get('Type') == 'volume' and m.get('Name') == state['clone_volume'] for m in current['Mounts']):
                fail('QQ_SWITCHED_LOGIN_VOLUME_MISMATCH')
            if name in ['api', 'worker', 'gateway'] and any(u.environment(current).get(key, 'false') != 'false' for key in FLAGS):
                fail('QQ_PAPER_MUST_REMAIN_DISABLED')
        ensure_history(u, pg, state['history']); verify_files(state)
        write(u, record / 'completed.json', {'targetCommit': TARGET, 'at': time.time(), 'paperEnabled': False})
        print('切换完成：原登录卷和配置保留，旧历史校验通过，论文关闭。请在网站后台确认 QQ 状态，需要时扫码。', flush=True)
    except BaseException:
        try:
            rollback(u, state, site_changed)
        except BaseException:
            print('自动回退未完全完成；备份和原卷保留，请提供本次步骤输出，勿重复执行。', flush=True)
        raise


def main():
    import fcntl
    if os.geteuid() != 0 or len(sys.argv) != 3 or sys.argv[1] not in ['plan', 'apply', 'rollback']:
        fail('QQ_USAGE_ROOT_PLAN_APPLY_ROLLBACK_PATH')
    os.umask(0o077)
    with open('/www/backup/gamehub/.unified-release.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if sys.argv[1] == 'plan':
            prepare(Path(sys.argv[2]).resolve())
        else:
            record = Path(sys.argv[2]).resolve()
            if record.parent != ROOT or not re.fullmatch(r'cutover-\d{8}T\d{6}Z-[a-f0-9]{6}', record.name):
                fail('QQ_RECORD_PATH_MISMATCH')
            state = json.loads((record / 'plan.private.json').read_text())
            if state['record'] != str(record):
                fail('QQ_RECORD_IDENTITY_MISMATCH')
            u, _ = load_helper(record)
            u.COMPOSE_ENV.update(state['compose_env'])
            if sys.argv[1] == 'apply':
                apply(u, state)
            else:
                rollback(u, state)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        message = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        print('切换工具已停止：' + message, flush=True)
        sys.exit(1)
