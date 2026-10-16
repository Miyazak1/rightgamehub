import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { loadKnowledgeMapDocument, validateKnowledgeMap } from '../packages/creator-tools/src/knowledge-map.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = path.resolve(root, 'curricula/cn-upper-secondary/2017-2020/catalog.json');
const briefsRoot = path.resolve(root, 'curricula/cn-upper-secondary/2017-2020/courseware-briefs');
const outputRoot = path.resolve(root, 'curricula/cn-upper-secondary/2017-2020/review-packets');
const checkOnly = process.argv.includes('--check');
const localized = (zh, en) => ({ 'zh-CN':zh, en });
const makeCheck = (code, zh, en) => ({ code, label:localized(zh,en), required:true, status:'pending' });
const nodeChecks = () => [
  makeCheck('scope-boundary','确认知识边界与粒度符合课标，不与相邻节点重复或遗漏。','Confirm that scope and granularity match the standard without overlap or omission.'),
  makeCheck('terminology','确认中英文术语、符号、单位和表述准确。','Confirm Chinese and English terminology, symbols, units, and wording.'),
  makeCheck('prerequisites','确认先修关系充分、方向正确且没有隐含跳步。','Confirm prerequisites are sufficient, correctly directed, and contain no hidden leaps.'),
  makeCheck('observables','确认可观察量能够支撑目标概念，不把界面效果当成学习证据。','Confirm observables support the concept rather than treating visual effects as evidence.'),
  makeCheck('misconceptions','确认典型误区真实、可诊断并适合检查点验证。','Confirm misconceptions are authentic, diagnosable, and suitable for checkpoint evidence.')
];
const relationChecks = () => [
  makeCheck('relation-validity','确认关系类型与方向准确。','Confirm relation type and direction.'),
  makeCheck('relation-evidence','确认关系有课标依据或明确标为推断。','Confirm the relation is sourced or explicitly marked as inferred.')
];
const clusterChecks = () => [
  makeCheck('cluster-coherence','确认知识簇围绕一个可验证的学习进阶，而非简单拼接主题。','Confirm the cluster forms a testable learning progression rather than a topic bundle.'),
  makeCheck('core-node-selection','确认核心节点足以代表课件学习目标。','Confirm core nodes adequately represent the courseware objectives.'),
  makeCheck('runtime-fit','确认 Domain Pack 与 Instrument 能表达概念且结果可复现。','Confirm Domain Packs and Instruments express the concepts with reproducible results.'),
  makeCheck('assessment-alignment','确认每个学习目标都有可观察、可判定的学习证据。','Confirm every objective has observable, assessable learning evidence.')
];

function relationScope(relation, nodeIds) {
  const fromInside = nodeIds.has(relation.fromNodeId);
  const toInside = nodeIds.has(relation.toNodeId);
  return fromInside && toInside ? 'internal' : toInside ? 'inbound' : 'outbound';
}

function buildPacket(brief, map, digest) {
  const cluster = map.clusters.find(item => item.id === brief.clusterId);
  if (!cluster) throw new Error(`课件规格 ${brief.id} 引用了未知知识簇 ${brief.clusterId}`);
  const nodeIds = new Set(cluster.nodeIds);
  const nodes = cluster.nodeIds.map(id => map.nodes.find(item => item.id === id));
  if (nodes.some(item => !item)) throw new Error(`知识簇 ${cluster.id} 包含未知节点。`);
  const relations = map.relations.filter(item => nodeIds.has(item.fromNodeId) || nodeIds.has(item.toNodeId));
  const mappingsByNode = new Map(cluster.nodeIds.map(nodeId => [nodeId, map.textbookMappings.filter(item => item.nodeId === nodeId)]));
  const mappedNodeCount = [...mappingsByNode.values()].filter(items => items.length > 0).length;
  return {
    format:'mooyu.curriculum-review-packet',
    schemaVersion:1,
    id:`review.${brief.id}`,
    catalogId:map.id,
    catalogDigest:digest,
    briefId:brief.id,
    subjectId:brief.subjectId,
    clusterId:brief.clusterId,
    status:'pending',
    reviewPolicy:[
      localized('此文件是复核工作表，不是审校结论；所有检查项默认为 pending。','This file is a review worksheet, not an approval record; every check starts as pending.'),
      localized('只有具名学科审校人完成节点、关系与知识簇检查后，才能把源图谱改为 subject-checked。','The source map may become subject-checked only after a named subject reviewer completes node, relation, and cluster checks.'),
      localized('教材映射必须基于实际采用版本录入，不得从课程标准页码推测教材章节。','Textbook mappings must use an actually adopted edition and must not infer textbook chapters from curriculum-standard pages.')
    ],
    nodeReviews:nodes.map(node => ({
      nodeId:node.id,
      title:node.title,
      type:node.type,
      ...(node.parentId ? { parentId:node.parentId } : {}),
      curriculumLevels:node.curriculumLevels,
      sourceRefs:node.standardRefs,
      representations:node.representations,
      observableVariables:node.observableVariables,
      interactionCandidates:node.interactionCandidates,
      misconceptions:node.misconceptions ?? [],
      checks:nodeChecks()
    })),
    relationReviews:relations.map(relation => ({
      relationId:relation.id,
      type:relation.type,
      fromNodeId:relation.fromNodeId,
      toNodeId:relation.toNodeId,
      scope:relationScope(relation,nodeIds),
      sourceRefs:relation.standardRefs,
      checks:relationChecks()
    })),
    clusterReview:{
      title:cluster.title,
      coreNodeIds:cluster.coreNodeIds,
      runtimeRequirements:cluster.runtimeRequirements,
      checks:clusterChecks()
    },
    textbookMappingIntake:{
      status:mappedNodeCount===cluster.nodeIds.length?'complete':mappedNodeCount?'mapping-in-progress':'edition-not-selected',
      requiredEditionFields:['publisher','edition','volume','chapter','section','page-range','isbn-or-catalog-id'],
      nodeRows:cluster.nodeIds.map(nodeId => ({
        nodeId,
        status:mappingsByNode.get(nodeId).length?'mapped':'pending',
        mappings:mappingsByNode.get(nodeId).map(item => ({ mappingId:item.id,publisher:item.publisher,edition:item.edition,locator:item.locator }))
      }))
    },
    releaseConditions:[
      localized('所有必需检查项均为 pass 或有明确的 not-applicable 理由。','Every required check is pass or has an explicit not-applicable rationale.'),
      localized('具名审校人和时间写回知识地图，节点与知识簇 subjectChecked=true。','A named reviewer and time are recorded in the knowledge map and nodes and cluster have subjectChecked=true.'),
      localized('至少一个实际采用教材版本完成全部核心节点映射。','At least one actually adopted textbook edition maps every core node.'),
      localized('课件规格重新校验后清除已满足的阻断项；学科审校必须保持独立人工签署。','Revalidation clears satisfied blockers; subject review remains an independent human sign-off.')
    ]
  };
}

const loaded = await loadKnowledgeMapDocument(catalogPath);
if (loaded.error) throw new Error(loaded.error.message);
const validation = validateKnowledgeMap(loaded.document);
if (!validation.ok) throw new Error(`知识地图未通过校验：${validation.summary.errors} 个错误。`);
const briefFiles = (await fs.readdir(briefsRoot)).filter(file => file.endsWith('.json')).sort();
const outputs = [];
await fs.mkdir(outputRoot,{recursive:true});
for (const file of briefFiles) {
  const brief = JSON.parse(await fs.readFile(path.join(briefsRoot,file),'utf8'));
  const packet = buildPacket(brief,loaded.document,validation.digest);
  const target = path.join(outputRoot,`${brief.id}.json`);
  const serialized = `${JSON.stringify(packet,null,2)}\n`;
  if (checkOnly) {
    const existing = await fs.readFile(target,'utf8').catch(() => '');
    if (existing !== serialized) throw new Error(`复核包不是最新生成结果：${path.relative(root,target)}`);
  } else await fs.writeFile(target,serialized,'utf8');
  outputs.push({ file:path.relative(root,target).replaceAll('\\','/'),briefId:brief.id,nodes:packet.nodeReviews.length,relations:packet.relationReviews.length,status:packet.status });
}
process.stdout.write(`${JSON.stringify({ mode:checkOnly?'check':'write',catalogDigest:validation.digest,packets:outputs },null,2)}\n`);
