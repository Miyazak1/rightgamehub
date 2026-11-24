import test from 'node:test';
import assert from 'node:assert/strict';
import {checkPaperOverlay} from '../../scripts/audit-generated-agent-files.mjs';
test('paper review requires all six off flags, original image and inert restart behavior',()=>{
 const keys=['PAPER_STUDY_ENABLED','PAPER_STUDY_WORKER_ENABLED','PAPER_STUDY_MODELS_ENABLED','PAPER_STUDY_PUBLISH_ENABLED','AGENT_PAPER_SEMANTIC_ENABLED','AGENT_PAPER_RESEARCH_WORKER_ENABLED'];
 const valid={image:'original',restart:'no',profiles:['paper-disabled'],environment:Object.fromEntries(keys.map(k=>[k,'false'])),entrypoint:['node','-e','process.exit(0)'],command:[]};
 assert.equal(checkPaperOverlay(valid,'original'),true);
 for(const change of [s=>s.image='new',s=>s.restart='always',s=>s.environment.AGENT_PAPER_RESEARCH_WORKER_ENABLED='true',s=>s.entrypoint=['node','worker.mjs'],s=>s.command=['worker'],s=>s.profiles=[]]){const s=structuredClone(valid);change(s);assert.equal(checkPaperOverlay(s,'original'),false);}
});
