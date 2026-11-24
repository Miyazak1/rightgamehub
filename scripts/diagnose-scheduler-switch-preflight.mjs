// Replays only the uploaded tool's preflight, with filesystem writes and all
// mutating Docker commands blocked. It never records/stops/starts a service.
import fs from 'node:fs';import crypto from 'node:crypto';
const file='/www/backup/gamehub/agent-scheduler-compat-20261123-r1/switch-scheduler-interaction-compat.mjs',original=fs.readFileSync(file,'utf8');
if(crypto.createHash('sha256').update(original).digest('hex')!=='18cbbdbf5fa741c1b96e45c4ca8ad099f845127e2e1713eede05fab244440939')throw Error('EXPECTED_UPLOADED_TOOL_REQUIRED');
console.log('ENTRY_STATE '+JSON.stringify({globalOperationLockPresent:fs.existsSync('/var/lock/mooyu-agent-plugin-cutover.lock'),uploadedToolHashMatches:true}));
let source=original;
function once(from,to){if(source.split(from).length!==2)throw Error('EXPECTED_DIAGNOSTIC_ANCHOR_REQUIRED');source=source.replace(from,to);}
once("  if(process.env.MOOYU_SCHEDULER_COMPAT_AUTH!=='20261123')fail('AUTHORIZED_LOCK_ENTRY_REQUIRED');fs.mkdirSync('/var/lock/mooyu-agent-plugin-cutover.lock',{mode:0o700});lock=true;","  trace('read-only-entry');");
once('await schedulerSwitchSequence({','await readonlyPreflightOnly({');
once("reader=new core.Cutover(deployed[0]+'/record');","reader=new core.Cutover(deployed[0]+'/record',{run:docker});");
once('function docker(args,options={}){','function docker(args,options={}){assertReadOnlyDocker(args);');
once('}catch(e){const result=', '}catch(e){reportPreflightError(e);const result=');
for(const [from,label]of [
 ['  const coreFile=','reader-module'],['  sourceRecords=[','old-locks'],['  const deployed=','deployment-record'],
 ['    idle();','idle-ledgers'],['papers();if(q(','paper-and-schema'],['before=inspect(SERVICE);','scheduler-container'],['    role=core.composeArgs(before);','compose-metadata'],
 ['     const proof=read(STAGE+','compat-proof'],['     const base=JSON.parse(','image-configuration'],
 ['protectedBefore=others(all());','protected-containers'],['domainBefore=reader.invariants();','business-invariants'],['historyBefore=history();','history-fingerprints'],['outboxBefore=outbox();','outbox-fingerprint'],['sourceBefore=oldFiles();','old-record-files'],['beforeWorker=json(','scheduler-heartbeat'],
]){const index=source.indexOf(from);if(index<0)throw Error('TRACE_ANCHOR_REQUIRED');source=source.slice(0,index)+"trace('"+label+"');"+source.slice(index);}
const helpers=String.raw`
let lastStep='entry';function trace(step){lastStep=step;console.log('PREFLIGHT_STEP '+step);}
async function readonlyPreflightOnly(a){await a.check();console.log('PREFLIGHT_CHECK_COMPLETED_NO_MUTATION');}
function assertReadOnlyDocker(args){
 if(args[0]==='inspect'||args[0]==='ps'&&args[1]==='-aq'||args[0]==='image'&&args[1]==='inspect')return;
 if(args[0]==='exec'&&args.includes('PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=8000 -c lock_timeout=1000')&&args.includes('psql')&&args.at(-2)==='-c'&&/^SELECT\b/.test(args.at(-1))&&!/;|\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO|VACUUM|ANALYZE|SET|RESET)\b/i.test(args.at(-1)))return;
 throw Error('READONLY_DOCKER_WRITE_REFUSED');
}
function reportPreflightError(e){const message=String(e.message??''),missing=/^([A-Za-z_$][\w$]*) is not defined$/.exec(message)?.[1],field=/reading '([A-Za-z_$][\w$]*)'/.exec(message)?.[1];const frames=String(e.stack??'').split('\n').slice(1,5).map(l=>({function:/^\s*at\s+([A-Za-z0-9_.$<>]+)/.exec(l)?.[1]??'embedded',location:/:(\d+):(\d+)\)?$/.exec(l)?.slice(1)??null}));console.log('PREFLIGHT_ERROR '+JSON.stringify({step:lastStep,type:e.name,nativeCode:/^[A-Z0-9_]+$/.test(e.code??'')?e.code:null,missingSymbol:missing??null,missingField:field??null,pathBasename:typeof e.path==='string'?e.path.split('/').at(-1):null,frames}));}
`;
// Block writes even if a future check accidentally attempts one.
for(const name of ['writeFileSync','mkdirSync','renameSync','copyFileSync','chmodSync','rmSync','rmdirSync','unlinkSync'])fs[name]=()=>{throw Error('READONLY_FILESYSTEM_WRITE_REFUSED');};
await import('data:text/javascript;base64,'+Buffer.from(helpers+'\n'+source+"\nawait switchScheduler('switch');\n").toString('base64'));
console.log('READONLY_END '+JSON.stringify({toolReplaced:false,servicesRestarted:false,locksChanged:false,databaseWritten:false,credentialsOrRawErrorPrinted:false}));
