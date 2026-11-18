const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync,execFileSync}=require('node:child_process'),{randomUUID}=require('node:crypto');
const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'/bin/bash';
const helper=path.resolve(__dirname,'../../deploy/running-service.sh').replaceAll('\\','/');
const resolve=(env,project='fixture-project')=>spawnSync(bash,['-c','source "$1"; running_service_id api "$2"','fixture',helper,project],
  {encoding:'utf8',windowsHide:true,env,timeout:15000});

test('release container discovery rejects missing, ambiguous, one-off and stale identities', {skip:!fs.existsSync(bash)},t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mooyu-container-discovery-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(root,'docker'),`#!/usr/bin/env bash
case "$1" in
 ps)
  case "$CASE" in
   missing) :;; engine-error) echo 'Engine unavailable' >&2;exit 7;;
   duplicate) printf 'cid-one\\ncid-two\\n';;
   with-oneoff) printf 'cid-job\\ncid-one\\n';;
   oneoff) echo cid-job;; *) echo cid-one;;
  esac;;
 inspect)
  project=fixture-project;service=api;running=true;oneoff=False
  case "$CASE" in wrong-project) project=other-project;;wrong-service) service=worker;;stopped) running=false;;unknown-label) oneoff=unexpected;;missing-label) oneoff='<no value>';;esac
  [ "\${*: -1}" != cid-job ] || oneoff=True
  printf '%s %s %s %s\\n' "$running" "$project" "$service" "$oneoff";;
 *) echo 'Unexpected Docker command' >&2;exit 8;;
esac
`,{mode:0o755});
 for(const scenario of ['normal','missing-label','with-oneoff','missing','engine-error','duplicate','oneoff','wrong-project','wrong-service','stopped','unknown-label']){
  const result=resolve({...process.env,PATH:root+path.delimiter+process.env.PATH,CASE:scenario});
  const accepted=['normal','missing-label','with-oneoff'].includes(scenario);
  assert.equal(result.status===0,accepted,scenario+'\n'+result.stderr);
  assert.equal(result.stdout.trim(),accepted?'cid-one':'',scenario);
  if(scenario==='duplicate')assert.match(result.stderr,/found=2/);
  if(['missing','oneoff'].includes(scenario))assert.match(result.stderr,/found=0/);
 }
});

test('real Docker resolves rebuilt containers across image overlays and excludes live one-off jobs',
 {skip:process.env.MOOYU_REAL_DEPLOY_DISCOVERY_TEST!=='1',timeout:120000},t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mooyu-real-discovery-'));
 const project='mooyu-release-discovery-'+randomUUID().replaceAll('-','');
 const images=[project+':old',project+':new'];
 const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:40000}).trim();
 t.after(()=>{
  try{
   const ids=docker('ps','-aq','--filter','label=mooyu.test='+project).split(/\s+/).filter(Boolean);
   for(const id of ids){
    const info=JSON.parse(docker('inspect',id))[0];
    assert.equal(info.Config.Labels['mooyu.test'],project);
    assert.ok(info.Mounts.every(mount=>mount.Type==='tmpfs'));
    docker('rm','--force',id);
   }
   for(const image of images)spawnSync('docker',['image','rm',image],{windowsHide:true,stdio:'ignore'});
  }finally{fs.rmSync(root,{recursive:true,force:true});}
 });
 docker('image','inspect','redis:7-alpine');
 for(const image of images)docker('image','tag','redis:7-alpine',image);
 const base=path.join(root,'base.yml'),overlay=path.join(root,'overlay.yml');
 fs.writeFileSync(base,`services:\n  api:\n    image: ${images[0]}\n    network_mode: none\n    tmpfs: ["/data"]\n    labels:\n      mooyu.test: ${project}\n`);
 fs.writeFileSync(overlay,`services:\n  api:\n    image: ${images[1]}\n`);
 docker('compose','--project-name',project,'-f',base,'up','-d','--no-build','--wait','api');
 const original=resolve(process.env,project);assert.equal(original.status,0,original.stderr);
 docker('compose','--project-name',project,'-f',base,'-f',overlay,'up','-d','--no-build','--wait','api');
 const current=resolve(process.env,project);assert.equal(current.status,0,current.stderr);
 assert.notEqual(current.stdout.trim(),original.stdout.trim());
 assert.equal(docker('inspect','--format','{{.Config.Image}}',current.stdout.trim()),images[1]);
 const extraLabels=['--label','mooyu.test='+project,'--label','com.docker.compose.project='+project,'--label','com.docker.compose.service=api'];
 docker('run','--detach','--network','none','--tmpfs','/data',...extraLabels,'--label','com.docker.compose.oneoff=True',images[1]);
 const withJob=resolve(process.env,project);assert.equal(withJob.status,0,withJob.stderr);assert.equal(withJob.stdout.trim(),current.stdout.trim());
 const inventory=spawnSync(bash,['-c','source "$1"; running_project_services "$2"','fixture',helper,project],
  {encoding:'utf8',windowsHide:true,env:process.env,timeout:15000});
 assert.equal(inventory.status,0,inventory.stderr);assert.equal(inventory.stdout.trim(),'api');
 docker('run','--detach','--network','none','--tmpfs','/data',...extraLabels,'--label','com.docker.compose.oneoff=False',images[1]);
 const ambiguous=resolve(process.env,project);assert.notEqual(ambiguous.status,0);assert.match(ambiguous.stderr,/found=2/);
});
