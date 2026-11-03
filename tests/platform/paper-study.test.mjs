import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createPaperStudyMemoryRepository, createPaperStudyService } from '../../apps/api/src/paper-study-service.mjs';
import { createPaperStudyReplayProcessor } from '../desktop/paper-study-replay.mjs';
import { createPaperStudyApiFixture } from '../desktop/paper-study-api-fixture.mjs';
import { createApiClient } from '../../packages/platform-api-client/src/index.mjs';
import { createDesktopAccountSession } from '../../apps/desktop/src/account-session.mjs';
import { createDesktopBusinessApi } from '../../apps/desktop/renderer/business-api.mjs';
import { createMemoryCredentialVault } from '../../apps/capability-executor/src/credential-vault.mjs';
import { businessArguments, businessRequestLimit } from '../../apps/desktop/src/business-contract.mjs';
import { createPaperStudyModelProcessor, createPaperStudyPublicSourceResolver } from '../../apps/api/src/paper-study-model-processor.mjs';

const actor = { userId: 'owner' }, stranger = { userId: 'stranger' };
const sourceSha256 = 'bdfaa68d8984f0dc02beaca527b76f207d99b666d31d1da728ee0728182df697';
const input = { title: 'Test paper', filename: 'paper.pdf', pdfBase64: Buffer.from('%PDF-local-test').toString('base64'), rightsConfirmed: true };
async function setup({ corrupt = false, blocked = false, drift = false } = {}) {
  const processor = await createPaperStudyReplayProcessor(), recorded = await processor.analyze({ sourceSha256 });
  const repository = createPaperStudyMemoryRepository(); let analyses = 0, compositions = 0;
  const service = createPaperStudyService({ repository, extract: async () => ({ pageCount: 15, pages: Array.from({length:15},(_,i)=>({page:i+1,blocks:[{text:'Test original prose'}]})), qualityAssessment:{permittedUses:blocked?[]:['analysis']} }),
    processor: { async analyze(source) { analyses++; return { ...recorded, sourceSha256: drift ? sourceSha256 : source.sourceSha256 }; },
      async compose(pack) { compositions++; const c = await processor.compose(pack); if(corrupt)c.content.blocks[2].text='伪造的研究结论'; return c; }, verify: processor.verify } });
  const wait = async id => { await repository.get(id).job; return service.read(actor,id); };
  return { service, repository, wait, get analyses(){return analyses;},get compositions(){return compositions;} };
}
test('private import, source, evidence and validated draft form a deduplicated owner-scoped workflow', async () => {
  const h=await setup(), imported=h.service.import(actor,input),id=imported.id;
  assert.equal(h.service.import(actor,input).id,id);assert.equal((await h.wait(id)).status,'imported');
  assert.deepEqual(h.service.source(actor,id),{pdfBase64:input.pdfBase64});
  assert.throws(()=>h.service.read(stranger,id),e=>e.status===404);assert.throws(()=>h.service.source(stranger,id),e=>e.status===404);
  assert.deepEqual(h.service.list(stranger),[]);assert.throws(()=>h.service.list(null),e=>e.status===401);
  assert.throws(()=>h.service.draft(actor,id),{code:'PAPER_STUDY_ANALYSIS_REQUIRED'});
  h.service.analyze(actor,id);h.service.analyze(actor,id);const analyzed=await h.wait(id);assert.equal(h.analyses,1);assert.equal(analyzed.status,'analyzed');
  h.service.draft(actor,id);h.service.draft(actor,id);const ready=await h.wait(id);assert.equal(h.compositions,1);assert.equal(ready.status,'draft-ready');
  assert.equal(ready.draft.private,true);assert.equal(ready.draft.publicationState,'draft');assert.equal(ready.draft.publicPublicationEnabled,false);
  assert.equal(ready.draft.manualReviewRequired,true);assert.ok(ready.draft.paragraphEvidenceBindings.length);assert.deepEqual(ready.draft.readingScope,ready.analysis.readingScope);
  assert.equal(h.service.draft(actor,id).draft.id,ready.draft.id);assert.equal(h.compositions,1);
});
test('quality rejection, mismatched source and fabricated draft stop before saving results',async()=>{
  for(const option of [{blocked:true},{drift:true},{corrupt:true}]){
    const h=await setup(option),id=h.service.import(actor,input).id;await h.wait(id);
    if(option.blocked){assert.throws(()=>h.service.analyze(actor,id),{code:'PAPER_STUDY_QUALITY_BLOCKED'});assert.equal(h.analyses,0);continue;}
    h.service.analyze(actor,id);const analyzed=await h.wait(id);
    if(option.drift){assert.equal(analyzed.status,'failed');assert.equal(analyzed.analysis,null);continue;}
    h.service.draft(actor,id);const result=await h.wait(id);assert.equal(result.status,'failed');assert.equal(result.draft,null);assert.ok(result.analysis);
  }
});
test('import requires PDF signature, canonical bounded base64 and explicit rights; bridge exposes fixed operations only',async()=>{
  const h=await setup();for(const change of [{rightsConfirmed:false},{pdfBase64:'!bad'},{pdfBase64:Buffer.from('HTML').toString('base64')},{publish:true}])assert.throws(()=>h.service.import(actor,{...input,...change}));
  assert.throws(()=>businessArguments('importPaperStudy',[{...input,headers:{authorization:'x'}}]));
  assert.throws(()=>businessArguments('publishPaperStudy',['id']));assert.equal(businessRequestLimit({method:'getPaperStudy'}),32768);assert.ok(businessRequestLimit({method:'importPaperStudy'})>32768);
});
test('HTTP and desktop transports require login and reject production/admin passthrough; isolated replay rejects unknown PDFs',async t=>{
  const backend=await createPaperStudyApiFixture();t.after(()=>backend.close());
  assert.equal((await fetch(backend.origin+'/v1/me/paper-studies')).status,401);
  const session=await createDesktopAccountSession({apiOrigin:backend.origin,vault:createMemoryCredentialVault()});
  const api=createDesktopBusinessApi({async call(method,args){try{return{ok:true,value:await session.call(method,args)};}catch(e){return{ok:false,error:{code:e.code,status:e.status,message:e.message}};}}},backend.origin);
  await assert.rejects(api.listPaperStudies(),e=>e.status===401);
  const challenge=await session.call('createChallenge',[{email:'paper@example.test'}]);await session.call('verifyChallenge',[{challengeId:challenge.data.challengeId,code:backend.code()}]);
  assert.deepEqual((await api.listPaperStudies()).data,[]);
  await assert.rejects(session.call('business',[{method:'getAdminAgentPaperAnalysis',args:['other','id']}])) ;
  const imported=(await api.importPaperStudy(input)).data;await backend.repository.get(imported.id).job;
  assert.equal((await api.getPaperStudySource(imported.id)).data.pdfBase64,input.pdfBase64);
  assert.equal((await api.getPaperStudy(imported.id)).data.status,'failed'); // malformed synthetic PDF, never mocked as analysis
  await session.call('logout',[]);await assert.rejects(api.getPaperStudy(imported.id),e=>e.status===401);
});

test('real model adapter refuses unproven public access and unverified analysis cannot unlock draft generation',async()=>{
  let calls=0;
  const processor=createPaperStudyModelProcessor({modelId:'isolated-test',resolvePublicSource:async()=>({sourceSha256,externalProcessingClass:'user-uploaded'}),providerGateway:{invoke(){calls++;throw Error('must not invoke');}}});
  await assert.rejects(processor.analyze({sourceSha256,parsed:{}}),{code:'PAPER_STUDY_EXTERNAL_PROCESSING_FORBIDDEN'});assert.equal(calls,0);
  await assert.rejects(processor.compose({analysisId:'unverified'}),{code:'PAPER_STUDY_ANALYSIS_DRIFT'});
  await assert.rejects(processor.verify({}, {analysisId:'unverified'}),{code:'PAPER_STUDY_COMPOSITION_DRIFT'});
});
test('public-source resolver verifies the fetched PDF hash and rejects locator/URL injection before model use',async()=>{
  let fetched=0;
  const resolver=createPaperStudyPublicSourceResolver({readArxiv:async({request})=>{fetched++;assert.equal(request.paper,'https://arxiv.org/abs/1706.03762v7');return{output:{identity:{title:'Verified source'},version:{contentSha256:sourceSha256,sourceUrl:'https://arxiv.org/pdf/1706.03762v7'}}};}});
  await assert.rejects(resolver(sourceSha256,''),{code:'PAPER_STUDY_PUBLIC_SOURCE_REQUIRED'});
  await assert.rejects(resolver(sourceSha256,'https://127.0.0.1/private'));
  assert.equal(fetched,0);
  await assert.rejects(resolver('0'.repeat(64),'1706.03762v7'),{code:'PAPER_STUDY_PUBLIC_SOURCE_HASH_MISMATCH'});
  assert.equal((await resolver(sourceSha256,'1706.03762v7')).externalProcessingClass,'public-arxiv-open-fulltext');
});
