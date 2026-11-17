const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync,spawnSync}=require('node:child_process');
const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'/bin/bash';
test('practice release preserves production changes, stops before failed migration, and restores compatible images on activation failure',{skip:!fs.existsSync(bash)},t=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'mooyu-practice-release-'));
 t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const source=path.resolve(__dirname,'../..');
 for(const failure of ['none','dirty','ancestry','build','backup','migrate','restart','image-mismatch','source-mismatch','snapshot','snapshot-failure','resume']){
  const root=path.join(base,failure),repo=path.join(root,'repo'),bin=path.join(root,'bin'),records=path.join(root,'records');
  fs.mkdirSync(path.join(repo,'deploy'),{recursive:true});fs.mkdirSync(bin,{recursive:true});fs.mkdirSync(path.join(repo,'apps/api/migrations'),{recursive:true});
  const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true}).trim();
  git('init','--initial-branch=production');git('config','user.name','Release fixture');git('config','user.email','fixture@example.test');git('config','core.autocrlf','false');
  fs.writeFileSync(path.join(repo,'.gitignore'),'deploy/.env.prod\n');fs.writeFileSync(path.join(repo,'deploy/compose.prod.yml'),'# previous compose\n');
  fs.writeFileSync(path.join(repo,'apps/api/migrations/0001_fixture.sql'),'-- previous schema\n');
  git('add','.');git('commit','-m','production');const previous=git('rev-parse','HEAD');
  const clean=p=>p.replaceAll('\\','/');
  for(const name of ['prepare-practice-release.sh','update-practice-release.sh','pin-running-image.sh']){
   const s=fs.readFileSync(path.join(source,'deploy',name),'utf8').replaceAll('/www/gamehub',clean(repo)).replaceAll('/www/backup/gamehub',clean(records));
   fs.writeFileSync(path.join(repo,'deploy',name),s);
  }
  fs.mkdirSync(path.join(repo,'apps/api/src'),{recursive:true});
  for(const name of ['agent-provider-request.mjs','agent-provider-gateway.mjs','agent-runtime-repository.mjs','agent-blog-prompt.mjs','agent-blog-public-admission.mjs','agent-runtime-worker.mjs'])fs.writeFileSync(path.join(repo,'apps/api/src',name),'// source fixture '+name+'\n');
  fs.writeFileSync(path.join(repo,'deploy/compose.prod.yml'),'# release compose\n');
  fs.writeFileSync(path.join(repo,'apps/api/migrations/0002_fixture.sql'),'-- additive schema\n');
  git('add','.');git('commit','-m','release');const release=git('rev-parse','HEAD');
  const launcher=path.join(root,'prepare.sh');fs.copyFileSync(path.join(repo,'deploy/prepare-practice-release.sh'),launcher);
  git('checkout','--detach',previous);fs.writeFileSync(path.join(repo,'deploy/.env.prod'),'POSTGRES_PASSWORD=fixture-secret\n');
  if(failure==='dirty')fs.appendFileSync(path.join(repo,'deploy/compose.prod.yml'),'# local change\n');
  if(failure==='ancestry'){fs.writeFileSync(path.join(repo,'online-only.txt'),'keep me');git('add','.');git('commit','-m','production-only');}
  fs.writeFileSync(path.join(bin,'docker'),`#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$TRACE"
case "$*" in
 *'Config.Image'*) if [ "$FAIL_STAGE" = image-mismatch ]; then echo old-image;else target="\${*: -1}";service="\${target#cid-}";awk -v service="$service" '$0=="  "service":" {getline;print $2}' "$MOOYU_RELEASE_RECORD/release-images.yml";fi;;
 *'exec -T api sha256sum '*) if [ "$FAIL_STAGE" = source-mismatch ]; then echo 000000;else target="\${*: -1}";sha256sum "$FIXTURE_REPO/\${target#/app/}";fi;;
 *'config --format json'*) printf '%s\\n' '{"services":{"api":{"build":{}},"web":{"build":{}},"migrate":{"build":{}}}}';;
 'exec -i cid-api node -e '*) shift 3; "$@";exit $?;;
 *'ps --status running --services'*) printf 'api\\nweb\\n';;
 *'ps --status running --quiet '*) printf 'cid-%s\\n' "\${*: -1}";;
 'image inspect '*) case "$FAIL_STAGE" in snapshot|snapshot-failure) exit 1;; esac;;
 *'"Env"'*'println (index'*) printf 'PATH\\nFIXTURE_SECRET\\n';;
 *'"Env"'*) printf 'PATH=/usr/local/bin:/usr/bin:/bin\\n';;
 *'"Entrypoint"'*) printf '["node"]\\n';;
 *'"Cmd"'*) printf '["fixture.mjs"]\\n';;
 *'"User"'*) echo node;;
 *'"WorkingDir"'*) echo /app;;
 *'"ExposedPorts"'*) echo 3090/tcp;;
 *'"Volumes"'*) echo /data;;
 'inspect '*) echo sha256:fixture;;
 'export '*) printf filesystem-fixture;;
 'import '*) cat >/dev/null; [ "$FAIL_STAGE" != snapshot-failure ] || exit 7;;
 'exec cid-api test -d '*) exit 0;;
 'exec cid-web test -d '*) exit 1;;
 *' build --build-arg '*) [ "$FAIL_STAGE" != build ] || exit 7;;
 *' pg_dump '*) [ "$FAIL_STAGE" != backup ] || exit 7; echo fixture-dump;;
 *' pg_restore '*) cat >/dev/null;;
 *'run --rm --no-deps migrate'*) [ "$FAIL_STAGE" != migrate ] || exit 7;;
 *'up -d --no-build --no-deps --wait '*) if [ "$FAIL_STAGE" = restart ] && [ ! -f "$ONCE" ]; then touch "$ONCE"; exit 7; fi;;
 *'exec -T api node '*) cat >/dev/null;;
 *'SELECT count(*) FROM schema_migrations'*) echo 158;;
esac
exit 0
`,{mode:0o755});
  const trace=path.join(root,'trace'),once=path.join(root,'once');
  const environment={...process.env,PATH:bin+path.delimiter+process.env.PATH,TRACE:clean(trace),ONCE:clean(once),FIXTURE_REPO:clean(repo),FAIL_STAGE:failure==='resume'?'build':failure};
  let result=spawnSync(bash,[clean(launcher),release],{cwd:repo,encoding:'utf8',windowsHide:true,timeout:60000,env:environment});
  if(failure==='resume'){
   assert.equal(result.status,7,result.stdout+result.stderr);
   const firstRecord=path.join(records,fs.readdirSync(records)[0]);
   fs.writeFileSync(path.join(repo,'fixed.txt'),'release recovery fix');git('add','.');git('commit','-m','recovery fix');const fixed=git('rev-parse','HEAD');
   // Return to the failed source version, as on the real server before retry.
   git('checkout','--detach',release);
   fs.writeFileSync(path.join(repo,'deploy/.env.prod'),'POSTGRES_PASSWORD=fixture-secret-changed-during-work\n');
   result=spawnSync(bash,[clean(launcher),fixed,'--resume'],{cwd:repo,encoding:'utf8',windowsHide:true,timeout:60000,env:{...environment,FAIL_STAGE:'none'}});
   assert.equal(fs.readdirSync(records).length,1,'retry must reuse the original production record');
   assert.equal(fs.readFileSync(path.join(firstRecord,'env.before'),'utf8'),'POSTGRES_PASSWORD=fixture-secret\n','retry must not overwrite the original environment backup');
   assert.equal(git('rev-parse','HEAD'),fixed);
  }
  const output=result.stdout+result.stderr,log=fs.existsSync(trace)?fs.readFileSync(trace,'utf8'):'';
  assert.equal(result.status,['none','snapshot','resume'].includes(failure)?0:['dirty','ancestry','image-mismatch','source-mismatch'].includes(failure)?1:7,output);
  assert.doesNotMatch(output,/fixture-secret/);
  assert.doesNotMatch(log,/down|--remove-orphans|volume rm|image prune/);
  if(['dirty','ancestry'].includes(failure)){assert.equal(log,'');assert.notEqual(git('rev-parse','HEAD'),release);continue;}
  const record=path.join(records,fs.readdirSync(records)[0]);
  assert.equal(fs.readFileSync(path.join(record,'compose.before.yml'),'utf8'),'# previous compose\n');
  assert.equal(fs.readFileSync(path.join(record,'previous-commit.txt'),'utf8').trim(),previous);
  if(failure==='snapshot-failure'){assert.doesNotMatch(log,/build --tag|run --rm|up -d/);continue;}
  assert.match(log,/build --tag mooyu-release-rollback/);
  if(failure==='snapshot'){
   assert.match(log,/export cid-api/);
   assert.match(log,/import --change ENV PATH=/);
   assert.doesNotMatch(log,/ENV FIXTURE_SECRET=/);
   assert.match(log,/--change ENTRYPOINT \["node"\]/);
   assert.match(log,/--change VOLUME \["\/data"\]/);
  }else assert.match(log,/image tag sha256:fixture mooyu-release-original/);
  assert.match(log,/MOOYU_WEB_RUNTIME_IMAGE=mooyu-release-original/);
  const migration=log.indexOf('run --rm --no-deps migrate'),activation=log.indexOf('up -d --no-build --no-deps --wait ');
  if(['build','backup'].includes(failure))assert.equal(migration,-1);
  if(failure==='migrate')assert.equal(activation,-1);
  if(failure==='none'||failure==='restart'){assert.ok(log.indexOf('pg_dump')<migration);assert.ok(migration<activation);}
  if(['restart','image-mismatch','source-mismatch'].includes(failure)){assert.match(output,/restoring previous images/);assert.match(log,/-f rollback-images.yml/);}
  if(failure==='image-mismatch')assert.match(output,/Unexpected release image/);
  if(failure==='source-mismatch')assert.match(output,/Running source mismatch/);
 }
});
