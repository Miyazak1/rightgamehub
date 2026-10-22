import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';

const DAY_MS=86400000;
const cleanCode=value=>String(value||'REQUEST_FAILED').toUpperCase().replace(/[^A-Z0-9_-]/gu,'_').slice(0,80)||'REQUEST_FAILED';
const finiteInteger=(value,name,{min,max})=>{const parsed=Number(value);if(!Number.isInteger(parsed)||parsed<min||parsed>max)throw new Error(`${name}_INVALID`);return parsed;};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export function normalizeResearchSoakTarget(value,{smoke=false}={}){
  let target;
  try{target=new URL(value);}catch{throw new Error('RESEARCH_SOAK_TARGET_INVALID');}
  if(target.username||target.password||target.search||target.hash)throw new Error('RESEARCH_SOAK_TARGET_INVALID');
  const loopback=['127.0.0.1','localhost','::1','[::1]'].includes(target.hostname),composeService=target.hostname==='api';
  if(target.protocol!=='https:'&&!(target.protocol==='http:'&&(loopback||composeService)))throw new Error('RESEARCH_SOAK_TARGET_REQUIRES_HTTPS');
  if(smoke&&!loopback)throw new Error('RESEARCH_SOAK_SMOKE_REQUIRES_LOOPBACK');
  target.pathname='/';
  return target.origin;
}

const schedulerSnapshot=value=>value&&typeof value==='object'?{
  healthy:value.healthy===true,
  status:String(value.status||'unknown').slice(0,40),
  intervalMs:Number.isFinite(Number(value.intervalMs))?Number(value.intervalMs):null,
  lastTickStartedAt:value.lastTickStartedAt||null,
  lastTickCompletedAt:value.lastTickCompletedAt||null,
  consecutiveErrors:Number.isFinite(Number(value.consecutiveErrors))?Number(value.consecutiveErrors):null,
  lastErrorCode:value.lastErrorCode?cleanCode(value.lastErrorCode):null,
}:null;

export function validateResearchSoakState(value){
  if(!value||value.schemaVersion!=='research-soak-state-v1')throw new Error('RESEARCH_SOAK_STATE_INVALID');
  const smoke=value.smoke===true,targetOrigin=normalizeResearchSoakTarget(value.targetOrigin,{smoke}),durationMs=finiteInteger(value.durationMs,'RESEARCH_SOAK_STATE_DURATION',{min:smoke?1000:3600000,max:smoke?60000:744*3600000}),intervalMs=finiteInteger(value.intervalMs,'RESEARCH_SOAK_STATE_INTERVAL',{min:smoke?100:10000,max:smoke?10000:3600000}),startedMs=new Date(value.startedAt).getTime(),endMs=new Date(value.expectedEndAt).getTime();
  if(!Number.isFinite(startedMs)||!Number.isFinite(endMs)||endMs-startedMs!==durationMs||intervalMs>durationMs)throw new Error('RESEARCH_SOAK_STATE_INVALID');
  const environment=String(value.environment||'').trim().slice(0,80),runId=String(value.runId||'').trim();
  if(!environment||!runId||!/^[A-Za-z0-9_-]{1,120}$/u.test(runId))throw new Error('RESEARCH_SOAK_STATE_INVALID');
  return{...value,runId,environment,targetOrigin,durationMs,intervalMs,smoke};
}

export async function sampleResearchReadiness({targetOrigin,fetchImpl=fetch,timeoutMs=5000,clock=()=>new Date(),monotonicNow=()=>performance.now()}={}){
  const at=clock().toISOString(),started=monotonicNow(),controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetchImpl(`${targetOrigin}/ready`,{headers:{accept:'application/json'},redirect:'error',signal:controller.signal});
    const declaredLength=Number(response.headers?.get?.('content-length')||0);
    if(declaredLength>65536)throw Object.assign(new Error('readiness response too large'),{code:'RESPONSE_TOO_LARGE'});
    const text=await response.text();
    if(Buffer.byteLength(text,'utf8')>65536)throw Object.assign(new Error('readiness response too large'),{code:'RESPONSE_TOO_LARGE'});
    let payload=null;
    try{payload=JSON.parse(text);}catch{throw Object.assign(new Error('invalid readiness JSON'),{code:'RESPONSE_INVALID_JSON'});}
    const data=payload?.data??{},scheduler=schedulerSnapshot(data.researchScheduler);
    const healthy=response.ok&&data.status==='ready'&&data.database===true&&data.migrations?.ready===true&&(scheduler===null||scheduler.healthy===true);
    return{at,latencyMs:Math.max(0,Math.round((monotonicNow()-started)*100)/100),healthy,httpStatus:response.status,platformStatus:String(data.status||'unknown').slice(0,40),database:data.database===true,migrations:{ready:data.migrations?.ready===true,applied:Number.isFinite(Number(data.migrations?.applied))?Number(data.migrations.applied):null,expected:Number.isFinite(Number(data.migrations?.expected))?Number(data.migrations.expected):null,reason:data.migrations?.reason?cleanCode(data.migrations.reason):null},realtime:data.realtime!==false,researchScheduler:scheduler,errorCode:null};
  }catch(error){
    return{at,latencyMs:Math.max(0,Math.round((monotonicNow()-started)*100)/100),healthy:false,httpStatus:null,platformStatus:'unreachable',database:false,migrations:{ready:false,applied:null,expected:null,reason:null},realtime:false,researchScheduler:null,errorCode:cleanCode(error?.code||error?.name)};
  }finally{clearTimeout(timeout);}
}

const maxConsecutiveFailures=samples=>{let current=0,maximum=0;for(const sample of samples){if(sample.healthy)current=0;else{current+=1;maximum=Math.max(maximum,current);}}return maximum;};
const schedulerAdvanceCount=samples=>{let previous=null,count=0;for(const sample of samples){const value=sample.researchScheduler?.lastTickCompletedAt;if(value&&value!==previous){count+=1;previous=value;}}return count;};

export function evaluateResearchSoak({state,samples,endedAt=new Date().toISOString()}={}){
  const startedMs=new Date(state.startedAt).getTime(),endedMs=new Date(endedAt).getTime(),observedDurationMs=Math.max(0,endedMs-startedMs),targetDurationMs=Number(state.durationMs),intervalMs=Number(state.intervalMs),plannedSamples=Math.ceil(targetDurationMs/intervalMs),healthySamples=samples.filter(sample=>sample.healthy).length,coverageRatio=plannedSamples?Math.min(1,samples.length/plannedSamples):0,healthyRatio=samples.length?healthySamples/samples.length:0,consecutiveFailures=maxConsecutiveFailures(samples),schedulerAdvances=schedulerAdvanceCount(samples),schedulerIntervalMs=samples.find(sample=>Number(sample.researchScheduler?.intervalMs)>0)?.researchScheduler.intervalMs??60000,expectedSchedulerAdvances=Math.max(1,Math.floor(Math.min(observedDurationMs,targetDurationMs)/Math.max(intervalMs,schedulerIntervalMs))),longDuration=targetDurationMs>=14*DAY_MS;
  const checks=[
    {name:'monitor reached configured duration',ok:observedDurationMs>=targetDurationMs},
    {name:'sample coverage is at least 99%',ok:coverageRatio>=0.99},
    {name:'healthy readiness samples are at least 99.5%',ok:healthyRatio>=0.995},
    {name:'no more than three consecutive readiness failures',ok:consecutiveFailures<=3},
    {name:'scheduler completion timestamp kept advancing',ok:schedulerAdvances>=Math.max(1,Math.floor(expectedSchedulerAdvances*0.9))},
    {name:'duration qualifies as a 14-day soak',ok:longDuration&&observedDurationMs>=14*DAY_MS},
  ];
  const smokeChecks=checks.slice(1,5);
  return{schemaVersion:'research-soak-report-v1',runId:state.runId,environment:state.environment,targetOrigin:state.targetOrigin,startedAt:state.startedAt,endedAt,targetDurationMs,observedDurationMs,intervalMs,plannedSamples,actualSamples:samples.length,healthySamples,unhealthySamples:samples.length-healthySamples,coverageRatio,healthyRatio,maxConsecutiveFailures:consecutiveFailures,schedulerAdvances,expectedSchedulerAdvances,checks,smokePassed:smokeChecks.every(check=>check.ok)&&samples.length>0,observationGatePassed:checks.every(check=>check.ok),productionReady:false,qualification:checks.every(check=>check.ok)?'14-day-readiness-soak-evidence':state.smoke?'smoke-only':'incomplete-soak',coverage:['API readiness','database and migration readiness','local research scheduler loop progress'],excluded:['ten-topic research outcome audit','provider billing reconciliation','Search/Fetch/Researcher correctness','notification delivery','backup/restore','account isolation','production capacity','full product production readiness']};
}

const parseArguments=argv=>{const values=new Map(),flags=new Set();for(let index=0;index<argv.length;index+=1){const token=argv[index];if(token==='--smoke'){flags.add(token);continue;}if(!token.startsWith('--')||index+1>=argv.length)throw new Error('RESEARCH_SOAK_ARGUMENT_INVALID');values.set(token,argv[++index]);}return{values,flags};};
const readSamples=async file=>{try{const stat=await fs.stat(file);if(stat.size>32*1024*1024)throw new Error('RESEARCH_SOAK_JOURNAL_TOO_LARGE');const lines=(await fs.readFile(file,'utf8')).split(/\r?\n/u).filter(Boolean);if(lines.length>100000||lines.some(line=>Buffer.byteLength(line,'utf8')>65536))throw new Error('RESEARCH_SOAK_JOURNAL_INVALID');return lines.map(line=>JSON.parse(line));}catch(error){if(error?.code==='ENOENT')return[];throw error;}};

export async function runResearchSoakCli(argv=process.argv.slice(2),{fetchImpl=fetch,clock=()=>new Date(),wait=sleep,onStart=()=>{}}={}){
  const {values,flags}=parseArguments(argv),smoke=flags.has('--smoke'),resume=values.get('--resume');
  let runDirectory,state;
  if(resume){
    if(values.size!==1||smoke)throw new Error('RESEARCH_SOAK_RESUME_ARGUMENTS_INVALID');
    runDirectory=path.resolve(resume);
    state=validateResearchSoakState(JSON.parse(await fs.readFile(path.join(runDirectory,'state.json'),'utf8')));
  }else{
    const targetOrigin=normalizeResearchSoakTarget(values.get('--target'),{smoke}),environment=String(values.get('--environment')||'unspecified').trim().slice(0,80);
    if(!environment||environment==='unspecified')throw new Error('RESEARCH_SOAK_ENVIRONMENT_REQUIRED');
    const durationMs=smoke?finiteInteger(values.get('--duration-seconds')??3,'RESEARCH_SOAK_DURATION_SECONDS',{min:1,max:60})*1000:finiteInteger(values.get('--duration-hours')??336,'RESEARCH_SOAK_DURATION_HOURS',{min:1,max:744})*3600000;
    const intervalMs=smoke?finiteInteger(values.get('--interval-ms')??500,'RESEARCH_SOAK_INTERVAL_MS',{min:100,max:10000}):finiteInteger(values.get('--interval-seconds')??60,'RESEARCH_SOAK_INTERVAL_SECONDS',{min:10,max:3600})*1000;
    const outputRoot=path.resolve(values.get('--output')||path.join(process.cwd(),'.runtime','research-soak')),startedAt=clock().toISOString(),runId=startedAt.replace(/[-:.TZ]/gu,'')+'_'+crypto.randomBytes(3).toString('hex');
    runDirectory=path.join(outputRoot,runId);
    await fs.mkdir(runDirectory,{recursive:true,mode:0o700});
    state=validateResearchSoakState({schemaVersion:'research-soak-state-v1',runId,environment,targetOrigin,startedAt,expectedEndAt:new Date(new Date(startedAt).getTime()+durationMs).toISOString(),durationMs,intervalMs,smoke});
    await fs.writeFile(path.join(runDirectory,'state.json'),JSON.stringify(state,null,2)+'\n',{encoding:'utf8',mode:0o600,flag:'wx'});
  }
  onStart({runDirectory,state});
  const sampleFile=path.join(runDirectory,'samples.jsonl'),samples=await readSamples(sampleFile),endMs=new Date(state.expectedEndAt).getTime();
  while(clock().getTime()<endMs){
    const sample=await sampleResearchReadiness({targetOrigin:state.targetOrigin,fetchImpl,clock});
    samples.push(sample);
    await fs.appendFile(sampleFile,JSON.stringify(sample)+'\n',{encoding:'utf8',mode:0o600});
    const remaining=endMs-clock().getTime();
    if(remaining>0)await wait(Math.min(state.intervalMs,remaining));
  }
  const endedAt=clock().toISOString(),report=evaluateResearchSoak({state,samples,endedAt});
  await fs.writeFile(path.join(runDirectory,'report.json'),JSON.stringify(report,null,2)+'\n',{encoding:'utf8',mode:0o600});
  return{runDirectory,report};
}

const invokedAsScript=process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url;
if(invokedAsScript){
  try{const {runDirectory,report}=await runResearchSoakCli(process.argv.slice(2),{onStart:({runDirectory:directory,state})=>process.stdout.write(`${JSON.stringify({event:'research-soak-started',runDirectory:directory,expectedEndAt:state.expectedEndAt,environment:state.environment,productionReady:false})}\n`)});process.stdout.write(`${JSON.stringify({event:'research-soak-finished',runDirectory,qualification:report.qualification,smokePassed:report.smokePassed,observationGatePassed:report.observationGatePassed,productionReady:false})}\n`);process.exitCode=(report.smokePassed&&(report.observationGatePassed||report.qualification==='smoke-only'))?0:1;}
  catch(error){process.stderr.write(`${JSON.stringify({error:cleanCode(error?.code||error?.message||error?.name)})}\n`);process.exitCode=1;}
}
