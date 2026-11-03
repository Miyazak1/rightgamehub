// Disposable local databases only. No .env, production URL, model or deployment.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const suffix=randomUUID().replaceAll('-',''),label='mooyu.paper-study.test',password=randomBytes(32).toString('hex');
const names={postgres:'paper-pg-'+suffix,redis:'paper-redis-'+suffix},started=[];
const directory=path.join(root,'.runtime/paper-study/persistence-'+suffix);await fs.mkdir(directory,{recursive:true});
const env={...process.env,POSTGRES_PASSWORD:password};
if(env.DOCKER_HOST&&!/^(?:unix:|npipe:)/.test(env.DOCKER_HOST))throw Error('PAPER_TEST_LOCAL_DOCKER_REQUIRED');
const docker=args=>{const r=spawnSync('docker',args,{encoding:'utf8',env,windowsHide:true});if(r.status!==0)throw Error('PAPER_TEST_DOCKER_'+args[0]);return r.stdout.trim();};
let code=1;const report={passed:false,directory,productionConnected:false,modelCalls:0,published:false,deployed:false};
try{
  if(!/^(?:npipe:|unix:)/.test(docker(['context','inspect','--format','{{.Endpoints.docker.Host}}'])))throw Error('PAPER_TEST_LOCAL_DOCKER_REQUIRED');
  for(const image of ['postgres:17','redis:7.4-alpine'])docker(['image','inspect',image]);
  docker(['run','--detach','--rm','--name',names.postgres,'--label',label+'='+suffix,'--memory','512m','--tmpfs','/var/lib/postgresql/data:rw','--publish','127.0.0.1::5432','--env','POSTGRES_PASSWORD','--env','POSTGRES_USER=qa_ledger_test','--env','POSTGRES_DB=qa_ledger_test_'+suffix,'postgres:17']);started.push(names.postgres);
  docker(['run','--detach','--rm','--name',names.redis,'--label',label+'='+suffix,'--memory','64m','--tmpfs','/data:rw','--publish','127.0.0.1::6379','redis:7.4-alpine','redis-server','--save','','--appendonly','no']);started.push(names.redis);
  const port=(name,internal)=>{const p=docker(['port',name,internal+'/tcp']).match(/^127\.0\.0\.1:(\d+)$/)?.[1];if(!p)throw Error('PAPER_TEST_LOOPBACK_REQUIRED');return p;};
  const pgUrl=new URL('postgresql://127.0.0.1:'+port(names.postgres,5432)+'/qa_ledger_test_'+suffix);pgUrl.username='qa_ledger_test';pgUrl.password=password;
  const testEnv={...process.env,DATABASE_URL:'',DEEPSEEK_API_KEY:'',DEEPSEEK_MODEL:'',GAMEHUB_TEST_DATABASE_URL:'',QA_LEDGER_TEST_ISOLATED:'1',QA_LEDGER_TEST_URL:pgUrl.href,
    PAPER_STUDY_TEST_REDIS_URL:'redis://127.0.0.1:'+port(names.redis,6379),PAPER_STUDY_TEST_REDIS_CONTAINER:names.redis,PAPER_STUDY_TEST_LABEL:suffix,PAPER_STUDY_TEST_RESULT:path.join(directory,'checks.json')};
  for(let i=0;i<60;i++){const p=spawnSync('docker',['exec',names.postgres,'pg_isready','-U','qa_ledger_test'],{encoding:'utf8',env,windowsHide:true});if(p.status===0)break;if(i===59)throw Error('PAPER_TEST_POSTGRES_NOT_READY');await new Promise(r=>setTimeout(r,250));}
  const output=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--test','--test-concurrency=1','tests/platform/paper-study-persistence-db.test.cjs'],{cwd:root,env:testEnv,windowsHide:true,stdio:['ignore','pipe','pipe']});let text='';
    const timeout=setTimeout(()=>{child.kill();reject(Error('PAPER_TEST_TIMEOUT'));},240000);
    child.stdout.on('data',b=>text+=b);child.stderr.on('data',b=>text+=b);child.once('error',reject);child.once('exit',c=>{clearTimeout(timeout);code=c??1;resolve(text);});
  });
  await fs.writeFile(path.join(directory,'tests.log'),output);console.log(output);
  report.passed=code===0;report.tests=Number(/# tests (\d+)/.exec(output)?.[1]);report.failed=Number(/# fail (\d+)/.exec(output)?.[1]);
}catch(e){report.error=e.message;console.error(e.message);}
finally{
  report.cleaned=true;
  for(const name of started.reverse())try{const info=JSON.parse(docker(['inspect',name]))[0];if(info.Name!=='/'+name||info.Config.Labels[label]!==suffix||info.Mounts.some(m=>m.Type!=='tmpfs'))throw Error('PAPER_TEST_CLEANUP_IDENTITY');docker(['rm','--force',name]);}catch{report.cleaned=false;report.passed=false;}
  await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));await fs.writeFile(path.join(root,'.runtime/paper-study/persistence-latest.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
if(!report.passed)process.exitCode=1;
