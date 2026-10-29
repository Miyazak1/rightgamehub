const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('R1.7 frozen identity evaluation stays deterministic and never model-merges',async()=>{
  const mod=await import('../../apps/api/src/agent-paper-discovery-contracts.mjs');
  const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/paper-identity-resolution-eval-v1.json'),'utf8'));
  const candidate=mod.normalizeDiscoveryCandidate({sourceKind:'crossref',externalKey:'doi:10.1000/example',doi:'10.1000/example',
    title:'A Useful Paper',authors:['Ada Lovelace'],publicationYear:2026,venue:'Journal',metadata:{},provenance:{}});
  for(const item of fixture.cases){const result=mod.resolvePaperIdentity(candidate,item.evidence);assert.equal(result.decision,item.decision,item.name);}
  const possible=mod.resolvePaperIdentity(candidate,fixture.cases.find(item=>item.name==='title-author-only').evidence);
  assert.equal(mod.queueStateForResolution(possible),'blocked');assert.equal(possible.matchBasis[0],'title-author-year');
});

test('R1.7 query and candidate normalization are bounded and stable',async()=>{
  const mod=await import('../../apps/api/src/agent-paper-discovery-contracts.mjs');
  assert.deepEqual(mod.normalizeDiscoveryQuery({kind:'doi',doi:'https://doi.org/10.1000/ABC'}),{kind:'doi',doi:'10.1000/abc'});
  assert.equal(mod.normalizeDiscoveryQuery({kind:'arxiv',arxivId:'2401.12345v2'}).arxivId,'2401.12345v2');
  const first=mod.normalizeDiscoveryCandidate({sourceKind:'crossref',externalKey:'doi:10.1000/example',doi:'10.1000/example',title:'A  Useful—Paper',authors:['Ada Lovelace'],publicationYear:2026,metadata:{},provenance:{}});
  const second=mod.normalizeDiscoveryCandidate({sourceKind:'crossref',externalKey:'doi:10.1000/example',doi:'10.1000/example',title:'a useful paper',authors:['Ada Lovelace'],publicationYear:2026,metadata:{},provenance:{}});
  assert.equal(first.titleFingerprint,second.titleFingerprint);assert.equal(first.authorFingerprint,second.authorFingerprint);
  assert.throws(()=>mod.normalizeDiscoveryQuery({kind:'url',url:'https://example.com'}));
});

test('R1.7 is wired only to private admin routes and exposes no publish action',()=>{
  const routes=fs.readFileSync(path.join(__dirname,'../../apps/api/src/agent-account-routes.mjs'),'utf8');
  const service=fs.readFileSync(path.join(__dirname,'../../apps/api/src/agent-paper-discovery-service.mjs'),'utf8');
  assert.match(routes,/\/v1\/admin\/agents\/:agentUserId\/paper-discoveries/);
  assert.match(routes,/\/paper-research-queue/);
  assert.doesNotMatch(service,/blog_articles|publishArticle|publication_receipt/);
  assert.match(service,/modelUsed:false/);
});
