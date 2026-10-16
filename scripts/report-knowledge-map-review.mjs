import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { loadKnowledgeMapDocument,validateKnowledgeMap } from '../packages/creator-tools/src/knowledge-map.mjs';

const args=process.argv.slice(2);
const valueFor=name=>{ const index=args.indexOf(name); return index>=0 ? args[index+1] : undefined; };
const subjectId=valueFor('--subject')??'physics';
const catalogPath=path.resolve(valueFor('--catalog')??'curricula/cn-upper-secondary/2017-2020/catalog.json');
const outputPath=path.resolve(valueFor('--output')??`curricula/cn-upper-secondary/2017-2020/reports/${subjectId}-review.json`);
const loaded=await loadKnowledgeMapDocument(catalogPath);
if(loaded.error)throw new Error(loaded.error.message);
const validation=validateKnowledgeMap(loaded.document);
if(!validation.ok)throw new Error(`知识地图未通过校验：${validation.summary.errors} 个错误。`);
const subject=loaded.document.subjects.find(item=>item.id===subjectId);
if(!subject)throw new Error(`未知学科：${subjectId}`);
const nodes=loaded.document.nodes.filter(item=>item.subjectId===subjectId);
const nodeIds=new Set(nodes.map(item=>item.id));
const relations=loaded.document.relations.filter(item=>nodeIds.has(item.fromNodeId)||nodeIds.has(item.toNodeId));
const clusters=loaded.document.clusters.filter(item=>item.subjectId===subjectId);
const mappings=loaded.document.textbookMappings.filter(item=>nodeIds.has(item.nodeId));
const textbookTargetNodes=nodes.filter(node=>!['module','subject-root'].includes(node.type)&&node.curriculumLevels.some(level=>level==='required'||level==='selective-required'));
const textbookTargetIds=new Set(textbookTargetNodes.map(item=>item.id));
const mappedNodeIds=new Set(mappings.filter(item=>textbookTargetIds.has(item.nodeId)).map(item=>item.nodeId));
const coreIds=new Set(clusters.flatMap(item=>item.coreNodeIds??[]));
const priorityOrder={high:0,medium:1,low:2};
const priorityFor=node=>node.type==='experiment'||coreIds.has(node.id)?'high':node.type==='module'||node.type==='subject-root'?'low':'medium';
const queue=nodes.filter(node=>!node.review?.subjectChecked).map(node=>({
  nodeId:node.id,
  title:node.title?.['zh-CN']??node.title?.en??node.id,
  type:node.type,
  curriculumLevels:node.curriculumLevels,
  priority:priorityFor(node),
  sourceLocators:(node.standardRefs??[]).map(ref=>ref.locator),
  reviewChecks:['边界与粒度','术语准确性','先修关系','可观察变量','互动候选']
})).sort((a,b)=>(priorityOrder[a.priority]-priorityOrder[b.priority])||a.nodeId.localeCompare(b.nodeId));
const countBy=(items,key)=>Object.fromEntries([...new Set(items.map(item=>item[key]))].sort().map(value=>[value,items.filter(item=>item[key]===value).length]));
const report={
  format:'mooyu.curriculum-review-report',
  schemaVersion:1,
  generatedAt:new Date().toISOString(),
  catalogId:loaded.document.id,
  catalogDigest:validation.digest,
  subject:{ id:subject.id,title:subject.title,catalogStatus:subject.catalogStatus },
  coverage:{
    nodes:nodes.length,
    relations:relations.length,
    clusters:clusters.length,
    textbookMappings:mappings.length,
    textbookMappingTargetNodes:textbookTargetNodes.length,
    textbookMappedTargetNodes:mappedNodeIds.size,
    sourceCheckedNodes:nodes.filter(node=>node.review?.sourceChecked).length,
    subjectCheckedNodes:nodes.filter(node=>node.review?.subjectChecked).length,
    nodesByType:countBy(nodes,'type'),
    nodesByPriority:countBy(queue,'priority')
  },
  gaps:[
    ...(queue.length?[{code:'SUBJECT_REVIEW_PENDING',severity:'blocking',count:queue.length,message:'节点尚未通过学科专家审校，不能进入 K2 完成态。'}]:[]),
    ...(mappedNodeIds.size===0?[{code:'TEXTBOOK_MAPPING_MISSING',severity:'non-blocking',count:textbookTargetNodes.length,message:'尚未建立必修与选择性必修原子节点的教材版本、章节映射。'}]:mappedNodeIds.size<textbookTargetNodes.length?[{code:'TEXTBOOK_MAPPING_INCOMPLETE',severity:'non-blocking',count:textbookTargetNodes.length-mappedNodeIds.size,message:'已建立首套教材基线，但仍有必修或选择性必修原子节点缺少教材章节映射。'}]:[]),
    ...(!clusters.length?[{code:'LEARNING_CLUSTER_MISSING',severity:'blocking',count:nodes.length,message:'尚未形成可立项的互动课件知识簇。'}]:[]),
    {code:'COURSEWARE_DEPTH_UNMEASURED',severity:'non-blocking',count:clusters.length,message:'知识簇尚未绑定发布课件的 C0-C5 深度证据。'},
    ...(subjectId==='mathematics'?[{code:'MATHEMATICS_ELECTIVE_E_SCHOOL_DEFINED',severity:'scope-note',count:0,message:'数学 E 类课程由学校按需求开发或选用，国家课标只提供类型和示例，不属于全国统一固定清单。'}]:[]),
    ...(subjectId==='physics'?[{code:'SCHOOL_DEFINED_ELECTIVES_OUT_OF_BASELINE',severity:'scope-note',count:0,message:'学校自主设置的选修模块不属于国家课标基线的可穷举范围。'}]:[]),
    ...(subjectId==='chemistry'?[{code:'ELECTIVE_COMPOSITION_FLEXIBLE',severity:'scope-note',count:0,message:'化学选修允许系列内、跨系列或综合项目组合，本报告只覆盖国家课标建议基线。'}]:[])
  ],
  reviewQueue:queue
};
await fs.mkdir(path.dirname(outputPath),{recursive:true});
await fs.writeFile(outputPath,`${JSON.stringify(report,null,2)}\n`,'utf8');
process.stdout.write(`${JSON.stringify({output:outputPath,subject:subjectId,coverage:report.coverage,gaps:report.gaps.map(item=>item.code)},null,2)}\n`);
