const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync,spawnSync}=require('node:child_process');
const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'/bin/bash';
test('practice release preserves production changes, stops before failed migration, and restores compatible images on activation failure',{skip:!fs.existsSync(bash)},t=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'mooyu-practice-release-'));
 t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const source=path.resolve(__dirname,'../..');
 for(const failure of ['none','dirty','ancestry','build','backup','migrate','restart']){
  const root=path.join(base,failure),repo=path.join(root,'repo'),bin=path.join(root,'bin'),records=path.join(root,'records');
  fs.mkdirSync(path.join(repo,'deploy'),{recursive:true});fs.mkdirSync(bin,{recursive:true});fs.mkdirSync(path.join(repo,'apps/api/migrations'),{recursive:true});
  const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true}).trim();
  git('init','--initial-branch=production');git('config','user.name','Release fixture');git('config','user.email','fixture@example.test');git('config','core.autocrlf','false');
  fs.writeFileSync(path.join(repo,'.gitignore'),'deploy/.env.prod\n');fs.writeFileSync(path.join(repo,'deploy/compose.prod.yml'),'# previous compose\n');
  fs.writeFileSync(path.join(repo,'apps/api/migrations/0001_fixture.sql'),'-- previous schema\n');
  git('add','.');git('commit','-m','production');const previous=git('rev-parse','HEAD');
  const clean=p=>p.replaceAll('\\','/');
  for(const name of ['prepare-practice-release.sh','update-practice-release.sh']){
   const s=fs.readFileSync(path.join(source,'deploy',name),'utf8').replaceAll('/www/gamehub',clean(repo)).replace('/www/backup/gamehub',clean(records));
   fs.writeFileSync(path.join(repo,'deploy',name),s);
  }
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
 *'ps --status running --services'*) printf 'api\\nweb\\n';;
 *'ps --status running --quiet '*) printf 'cid-%s\\n' "\${*: -1}";;
 'inspect '*) echo sha256:fixture;;
 'exec cid-api test -d '*) exit 0;;
 'exec cid-web test -d '*) exit 1;;
 *' build --build-arg '*) [ "$FAIL_STAGE" != build ] || exit 7;;
 *' pg_dump '*) [ "$FAIL_STAGE" != backup ] || exit 7; echo fixture-dump;;
 *' pg_restore '*) cat >/dev/null;;
 *'run --rm --no-deps migrate'*) [ "$FAIL_STAGE" != migrate ] || exit 7;;
 *'up -d --no-build --no-deps --wait '*) if [ "$FAIL_STAGE" = restart ] && [ ! -f "$ONCE" ]; then touch "$ONCE"; exit 7; fi;;
 *'exec -T api node '*) cat >/dev/null;;
esac
exit 0
`,{mode:0o755});
  const trace=path.join(root,'trace'),once=path.join(root,'once');
  const result=spawnSync(bash,[clean(launcher),release],{cwd:repo,encoding:'utf8',windowsHide:true,timeout:60000,env:{...process.env,PATH:bin+path.delimiter+process.env.PATH,TRACE:clean(trace),ONCE:clean(once),FAIL_STAGE:failure}});
  const output=result.stdout+result.stderr,log=fs.existsSync(trace)?fs.readFileSync(trace,'utf8'):'';
  assert.equal(result.status,failure==='none'?0:failure==='dirty'||failure==='ancestry'?1:7,output);
  assert.doesNotMatch(output,/fixture-secret/);
  assert.doesNotMatch(log,/down|--remove-orphans|volume rm|image prune/);
  if(['dirty','ancestry'].includes(failure)){assert.equal(log,'');assert.notEqual(git('rev-parse','HEAD'),release);continue;}
  const record=path.join(records,fs.readdirSync(records)[0]);
  assert.equal(fs.readFileSync(path.join(record,'compose.before.yml'),'utf8'),'# previous compose\n');
  assert.equal(fs.readFileSync(path.join(record,'previous-commit.txt'),'utf8').trim(),previous);
  assert.match(log,/build --tag mooyu-release-rollback/);
  assert.match(log,/image tag sha256:fixture mooyu-release-original/);
  assert.match(log,/MOOYU_WEB_RUNTIME_IMAGE=mooyu-release-original/);
  const migration=log.indexOf('run --rm --no-deps migrate'),activation=log.indexOf('up -d --no-build --no-deps --wait ');
  if(['build','backup'].includes(failure))assert.equal(migration,-1);
  if(failure==='migrate')assert.equal(activation,-1);
  if(failure==='none'||failure==='restart'){assert.ok(log.indexOf('pg_dump')<migration);assert.ok(migration<activation);}
  if(failure==='restart'){assert.match(output,/restoring previous images/);assert.match(log,/-f rollback-images.yml/);}
 }
});
