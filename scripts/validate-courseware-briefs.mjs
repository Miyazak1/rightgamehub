import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadKnowledgeMapDocument, validateKnowledgeMap } from '../packages/creator-tools/src/knowledge-map.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = path.join(root, 'curricula/cn-upper-secondary/2017-2020/catalog.json');
const briefsRoot = path.join(root, 'curricula/cn-upper-secondary/2017-2020/courseware-briefs');
const requiredRootFields = new Set(['format','schemaVersion','id','subjectId','clusterId','title','status','targetDepth','knowledgeNodeIds','blockingGates','runtimeRequirements','learning','model','instruments','scenes','checkpoints','acceptance']);
const idPattern = /^[a-z][a-z0-9._-]{0,127}$/u;
const finding = (severity, code, message, file, pointer = '/') => ({ severity, code, message, file, pointer });
const equalSets = (left, right) => left.size === right.size && [...left].every(value => right.has(value));
const duplicateIds = values => {
  const seen = new Set();
  return values.filter(value => seen.has(value) || !seen.add(value));
};

function checkLocalized(value, findings, file, pointer) {
  if (!value || typeof value !== 'object' || typeof value['zh-CN'] !== 'string' || !value['zh-CN'].trim() || typeof value.en !== 'string' || !value.en.trim()) {
    findings.push(finding('error', 'COURSEWARE_BRIEF_LOCALIZATION_INVALID', '双语字段必须同时提供非空 zh-CN 和 en。', file, pointer));
  }
}

export function validateCoursewareBrief(brief, map, file = '<memory>') {
  const findings = [];
  if (!brief || typeof brief !== 'object' || Array.isArray(brief)) return [finding('error','COURSEWARE_BRIEF_DOCUMENT_INVALID','课件规格根必须是对象。',file)];
  for (const key of Object.keys(brief)) if (!requiredRootFields.has(key)) findings.push(finding('error','COURSEWARE_BRIEF_ADDITIONAL_PROPERTY',`根对象包含未知字段 ${key}。`,file,`/${key}`));
  for (const key of requiredRootFields) if (!(key in brief)) findings.push(finding('error','COURSEWARE_BRIEF_REQUIRED_FIELD_MISSING',`缺少必需字段 ${key}。`,file,`/${key}`));
  if (brief.format !== 'mooyu.courseware-brief' || brief.schemaVersion !== 1) findings.push(finding('error','COURSEWARE_BRIEF_FORMAT_UNSUPPORTED','课件规格必须使用 mooyu.courseware-brief schemaVersion 1。',file,'/format'));
  for (const [key,value] of [['id',brief.id],['subjectId',brief.subjectId],['clusterId',brief.clusterId]]) if (!idPattern.test(value ?? '')) findings.push(finding('error','COURSEWARE_BRIEF_ID_INVALID',`${key} 不是稳定 ID。`,file,`/${key}`));
  checkLocalized(brief.title, findings, file, '/title');
  if (!['review-blocked','ready','building','accepted'].includes(brief.status)) findings.push(finding('error','COURSEWARE_BRIEF_STATUS_INVALID','status 不受支持。',file,'/status'));
  if (!['C4','C5'].includes(brief.targetDepth)) findings.push(finding('error','COURSEWARE_BRIEF_DEPTH_INVALID','代表性课件目标必须为 C4 或 C5。',file,'/targetDepth'));

  const subject = map.subjects.find(item => item.id === brief.subjectId);
  const cluster = map.clusters.find(item => item.id === brief.clusterId);
  if (!subject) findings.push(finding('error','COURSEWARE_BRIEF_SUBJECT_INVALID',`学科 ${brief.subjectId ?? '<missing>'} 不存在。`,file,'/subjectId'));
  if (!cluster) findings.push(finding('error','COURSEWARE_BRIEF_CLUSTER_INVALID',`知识簇 ${brief.clusterId ?? '<missing>'} 不存在。`,file,'/clusterId'));
  else {
    if (cluster.subjectId !== brief.subjectId) findings.push(finding('error','COURSEWARE_BRIEF_CLUSTER_SUBJECT_MISMATCH','知识簇与课件规格的学科不一致。',file,'/clusterId'));
    if (!equalSets(new Set(brief.knowledgeNodeIds ?? []), new Set(cluster.nodeIds ?? []))) findings.push(finding('error','COURSEWARE_BRIEF_NODE_DRIFT','knowledgeNodeIds 必须与绑定知识簇完整一致。',file,'/knowledgeNodeIds'));
    if (!equalSets(new Set(brief.runtimeRequirements ?? []), new Set(cluster.runtimeRequirements ?? []))) findings.push(finding('error','COURSEWARE_BRIEF_RUNTIME_DRIFT','runtimeRequirements 必须与绑定知识簇完整一致。',file,'/runtimeRequirements'));
  }

  const knowledgeNodeIds = Array.isArray(brief.knowledgeNodeIds) ? brief.knowledgeNodeIds : [];
  const mappedNodeIds = new Set(map.textbookMappings.map(item => item.nodeId));
  const lacksTextbookMapping = knowledgeNodeIds.some(id => !mappedNodeIds.has(id));
  const blockingGates = new Set(Array.isArray(brief.blockingGates) ? brief.blockingGates : []);
  if (!cluster?.review?.subjectChecked && !blockingGates.has('subject-review')) findings.push(finding('error','COURSEWARE_BRIEF_REVIEW_GATE_MISSING','未通过学科审校的知识簇必须阻断 subject-review。',file,'/blockingGates'));
  if (lacksTextbookMapping && !blockingGates.has('textbook-mapping')) findings.push(finding('error','COURSEWARE_BRIEF_TEXTBOOK_GATE_MISSING','知识簇缺少教材映射时必须阻断 textbook-mapping。',file,'/blockingGates'));
  if (blockingGates.size > 0 && brief.status !== 'review-blocked') findings.push(finding('error','COURSEWARE_BRIEF_BLOCKING_STATUS_INVALID','存在阻断门禁时 status 必须为 review-blocked。',file,'/status'));
  if (blockingGates.size === 0 && brief.status === 'review-blocked') findings.push(finding('error','COURSEWARE_BRIEF_STALE_BLOCK','没有阻断门禁时不能继续标记为 review-blocked。',file,'/status'));

  const objectives = brief.learning?.objectives ?? [];
  const scenes = brief.scenes ?? [];
  const checkpoints = brief.checkpoints ?? [];
  const instruments = brief.instruments ?? [];
  for (const [name,values] of [['objectives',objectives],['scenes',scenes],['checkpoints',checkpoints],['instruments',instruments]]) {
    const ids = values.map(item => item?.id);
    if (values.length === 0 || ids.some(id => !idPattern.test(id ?? '')) || duplicateIds(ids).length) findings.push(finding('error','COURSEWARE_BRIEF_COLLECTION_INVALID',`${name} 必须是非空、ID 唯一的集合。`,file,`/${name}`));
  }
  const objectiveIds = new Set(objectives.map(item => item.id));
  const sceneIds = new Set(scenes.map(item => item.id));
  const instrumentIds = new Set(instruments.map(item => item.id));
  const coveredByScenes = new Set();
  const coveredByCheckpoints = new Set();
  objectives.forEach((item,index) => checkLocalized(item.text,findings,file,`/learning/objectives/${index}/text`));
  (brief.learning?.prerequisites ?? []).forEach((item,index) => checkLocalized(item,findings,file,`/learning/prerequisites/${index}`));
  (brief.learning?.misconceptions ?? []).forEach((item,index) => {
    checkLocalized(item.text,findings,file,`/learning/misconceptions/${index}/text`);
    for (const id of item.objectiveIds ?? []) if (!objectiveIds.has(id)) findings.push(finding('error','COURSEWARE_BRIEF_OBJECTIVE_REFERENCE_INVALID',`误区引用了未知目标 ${id}。`,file,`/learning/misconceptions/${index}/objectiveIds`));
  });
  for (const [index,scene] of scenes.entries()) {
    checkLocalized(scene.title,findings,file,`/scenes/${index}/title`);
    for (const id of scene.objectiveIds ?? []) { if (!objectiveIds.has(id)) findings.push(finding('error','COURSEWARE_BRIEF_OBJECTIVE_REFERENCE_INVALID',`场景引用了未知目标 ${id}。`,file,`/scenes/${index}/objectiveIds`)); else coveredByScenes.add(id); }
    for (const id of scene.instrumentIds ?? []) if (!instrumentIds.has(id)) findings.push(finding('error','COURSEWARE_BRIEF_INSTRUMENT_REFERENCE_INVALID',`场景引用了未知工具 ${id}。`,file,`/scenes/${index}/instrumentIds`));
  }
  for (const [index,checkpoint] of checkpoints.entries()) {
    if (!sceneIds.has(checkpoint.sceneId)) findings.push(finding('error','COURSEWARE_BRIEF_SCENE_REFERENCE_INVALID',`检查点引用了未知场景 ${checkpoint.sceneId}。`,file,`/checkpoints/${index}/sceneId`));
    checkLocalized(checkpoint.prompt,findings,file,`/checkpoints/${index}/prompt`);
    checkLocalized(checkpoint.successEvidence,findings,file,`/checkpoints/${index}/successEvidence`);
    for (const id of checkpoint.objectiveIds ?? []) { if (!objectiveIds.has(id)) findings.push(finding('error','COURSEWARE_BRIEF_OBJECTIVE_REFERENCE_INVALID',`检查点引用了未知目标 ${id}。`,file,`/checkpoints/${index}/objectiveIds`)); else coveredByCheckpoints.add(id); }
  }
  for (const id of objectiveIds) {
    if (!coveredByScenes.has(id)) findings.push(finding('error','COURSEWARE_BRIEF_OBJECTIVE_UNSCENED',`学习目标 ${id} 未被场景覆盖。`,file,'/scenes'));
    if (!coveredByCheckpoints.has(id)) findings.push(finding('error','COURSEWARE_BRIEF_OBJECTIVE_UNASSESSED',`学习目标 ${id} 未被检查点验证。`,file,'/checkpoints'));
  }
  const locales = new Set((brief.acceptance?.journeys ?? []).map(item => item.locale));
  if (!locales.has('zh-CN') || !locales.has('en')) findings.push(finding('error','COURSEWARE_BRIEF_JOURNEY_LOCALE_MISSING','验收旅程必须同时覆盖 zh-CN 与 en。',file,'/acceptance/journeys'));
  if ((brief.acceptance?.embedHosts ?? 0) < 2 || brief.acceptance?.keyboardComplete !== true || brief.acceptance?.reducedMotion !== true) findings.push(finding('error','COURSEWARE_BRIEF_ACCEPTANCE_INCOMPLETE','C4 规格必须要求两个外站容器、完整键盘流程和减少动态效果。',file,'/acceptance'));
  return findings;
}

export async function validateCoursewareBriefs({ catalog = catalogPath, directory = briefsRoot } = {}) {
  const loaded = await loadKnowledgeMapDocument(catalog);
  if (loaded.error) return { ok:false, summary:{ errors:1, warnings:0 }, findings:[loaded.error], briefs:[] };
  const mapReport = validateKnowledgeMap(loaded.document);
  const findings = mapReport.findings.filter(item => item.severity === 'error').map(item => ({ ...item, file:catalog }));
  const files = (await fs.readdir(directory)).filter(file => file.endsWith('.json')).sort();
  const briefs = [];
  for (const name of files) {
    const file = path.join(directory, name);
    try {
      const brief = JSON.parse(await fs.readFile(file, 'utf8'));
      briefs.push(brief);
      findings.push(...validateCoursewareBrief(brief, loaded.document, file));
    } catch (error) {
      findings.push(finding('error','COURSEWARE_BRIEF_JSON_INVALID',`无法读取课件规格：${error.message}`,file));
    }
  }
  if (briefs.length === 0) findings.push(finding('error','COURSEWARE_BRIEF_MISSING','未找到课件规格。',directory));
  const briefIds = briefs.map(item => item.id);
  for (const id of duplicateIds(briefIds)) findings.push(finding('error','COURSEWARE_BRIEF_ID_DUPLICATE',`课件规格 ID 重复：${id}。`,directory));
  const summary = { errors:findings.filter(item => item.severity === 'error').length, warnings:findings.filter(item => item.severity === 'warning').length };
  return { ok:summary.errors === 0, summary, findings, briefs:briefs.map(item => ({ id:item.id, subjectId:item.subjectId, clusterId:item.clusterId, status:item.status, targetDepth:item.targetDepth })) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const report = await validateCoursewareBriefs();
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}
