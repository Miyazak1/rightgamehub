import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const KNOWLEDGE_MAP_FORMAT = 'mooyu.curriculum-knowledge-map';
export const KNOWLEDGE_MAP_SCHEMA_VERSION = 1;
export const KNOWLEDGE_MAP_VALIDATOR_VERSION = '0.1.0';

const rootFields = new Set(['format','schemaVersion','id','title','jurisdiction','educationStage','curriculumVersion','authorities','subjects','fragments','nodes','relations','clusters','textbookMappings','review']);
const fragmentFields = new Set(['format','schemaVersion','id','subjectId','nodes','relations','clusters','textbookMappings','review']);
const idPattern = /^[a-z][a-z0-9._-]{0,127}$/u;
const localPathPattern = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\)[A-Za-z0-9][A-Za-z0-9._/-]*$/u;
const finding = (severity,code,message,pointer='/') => ({ severity,code,message,pointer });
const ids = values => new Set((Array.isArray(values) ? values : []).map(value => value?.id));
const stable = value => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};

function requireCollection(value,name,findings,{ allowEmpty=false }={}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    findings.push(finding('error','KNOWLEDGE_MAP_COLLECTION_INVALID',`${name} 必须是${allowEmpty ? '' : '非空'}数组。`,`/${name}`));
    return [];
  }
  return value;
}

function checkUnique(values,name,findings) {
  const seen = new Set();
  for (const [index,value] of values.entries()) {
    if (!idPattern.test(value?.id ?? '')) findings.push(finding('error','KNOWLEDGE_MAP_ID_INVALID',`${name}[${index}] 缺少稳定 ID。`,`/${name}/${index}/id`));
    else if (seen.has(value.id)) findings.push(finding('error','KNOWLEDGE_MAP_ID_DUPLICATE',`${name} 存在重复 ID ${value.id}。`,`/${name}/${index}/id`));
    seen.add(value?.id);
  }
  return seen;
}

function checkReview(review,findings,pointer) {
  if (!review || typeof review !== 'object' || typeof review.sourceChecked !== 'boolean' || typeof review.subjectChecked !== 'boolean') findings.push(finding('error','KNOWLEDGE_MAP_REVIEW_INVALID','review 必须明确来源审校和学科审校状态。',pointer));
  if (review?.subjectChecked && !review.sourceChecked) findings.push(finding('error','KNOWLEDGE_MAP_REVIEW_ORDER_INVALID','学科审校不能先于来源审校。',pointer));
}

function checkStandardRefs(values,authorityIds,findings,pointer,{ required=true }={}) {
  if (!Array.isArray(values) || (required && values.length === 0)) { findings.push(finding('error','KNOWLEDGE_MAP_STANDARD_REF_MISSING','知识条目必须可追溯到权威来源。',pointer)); return; }
  for (const [index,ref] of values.entries()) if (!authorityIds.has(ref?.authorityId)) findings.push(finding('error','KNOWLEDGE_MAP_AUTHORITY_REFERENCE_INVALID',`来源引用 ${ref?.authorityId ?? '<missing>'} 不存在。`,`${pointer}/${index}/authorityId`));
}

function prerequisiteCycles(nodes,relations) {
  const graph = new Map(nodes.map(node => [node.id,[]]));
  for (const relation of relations) if (relation.type === 'prerequisiteOf' && graph.has(relation.fromNodeId)) graph.get(relation.fromNodeId).push(relation.toNodeId);
  const visiting=new Set(),visited=new Set(),cycles=[];
  const visit=(id,trail=[])=>{ if(visiting.has(id)){cycles.push([...trail,id]);return;} if(visited.has(id))return; visiting.add(id); for(const next of graph.get(id)??[])visit(next,[...trail,id]); visiting.delete(id); visited.add(id); };
  for (const id of graph.keys()) visit(id);
  return cycles;
}

export function validateKnowledgeMap(document) {
  const findings=[];
  if (!document || typeof document !== 'object' || Array.isArray(document)) return { ok:false,summary:{errors:1,warnings:0,info:0},findings:[finding('error','KNOWLEDGE_MAP_DOCUMENT_INVALID','知识地图根必须是对象。')] };
  for (const key of Object.keys(document)) if (!rootFields.has(key)) findings.push(finding('error','KNOWLEDGE_MAP_ADDITIONAL_PROPERTY',`根对象包含未知字段 ${key}。`,`/${key}`));
  for (const key of rootFields) if (!(key in document)) findings.push(finding('error','KNOWLEDGE_MAP_REQUIRED_FIELD_MISSING',`缺少必需字段 ${key}。`,`/${key}`));
  if (document.format !== KNOWLEDGE_MAP_FORMAT || document.schemaVersion !== KNOWLEDGE_MAP_SCHEMA_VERSION) findings.push(finding('error','KNOWLEDGE_MAP_FORMAT_UNSUPPORTED','知识地图必须使用 mooyu.curriculum-knowledge-map schemaVersion 1。','/format'));
  if (document.jurisdiction !== 'CN' || document.educationStage !== 'upper-secondary') findings.push(finding('error','KNOWLEDGE_MAP_SCOPE_INVALID','首版只接受中国普通高中知识地图。','/jurisdiction'));
  const authorities=requireCollection(document.authorities,'authorities',findings),subjects=requireCollection(document.subjects,'subjects',findings),nodes=requireCollection(document.nodes,'nodes',findings),relations=requireCollection(document.relations,'relations',findings,{allowEmpty:true}),clusters=requireCollection(document.clusters,'clusters',findings,{allowEmpty:true}),textbookMappings=requireCollection(document.textbookMappings,'textbookMappings',findings,{allowEmpty:true});
  const fragments=requireCollection(document.fragments,'fragments',findings,{allowEmpty:true});
  if(new Set(fragments).size!==fragments.length||fragments.some(value=>typeof value!=='string'||!localPathPattern.test(value)))findings.push(finding('error','KNOWLEDGE_MAP_FRAGMENT_PATH_INVALID','fragments 必须是无重复的安全相对路径。','/fragments'));
  const authorityIds=checkUnique(authorities,'authorities',findings),subjectIds=checkUnique(subjects,'subjects',findings),nodeIds=checkUnique(nodes,'nodes',findings);
  checkUnique(relations,'relations',findings); checkUnique(clusters,'clusters',findings); checkUnique(textbookMappings,'textbookMappings',findings);
  checkReview(document.review,findings,'/review');
  for(const [index,subject] of subjects.entries()){
    if(!authorityIds.has(subject.authorityId))findings.push(finding('error','KNOWLEDGE_MAP_AUTHORITY_REFERENCE_INVALID',`学科 ${subject.id} 的来源不存在。`,`/subjects/${index}/authorityId`));
    if(!nodeIds.has(subject.rootNodeId))findings.push(finding('error','KNOWLEDGE_MAP_ROOT_NODE_INVALID',`学科 ${subject.id} 的根节点不存在。`,`/subjects/${index}/rootNodeId`));
  }
  for(const [index,node] of nodes.entries()){
    if(!subjectIds.has(node.subjectId))findings.push(finding('error','KNOWLEDGE_MAP_SUBJECT_REFERENCE_INVALID',`节点 ${node.id} 的学科不存在。`,`/nodes/${index}/subjectId`));
    if(node.parentId!==undefined&&!nodeIds.has(node.parentId))findings.push(finding('error','KNOWLEDGE_MAP_NODE_REFERENCE_INVALID',`节点 ${node.id} 的父节点不存在。`,`/nodes/${index}/parentId`));
    checkStandardRefs(node.standardRefs,authorityIds,findings,`/nodes/${index}/standardRefs`); checkReview(node.review,findings,`/nodes/${index}/review`);
  }
  for(const [index,relation] of relations.entries()){
    if(!nodeIds.has(relation.fromNodeId)||!nodeIds.has(relation.toNodeId))findings.push(finding('error','KNOWLEDGE_MAP_RELATION_REFERENCE_INVALID',`关系 ${relation.id} 包含不存在的节点。`,`/relations/${index}`));
    if(relation.fromNodeId===relation.toNodeId)findings.push(finding('error','KNOWLEDGE_MAP_RELATION_SELF_REFERENCE',`关系 ${relation.id} 不能指向自身。`,`/relations/${index}`));
    checkStandardRefs(relation.standardRefs,authorityIds,findings,`/relations/${index}/standardRefs`,{required:false}); checkReview(relation.review,findings,`/relations/${index}/review`);
  }
  for(const [index,cluster] of clusters.entries()){
    if(!subjectIds.has(cluster.subjectId))findings.push(finding('error','KNOWLEDGE_MAP_SUBJECT_REFERENCE_INVALID',`知识簇 ${cluster.id} 的学科不存在。`,`/clusters/${index}/subjectId`));
    for(const id of [...(cluster.nodeIds??[]),...(cluster.coreNodeIds??[])])if(!nodeIds.has(id))findings.push(finding('error','KNOWLEDGE_MAP_CLUSTER_NODE_INVALID',`知识簇 ${cluster.id} 引用了不存在的节点 ${id}。`,`/clusters/${index}/nodeIds`));
    for(const id of cluster.coreNodeIds??[])if(!(cluster.nodeIds??[]).includes(id))findings.push(finding('error','KNOWLEDGE_MAP_CLUSTER_CORE_INVALID',`核心节点 ${id} 不在知识簇 ${cluster.id} 的 nodeIds 中。`,`/clusters/${index}/coreNodeIds`));
    checkReview(cluster.review,findings,`/clusters/${index}/review`);
  }
  for(const [index,mapping] of textbookMappings.entries()){
    if(!nodeIds.has(mapping.nodeId))findings.push(finding('error','KNOWLEDGE_MAP_TEXTBOOK_NODE_INVALID',`教材映射 ${mapping.id} 引用了不存在的节点。`,`/textbookMappings/${index}/nodeId`));
    checkReview(mapping.review,findings,`/textbookMappings/${index}/review`);
  }
  for(const cycle of prerequisiteCycles(nodes,relations)) findings.push(finding('error','KNOWLEDGE_MAP_PREREQUISITE_CYCLE',`先修关系形成环：${cycle.join(' -> ')}。`,'/relations'));
  if(!findings.some(value=>value.severity==='error'))findings.push(finding('info','KNOWLEDGE_MAP_VALID','知识地图结构、来源和引用关系通过校验。'));
  if(subjects.some(subject=>subject.catalogStatus!=='atomic-reviewed'))findings.push(finding('warning','KNOWLEDGE_MAP_COVERAGE_INCOMPLETE','目录仍包含未完成原子审校的学科，不能宣称完整知识覆盖。','/subjects'));
  const summary={errors:findings.filter(value=>value.severity==='error').length,warnings:findings.filter(value=>value.severity==='warning').length,info:findings.filter(value=>value.severity==='info').length};
  return { ok:summary.errors===0,summary,findings,coverage:{subjects:subjects.length,nodes:nodes.length,relations:relations.length,clusters:clusters.length,sourceCheckedNodes:nodes.filter(node=>node.review?.sourceChecked).length,subjectCheckedNodes:nodes.filter(node=>node.review?.subjectChecked).length},digest:crypto.createHash('sha256').update(stable(document)).digest('hex') };
}

export async function loadKnowledgeMapDocument(file) {
  const absolute=path.resolve(file); let document;
  try { document=JSON.parse(await fs.readFile(absolute,'utf8')); }
  catch(error){ return { file:absolute,error:finding('error','KNOWLEDGE_MAP_JSON_INVALID',`无法读取知识地图：${error.message}`) }; }
  const fragments=[];
  for(const [index,relative] of (document.fragments??[]).entries()){
    if(typeof relative!=='string'||!localPathPattern.test(relative))continue;
    let fragment;
    try{fragment=JSON.parse(await fs.readFile(path.join(path.dirname(absolute),...relative.split('/')),'utf8'));}
    catch(error){fragments.push({ error:finding('error','KNOWLEDGE_MAP_FRAGMENT_INVALID',`无法读取片段 ${relative}：${error.message}`,`/fragments/${index}`) });continue;}
    const unknown=Object.keys(fragment).filter(key=>!fragmentFields.has(key));
    if(fragment.format!=='mooyu.curriculum-knowledge-map-fragment'||fragment.schemaVersion!==1||unknown.length){fragments.push({ error:finding('error','KNOWLEDGE_MAP_FRAGMENT_INVALID',`片段 ${relative} 的格式、版本或字段无效。`,`/fragments/${index}`) });continue;}
    fragments.push({ relative,fragment });
  }
  const compiled=structuredClone(document);
  for(const item of fragments)if(item.fragment){
    for(const key of ['nodes','relations','clusters','textbookMappings'])compiled[key].push(...(item.fragment[key]??[]));
  }
  return { file:absolute,document:compiled,fragments };
}

export async function inspectKnowledgeMap(file) {
  const loaded=await loadKnowledgeMapDocument(file);
  if(loaded.error)return { file:loaded.file,ok:false,summary:{errors:1,warnings:0,info:0},findings:[loaded.error] };
  const { file:absolute,document:compiled,fragments }=loaded;
  const report=validateKnowledgeMap(compiled);
  for(const item of fragments)if(item.error)report.findings.unshift(item.error);
  report.summary={errors:report.findings.filter(value=>value.severity==='error').length,warnings:report.findings.filter(value=>value.severity==='warning').length,info:report.findings.filter(value=>value.severity==='info').length};
  report.ok=report.summary.errors===0;
  return { file:absolute,fragmentCount:fragments.filter(item=>item.fragment).length,...report };
}
