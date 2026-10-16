const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const { execFile }=require('node:child_process');
const { promisify }=require('node:util');
const { pathToFileURL }=require('node:url');

const root=path.resolve(__dirname,'../..');
const catalogPath=path.join(root,'curricula/cn-upper-secondary/2017-2020/catalog.json');
const toolsUrl=pathToFileURL(path.join(root,'packages/creator-tools/src/knowledge-map.mjs'));
const exec=promisify(execFile);

test('official upper-secondary catalog records all 20 subject standards and validates',async()=>{
  const { inspectKnowledgeMap }=await import(toolsUrl);
  const report=await inspectKnowledgeMap(catalogPath);
  assert.equal(report.ok,true,JSON.stringify(report.findings,null,2));
  assert.equal(report.coverage.subjects,20);
  assert.equal(report.coverage.nodes,513);
  assert.equal(report.coverage.sourceCheckedNodes,513);
  assert.equal(report.coverage.subjectCheckedNodes,0);
  assert.equal(report.coverage.relations,252);
  assert.equal(report.coverage.clusters,89);
  assert.match(report.digest,/^[a-f0-9]{64}$/u);
  assert.ok(report.findings.some(item=>item.code==='KNOWLEDGE_MAP_COVERAGE_INCOMPLETE'));
  const catalog=JSON.parse(await fs.readFile(catalogPath,'utf8'));
  assert.deepEqual(catalog.fragments,['subjects/mathematics.json','subjects/mathematics-required-functions.json','subjects/mathematics-required-geometry-data-modeling.json','subjects/mathematics-selective-required.json','subjects/mathematics-electives.json','subjects/physics-required.json','subjects/physics-selective-required.json','subjects/physics-required-experiments.json','subjects/physics-electives.json','subjects/chemistry-required.json','subjects/chemistry-required-experiments.json','subjects/chemistry-selective-required.json','subjects/chemistry-electives.json','subjects/mathematics-textbook-mappings.json','subjects/physics-textbook-mappings.json','subjects/chemistry-textbook-mappings.json']);
  assert.deepEqual(catalog.subjects.map(subject=>subject.standardNumber).sort((a,b)=>a-b),Array.from({length:20},(_,index)=>index+2));
  assert.equal(catalog.authorities[0].artifactSha256,'30204dfd2357c6d6f3bd66e55538f1fbb62a952459aff9c0293e3e2d608d004f');
});

test('the first textbook baseline is explicit, authoritative and edition-specific',async()=>{
  const baseline=JSON.parse(await fs.readFile(path.join(root,'curricula/cn-upper-secondary/2017-2020/textbook-baseline.json'),'utf8'));
  assert.equal(baseline.format,'mooyu.curriculum-textbook-baseline');
  assert.equal(baseline.selectionPolicy,'platform-first-baseline');
  assert.equal(baseline.checkedAt,'2026-10-15');
  assert.deepEqual([...new Set(baseline.editions.map(item=>item.subjectId))].sort(),['chemistry','mathematics','physics']);
  assert.ok(baseline.authorities.some(item=>item.kind==='national-catalog'&&item.sourceUrl.startsWith('https://www.moe.gov.cn/')));
  assert.ok(baseline.authorities.some(item=>item.kind==='regional-adoption-catalog'&&item.title['zh-CN'].includes('2026')));
  assert.ok(baseline.authorities.some(item=>item.kind==='publisher-catalog'&&item.sourceUrl.startsWith('https://www.pep.com.cn/')));
  assert.equal(baseline.editions.length,16);
  assert.ok(baseline.editions.filter(item=>item.isbn).every(item=>/^978-[0-9]-[0-9]{3}-[0-9]{5}-[0-9]$/u.test(item.isbn)));
  assert.ok(baseline.editions.every(item=>item.authorityIds.length>=3&&item.sourceUrls.length>=3));
});

test('generated subject review reports expose review queues and explicit coverage gaps',async()=>{
  const mathematics=JSON.parse(await fs.readFile(path.join(root,'curricula/cn-upper-secondary/2017-2020/reports/mathematics-review.json'),'utf8'));
  const physics=JSON.parse(await fs.readFile(path.join(root,'curricula/cn-upper-secondary/2017-2020/reports/physics-review.json'),'utf8'));
  const chemistry=JSON.parse(await fs.readFile(path.join(root,'curricula/cn-upper-secondary/2017-2020/reports/chemistry-review.json'),'utf8'));
  assert.equal(mathematics.coverage.nodes,181);
  assert.equal(mathematics.coverage.relations,95);
  assert.equal(mathematics.coverage.clusters,26);
  assert.equal(mathematics.reviewQueue.length,181);
  assert.equal(physics.coverage.nodes,185);
  assert.equal(physics.coverage.sourceCheckedNodes,185);
  assert.equal(physics.coverage.subjectCheckedNodes,0);
  assert.equal(physics.reviewQueue.length,185);
  assert.equal(chemistry.coverage.nodes,130);
  assert.equal(chemistry.coverage.clusters,27);
  assert.equal(chemistry.coverage.nodesByType.experiment,18);
  assert.ok(chemistry.reviewQueue.some(item=>item.priority==='high'));
  assert.ok(physics.gaps.some(item=>item.code==='SCHOOL_DEFINED_ELECTIVES_OUT_OF_BASELINE'));
  assert.equal(mathematics.coverage.textbookMappedTargetNodes,mathematics.coverage.textbookMappingTargetNodes);
  assert.ok(!mathematics.gaps.some(item=>item.code.startsWith('TEXTBOOK_MAPPING_')));
  assert.ok(mathematics.gaps.some(item=>item.code==='MATHEMATICS_ELECTIVE_E_SCHOOL_DEFINED'));
  assert.equal(chemistry.coverage.textbookMappedTargetNodes,chemistry.coverage.textbookMappingTargetNodes);
  assert.ok(!chemistry.gaps.some(item=>item.code.startsWith('TEXTBOOK_MAPPING_')));
  assert.ok(chemistry.gaps.some(item=>item.code==='ELECTIVE_COMPOSITION_FLEXIBLE'));
});

test('three-subject focus report freezes expansion and exposes completion gates',async()=>{
  const focus=JSON.parse(await fs.readFile(path.join(root,'curricula/cn-upper-secondary/2017-2020/reports/stem-focus-coverage.json'),'utf8'));
  assert.deepEqual(focus.policy.activeSubjects,['mathematics','physics','chemistry']);
  assert.equal(focus.policy.frozenSubjects.length,17);
  assert.deepEqual(focus.aggregate,{nodes:496,relations:252,clusters:89,textbookMappings:280,sourceCheckedNodes:496,subjectCheckedNodes:0});
  for(const subject of focus.subjects){
    assert.equal(subject.gates.sourceTraceability.passed,true);
    assert.equal(subject.gates.subjectReview.passed,false);
    assert.equal(subject.gates.textbookMapping.passed,true);
    assert.equal(subject.gates.textbookMapping.current,subject.gates.textbookMapping.target);
    assert.equal(subject.gates.representativeClusters.passed,true);
    assert.equal(subject.gates.representativeCourseware.passed,true);
    assert.equal(subject.gates.representativeCourseware.current,1);
    assert.equal(subject.gates.c4Courseware.passed,false);
    assert.equal(subject.courseware.length,1);
    assert.equal(subject.topCoursewareCandidates.length,5);
  }
});

test('three representative courseware briefs are bilingual, C4-targeted and correctly review-blocked',async()=>{
  const { loadKnowledgeMapDocument }=await import(toolsUrl);
  const { validateCoursewareBriefs }=await import(pathToFileURL(path.join(root,'scripts/validate-courseware-briefs.mjs')));
  const report=await validateCoursewareBriefs();
  assert.equal(report.ok,true,JSON.stringify(report.findings,null,2));
  assert.equal(report.briefs.length,3);
  assert.deepEqual(report.briefs.map(item=>item.subjectId).sort(),['chemistry','mathematics','physics']);
  assert.ok(report.briefs.every(item=>item.status==='review-blocked'&&item.targetDepth==='C4'));
  const loaded=await loadKnowledgeMapDocument(catalogPath);
  const clusterById=new Map(loaded.document.clusters.map(item=>[item.id,item]));
  const directory=path.join(root,'curricula/cn-upper-secondary/2017-2020/courseware-briefs');
  for(const file of (await fs.readdir(directory)).filter(name=>name.endsWith('.json'))){
    const brief=JSON.parse(await fs.readFile(path.join(directory,file),'utf8'));
    const cluster=clusterById.get(brief.clusterId);
    assert.deepEqual(new Set(brief.knowledgeNodeIds),new Set(cluster.nodeIds));
    assert.deepEqual(new Set(brief.runtimeRequirements),new Set(cluster.runtimeRequirements));
    assert.deepEqual(new Set(brief.blockingGates),new Set(['subject-review']));
    assert.deepEqual(new Set(brief.acceptance.journeys.map(item=>item.locale)),new Set(['zh-CN','en']));
    assert.equal(brief.acceptance.embedHosts,2);
    assert.equal(brief.acceptance.keyboardComplete,true);
    assert.equal(brief.acceptance.reducedMotion,true);
  }
});

test('representative clusters have current, pending-only expert review and textbook intake packets',async()=>{
  await exec(process.execPath,[path.join(root,'scripts/report-courseware-review-packets.mjs'),'--check'],{cwd:root});
  const { loadKnowledgeMapDocument }=await import(toolsUrl);
  const loaded=await loadKnowledgeMapDocument(catalogPath);
  const clusters=new Map(loaded.document.clusters.map(item=>[item.id,item]));
  const directory=path.join(root,'curricula/cn-upper-secondary/2017-2020/review-packets');
  const files=(await fs.readdir(directory)).filter(name=>name.endsWith('.json')).sort();
  assert.equal(files.length,3);
  for(const file of files){
    const packet=JSON.parse(await fs.readFile(path.join(directory,file),'utf8'));
    const cluster=clusters.get(packet.clusterId);
    assert.equal(packet.status,'pending');
    assert.deepEqual(new Set(packet.nodeReviews.map(item=>item.nodeId)),new Set(cluster.nodeIds));
    assert.deepEqual(new Set(packet.textbookMappingIntake.nodeRows.map(item=>item.nodeId)),new Set(cluster.nodeIds));
    assert.equal(packet.textbookMappingIntake.status,'complete');
    assert.ok(packet.textbookMappingIntake.nodeRows.every(item=>item.status==='mapped'&&item.mappings.length>0));
    assert.ok(packet.nodeReviews.every(item=>item.checks.every(check=>check.status==='pending')));
    assert.ok(packet.relationReviews.every(item=>item.checks.every(check=>check.status==='pending')));
    assert.ok(packet.clusterReview.checks.every(check=>check.status==='pending'));
    assert.ok(packet.relationReviews.every(item=>cluster.nodeIds.includes(item.fromNodeId)||cluster.nodeIds.includes(item.toNodeId)));
  }
});

test('knowledge map validator rejects unknown roots, broken references and prerequisite cycles',async()=>{
  const { validateKnowledgeMap }=await import(toolsUrl);
  const source=JSON.parse(await fs.readFile(catalogPath,'utf8'));
  const broken=structuredClone(source);
  broken.unapproved=true;
  broken.nodes.push({ ...structuredClone(broken.nodes[0]),id:'cn-hs.broken',parentId:'cn-hs.missing' });
  broken.relations.push({ id:'cycle-a',type:'prerequisiteOf',fromNodeId:'cn-hs.chinese',toNodeId:'cn-hs.mathematics',standardRefs:[],review:{status:'draft',sourceChecked:false,subjectChecked:false} });
  broken.relations.push({ id:'cycle-b',type:'prerequisiteOf',fromNodeId:'cn-hs.mathematics',toNodeId:'cn-hs.chinese',standardRefs:[],review:{status:'draft',sourceChecked:false,subjectChecked:false} });
  const report=validateKnowledgeMap(broken);
  assert.equal(report.ok,false);
  assert.ok(report.findings.some(item=>item.code==='KNOWLEDGE_MAP_ADDITIONAL_PROPERTY'));
  assert.ok(report.findings.some(item=>item.code==='KNOWLEDGE_MAP_NODE_REFERENCE_INVALID'));
  assert.ok(report.findings.some(item=>item.code==='KNOWLEDGE_MAP_PREREQUISITE_CYCLE'));
});

test('knowledge map digest is stable across object key order',async()=>{
  const { validateKnowledgeMap }=await import(toolsUrl);
  const source=JSON.parse(await fs.readFile(catalogPath,'utf8'));
  const reordered=Object.fromEntries(Object.entries(source).reverse());
  assert.equal(validateKnowledgeMap(source).digest,validateKnowledgeMap(reordered).digest);
});
