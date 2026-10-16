import fs from 'node:fs/promises';
import path from 'node:path';
import { loadKnowledgeMapDocument,validateKnowledgeMap } from '../packages/creator-tools/src/knowledge-map.mjs';

const activeSubjectIds=['mathematics','physics','chemistry'];
const catalogPath=path.resolve('curricula/cn-upper-secondary/2017-2020/catalog.json');
const coursewareCoveragePath=path.resolve('curricula/cn-upper-secondary/2017-2020/courseware-coverage.json');
const outputPath=path.resolve('curricula/cn-upper-secondary/2017-2020/reports/stem-focus-coverage.json');
const loaded=await loadKnowledgeMapDocument(catalogPath);
if(loaded.error)throw new Error(loaded.error.message);
const validation=validateKnowledgeMap(loaded.document);
if(!validation.ok)throw new Error(`知识地图未通过校验：${validation.summary.errors} 个错误。`);
const coursewareCoverage=JSON.parse(await fs.readFile(coursewareCoveragePath,'utf8'));
if(coursewareCoverage.format!=='mooyu.courseware-coverage'||coursewareCoverage.schemaVersion!==1||coursewareCoverage.catalogId!==loaded.document.id||!Array.isArray(coursewareCoverage.entries))throw new Error('课件覆盖登记表格式无效。');
const coverageIds=new Set(),packageIds=new Set();
for(const entry of coursewareCoverage.entries){
  if(!entry||typeof entry!=='object'||coverageIds.has(entry.id))throw new Error(`课件覆盖登记 ID 无效或重复：${entry?.id??'<missing>'}。`);
  coverageIds.add(entry.id);
  if(!activeSubjectIds.includes(entry.subjectId))throw new Error(`课件覆盖登记 ${entry.id} 的学科不在首期范围。`);
  if(!/^templates\/courseware\/[a-z][a-z0-9._-]+$/u.test(entry.packagePath??''))throw new Error(`课件覆盖登记 ${entry.id} 的 packagePath 无效。`);
  if(packageIds.has(entry.packageId))throw new Error(`课件覆盖登记 packageId 重复：${entry.packageId}。`);
  packageIds.add(entry.packageId);
  if(!['representative-prototype','C4','C5'].includes(entry.coverageLevel)||!['draft','doctor-verified','browser-verified','release-ready'].includes(entry.engineeringStatus))throw new Error(`课件覆盖登记 ${entry.id} 的状态无效。`);
  const evidence=entry.evidence;
  if(!evidence||['doctor','bilingual','keyboardComplete','reducedMotion','subjectReviewed'].some(key=>typeof evidence[key]!=='boolean')||!Number.isInteger(evidence.embedHostCount)||!Number.isInteger(evidence.browserJourneyCount))throw new Error(`课件覆盖登记 ${entry.id} 的证据无效。`);
}

const scoreCluster=cluster=>Object.values(cluster.priority??{}).reduce((sum,value)=>sum+value,0);
const subjectReport=async subjectId=>{
  const subject=loaded.document.subjects.find(item=>item.id===subjectId);
  if(!subject)throw new Error(`缺少首期学科：${subjectId}`);
  const nodes=loaded.document.nodes.filter(item=>item.subjectId===subjectId);
  const nodeIds=new Set(nodes.map(item=>item.id));
  const relations=loaded.document.relations.filter(item=>nodeIds.has(item.fromNodeId)||nodeIds.has(item.toNodeId));
  const clusters=loaded.document.clusters.filter(item=>item.subjectId===subjectId);
  const mappings=loaded.document.textbookMappings.filter(item=>nodeIds.has(item.nodeId));
  const textbookTargetNodes=nodes.filter(node=>!['module','subject-root'].includes(node.type)&&node.curriculumLevels.some(level=>level==='required'||level==='selective-required'));
  const textbookTargetIds=new Set(textbookTargetNodes.map(item=>item.id));
  const mappedNodeIds=new Set(mappings.filter(item=>textbookTargetIds.has(item.nodeId)).map(item=>item.nodeId));
  const sourceCheckedNodes=nodes.filter(item=>item.review?.sourceChecked).length;
  const subjectCheckedNodes=nodes.filter(item=>item.review?.subjectChecked).length;
  const coursewareEntries=coursewareCoverage.entries.filter(item=>item.subjectId===subjectId);
  for(const entry of coursewareEntries){
    const cluster=clusters.find(item=>item.id===entry.clusterId);
    if(!cluster)throw new Error(`课件覆盖登记 ${entry.id} 引用了不存在的知识簇 ${entry.clusterId}。`);
    if(cluster.subjectId!==entry.subjectId)throw new Error(`课件覆盖登记 ${entry.id} 的学科与知识簇不一致。`);
    const manifestPath=path.resolve(entry.packagePath,'mooyu-courseware.json');
    const manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));
    if(manifest.id!==entry.packageId)throw new Error(`课件覆盖登记 ${entry.id} 的 packageId 与清单不一致。`);
  }
  const representativePackages=coursewareEntries.filter(item=>item.evidence?.doctor&&item.evidence?.bilingual&&item.evidence?.keyboardComplete&&item.evidence?.reducedMotion);
  const c4Packages=coursewareEntries.filter(item=>['C4','C5'].includes(item.coverageLevel)&&['browser-verified','release-ready'].includes(item.engineeringStatus));
  const externallyAccepted=coursewareEntries.filter(item=>item.evidence?.embedHostCount>=2&&item.evidence?.browserJourneyCount>=2);
  const candidates=clusters.map(cluster=>({
    clusterId:cluster.id,
    title:cluster.title,
    score:scoreCluster(cluster),
    coreNodeIds:cluster.coreNodeIds,
    runtimeRequirements:cluster.runtimeRequirements
  })).sort((a,b)=>(b.score-a.score)||a.clusterId.localeCompare(b.clusterId)).slice(0,5);
  return {
    subjectId,
    title:subject.title,
    stage:subjectCheckedNodes===nodes.length&&mappedNodeIds.size===textbookTargetNodes.length?'reviewed-and-mapped':'source-mapped-review-pending',
    coverage:{ nodes:nodes.length,relations:relations.length,clusters:clusters.length,textbookMappings:mappings.length,sourceCheckedNodes,subjectCheckedNodes },
    gates:{
      sourceTraceability:{passed:sourceCheckedNodes===nodes.length,current:sourceCheckedNodes,target:nodes.length},
      subjectReview:{passed:subjectCheckedNodes===nodes.length,current:subjectCheckedNodes,target:nodes.length},
      textbookMapping:{passed:mappedNodeIds.size===textbookTargetNodes.length,current:mappedNodeIds.size,target:textbookTargetNodes.length,scope:'required-and-selective-required-atomic-nodes'},
      representativeClusters:{passed:clusters.length>=3,current:clusters.length,target:3},
      representativeCourseware:{passed:representativePackages.length>=1,current:representativePackages.length,target:1},
      c4Courseware:{passed:c4Packages.length>=1,current:c4Packages.length,target:1},
      externalEmbedAcceptance:{passed:externallyAccepted.length>=1,current:externallyAccepted.length,target:1}
    },
    courseware:coursewareEntries,
    topCoursewareCandidates:candidates
  };
};

const subjects=await Promise.all(activeSubjectIds.map(subjectReport));
const sum=key=>subjects.reduce((total,subject)=>total+subject.coverage[key],0);
const report={
  format:'mooyu.curriculum-focus-coverage',
  schemaVersion:1,
  generatedAt:new Date().toISOString(),
  catalogId:loaded.document.id,
  catalogDigest:validation.digest,
  policy:{
    activeSubjects:activeSubjectIds,
    frozenSubjects:loaded.document.subjects.map(item=>item.id).filter(id=>!activeSubjectIds.includes(id)),
    rule:'三科完成门禁通过前，不继续拆分其他学科；顶层学科根节点不计作已完成覆盖。'
  },
  aggregate:{
    nodes:sum('nodes'),
    relations:sum('relations'),
    clusters:sum('clusters'),
    textbookMappings:sum('textbookMappings'),
    sourceCheckedNodes:sum('sourceCheckedNodes'),
    subjectCheckedNodes:sum('subjectCheckedNodes')
  },
  subjects
};

await fs.mkdir(path.dirname(outputPath),{recursive:true});
await fs.writeFile(outputPath,`${JSON.stringify(report,null,2)}\n`,'utf8');
process.stdout.write(`${JSON.stringify({output:outputPath,activeSubjects:activeSubjectIds,aggregate:report.aggregate},null,2)}\n`);
