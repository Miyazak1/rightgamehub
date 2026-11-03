import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPaperStudyConfig } from '../../apps/api/src/paper-study-config.mjs';
import { createApp } from '../../apps/api/src/app.mjs';
import { AuthError } from '../../apps/api/src/auth-service.mjs';

const agent='c86fd3db-bb40-41ea-a0dd-aea75d02aa0a';
test('formal service and worker default closed; model and publication cannot be enabled by environment',()=>{
  const disabled=loadPaperStudyConfig({});assert.equal(disabled.enabled,false);assert.equal(disabled.workerEnabled,false);
  const enabled=loadPaperStudyConfig({PAPER_STUDY_ENABLED:'true',PAPER_STUDY_EXECUTION_AGENT_USER_ID:agent});
  assert.equal(enabled.modelsEnabled,false);assert.equal(enabled.publishingEnabled,false);
  assert.throws(()=>loadPaperStudyConfig({PAPER_STUDY_ENABLED:'true'}),/EXECUTION_AGENT_REQUIRED/);
  for(const env of [{PAPER_STUDY_MODELS_ENABLED:'true'},{PAPER_STUDY_PUBLISH_ENABLED:'true'},{PAPER_STUDY_ENABLED:'yes'}])assert.throws(()=>loadPaperStudyConfig(env));
});
test('disabled formal app has no paper routes and does not replace existing auth',async t=>{
  const app=createApp({config:{requestBodyLimit:65536,corsOrigins:[],nodeEnv:'test'}});t.after(()=>app.close());
  assert.equal((await app.inject('/v1/me/paper-studies')).statusCode,404);
});
test('formal routes authenticate before accepting uploads and keep model/publish authority server-side',async t=>{
  let imported=0;
  const service={list:async()=>[],import:async(actor,body)=>{imported++;assert.equal(actor.userId,'owner');return{id:'doc',status:'importing'};},
    read:async()=>{throw Object.assign(Error(),{code:'PAPER_STUDY_NOT_FOUND',statusCode:404});},
    analyze:async()=>{throw Object.assign(Error(),{code:'PAPER_STUDY_MODELS_DISABLED',statusCode:409});},draft:async()=>{throw Object.assign(Error(),{code:'PAPER_STUDY_MODELS_DISABLED',statusCode:409});}};
  const authService={async authenticateBearer(token){if(token!=='Bearer test')throw new AuthError('AUTH_REQUIRED',401,'Sign in.');return{userId:'owner'};}};
  const app=createApp({config:{requestBodyLimit:65536,corsOrigins:[],nodeEnv:'test'},authService,paperStudyService:service});t.after(()=>app.close());
  const large={pdfBase64:'x'.repeat(70000)};
  assert.equal((await app.inject({method:'POST',url:'/v1/me/paper-studies',payload:large})).statusCode,401);assert.equal(imported,0);
  const headers={authorization:'Bearer test'};
  assert.equal((await app.inject({method:'POST',url:'/v1/me/paper-studies',payload:large,headers})).statusCode,202);
  assert.equal(imported,1);
  assert.equal((await app.inject({method:'POST',url:'/v1/me/paper-studies/'+agent+'/analyze',payload:{},headers})).json().error.code,'PAPER_STUDY_MODELS_DISABLED');
  assert.equal((await app.inject({method:'POST',url:'/v1/me/paper-studies/'+agent+'/draft',payload:{publish:true},headers})).statusCode,400);
  assert.equal((await app.inject({method:'POST',url:'/v1/me/paper-studies/'+agent+'/publish',payload:{},headers})).statusCode,404);
  assert.equal((await app.inject({url:'/v1/me/paper-studies/'+agent,headers})).statusCode,404);
});
