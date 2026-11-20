// Explicit local acceptance. Reads existing credentials without printing them.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),{Pool}=createRequire(path.join(root,'apps/api/package.json'))('pg');
function docker(args,options={}){const r=cp.spawnSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:30000,...options});if(r.status!==0)throw Object.assign(Error('LAB_DOCKER_FAILED'),{code:'LAB_DOCKER_FAILED'});return r.stdout.trim();}
function parse(file){return Object.fromEntries(fs.readFileSync(file,'utf8').split(/\r?\n/).filter(l=>l.includes('=')).map(l=>{const at=l.indexOf('=');return [l.slice(0,at),l.slice(at+1).replace(/^"(.*)"$/,'$1')];}));}
async function main(){
 if(process.argv[2]!=='--prepare')throw Error('EXPLICIT_PREPARE_REQUIRED');
 const suffix=crypto.randomUUID().replaceAll('-',''),id=new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14)+'-'+suffix.slice(0,6),name='mooyu-agent-lab-'+id;
 const privateRoot=path.join(root,'../../private-deployments/agent-interactions',id),evidence=path.join('E:/CodexData/build/Right/qq-github-tools/live',id);
 fs.mkdirSync(privateRoot,{recursive:true});fs.mkdirSync(evidence,{recursive:true});
 const oldBase=path.resolve(root,'../../private-deployments/qq-login-repro/20261120063447-adf4d8'),old=JSON.parse(fs.readFileSync(path.join(oldBase,'business-stack.json'))),login=JSON.parse(fs.readFileSync(path.join(oldBase,'session.json'))),oldEnv=parse(path.join(oldBase,'business-worker.env'));
 const gateway=JSON.parse(docker(['inspect',old.gateway]))[0];if(!gateway.State.Running||gateway.Config.Labels['mooyu.qq-login-lab']!==old.id)throw Error('INDEPENDENT_GATEWAY_REQUIRED');
 let githubToken=null;const credentials=cp.spawnSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',windowsHide:true,timeout:15000,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'}});
 if(credentials.status===0)githubToken=credentials.stdout.split(/\r?\n/).find(v=>v.startsWith('password='))?.slice(9)??null;
 if(!oldEnv.DEEPSEEK_API_KEY||!githubToken)throw Error('EXISTING_LOCAL_CREDENTIALS_REQUIRED');
 const password=crypto.randomBytes(24).toString('hex'),database='qa_ledger_test_'+suffix,volume=name+'-database',network=name;
 docker(['network','create','--label','mooyu.agent-lab='+id,network]);docker(['volume','create','--label','mooyu.agent-lab='+id,volume]);
 docker(['run','-d','--name',name+'-db','--label','mooyu.agent-lab='+id,'--network',network,'--network-alias','qq-postgres','--publish','127.0.0.1::5432','--env','POSTGRES_PASSWORD','--env','POSTGRES_USER=qa_ledger_test','--env','POSTGRES_DB='+database,'--memory','512m','--mount',`type=volume,source=${volume},target=/var/lib/postgresql/data`,'postgres:17'],{env:{...process.env,POSTGRES_PASSWORD:password}});
 const port=docker(['port',name+'-db','5432/tcp']).match(/127\.0\.0\.1:(\d+)/)[1],url=new URL('postgresql://127.0.0.1:'+port+'/'+database);url.username='qa_ledger_test';url.password=password;
 const session={schemaVersion:'agent-interaction-lab-v1',id,name,network,volume,databaseUrl:url.href,qqDatabase:'mooyu_qq_local_interaction_'+suffix.slice(0,12),masterKey:crypto.randomBytes(32).toString('hex'),sharedSecret:crypto.randomBytes(32).toString('hex'),browserToken:crypto.randomBytes(32).toString('hex'),modelKey:oldEnv.DEEPSEEK_API_KEY,modelId:oldEnv.DEEPSEEK_MODEL??'deepseek-flash',githubToken,oldBase,oldStack:old,gatewayToken:login.token,gatewayOrigin:login.origin,accessToken:oldEnv.QQ_ACCESS_TOKEN,privateRoot,evidence,paperEnabled:false,providerCallLimit:20,costMicrousdLimit:1000000};
 const file=path.join(privateRoot,'session.private.json');fs.writeFileSync(file,JSON.stringify(session,null,2),{flag:'wx',mode:0o600});
 let ready=false;for(let i=0;i<40;i++){const pool=new Pool({connectionString:url.href,connectionTimeoutMillis:1000});try{await pool.query('SELECT 1');ready=true;break;}catch{}finally{await pool.end();}await new Promise(r=>setTimeout(r,250));}if(!ready)throw Error('LAB_DATABASE_NOT_READY');
 fs.writeFileSync(path.join(evidence,'setup.json'),JSON.stringify({id,name,network,volume,independentGateway:old.gateway,oldWorkerRetained:true,oldDatabaseRetained:true,paperEnabled:false,providerCallLimit:20,sessionFile:file},null,2));
 console.log(JSON.stringify({prepared:true,id,sessionFile:file,evidence,paperEnabled:false}));
}
main().catch(e=>{console.error(/^[A-Z_]+$/.test(e.message)?e.message:'LAB_PREPARE_FAILED');process.exitCode=1;});
