const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{execFileSync,spawnSync}=require('node:child_process');
const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'/bin/bash';
test('unified deployment validates uploads before mutation, preserves Compose overlays and rolls back activation/HTTP failures',{skip:!fs.existsSync(bash),timeout:120000},t=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'mooyu-unified-deploy-')),source=path.resolve(__dirname,'../..');t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 for(const failure of ['none','locked','dirty','checksum','model','overlay','build','restart','activate','http','rolled-back','rolled-back-restart']){
  const root=path.join(base,failure),repo=path.join(root,'repo'),bin=path.join(root,'bin'),records=path.join(root,'records'),downloads=path.join(root,'downloads'),incoming=path.join(root,'bundle');for(const dir of [repo,bin,records,downloads,incoming,path.join(repo,'deploy'),path.join(repo,'apps/api/migrations'),path.join(repo,'config')])fs.mkdirSync(dir,{recursive:true});
  const clean=p=>{const value=p.replaceAll('\\','/');return process.platform==='win32'?'/'+value[0].toLowerCase()+value.slice(2):value;},git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
  git('init','--initial-branch=production');git('config','user.name','Release fixture');git('config','user.email','fixture@example.test');git('config','core.autocrlf','false');
  fs.writeFileSync(path.join(repo,'.gitignore'),'deploy/.env.prod\n');fs.writeFileSync(path.join(repo,'deploy/compose.prod.yml'),'# previous base\n');fs.writeFileSync(path.join(repo,'deploy/extra.yml'),'# preserve extra gateway configuration\n');fs.writeFileSync(path.join(repo,'apps/api/migrations/0001_test.sql'),'-- unchanged\n');git('add','.');git('commit','-m','production');const previous=git('rev-parse','HEAD');
  for(const name of ['prepare-unified-release.sh','prepare-practice-release.sh','update-practice-release.sh','pin-running-image.sh','unified-assets.mjs','compose.unified-downloads.yml']){let content=fs.readFileSync(path.join(source,'deploy',name),'utf8').replaceAll('/www/backup/gamehub',clean(records)).replaceAll('/www/gamehub-downloads',clean(downloads)).replaceAll('/www/gamehub',clean(repo));if(name==='prepare-unified-release.sh')content=content.replace('set -Eeuo pipefail','set -Eeuo pipefail\ncurl() { bash "$FIXTURE_BIN/curl" "$@"; }; export -f curl\nflock() { [ "$FAIL_STAGE" != locked ]; }; export -f flock');fs.writeFileSync(path.join(repo,'deploy',name),content);}
  for(const [dir,key]of [['agent','agent'],['desktop','desktop']]){fs.mkdirSync(path.join(downloads,dir));fs.writeFileSync(path.join(downloads,dir,'manifest.json'),JSON.stringify({[key]:'ready'})+'\n');}
  fs.writeFileSync(path.join(incoming,'bundle.json'),'{}');const archive=path.join(root,'release.tar.gz');execFileSync('tar',['-czf',archive,'-C',incoming,'.'],{windowsHide:true});const sum=crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  fs.writeFileSync(path.join(repo,'config/unified-release.json'),JSON.stringify({archiveSha256:sum},null,2)+'\n');fs.writeFileSync(path.join(repo,'deploy/compose.prod.yml'),'# release base\n');git('add','.');git('commit','-m','release');const release=git('rev-parse','HEAD'),launcher=path.join(root,'prepare.sh');fs.copyFileSync(path.join(repo,'deploy/prepare-unified-release.sh'),launcher);git('checkout','--detach',previous);fs.writeFileSync(path.join(repo,'deploy/.env.prod'),'PRIVATE_FIXTURE_VALUE=never-print-me\n');
  const rolledBack=failure.startsWith('rolled-back'),priorRecord=path.join(records,'previous');
  if(rolledBack){
   fs.mkdirSync(priorRecord);
   fs.writeFileSync(path.join(priorRecord,'compose-0.before.yml'),'# previous base\n');
   fs.writeFileSync(path.join(priorRecord,'compose-1.before.yml'),'# preserve extra gateway configuration\n');
   fs.writeFileSync(path.join(priorRecord,'rollback-images.yml'),'services:\n  api:\n    image: immutable-previous-rollback-api\n');
   fs.writeFileSync(path.join(priorRecord,'rollback.sh'),'# generated prior rollback\n');
   fs.writeFileSync(path.join(priorRecord,'release-commit.txt'),previous+'\n');
   fs.writeFileSync(path.join(priorRecord,'compose-files.rollback.txt'),'compose-0.before.yml\ncompose-1.before.yml\n');
  }
  if(failure==='dirty')fs.appendFileSync(path.join(repo,'deploy/compose.prod.yml'),'# local operator edit\n');if(failure==='checksum')fs.appendFileSync(archive,'tampered');
  const docker=`#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$TRACE"
case "$*" in
 'ps -q '*service=web*) echo cid-web;;
 'ps -q '*service=api*) echo cid-api;;
 *'project.config_files'*) if [ "$FAIL_STAGE" = overlay ]; then echo /missing/operator-overlay.yml; elif [[ "$FAIL_STAGE" = rolled-back* ]]; then printf '%s,%s,%s\\n' "$FIXTURE_PREVIOUS_RECORD/compose-0.before.yml" "$FIXTURE_PREVIOUS_RECORD/compose-1.before.yml" "$FIXTURE_PREVIOUS_RECORD/rollback-images.yml"; else printf '%s,%s\\n' "$FIXTURE_REPO/deploy/compose.prod.yml" "$FIXTURE_REPO/deploy/extra.yml"; fi;;
 *'.Mounts'*) :;;
 *'.NetworkSettings.Ports'*) echo 8443;;
 'image inspect '*) :;;
 'inspect '*) echo sha256:fixture;;
 'image tag '*) :;;
 'exec cid-api test -d '*) exit 0;;
 'exec cid-web test -d '*) exit 1;;
 'exec cid-web printenv APP_DOMAIN') echo example.test;;
 *'config --format json'*) if [ "$FAIL_STAGE" = model ];then printf '{"services":{"api":{"environment":{"DEEPSEEK_API_KEY":""}}}}';else printf '{"services":{"api":{"environment":{"DEEPSEEK_API_KEY":"fixture-key"}}}}';fi;;
 'exec -i cid-api node -e '*) shift 3; "$@";exit $?;;
 *'ps --status running --services'*) printf 'api\\nweb\\n';;
 *'ps --status running --quiet '*) printf 'cid-%s\\n' "\${*: -1}";;
 'run --rm --network none'*)
  action='';record='';previous=''
  for arg in "$@"; do if [ "$previous" = -v ] && [[ "$arg" = *:/work ]]; then record=\${arg%:/work}; fi; if [ "$previous" = /work/assets-tool.mjs ]; then action=$arg; fi; previous=$arg; done
  mkdir -p "$record/assets-record"
  if [ "$action" = activate ]; then touch "$record/assets-record/pointers-activation-started"; [ "$FAIL_STAGE" != activate ] || exit 7; fi;;
 *' build --build-arg '*) [ "$FAIL_STAGE" != build ] || exit 7;;
 *' pg_dump '*) echo fixture-dump;;
 *' pg_restore '*) cat >/dev/null;;
 *'up -d --no-build --no-deps --wait '*) if [[ "$FAIL_STAGE" = restart || "$FAIL_STAGE" = rolled-back-restart ]] && [ ! -f "$ONCE" ]; then touch "$ONCE";exit 7;fi;;
 *'exec -T api node '*) cat >/dev/null;;
esac
exit 0
`;fs.writeFileSync(path.join(bin,'docker'),docker,{mode:0o755});fs.writeFileSync(path.join(bin,'curl'),`#!/usr/bin/env bash
if [ "$FAIL_STAGE" = http ]; then echo wrong-content;elif [[ "\${*: -1}" = *'/desktop/manifest.json' ]];then printf '{"desktop":"ready"}\\n';else printf '{"agent":"ready"}\\n';fi
`,{mode:0o755});
  const trace=path.join(root,'trace'),result=spawnSync(bash,[clean(launcher),release,clean(archive)],{cwd:repo,encoding:'utf8',timeout:60000,windowsHide:true,env:{...process.env,PATH:bin+path.delimiter+process.env.PATH,TRACE:clean(trace),ONCE:clean(path.join(root,'once')),FIXTURE_REPO:clean(repo),FIXTURE_PREVIOUS_RECORD:clean(priorRecord),FIXTURE_BIN:clean(bin),FAIL_STAGE:failure,PLATFORM_ASSISTANT_ENABLED:['none','model'].includes(failure)?'true':'false'}}),output=result.stdout+result.stderr,log=fs.existsSync(trace)?fs.readFileSync(trace,'utf8'):'';
  assert.equal(result.status===0,['none','rolled-back'].includes(failure),failure+'\n'+output);assert.doesNotMatch(output,/never-print-me/);assert.doesNotMatch(log,/\bdown\b|--remove-orphans|volume rm|image prune/);
  if(['locked','dirty','checksum'].includes(failure)){assert.equal(log,'');assert.equal(git('rev-parse','HEAD'),previous);continue;}
  if(['overlay','model'].includes(failure)){assert.equal(git('rev-parse','HEAD'),previous);assert.doesNotMatch(log,/ build |up -d/);continue;}
  const record=path.join(records,fs.readdirSync(records).find(name=>name!=='previous'&&fs.statSync(path.join(records,name)).isDirectory()));assert.equal(fs.readFileSync(path.join(record,'compose-1.before.yml'),'utf8'),'# preserve extra gateway configuration\n');
  if(!rolledBack)assert.match(log,/-f .*extra\.yml -f .*compose\.unified-downloads\.yml/);assert.equal(fs.readFileSync(path.join(repo,'deploy/extra.yml'),'utf8'),'# preserve extra gateway configuration\n');
  if(['none','rolled-back'].includes(failure))assert.ok(fs.existsSync(path.join(record,'unified-release-complete')));
  if(['restart','activate','http','rolled-back-restart'].includes(failure)){assert.match(log,/compose-1\.before\.yml/);assert.match(log,/rollback-images\.yml/);}
  if(rolledBack){
   const targets=fs.readFileSync(path.join(record,'compose-files.target.txt'),'utf8');
   assert.equal(targets.split('\n')[0],clean(repo)+'/deploy/compose.prod.yml');
   assert.ok(targets.includes(clean(priorRecord)+'/compose-1.before.yml'),'retain active operator overlay');
   assert.ok(!targets.includes('rollback-images.yml'),'new builds must not overwrite previous rollback images');
   const builds=log.split('\n').filter(line=>line.includes(' build --build-arg '));
   assert.equal(builds.length,1);
   assert.ok(!builds[0].includes('rollback-images.yml'));
   assert.ok(builds[0].includes('--project-directory '+clean(repo)+'/deploy'));
   assert.equal(fs.readFileSync(path.join(priorRecord,'rollback-images.yml'),'utf8'),'services:\n  api:\n    image: immutable-previous-rollback-api\n');
   assert.equal(fs.readFileSync(path.join(record,'compose-2.before.yml'),'utf8'),fs.readFileSync(path.join(priorRecord,'rollback-images.yml'),'utf8'));
  }
  if(failure==='build')assert.doesNotMatch(log,/up -d/);
 }
});

test('real Compose keeps rollback snapshots relative to the production deploy directory', t=>{
 const probe=spawnSync('docker',['compose','version'],{encoding:'utf8',windowsHide:true});
 if(probe.status!==0){t.skip('Docker Compose CLI is unavailable');return;}
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mooyu-compose-paths-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const project=path.join(root,'production'),deploy=path.join(project,'deploy'),backup=path.join(root,'backups','previous');
 for(const directory of [deploy,backup,path.join(project,'rules')])fs.mkdirSync(directory,{recursive:true});
 const snapshot=path.join(backup,'compose-0.before.yml');
 fs.writeFileSync(snapshot,'services:\n  api:\n    build:\n      context: ..\n      dockerfile: deploy/Dockerfile.api\n    volumes:\n      - ../rules:/app/rules:ro\n');
 const read=args=>{
  const result=spawnSync('docker',['compose',...args,'-f',snapshot,'config','--format','json'],{encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,result.stderr);
  return JSON.parse(result.stdout).services.api;
 };
 const wrong=read([]),fixed=read(['--project-directory',deploy]);
 assert.equal(path.resolve(wrong.build.context),path.resolve(root,'backups'));
 assert.equal(path.resolve(fixed.build.context),path.resolve(project));
 assert.equal(path.resolve(fixed.volumes[0].source),path.resolve(project,'rules'));
 assert.equal(fixed.build.dockerfile,'deploy/Dockerfile.api');
});
