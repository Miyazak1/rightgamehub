const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {spawnSync}=require('node:child_process');
const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'/bin/bash';
test('local-only deployment disables cloud jobs, serializes builds, backs up before migration and stops on failure',async t=>{
  try{await fs.access(bash);}catch{t.skip('Bash unavailable');return;}
  const source=await fs.readFile(path.join(__dirname,'../../deploy/update-local-saves.sh'),'utf8');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'gamehub-local-deploy-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  for(const failure of ['none','build','pg_dump','pg_restore','migrate']){
    const work=path.join(root,failure);await fs.mkdir(path.join(work,'deploy'),{recursive:true});await fs.mkdir(path.join(work,'bin'));
    await fs.writeFile(path.join(work,'deploy/update-local-saves.sh'),source);
    await fs.writeFile(path.join(work,'deploy/.env.prod'),'CLOUD_SAVE_ENABLED=true\nCOMPOSE_PROFILES=save-operations\nPOSTGRES_PASSWORD=test-secret\n');
    await fs.writeFile(path.join(work,'bin/docker'),[
      '#!/bin/sh',
      'printf "%s" "$*" | tr "\\n" " " >> "$TRACE"',
      'printf "|cloud=%s|profiles=%s\\n" "$CLOUD_SAVE_ENABLED" "$COMPOSE_PROFILES" >> "$TRACE"',
      'case "$*" in',
      '  *" build") stage=build;;',
      '  *" pg_dump "*) stage=pg_dump;;',
      '  *" pg_restore "*) stage=pg_restore;;',
      '  *" run --rm --no-deps migrate") stage=migrate;;',
      '  *) stage=other;;',
      'esac',
      '[ "$FAIL_STAGE" != "$stage" ] || exit 7',
      '[ "$stage" != pg_dump ] || printf "backup-data"',
      '[ "$stage" != pg_restore ] || cat >/dev/null',
      'exit 0','',
    ].join('\n'),{mode:0o755});
    const trace=path.join(work,'trace.txt'),backup=path.join(work,'backups');
    const result=spawnSync(bash,['deploy/update-local-saves.sh'],{cwd:work,encoding:'utf8',timeout:30000,env:{...process.env,
      PATH:path.join(work,'bin')+path.delimiter+process.env.PATH,
      TRACE:trace.replaceAll('\\','/'),BACKUP_ROOT:backup.replaceAll('\\','/'),FAIL_STAGE:failure,CLOUD_SAVE_ENABLED:'true',COMPOSE_PROFILES:'save-operations',
    }});
    assert.equal(result.status,failure==='none'?0:7,result.stderr);
    const log=await fs.readFile(trace,'utf8'),lines=log.trim().split('\n');
    assert.ok(lines.every(line=>line.startsWith('compose --parallel 1 ')&&line.endsWith('|cloud=false|profiles=')),log);
    assert.doesNotMatch(log,/down|--volumes|save-operations up/);
    assert.doesNotMatch(result.stdout+result.stderr,/test-secret/);
    assert.match(await fs.readFile(path.join(work,'deploy/.env.prod'),'utf8'),/CLOUD_SAVE_ENABLED=false/);
    assert.match(log,/stop -t 60 save-maintenance save-storage-probe/);
    if(failure==='none'){
      assert.ok(log.indexOf('pg_dump')<log.indexOf('run --rm --no-deps migrate'));
      assert.ok(log.indexOf('pg_restore')<log.indexOf(' up -d '));
      assert.equal((await fs.readdir(backup)).filter(name=>name.endsWith('.dump')).length,1);
      assert.match(log,/ up -d --no-build --wait /);
    }else{
      assert.doesNotMatch(log,/ up -d /);
      if(failure!=='migrate')assert.doesNotMatch(log,/run --rm --no-deps migrate/);
    }
  }
});
