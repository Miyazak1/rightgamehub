const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');

const root=path.resolve(__dirname,'../..');
const moduleUrl=relative=>pathToFileURL(path.join(root,relative)).href;

test('research soak target rejects credentials, public plaintext HTTP and remote smoke mode',async()=>{
  const {normalizeResearchSoakTarget,validateResearchSoakState}=await import(moduleUrl('scripts/run-research-soak.mjs'));
  assert.equal(normalizeResearchSoakTarget('https://mooyu.fun/path'),'https://mooyu.fun');
  assert.equal(normalizeResearchSoakTarget('http://api:3090'),'http://api:3090');
  assert.equal(normalizeResearchSoakTarget('http://127.0.0.1:3090',{smoke:true}),'http://127.0.0.1:3090');
  assert.throws(()=>normalizeResearchSoakTarget('http://mooyu.fun'),/REQUIRES_HTTPS/u);
  assert.throws(()=>normalizeResearchSoakTarget('https://user:secret@mooyu.fun'),/TARGET_INVALID/u);
  assert.throws(()=>normalizeResearchSoakTarget('https://mooyu.fun',{smoke:true}),/SMOKE_REQUIRES_LOOPBACK/u);
  assert.throws(()=>validateResearchSoakState({schemaVersion:'research-soak-state-v1',runId:'run-1',environment:'test',targetOrigin:'http://metadata.internal',startedAt:'2026-10-21T00:00:00.000Z',expectedEndAt:'2026-10-21T00:00:01.000Z',durationMs:1000,intervalMs:100,smoke:true}),/TARGET_REQUIRES_HTTPS/u);
});

test('research soak sample keeps only bounded operational fields',async()=>{
  const {sampleResearchReadiness}=await import(moduleUrl('scripts/run-research-soak.mjs'));
  let request;
  const sample=await sampleResearchReadiness({
    targetOrigin:'https://mooyu.fun',clock:()=>new Date('2026-10-21T00:00:00.000Z'),
    fetchImpl:async(url,options)=>{request={url,options};return new Response(JSON.stringify({data:{status:'ready',database:true,migrations:{ready:true,applied:102,expected:102},realtime:true,researchScheduler:{healthy:true,status:'online',intervalMs:60000,lastTickCompletedAt:'2026-10-20T23:59:30.000Z',workerId:'must-not-leak',privateBody:'must-not-leak'}}}),{status:200,headers:{'content-type':'application/json'}});},
  });
  assert.equal(request.url,'https://mooyu.fun/ready');
  assert.equal(request.options.redirect,'error');
  assert.equal(sample.healthy,true);
  assert.equal(sample.researchScheduler.status,'online');
  assert.equal('workerId' in sample.researchScheduler,false);
  assert.equal(JSON.stringify(sample).includes('must-not-leak'),false);
});

test('research soak evaluator requires duration, coverage, readiness and scheduler advancement without claiming production readiness',async()=>{
  const {evaluateResearchSoak}=await import(moduleUrl('scripts/run-research-soak.mjs'));
  const hour=3600000,start=Date.parse('2026-10-01T00:00:00.000Z'),samples=[];
  for(let index=0;index<14*24;index+=1)samples.push({healthy:index!==100,researchScheduler:{intervalMs:hour,lastTickCompletedAt:new Date(start+index*hour).toISOString()}});
  const state={runId:'acceptance-1',environment:'staging',targetOrigin:'https://staging.example',startedAt:new Date(start).toISOString(),durationMs:14*24*hour,intervalMs:hour,smoke:false};
  const report=evaluateResearchSoak({state,samples,endedAt:new Date(start+14*24*hour).toISOString()});
  assert.equal(report.observationGatePassed,true);
  assert.equal(report.qualification,'14-day-readiness-soak-evidence');
  assert.equal(report.productionReady,false);
  assert.match(report.excluded.join(' '),/billing reconciliation/u);
  const short=evaluateResearchSoak({state:{...state,durationMs:13*24*hour},samples:samples.slice(0,13*24),endedAt:new Date(start+13*24*hour).toISOString()});
  assert.equal(short.observationGatePassed,false);
  assert.equal(short.productionReady,false);
});

test('research soak smoke run journals resumable samples and writes a bounded report',async t=>{
  const {runResearchSoakCli}=await import(moduleUrl('scripts/run-research-soak.mjs'));
  const output=await fs.mkdtemp(path.join(os.tmpdir(),'gamehub-research-soak-'));
  t.after(()=>fs.rm(output,{recursive:true,force:true}));
  let now=Date.parse('2026-10-21T00:00:00.000Z'),tick=0;
  const fetchImpl=async()=>{tick+=1;return new Response(JSON.stringify({data:{status:'ready',database:true,migrations:{ready:true,applied:102,expected:102},realtime:true,researchScheduler:{healthy:true,status:'online',intervalMs:100,lastTickCompletedAt:new Date(now).toISOString()}}}),{status:200});};
  const result=await runResearchSoakCli(['--smoke','--target','http://127.0.0.1:3090','--environment','local-test','--duration-seconds','1','--interval-ms','100','--output',output],{fetchImpl,clock:()=>new Date(now),wait:async delay=>{now+=delay;}});
  assert.equal(result.report.smokePassed,true);
  assert.equal(result.report.observationGatePassed,false);
  assert.equal(result.report.productionReady,false);
  assert.equal(result.report.actualSamples,10);
  const state=JSON.parse(await fs.readFile(path.join(result.runDirectory,'state.json'),'utf8'));
  const journal=(await fs.readFile(path.join(result.runDirectory,'samples.jsonl'),'utf8')).trim().split(/\r?\n/u);
  assert.equal(state.schemaVersion,'research-soak-state-v1');
  assert.equal(journal.length,10);
  assert.equal(tick,10);
});
