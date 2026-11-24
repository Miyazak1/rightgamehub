// Public, unauthenticated read-only adapter smoke test. No model, login, .env,
// database or production endpoint is loaded. Store only public GitHub evidence.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {createGitHubRepositorySearchAdapter} from '../apps/api/src/agent-github-repository-search-tool.mjs';
import {createGitHubRepositoryMaterialsAdapter} from '../apps/api/src/agent-github-repository-materials-tool.mjs';
import {buildSearchEvidence} from '../apps/api/src/agent-plugins/github/search.mjs';
const out=path.resolve(process.argv[2]??'');
if(!process.argv[2]||!out.toLowerCase().startsWith('e:\\codexdata\\build\\right\\agent-server-preflight\\')||fs.existsSync(out))throw Error('NEW_LOCAL_BUILD_PATH_REQUIRED');fs.mkdirSync(out,{recursive:true});
const adapter=createGitHubRepositorySearchAdapter({contractVersion:2}),results=[];
for(const [topic,query,language]of [['DOM selectors','css selector','JavaScript'],['workflow engines','workflow engine','Python'],['speech recognition','speech recognition',null]]){
 const result=await adapter({request:{query,limit:3,sort:'best-match',minStars:0,pushedAfter:null,filters:{language,license:null,createdAfter:null,createdBefore:null,pushedBefore:null,maxStars:null}},timeoutSeconds:20});
 assert(result.output.source.fetchedAt);assert.equal(result.output.schemaVersion,'github-repository-search-v2');
 results.push({topic,...result.output});
}
fs.writeFileSync(path.join(out,'public-search-evidence.json'),JSON.stringify(results,null,2)+'\n');
const materials=(await createGitHubRepositoryMaterialsAdapter()({request:{repository:'https://github.com/antonmedv/finder'},timeoutSeconds:40})).output;
fs.writeFileSync(path.join(out,'public-materials-evidence.json'),JSON.stringify(materials,null,2)+'\n');
const evidence=buildSearchEvidence({key:'antonmedv/finder',canonicalUrl:'https://github.com/antonmedv/finder',language:null,licenseSpdx:materials.metadata.licenseSpdx,stars:materials.metadata.stars,createdAt:null,pushedAt:materials.metadata.pushedAt},materials,1);
assert(evidence.sources.some(s=>s.kind==='readme'));fs.writeFileSync(path.join(out,'bounded-evidence.json'),JSON.stringify(evidence,null,2)+'\n');
const summary={result:'PASSED',topics:results.map(r=>({topic:r.topic,count:r.candidates.length,incomplete:r.incompleteResults,fetchedAt:r.source.fetchedAt})),materialRevision:materials.sourceVersion.revision,actualPublicGitHubRequests:true,modelInvoked:false,productionAccessed:false,credentialsLoaded:false};fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
