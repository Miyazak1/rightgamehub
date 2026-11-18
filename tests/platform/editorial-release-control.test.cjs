const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync,spawnSync}=require('node:child_process');
const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'/bin/bash';
test('editorial release bootstraps through healthy API before worker inspection and can finish without redeploy',
 {skip:!fs.existsSync(bash),timeout:120000},t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mooyu-editorial-control-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const source=fs.readFileSync(path.resolve(__dirname,'../../deploy/update-blog-editorial-continuity.sh'),'utf8');
 for(const scenario of ['normal','finish','ready','bootstrap-failure','source-mismatch','business-change']){
  const base=path.join(root,scenario),repo=path.join(base,'repo'),records=path.join(base,'records'),audit=path.join(records,'update-editorial-fixture'),bin=path.join(base,'bin');
  for(const dir of [repo,audit,bin,path.join(repo,'deploy'),path.join(repo,'apps/api/src')])fs.mkdirSync(dir,{recursive:true});
  const clean=value=>{const normalized=value.replaceAll('\\','/');return process.platform==='win32'
    ?normalized.replace(/^([A-Za-z]):/,(_,drive)=>'/'+drive.toLowerCase()):normalized;};
  const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true}).trim();
  git('init','--initial-branch=production');git('config','user.name','Fixture');git('config','user.email','fixture@example.test');git('config','core.autocrlf','false');
  fs.writeFileSync(path.join(repo,'.gitignore'),'deploy/.env.prod\n');
  const files=['agent-blog-foundation-generation.mjs','agent-blog-candidate-discovery.mjs','agent-editorial-memory-repository.mjs',
   'agent-blog-private-canary-manual-run.mjs','agent-blog-public-runtime-manual-run.mjs','agent-blog-public-schedule.mjs',
   'agent-runtime-repository.mjs','agent-blog-public-request-repository.mjs','agent-blog-public-runtime.mjs','agent-blog-foundation-workflows.mjs'];
  for(const file of files)fs.writeFileSync(path.join(repo,'apps/api/src',file),'// reviewed '+file+'\n');
  fs.writeFileSync(path.join(repo,'deploy/resume-blog-public.sh'),'#!/bin/bash\ntest -f "$BOOTSTRAPPED"\necho resumed\n');
  fs.writeFileSync(path.join(repo,'deploy/prepare-unified-release.sh'),'#!/bin/bash\nset -e\nprintf prepared >> "$PREPARED"\ngit merge --ff-only "$1"\n');
  git('add','.');git('commit','-m','active business');const previous=git('rev-parse','HEAD');
  const script=source.replaceAll('/www/backup/gamehub',clean(records)).replaceAll('/www/gamehub',clean(repo));
  fs.writeFileSync(path.join(repo,'deploy/update-blog-editorial-continuity.sh'),script);
  if(scenario==='business-change')fs.appendFileSync(path.join(repo,'apps/api/src',files[0]),'// new business\n');
  git('add','.');git('commit','-m','host recovery fix');const target=git('rev-parse','HEAD');
  git('update-ref','refs/remotes/origin/codex/release-practice-no-paper',target);
  fs.writeFileSync(path.join(audit,'run.sh'),script);git('checkout','--detach',previous);
  fs.writeFileSync(path.join(repo,'deploy/.env.prod'),'PRIVATE_FIXTURE=preserve-this-secret\n');
  const archive=path.join(base,'bundle.tar.gz');if(!['finish','business-change'].includes(scenario))fs.writeFileSync(archive,'fixture archive');
  fs.writeFileSync(path.join(bin,'flock'),'#!/bin/bash\nexit 0\n',{mode:0o755});
  fs.writeFileSync(path.join(bin,'docker'),`#!/bin/bash
echo "$*" >> "$TRACE"
case "$*" in
 'ps -q '*service=api) echo cid-api;;
 'ps -q '*service=agent-blog-public-scheduler) echo cid-scheduler;;
 'ps -aq '*service=api) echo cid-api;;
 'ps -aq '*service=agent-blog-public-scheduler) echo cid-scheduler;;
 *'State.Restarting'*) if [ "$SCENARIO" = ready ];then echo false;else echo true;fi;;
 'restart cid-scheduler') test -f "$BOOTSTRAPPED" || exit 9;echo cid-scheduler;;
 'exec cid-api node /app/apps/api/src/agent-blog-public-runtime-bootstrap-cli.mjs')
   [ "$SCENARIO" != bootstrap-failure ] || exit 7;touch "$BOOTSTRAPPED";echo bootstrapped;;
 'exec cid-scheduler '*) test -f "$BOOTSTRAPPED" || { echo 'WORKFLOWS_NOT_READY' >&2;exit 9; };;
esac
case "$*" in
 *' sha256sum '*) if [ "$SCENARIO" = source-mismatch ];then echo bad;else file="\${*: -1}";sha256sum "$FIXTURE_REPO/\${file#/app/}";fi;;
 *'PLATFORM_ASSISTANT_ENABLED'*) echo true;;
esac
exit 0
`,{mode:0o755});
  const trace=path.join(base,'trace'),prepared=path.join(base,'prepared');
  const result=spawnSync(bash,[clean(path.join(audit,'run.sh')),target,clean(archive)],{cwd:repo,encoding:'utf8',timeout:45000,windowsHide:true,
   env:{...process.env,PATH:bin+path.delimiter+process.env.PATH,SCENARIO:scenario,TRACE:clean(trace),PREPARED:clean(prepared),
    FIXTURE_REPO:clean(repo),BOOTSTRAPPED:clean(path.join(base,'bootstrapped')),RESUME_BLOG_SCHEDULE:'true',
    MOOYU_RELEASE_FINISH_ONLY:['finish','business-change'].includes(scenario)?'true':'false'}});
  const output=result.stdout+result.stderr,commands=fs.existsSync(trace)?fs.readFileSync(trace,'utf8'):'';
  const success=['normal','finish','ready'].includes(scenario);
  assert.equal(result.status===0,success,scenario+'\n'+output);
  assert.equal(fs.readFileSync(path.join(repo,'deploy/.env.prod'),'utf8'),'PRIVATE_FIXTURE=preserve-this-secret\n');
  assert.doesNotMatch(output,/preserve-this-secret/);
  if(success){
   const bootstrap=commands.indexOf('exec cid-api node /app/apps/api/src/agent-blog-public-runtime-bootstrap-cli.mjs');
   assert.ok(bootstrap>=0);assert.ok(bootstrap<commands.indexOf('exec cid-scheduler'));
   assert.match(output,/resumed/);assert.equal(fs.readFileSync(path.join(audit,'exit-code'),'utf8').trim(),'0');
   if(scenario==='ready')assert.doesNotMatch(commands,/restart /);
   if(scenario==='finish'){assert.equal(fs.existsSync(prepared),false);assert.doesNotMatch(commands,/build |pg_dump|pg_restore|migrate|up -d/);}
  }else{
   assert.doesNotMatch(commands,/restart |exec cid-scheduler/);
   if(scenario==='business-change'){assert.equal(git('rev-parse','HEAD'),previous);assert.doesNotMatch(commands,/bootstrap-cli|restart |sha256sum/);}
   if(scenario==='bootstrap-failure')assert.equal(fs.readFileSync(path.join(audit,'phase'),'utf8').trim(),'bootstrap');
  }
 }
});
