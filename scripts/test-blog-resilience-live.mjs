// Explicit isolated real-provider acceptance. Supply only a local model env path.
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
const pg=createRequire(new URL('../apps/api/package.json',import.meta.url))('pg');
if(!process.argv[2])throw Error('LOCAL_MODEL_ENV_PATH_REQUIRED');
const id=randomUUID().replaceAll('-',''),name='blog-recovery-test-'+id,database='qa_ledger_test_'+id;
const env={...process.env,POSTGRES_PASSWORD:randomBytes(32).toString('hex')};
const docker=args=>{
  const result=spawnSync('docker',args,{env,encoding:'utf8',windowsHide:true});
  if(result.status!==0)throw Error('ISOLATED_DOCKER_'+args[0]);return result.stdout.trim();
};
let started=false;
try{
  docker(['run','--detach','--rm','--name',name,'--label','blog.recovery.test='+id,
    '--memory','512m','--tmpfs','/var/lib/postgresql/data:rw','--publish','127.0.0.1::5432',
    '--env','POSTGRES_PASSWORD','--env','POSTGRES_USER=qa_ledger_test','--env','POSTGRES_DB='+database,'postgres:17']);started=true;
  const port=docker(['port',name,'5432/tcp']).match(/^127\.0\.0\.1:(\d+)$/)?.[1];
  if(!port)throw Error('ISOLATED_PORT_REQUIRED');
  const url=new URL('postgresql://127.0.0.1:'+port+'/'+database);url.username='qa_ledger_test';url.password=env.POSTGRES_PASSWORD;
  let ready=false;
  for(let attempt=0;attempt<120;attempt++){
    const client=new pg.Client({connectionString:url.href,connectionTimeoutMillis:1000});
    try{await client.connect();await client.query('SELECT 1');ready=true;break;}catch{}
    finally{await client.end().catch(()=>{});}await new Promise(resolve=>setTimeout(resolve,250));
  }
  if(!ready)throw Error('ISOLATED_DATABASE_NOT_READY');
  if(process.argv[2]==='--db-matrix'){
    const directory=await fs.mkdtemp(path.resolve('.runtime/public-resilience-db-'));
    const control=new pg.Client({connectionString:url.href});await control.connect();
    const available=(await fs.readdir('tests/platform')).filter(name=>/^agent.*-db\.test\.cjs$/u.test(name));
    available.push('practice-release-migrate.test.mjs');
    const requested=process.argv.slice(3);
    if(requested.some(file=>!available.includes(file)))throw Error('ISOLATED_TEST_FILE_INVALID');
    const files=requested.length?requested:available;
    const results=[];
    try{
      for(const file of files){
        const db='qa_ledger_test_'+randomUUID().replaceAll('-','');
        await control.query('CREATE DATABASE '+db+' OWNER qa_ledger_test');
        const testUrl=new URL(url);testUrl.pathname='/'+db;
        const migrationUrl=new URL(url);migrationUrl.pathname='/postgres';
        const handle=await fs.open(path.join(directory,file+'.log'),'w');
        let code;
        try{
          code=await new Promise((resolve,reject)=>{
            const child=spawn(process.execPath,['--test','tests/platform/'+file],{windowsHide:true,
              stdio:['ignore',handle.fd,handle.fd],timeout:300000,env:{...process.env,DATABASE_URL:'',GAMEHUB_TEST_DATABASE_URL:'',
                QA_LEDGER_TEST_URL:testUrl.href,QA_LEDGER_TEST_ISOLATED:'1',MOOYU_RELEASE_TEST_DATABASE_URL:migrationUrl.href}});
            child.once('error',reject);child.once('exit',code=>resolve(code??1));
          });
        }finally{await handle.close();await control.query('DROP DATABASE '+db+' WITH (FORCE)');}
        results.push({file,exitCode:code});
        await fs.writeFile(path.join(directory,'results.json'),JSON.stringify(results,null,2));
        console.log(JSON.stringify(results.at(-1)));
      }
    }finally{await control.end();}
    console.log(JSON.stringify({directory,files:results.length,passed:results.every(row=>row.exitCode===0)}));
    process.exitCode=results.some(row=>row.exitCode!==0)?1:0;
  }else{
  console.log('Isolated PostgreSQL ready; real-model recovery acceptance starting.');
  const code=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['scripts/verify-blog-public-live.cjs','--run',process.argv[2],'--git-credential','--resilience'],
      {windowsHide:true,stdio:'inherit',env:{...process.env,DATABASE_URL:'',QA_LEDGER_TEST_URL:url.href,QA_LEDGER_TEST_ISOLATED:'1'}});
    child.once('error',reject);child.once('exit',code=>resolve(code??1));
  });
  process.exitCode=code;
  }
}finally{
  if(started){
    const info=JSON.parse(docker(['inspect',name]))[0];
    if(info.Name!=='/'+name||info.Config.Labels['blog.recovery.test']!==id||info.Mounts.some(mount=>mount.Type!=='tmpfs'))throw Error('ISOLATED_CLEANUP_IDENTITY');
    docker(['rm','--force',name]);console.log('Isolated PostgreSQL removed; production untouched.');
  }
}
