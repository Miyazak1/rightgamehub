import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { coursewareRuntimeFiles, resolveCoursewareModuleGraph } from './courseware-modules.mjs';

export const COURSEWARE_FORMAT = 'mooyu.courseware';
export const COURSEWARE_SCHEMA_VERSION = 1;
export const COURSEWARE_DOCTOR_REPORT_VERSION = 1;
export const COURSEWARE_VALIDATOR_VERSION = '0.2.0';

const idPattern = /^[a-z][a-z0-9._-]{0,63}$/u;
const localePattern = /^[a-z]{2,3}(?:-[A-Z][A-Za-z0-9]{1,7})?$/u;
const audienceStages = new Set(['primary', 'lower-secondary', 'upper-secondary', 'higher-education', 'professional', 'lifelong']);
const runtimeCapabilities = new Set(['fullscreen', 'pointerLock', 'localSave', 'fileExport', 'shareLinks', 'learningProgress', 'learningEvents', 'assessmentResult']);
const sceneTypes = new Set(['explain', 'explore', 'simulate', 'practice', 'assess', 'reflect']);
const checkpointKinds = new Set(['observation', 'prediction', 'multiple-choice', 'numeric', 'ordering', 'free-response']);
const sourceTypes = new Set(['book', 'paper', 'standard', 'documentation', 'dataset', 'web']);
const verificationKinds = new Set(['primary-source', 'cross-checked', 'reviewed', 'author-asserted']);
const journeyActions = new Set(['enter', 'set', 'click', 'answer', 'assert', 'complete']);
const experienceModeKinds = new Set(['textbook-lab', 'free-sandbox', 'scenario-challenge']);
const experienceViewKinds = new Set(['explore', 'model', 'analyse']);
const freedomLevels = new Set(['F0', 'F1', 'F2', 'F3']);
const experienceCommands = new Set(['object.add', 'object.remove', 'object.place', 'object.connect', 'object.configure', 'simulation.run', 'simulation.pause', 'simulation.step', 'simulation.reset', 'measurement.record', 'snapshot.save', 'snapshot.compare']);
const instrumentKinds = new Set(['probe', 'trace', 'vector', 'graph', 'table', 'comparison', 'annotation', 'replay']);
const sandboxMinimumCommands = ['object.add', 'object.remove', 'object.place', 'object.configure', 'simulation.run', 'simulation.reset', 'measurement.record', 'snapshot.save'];
const ignoredDirectories = new Set(['.git', '.gamehub', '.mooyu', 'node_modules']);
const finding = (severity, code, message, details = {}) => ({ severity, code, message, ...details });
const isObject = value => Boolean(value) && !Array.isArray(value) && typeof value === 'object';
const isTextMap = value => isObject(value)
  && Object.keys(value).length > 0
  && Object.entries(value).every(([locale, text]) => localePattern.test(locale) && typeof text === 'string' && text.trim().length > 0);
const safeRelativePath = value => typeof value === 'string'
  && value.length > 0
  && value.length <= 255
  && !path.isAbsolute(value)
  && !value.includes('\\')
  && value.split('/').every(part => part && part !== '.' && part !== '..');

function rejectUnknown(value, allowed, findings, file, pointer = '') {
  if (!isObject(value)) return;
  for (const key of Object.keys(value)) if (!allowed.includes(key)) {
    findings.push(finding('error', 'COURSEWARE_ADDITIONAL_PROPERTY', `${file} 包含未定义字段 ${key}。`, { path: file, pointer: `${pointer}/${key}` }));
  }
}

function requireFields(value, required, findings, file, pointer = '') {
  if (!isObject(value)) {
    findings.push(finding('error', 'COURSEWARE_OBJECT_REQUIRED', `${file}${pointer || '/'} 必须是 JSON 对象。`, { path: file, pointer: pointer || '/' }));
    return false;
  }
  for (const key of required) if (!(key in value)) {
    findings.push(finding('error', 'COURSEWARE_FIELD_REQUIRED', `${file} 缺少字段 ${key}。`, { path: file, pointer: `${pointer}/${key}` }));
  }
  return true;
}

function requireId(value, findings, file, pointer) {
  if (!idPattern.test(value ?? '')) findings.push(finding('error', 'COURSEWARE_ID_INVALID', `${file}${pointer} 必须是稳定的小写标识符。`, { path: file, pointer }));
}

function requireIdList(value, findings, file, pointer, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.some(id => !idPattern.test(id)) || new Set(value).size !== value.length) {
    findings.push(finding('error', 'COURSEWARE_ID_LIST_INVALID', `${file}${pointer} 必须是${allowEmpty ? '' : '非空'}、无重复的稳定标识符数组。`, { path: file, pointer }));
    return [];
  }
  return value;
}

function requireTextMap(value, findings, file, pointer) {
  if (!isTextMap(value)) findings.push(finding('error', 'COURSEWARE_LOCALIZED_TEXT_INVALID', `${file}${pointer} 必须是非空的语言到文字映射。`, { path: file, pointer }));
}

async function readJson(projectRoot, relative, findings, code = 'COURSEWARE_JSON_INVALID') {
  if (!safeRelativePath(relative)) {
    findings.push(finding('error', 'COURSEWARE_PATH_INVALID', `课程包路径 ${String(relative)} 不安全。`, { path: 'mooyu-courseware.json', pointer: '/' }));
    return null;
  }
  try {
    const absolute = path.join(projectRoot, ...relative.split('/'));
    const stat = await fs.lstat(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('不是普通文件');
    return JSON.parse(await fs.readFile(absolute, 'utf8'));
  } catch (error) {
    findings.push(finding('error', code, `${relative} 无法读取为普通 JSON 文件：${error.message}`, { path: relative, pointer: '/' }));
    return null;
  }
}

async function projectDigest(projectRoot) {
  const hash = crypto.createHash('sha256');
  const walk = async (directory, prefix = '') => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
      if (entry.isSymbolicLink()) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) await walk(path.join(directory, entry.name), relative);
      } else if (entry.isFile()) {
        hash.update(relative.replaceAll('\\', '/')); hash.update('\0');
        hash.update(await fs.readFile(path.join(directory, entry.name))); hash.update('\0');
      }
    }
  };
  try { await walk(projectRoot); } catch (error) { hash.update(`unreadable:${error.message}`); }
  return hash.digest('hex');
}

async function publishableProjectDigest(projectRoot, manifest) {
  const fixed = ['mooyu-courseware.json',manifest?.course,manifest?.experience,manifest?.mission,manifest?.capabilityBindings,manifest?.evidenceModel,manifest?.evidence,manifest?.tests].filter(Boolean);
  if (fixed.some(relative => !safeRelativePath(relative))) return projectDigest(projectRoot);
  const records = [];
  const add = async relative => records.push({ relative,bytes:await fs.readFile(path.join(projectRoot,...relative.split('/'))) });
  try {
    for (const relative of fixed) await add(relative);
    const moduleGraph = await resolveCoursewareModuleGraph(projectRoot, manifest);
    if (moduleGraph) {
      for (const record of moduleGraph.records) {
        records.push({ relative:record.manifestFile.relative,bytes:record.manifestFile.bytes });
        records.push({ relative:record.entryFile.relative,bytes:record.entryFile.bytes });
      }
      records.push({ relative:manifest.runtime.moduleLock,bytes:moduleGraph.lockBytes });
      for (const record of await coursewareRuntimeFiles(manifest)) records.push({ relative:record.relative,bytes:record.bytes });
    }
    const walk = async (directory,prefix='dist') => {
      for (const entry of await fs.readdir(directory,{ withFileTypes:true })) {
        const relative = `${prefix}/${entry.name}`;
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) await walk(path.join(directory,entry.name),relative);
        else if (entry.isFile() && relative !== manifest?.runtime?.moduleLock && !relative.startsWith('dist/_mooyu/')) await add(relative);
      }
    };
    await walk(path.join(projectRoot,'dist'));
    const hash = crypto.createHash('sha256');
    for (const record of [...new Map(records.map(record => [record.relative,record])).values()].sort((left,right) => left.relative.localeCompare(right.relative,'en'))) {
      hash.update(record.relative); hash.update('\0'); hash.update(record.bytes); hash.update('\0');
    }
    return hash.digest('hex');
  } catch { return projectDigest(projectRoot); }
}

function validateManifest(manifest, findings) {
  const file = 'mooyu-courseware.json';
  const allowed = ['format', 'schemaVersion', 'id', 'title', 'summary', 'defaultLocale', 'locales', 'subjects', 'audience', 'catalog', 'course', 'experience', 'mission', 'capabilityBindings', 'evidenceModel', 'evidence', 'tests', 'build', 'runtime', 'licenses'];
  const required = ['format', 'schemaVersion', 'id', 'title', 'defaultLocale', 'locales', 'subjects', 'audience', 'course', 'evidence', 'tests', 'build', 'runtime', 'licenses'];
  if (!requireFields(manifest, required, findings, file)) return;
  rejectUnknown(manifest, allowed, findings, file);
  if (manifest.format !== COURSEWARE_FORMAT || manifest.schemaVersion !== COURSEWARE_SCHEMA_VERSION) findings.push(finding('error', 'COURSEWARE_FORMAT_UNSUPPORTED', '课程包必须使用 mooyu.courseware schemaVersion 1。', { path: file, pointer: '/format' }));
  requireId(manifest.id, findings, file, '/id'); requireTextMap(manifest.title, findings, file, '/title');
  if (manifest.summary !== undefined) requireTextMap(manifest.summary, findings, file, '/summary');
  if (!localePattern.test(manifest.defaultLocale ?? '') || !Array.isArray(manifest.locales) || !manifest.locales.includes(manifest.defaultLocale) || new Set(manifest.locales).size !== manifest.locales.length || manifest.locales.some(locale => !localePattern.test(locale))) findings.push(finding('error', 'COURSEWARE_LOCALES_INVALID', 'defaultLocale 必须出现在无重复的 locales 列表中。', { path: file, pointer: '/locales' }));
  requireIdList(manifest.subjects, findings, file, '/subjects');
  if (!isObject(manifest.audience) || !Array.isArray(manifest.audience.stages) || !manifest.audience.stages.length || new Set(manifest.audience.stages).size !== manifest.audience.stages.length || manifest.audience.stages.some(stage => !audienceStages.has(stage))) findings.push(finding('error', 'COURSEWARE_AUDIENCE_INVALID', 'audience.stages 必须是无重复的受支持学习阶段。', { path: file, pointer: '/audience' }));
  else rejectUnknown(manifest.audience, ['stages', 'minimumAge', 'maximumAge'], findings, file, '/audience');
  if (manifest.catalog !== undefined) {
    const catalogFields = ['category', 'topic', 'estimatedMinutes', 'order', 'cover'];
    if (requireFields(manifest.catalog, ['category', 'topic', 'estimatedMinutes', 'cover'], findings, file, '/catalog')) {
      rejectUnknown(manifest.catalog, catalogFields, findings, file, '/catalog');
      requireTextMap(manifest.catalog.topic, findings, file, '/catalog/topic');
      if (!['simulations', 'practice', 'tools', 'topics'].includes(manifest.catalog.category) || !Number.isInteger(manifest.catalog.estimatedMinutes) || manifest.catalog.estimatedMinutes < 1 || manifest.catalog.estimatedMinutes > 240 || (manifest.catalog.order !== undefined && (!Number.isInteger(manifest.catalog.order) || manifest.catalog.order < 0))) findings.push(finding('error', 'COURSEWARE_CATALOG_INVALID', 'catalog 必须声明有效分类、主题、时长与排序。', { path:file,pointer:'/catalog' }));
      if (!isObject(manifest.catalog.cover) || typeof manifest.catalog.cover.symbol !== 'string' || !manifest.catalog.cover.symbol.trim() || !idPattern.test(manifest.catalog.cover.tone ?? '')) findings.push(finding('error', 'COURSEWARE_CATALOG_COVER_INVALID', 'catalog.cover 必须声明短符号与合法色调 ID。', { path:file,pointer:'/catalog/cover' }));
      else rejectUnknown(manifest.catalog.cover, ['symbol', 'tone'], findings, file, '/catalog/cover');
    }
  }
  for (const key of ['course', 'evidence', 'tests']) if (!safeRelativePath(manifest[key])) findings.push(finding('error', 'COURSEWARE_PATH_INVALID', `${key} 必须是包内安全相对路径。`, { path: file, pointer: `/${key}` }));
  for (const key of ['experience','mission','capabilityBindings','evidenceModel']) if (manifest[key] !== undefined && !safeRelativePath(manifest[key])) findings.push(finding('error', 'COURSEWARE_PATH_INVALID', `${key} 必须是包内安全相对路径。`, { path: file, pointer: `/${key}` }));
  const missionPaths = ['mission','capabilityBindings','evidenceModel'].filter(key => manifest[key] !== undefined);
  if (missionPaths.length !== 0 && missionPaths.length !== 3) findings.push(finding('error', 'COURSEWARE_MISSION_DOCUMENTS_INCOMPLETE', '综合任务必须同时声明 mission、capabilityBindings 与 evidenceModel。', { path:file,pointer:'/mission' }));
  if (!isObject(manifest.build) || !['mooyu-static-v1', 'mooyu-structured-v1'].includes(manifest.build.profile) || manifest.build.entry !== 'dist/index.html') findings.push(finding('error', 'COURSEWARE_BUILD_PROFILE_INVALID', 'build 必须使用受支持的固定构建配置和 dist/index.html。', { path: file, pointer: '/build' }));
  else rejectUnknown(manifest.build, ['profile', 'entry'], findings, file, '/build');
  if (!isObject(manifest.runtime) || manifest.runtime.learningSdk !== 1 || !['static-web', 'static-wasm'].includes(manifest.runtime.kind) || !Array.isArray(manifest.runtime.capabilities) || new Set(manifest.runtime.capabilities).size !== manifest.runtime.capabilities.length || manifest.runtime.capabilities.some(capability => !runtimeCapabilities.has(capability))) findings.push(finding('error', 'COURSEWARE_RUNTIME_INVALID', 'runtime 必须声明静态运行类型、Learning SDK v1 与无重复的已知能力数组。', { path: file, pointer: '/runtime' }));
  else {
    rejectUnknown(manifest.runtime, ['kind', 'learningSdk', 'capabilities', 'profile', 'modules', 'rootModules', 'moduleLock'], findings, file, '/runtime');
    const structured = manifest.build?.profile === 'mooyu-structured-v1';
    if (structured && (manifest.runtime.profile !== 'structured-courseware'
      || !Array.isArray(manifest.runtime.modules) || manifest.runtime.modules.length === 0 || new Set(manifest.runtime.modules).size !== manifest.runtime.modules.length || manifest.runtime.modules.some(modulePath => !safeRelativePath(modulePath) || !modulePath.endsWith('.json'))
      || !Array.isArray(manifest.runtime.rootModules) || manifest.runtime.rootModules.length === 0 || new Set(manifest.runtime.rootModules).size !== manifest.runtime.rootModules.length || manifest.runtime.rootModules.some(id => !idPattern.test(id))
      || manifest.runtime.moduleLock !== 'dist/mooyu-modules.lock.json')) findings.push(finding('error', 'COURSEWARE_MODULE_GRAPH_INVALID', '结构化课件必须声明模块清单、根模块与固定模块锁路径。', { path:file,pointer:'/runtime' }));
    if (!structured && manifest.runtime.profile !== undefined && manifest.runtime.profile !== 'legacy-web') findings.push(finding('error', 'COURSEWARE_RUNTIME_PROFILE_INVALID', '静态课件只能声明 legacy-web 运行配置。', { path:file,pointer:'/runtime/profile' }));
  }
  if (!isObject(manifest.licenses) || typeof manifest.licenses.code !== 'string' || typeof manifest.licenses.content !== 'string') findings.push(finding('error', 'COURSEWARE_LICENSE_INVALID', 'licenses 必须声明 code 与 content。', { path: file, pointer: '/licenses' }));
  else rejectUnknown(manifest.licenses, ['code', 'content'], findings, file, '/licenses');
}

function validateCourse(course, findings, file) {
  const required = ['schemaVersion', 'objectives', 'prerequisites', 'misconceptions', 'scenes', 'checkpoints', 'completion'];
  if (!requireFields(course, required, findings, file)) return null;
  rejectUnknown(course, required, findings, file);
  if (course.schemaVersion !== 1) findings.push(finding('error', 'COURSEWARE_COURSE_VERSION_INVALID', 'course schemaVersion 必须为 1。', { path: file, pointer: '/schemaVersion' }));
  const collections = [['objectives', course.objectives], ['scenes', course.scenes], ['checkpoints', course.checkpoints]];
  const sets = {};
  for (const [name, values] of collections) {
    if (!Array.isArray(values) || values.length === 0) { findings.push(finding('error', 'COURSEWARE_COLLECTION_EMPTY', `${name} 至少需要一项。`, { path: file, pointer: `/${name}` })); sets[name] = new Set(); continue; }
    const ids = values.map(value => value?.id); sets[name] = new Set(ids);
    ids.forEach((id, index) => requireId(id, findings, file, `/${name}/${index}/id`));
    if (sets[name].size !== ids.length) findings.push(finding('error', 'COURSEWARE_ID_DUPLICATE', `${name} 中存在重复 ID。`, { path: file, pointer: `/${name}` }));
  }
  for (const [index, objective] of (course.objectives ?? []).entries()) {
    rejectUnknown(objective, ['id', 'text'], findings, file, `/objectives/${index}`); requireTextMap(objective?.text, findings, file, `/objectives/${index}/text`);
  }
  if (!Array.isArray(course.prerequisites) || course.prerequisites.some(value => !isTextMap(value))) findings.push(finding('error', 'COURSEWARE_PREREQUISITES_INVALID', 'prerequisites 必须是本地化文字数组。', { path: file, pointer: '/prerequisites' }));
  if (!Array.isArray(course.misconceptions)) findings.push(finding('error', 'COURSEWARE_MISCONCEPTIONS_INVALID', 'misconceptions 必须是数组。', { path: file, pointer: '/misconceptions' }));
  for (const [index, misconception] of (course.misconceptions ?? []).entries()) {
    rejectUnknown(misconception, ['id', 'text', 'objectiveIds'], findings, file, `/misconceptions/${index}`); requireId(misconception?.id, findings, file, `/misconceptions/${index}/id`); requireTextMap(misconception?.text, findings, file, `/misconceptions/${index}/text`);
    for (const id of requireIdList(misconception?.objectiveIds, findings, file, `/misconceptions/${index}/objectiveIds`)) if (!sets.objectives.has(id)) findings.push(finding('error', 'COURSEWARE_OBJECTIVE_REFERENCE_INVALID', `误区 ${misconception?.id} 引用了不存在的目标 ${id}。`, { path: file, pointer: `/misconceptions/${index}/objectiveIds` }));
  }
  for (const [index, scene] of (course.scenes ?? []).entries()) {
    rejectUnknown(scene, ['id', 'type', 'title', 'objectiveIds', 'evidenceIds', 'component', 'fallback'], findings, file, `/scenes/${index}`);
    requireTextMap(scene?.title, findings, file, `/scenes/${index}/title`); requireTextMap(scene?.fallback, findings, file, `/scenes/${index}/fallback`);
    if (!sceneTypes.has(scene?.type)) findings.push(finding('error', 'COURSEWARE_SCENE_TYPE_INVALID', `场景 ${scene?.id ?? index} 的 type 不受支持。`, { path: file, pointer: `/scenes/${index}/type` }));
    const objectiveIds = requireIdList(scene?.objectiveIds, findings, file, `/scenes/${index}/objectiveIds`);
    for (const id of objectiveIds) if (!sets.objectives.has(id)) findings.push(finding('error', 'COURSEWARE_OBJECTIVE_REFERENCE_INVALID', `场景 ${scene?.id} 引用了不存在的目标 ${id}。`, { path: file, pointer: `/scenes/${index}/objectiveIds` }));
    requireIdList(scene?.evidenceIds, findings, file, `/scenes/${index}/evidenceIds`, { allowEmpty: true });
    if (!isObject(scene?.component) || !idPattern.test(scene.component.type ?? '') || (scene.component.config !== undefined && !isObject(scene.component.config))) findings.push(finding('error', 'COURSEWARE_COMPONENT_INVALID', `场景 ${scene?.id ?? index} 缺少稳定组件类型或 config 不是对象。`, { path: file, pointer: `/scenes/${index}/component` }));
    else rejectUnknown(scene.component, ['type', 'config'], findings, file, `/scenes/${index}/component`);
  }
  for (const [index, checkpoint] of (course.checkpoints ?? []).entries()) {
    rejectUnknown(checkpoint, ['id', 'sceneId', 'objectiveIds', 'kind', 'prompt', 'answer'], findings, file, `/checkpoints/${index}`);
    if (!checkpointKinds.has(checkpoint?.kind)) findings.push(finding('error', 'COURSEWARE_CHECKPOINT_KIND_INVALID', `检查点 ${checkpoint?.id ?? index} 的 kind 不受支持。`, { path: file, pointer: `/checkpoints/${index}/kind` }));
    if (!sets.scenes.has(checkpoint?.sceneId)) findings.push(finding('error', 'COURSEWARE_SCENE_REFERENCE_INVALID', `检查点 ${checkpoint?.id} 引用了不存在的场景 ${checkpoint?.sceneId}。`, { path: file, pointer: `/checkpoints/${index}/sceneId` }));
    const objectiveIds = requireIdList(checkpoint?.objectiveIds, findings, file, `/checkpoints/${index}/objectiveIds`);
    for (const id of objectiveIds) if (!sets.objectives.has(id)) findings.push(finding('error', 'COURSEWARE_OBJECTIVE_REFERENCE_INVALID', `检查点 ${checkpoint?.id} 引用了不存在的目标 ${id}。`, { path: file, pointer: `/checkpoints/${index}/objectiveIds` }));
    requireTextMap(checkpoint?.prompt, findings, file, `/checkpoints/${index}/prompt`);
  }
  const completionObjectives = requireIdList(course.completion?.objectiveIds, findings, file, '/completion/objectiveIds');
  const completionCheckpoints = requireIdList(course.completion?.checkpointIds, findings, file, '/completion/checkpointIds');
  rejectUnknown(course.completion, ['objectiveIds', 'checkpointIds'], findings, file, '/completion');
  for (const id of completionObjectives) if (!sets.objectives.has(id)) findings.push(finding('error', 'COURSEWARE_COMPLETION_REFERENCE_INVALID', `完成规则引用了不存在的目标 ${id}。`, { path: file, pointer: '/completion/objectiveIds' }));
  for (const id of completionCheckpoints) if (!sets.checkpoints.has(id)) findings.push(finding('error', 'COURSEWARE_COMPLETION_REFERENCE_INVALID', `完成规则引用了不存在的检查点 ${id}。`, { path: file, pointer: '/completion/checkpointIds' }));
  for (const id of sets.objectives) {
    if (!(course.scenes ?? []).some(scene => scene.objectiveIds?.includes(id))) findings.push(finding('error', 'COURSEWARE_OBJECTIVE_UNCOVERED', `学习目标 ${id} 没有场景覆盖。`, { path: file, pointer: '/scenes' }));
    if (!(course.checkpoints ?? []).some(checkpoint => checkpoint.objectiveIds?.includes(id))) findings.push(finding('error', 'COURSEWARE_OBJECTIVE_UNASSESSED', `学习目标 ${id} 没有检查点验证。`, { path: file, pointer: '/checkpoints' }));
  }
  return { objectiveIds: sets.objectives, sceneIds: sets.scenes, checkpointIds: sets.checkpoints };
}

function validateEvidence(evidence, findings, file, course, courseFile) {
  if (!requireFields(evidence, ['schemaVersion', 'sources', 'claims'], findings, file)) return;
  rejectUnknown(evidence, ['schemaVersion', 'sources', 'claims', 'assets'], findings, file);
  if (evidence.schemaVersion !== 1) findings.push(finding('error', 'COURSEWARE_EVIDENCE_VERSION_INVALID', 'evidence schemaVersion 必须为 1。', { path: file, pointer: '/schemaVersion' }));
  const sources = Array.isArray(evidence.sources) ? evidence.sources : [];
  const claims = Array.isArray(evidence.claims) ? evidence.claims : [];
  if (!sources.length || !claims.length) findings.push(finding('error', 'COURSEWARE_EVIDENCE_EMPTY', '证据文件至少需要一个来源和一个事实声明。', { path: file, pointer: '/' }));
  const sourceIds = new Set(sources.map(source => source?.id)); const claimIds = new Set(claims.map(claim => claim?.id));
  if (sourceIds.size !== sources.length || claimIds.size !== claims.length) findings.push(finding('error', 'COURSEWARE_ID_DUPLICATE', '证据来源或声明存在重复 ID。', { path: file, pointer: '/' }));
  for (const [index, source] of sources.entries()) { rejectUnknown(source, ['id', 'type', 'title', 'authors', 'publisher', 'url', 'publishedAt', 'accessedAt', 'license', 'locator'], findings, file, `/sources/${index}`); requireId(source?.id, findings, file, `/sources/${index}/id`); if (typeof source?.title !== 'string' || !source.title.trim() || !sourceTypes.has(source?.type)) findings.push(finding('error', 'COURSEWARE_SOURCE_INVALID', '来源必须有标题和受支持的 type。', { path: file, pointer: `/sources/${index}` })); }
  for (const [index, claim] of claims.entries()) {
    rejectUnknown(claim, ['id', 'text', 'sourceIds', 'locators', 'verification'], findings, file, `/claims/${index}`); requireId(claim?.id, findings, file, `/claims/${index}/id`); requireTextMap(claim?.text, findings, file, `/claims/${index}/text`);
    if (!verificationKinds.has(claim?.verification)) findings.push(finding('error', 'COURSEWARE_VERIFICATION_INVALID', `声明 ${claim?.id ?? index} 的 verification 不受支持。`, { path: file, pointer: `/claims/${index}/verification` }));
    for (const id of requireIdList(claim?.sourceIds, findings, file, `/claims/${index}/sourceIds`)) if (!sourceIds.has(id)) findings.push(finding('error', 'COURSEWARE_SOURCE_REFERENCE_INVALID', `声明 ${claim?.id} 引用了不存在的来源 ${id}。`, { path: file, pointer: `/claims/${index}/sourceIds` }));
  }
  for (const [index, asset] of (evidence.assets ?? []).entries()) {
    rejectUnknown(asset, ['path', 'sourceIds', 'license'], findings, file, `/assets/${index}`);
    if (!safeRelativePath(asset?.path) || typeof asset?.license !== 'string' || !asset.license.trim()) findings.push(finding('error', 'COURSEWARE_ASSET_INVALID', `素材 ${index} 缺少安全路径或许可证。`, { path: file, pointer: `/assets/${index}` }));
    for (const id of requireIdList(asset?.sourceIds, findings, file, `/assets/${index}/sourceIds`)) if (!sourceIds.has(id)) findings.push(finding('error', 'COURSEWARE_SOURCE_REFERENCE_INVALID', `素材 ${asset?.path ?? index} 引用了不存在的来源 ${id}。`, { path: file, pointer: `/assets/${index}/sourceIds` }));
  }
  for (const [index, scene] of (course?.scenes ?? []).entries()) for (const id of scene.evidenceIds ?? []) if (!claimIds.has(id)) findings.push(finding('error', 'COURSEWARE_EVIDENCE_REFERENCE_INVALID', `场景 ${scene.id} 引用了不存在的证据声明 ${id}。`, { path: courseFile, pointer: `/scenes/${index}/evidenceIds` }));
}

function validateJourneys(journeys, findings, file, courseSets) {
  if (!requireFields(journeys, ['schemaVersion', 'journeys'], findings, file)) return;
  rejectUnknown(journeys, ['schemaVersion', 'journeys'], findings, file);
  if (journeys.schemaVersion !== 1) findings.push(finding('error', 'COURSEWARE_JOURNEY_VERSION_INVALID', 'journeys schemaVersion 必须为 1。', { path: file, pointer: '/schemaVersion' }));
  if (!Array.isArray(journeys.journeys) || !journeys.journeys.length) { findings.push(finding('error', 'COURSEWARE_JOURNEY_EMPTY', '至少需要一条学习路径。', { path: file, pointer: '/journeys' })); return; }
  const ids = journeys.journeys.map(journey => journey?.id);
  if (new Set(ids).size !== ids.length) findings.push(finding('error', 'COURSEWARE_ID_DUPLICATE', '学习路径存在重复 ID。', { path: file, pointer: '/journeys' }));
  for (const [index, journey] of journeys.journeys.entries()) {
    rejectUnknown(journey, ['id', 'title', 'locale', 'steps', 'expectsCompletion'], findings, file, `/journeys/${index}`); requireId(journey?.id, findings, file, `/journeys/${index}/id`);
    if (typeof journey?.title !== 'string' || !journey.title.trim() || !localePattern.test(journey?.locale ?? '') || typeof journey?.expectsCompletion !== 'boolean') findings.push(finding('error', 'COURSEWARE_JOURNEY_INVALID', `学习路径 ${journey?.id ?? index} 的标题、语言或完成声明无效。`, { path: file, pointer: `/journeys/${index}` }));
    if (!Array.isArray(journey?.steps) || !journey.steps.length) findings.push(finding('error', 'COURSEWARE_JOURNEY_STEPS_EMPTY', `学习路径 ${journey?.id} 没有步骤。`, { path: file, pointer: `/journeys/${index}/steps` }));
    for (const [stepIndex, step] of (journey?.steps ?? []).entries()) {
      rejectUnknown(step, ['action', 'target', 'value', 'expect'], findings, file, `/journeys/${index}/steps/${stepIndex}`);
      if (!journeyActions.has(step?.action) || !idPattern.test(step?.target ?? '')) findings.push(finding('error', 'COURSEWARE_JOURNEY_STEP_INVALID', `学习路径 ${journey?.id} 包含无效步骤。`, { path: file, pointer: `/journeys/${index}/steps/${stepIndex}` }));
      if (step?.action === 'enter' && !courseSets?.sceneIds.has(step.target)) findings.push(finding('error', 'COURSEWARE_JOURNEY_SCENE_INVALID', `学习路径 ${journey?.id} 进入了不存在的场景 ${step.target}。`, { path: file, pointer: `/journeys/${index}/steps/${stepIndex}/target` }));
    }
  }
  if (!journeys.journeys.some(journey => journey.expectsCompletion === true && journey.steps?.some(step => step.action === 'complete'))) findings.push(finding('error', 'COURSEWARE_COMPLETION_JOURNEY_MISSING', '至少需要一条可完成课程的验收路径。', { path: file, pointer: '/journeys' }));
}

function validateExperience(experience, findings, file, courseSets) {
  const rootFields = ['format', 'schemaVersion', 'engine', 'defaultMode', 'modes', 'defaultView', 'views', 'instruments'];
  if (!requireFields(experience, ['format', 'schemaVersion', 'engine', 'defaultMode', 'modes'], findings, file)) return;
  rejectUnknown(experience, rootFields, findings, file);
  if (experience.format !== 'mooyu.courseware-experience' || experience.schemaVersion !== 1) findings.push(finding('error', 'COURSEWARE_EXPERIENCE_FORMAT_INVALID', 'experience 必须使用 mooyu.courseware-experience schemaVersion 1。', { path:file,pointer:'/format' }));

  const engine = experience.engine;
  const engineFields = ['id', 'version', 'deterministic', 'snapshot', 'stateVariables'];
  if (requireFields(engine, engineFields, findings, file, '/engine')) {
    rejectUnknown(engine, engineFields, findings, file, '/engine');
    requireId(engine.id, findings, file, '/engine/id');
    if (!Number.isInteger(engine.version) || engine.version < 1 || engine.deterministic !== true || engine.snapshot !== true) findings.push(finding('error', 'COURSEWARE_EXPERIENCE_ENGINE_INVALID', '实验引擎必须有正整数版本，并支持确定性重放和状态快照。', { path:file,pointer:'/engine' }));
    requireIdList(engine.stateVariables, findings, file, '/engine/stateVariables');
  }

  const instruments = Array.isArray(experience.instruments) ? experience.instruments : [];
  if (experience.instruments !== undefined && !Array.isArray(experience.instruments)) findings.push(finding('error', 'COURSEWARE_EXPERIENCE_INSTRUMENTS_INVALID', 'experience.instruments 必须是数组。', { path:file,pointer:'/instruments' }));
  const instrumentIds = new Set(instruments.map(value => value?.id));
  if (instrumentIds.size !== instruments.length) findings.push(finding('error', 'COURSEWARE_ID_DUPLICATE', 'experience 中存在重复工具 ID。', { path:file,pointer:'/instruments' }));
  for (const [index, instrument] of instruments.entries()) {
    const pointer = `/instruments/${index}`;
    if (!requireFields(instrument, ['id', 'kind', 'title'], findings, file, pointer)) continue;
    rejectUnknown(instrument, ['id', 'kind', 'title'], findings, file, pointer);
    requireId(instrument.id, findings, file, `${pointer}/id`); requireTextMap(instrument.title, findings, file, `${pointer}/title`);
    if (!instrumentKinds.has(instrument.kind)) findings.push(finding('error', 'COURSEWARE_EXPERIENCE_INSTRUMENT_INVALID', `工具 ${instrument.id ?? index} 的 kind 不受支持。`, { path:file,pointer:`${pointer}/kind` }));
  }

  const declaresViews = experience.defaultView !== undefined || experience.views !== undefined;
  if (declaresViews) {
    if (!requireFields(experience, ['defaultView', 'views'], findings, file)) return;
    const views = Array.isArray(experience.views) ? experience.views : [];
    if (!views.length) findings.push(finding('error', 'COURSEWARE_EXPERIENCE_VIEWS_EMPTY', 'experience 至少需要一个观察视图。', { path:file,pointer:'/views' }));
    const viewIds = new Set(views.map(value => value?.id));
    if (viewIds.size !== views.length) findings.push(finding('error', 'COURSEWARE_ID_DUPLICATE', 'experience 中存在重复视图 ID。', { path:file,pointer:'/views' }));
    if (!viewIds.has(experience.defaultView)) findings.push(finding('error', 'COURSEWARE_EXPERIENCE_DEFAULT_VIEW_INVALID', 'defaultView 必须引用已声明的视图。', { path:file,pointer:'/defaultView' }));
    for (const [index, view] of views.entries()) {
      const pointer = `/views/${index}`;
      const fields = ['id', 'kind', 'title', 'purpose', 'instrumentIds'];
      if (!requireFields(view, fields, findings, file, pointer)) continue;
      rejectUnknown(view, fields, findings, file, pointer);
      requireId(view.id, findings, file, `${pointer}/id`); requireTextMap(view.title, findings, file, `${pointer}/title`); requireTextMap(view.purpose, findings, file, `${pointer}/purpose`);
      if (!experienceViewKinds.has(view.kind)) findings.push(finding('error', 'COURSEWARE_EXPERIENCE_VIEW_KIND_INVALID', `视图 ${view.id ?? index} 的 kind 不受支持。`, { path:file,pointer:`${pointer}/kind` }));
      for (const instrumentId of requireIdList(view.instrumentIds, findings, file, `${pointer}/instrumentIds`, { allowEmpty:true })) if (!instrumentIds.has(instrumentId)) findings.push(finding('error', 'COURSEWARE_EXPERIENCE_INSTRUMENT_REFERENCE_INVALID', `视图 ${view.id} 引用了不存在的工具 ${instrumentId}。`, { path:file,pointer:`${pointer}/instrumentIds` }));
    }
  }

  const modes = Array.isArray(experience.modes) ? experience.modes : [];
  if (!modes.length) findings.push(finding('error', 'COURSEWARE_EXPERIENCE_MODES_EMPTY', 'experience 至少需要一种真实可用的体验模式。', { path:file,pointer:'/modes' }));
  const modeIds = new Set(modes.map(value => value?.id));
  if (modeIds.size !== modes.length) findings.push(finding('error', 'COURSEWARE_ID_DUPLICATE', 'experience 中存在重复模式 ID。', { path:file,pointer:'/modes' }));
  if (!modeIds.has(experience.defaultMode)) findings.push(finding('error', 'COURSEWARE_EXPERIENCE_DEFAULT_MODE_INVALID', 'defaultMode 必须引用已声明的模式。', { path:file,pointer:'/defaultMode' }));

  for (const [index, mode] of modes.entries()) {
    const pointer = `/modes/${index}`;
    const fields = ['id', 'kind', 'title', 'sceneIds', 'freedomLevel', 'allowedCommands', 'instrumentIds', 'curiosityHook'];
    if (!requireFields(mode, fields, findings, file, pointer)) continue;
    rejectUnknown(mode, [...fields, 'challenge'], findings, file, pointer);
    requireId(mode.id, findings, file, `${pointer}/id`); requireTextMap(mode.title, findings, file, `${pointer}/title`); requireTextMap(mode.curiosityHook, findings, file, `${pointer}/curiosityHook`);
    if (!experienceModeKinds.has(mode.kind)) findings.push(finding('error', 'COURSEWARE_EXPERIENCE_MODE_KIND_INVALID', `模式 ${mode.id ?? index} 的 kind 不受支持。`, { path:file,pointer:`${pointer}/kind` }));
    if (!freedomLevels.has(mode.freedomLevel)) findings.push(finding('error', 'COURSEWARE_EXPERIENCE_FREEDOM_INVALID', `模式 ${mode.id ?? index} 的 freedomLevel 无效。`, { path:file,pointer:`${pointer}/freedomLevel` }));
    for (const sceneId of requireIdList(mode.sceneIds, findings, file, `${pointer}/sceneIds`)) if (!courseSets?.sceneIds.has(sceneId)) findings.push(finding('error', 'COURSEWARE_EXPERIENCE_SCENE_INVALID', `模式 ${mode.id} 引用了不存在的场景 ${sceneId}。`, { path:file,pointer:`${pointer}/sceneIds` }));
    const commands = requireIdList(mode.allowedCommands, findings, file, `${pointer}/allowedCommands`, { allowEmpty:true });
    for (const command of commands) if (!experienceCommands.has(command)) findings.push(finding('error', 'COURSEWARE_EXPERIENCE_COMMAND_INVALID', `模式 ${mode.id} 声明了未知命令 ${command}。`, { path:file,pointer:`${pointer}/allowedCommands` }));
    for (const instrumentId of requireIdList(mode.instrumentIds, findings, file, `${pointer}/instrumentIds`, { allowEmpty:true })) if (!instrumentIds.has(instrumentId)) findings.push(finding('error', 'COURSEWARE_EXPERIENCE_INSTRUMENT_REFERENCE_INVALID', `模式 ${mode.id} 引用了不存在的工具 ${instrumentId}。`, { path:file,pointer:`${pointer}/instrumentIds` }));

    if (mode.kind === 'free-sandbox') {
      const missing = sandboxMinimumCommands.filter(command => !commands.includes(command));
      if (!['F2', 'F3'].includes(mode.freedomLevel) || missing.length) findings.push(finding('error', 'COURSEWARE_SANDBOX_FREEDOM_INSUFFICIENT', `自由实验必须达到 F2/F3，并支持自由增删、放置、配置、运行、复位、记录和快照；缺少：${missing.join('、') || '无'}。`, { path:file,pointer }));
    }

    if (mode.kind !== 'scenario-challenge') {
      if (mode.challenge !== undefined) findings.push(finding('error', 'COURSEWARE_CHALLENGE_UNEXPECTED', `非场景挑战模式 ${mode.id} 不应声明 challenge。`, { path:file,pointer:`${pointer}/challenge` }));
      continue;
    }
    const challenge = mode.challenge;
    const challengeFields = ['id', 'title', 'goal', 'success', 'attemptPolicy'];
    if (!requireFields(challenge, challengeFields, findings, file, `${pointer}/challenge`)) continue;
    rejectUnknown(challenge, challengeFields, findings, file, `${pointer}/challenge`);
    requireId(challenge.id, findings, file, `${pointer}/challenge/id`); requireTextMap(challenge.title, findings, file, `${pointer}/challenge/title`); requireTextMap(challenge.goal, findings, file, `${pointer}/challenge/goal`);
    if (!Array.isArray(challenge.success) || !challenge.success.length) findings.push(finding('error', 'COURSEWARE_CHALLENGE_RULES_INVALID', `挑战 ${challenge.id ?? index} 缺少成功条件。`, { path:file,pointer:`${pointer}/challenge/success` }));
    for (const [conditionIndex, condition] of (Array.isArray(challenge.success)?challenge.success:[]).entries()) {
      const conditionPointer = `${pointer}/challenge/success/${conditionIndex}`;
      if (!isObject(condition) || !idPattern.test(condition.metric ?? '') || !['eq', 'gte', 'lte', 'between'].includes(condition.operator)) { findings.push(finding('error', 'COURSEWARE_CHALLENGE_RULES_INVALID', `挑战 ${challenge.id ?? index} 包含无效成功条件。`, { path:file,pointer:conditionPointer })); continue; }
      rejectUnknown(condition, condition.operator === 'between' ? ['metric', 'operator', 'values'] : ['metric', 'operator', 'value'], findings, file, conditionPointer);
      if (condition.operator === 'between' ? (!Array.isArray(condition.values) || condition.values.length !== 2 || condition.values.some(value => typeof value !== 'number') || condition.values[0] > condition.values[1]) : typeof condition.value !== 'number') findings.push(finding('error', 'COURSEWARE_CHALLENGE_RULES_INVALID', `挑战 ${challenge.id ?? index} 的成功阈值无效。`, { path:file,pointer:conditionPointer }));
    }
    const attempt = challenge.attemptPolicy;
    if (!isObject(attempt) || !Number.isInteger(attempt.maxAttempts) || attempt.maxAttempts < 1 || attempt.maxAttempts > 100 || !['instant', 'after-feedback'].includes(attempt.retry)) findings.push(finding('error', 'COURSEWARE_CHALLENGE_ATTEMPT_POLICY_INVALID', `挑战 ${challenge.id ?? index} 的尝试规则无效。`, { path:file,pointer:`${pointer}/challenge/attemptPolicy` }));
    else rejectUnknown(attempt, ['maxAttempts', 'retry'], findings, file, `${pointer}/challenge/attemptPolicy`);
  }
}

function validateMissionCondition(condition, findings, file, pointer, meters, metricIds) {
  if (!isObject(condition) || !['metric','resource','clock','state','evidence'].includes(condition.source) || !idPattern.test(condition.id ?? '') || !['eq','neq','gt','gte','lt','lte','between','truthy','falsy'].includes(condition.operator)) {
    findings.push(finding('error','COURSEWARE_MISSION_CONDITION_INVALID',`${file}${pointer} 包含无效任务条件。`,{path:file,pointer})); return;
  }
  rejectUnknown(condition,['source','id','operator','value','values'],findings,file,pointer);
  if (condition.source === 'metric') metricIds.add(condition.id);
  if (condition.source === 'clock' && !meters.clocks.has(condition.id)) findings.push(finding('error','COURSEWARE_MISSION_METER_REFERENCE_INVALID',`任务条件引用了不存在的时钟 ${condition.id}。`,{path:file,pointer}));
  if (condition.source === 'resource' && !meters.resources.has(condition.id)) findings.push(finding('error','COURSEWARE_MISSION_METER_REFERENCE_INVALID',`任务条件引用了不存在的资源 ${condition.id}。`,{path:file,pointer}));
  if (condition.operator === 'between') {
    if (!Array.isArray(condition.values) || condition.values.length !== 2 || condition.values.some(value => !Number.isFinite(value)) || condition.values[0] > condition.values[1]) findings.push(finding('error','COURSEWARE_MISSION_CONDITION_INVALID','between 条件必须提供递增的两个数值。',{path:file,pointer:`${pointer}/values`}));
  } else if (!['truthy','falsy'].includes(condition.operator) && !['number','string','boolean'].includes(typeof condition.value)) findings.push(finding('error','COURSEWARE_MISSION_CONDITION_INVALID','任务比较条件缺少有效 value。',{path:file,pointer:`${pointer}/value`}));
}

function validateMission(mission, findings, file) {
  const rootFields=['format','schemaVersion','id','version','title','initialNodeId','capabilitySlots','clocks','resources','nodes','outcomes'];
  if (!requireFields(mission,rootFields,findings,file)) return null;
  rejectUnknown(mission,rootFields,findings,file);
  if (mission.format !== 'mooyu.learning-mission' || mission.schemaVersion !== 1) findings.push(finding('error','COURSEWARE_MISSION_FORMAT_INVALID','mission 必须使用 mooyu.learning-mission schemaVersion 1。',{path:file,pointer:'/format'}));
  requireId(mission.id,findings,file,'/id'); requireTextMap(mission.title,findings,file,'/title');
  if (!/^\d+\.\d+\.\d+$/u.test(mission.version ?? '')) findings.push(finding('error','COURSEWARE_MISSION_VERSION_INVALID','mission.version 必须使用稳定语义版本。',{path:file,pointer:'/version'}));
  const slots=new Set(requireIdList(mission.capabilitySlots,findings,file,'/capabilitySlots',{allowEmpty:true}));
  const meters={clocks:new Set(),resources:new Set()};
  for (const [kind,items] of [['clocks',mission.clocks],['resources',mission.resources]]) {
    if (!Array.isArray(items) || (kind === 'clocks' && items.length === 0)) { findings.push(finding('error','COURSEWARE_MISSION_METER_INVALID',`${kind} 必须是${kind === 'clocks'?'非空':''}数组。`,{path:file,pointer:`/${kind}`})); continue; }
    for (const [index,meter] of items.entries()) {
      const pointer=`/${kind}/${index}`; rejectUnknown(meter,['id','initial','minimum','maximum'],findings,file,pointer); requireId(meter?.id,findings,file,`${pointer}/id`);
      if (meters[kind].has(meter?.id)) findings.push(finding('error','COURSEWARE_ID_DUPLICATE',`${kind} 存在重复 ID ${meter?.id}。`,{path:file,pointer}));
      meters[kind].add(meter?.id);
      if (![meter?.initial,meter?.minimum,meter?.maximum].every(Number.isFinite) || meter.minimum > meter.maximum || meter.initial < meter.minimum || meter.initial > meter.maximum) findings.push(finding('error','COURSEWARE_MISSION_METER_INVALID',`任务量表 ${meter?.id ?? index} 的初始值或范围无效。`,{path:file,pointer}));
    }
  }
  const nodes=Array.isArray(mission.nodes)?mission.nodes:[]; const nodeIds=new Set(nodes.map(node=>node?.id));
  if (!nodes.length || nodeIds.size !== nodes.length) findings.push(finding('error','COURSEWARE_MISSION_NODE_INVALID','任务节点必须非空且 ID 无重复。',{path:file,pointer:'/nodes'}));
  if (!nodeIds.has(mission.initialNodeId)) findings.push(finding('error','COURSEWARE_MISSION_NODE_REFERENCE_INVALID',`初始节点 ${mission.initialNodeId} 不存在。`,{path:file,pointer:'/initialNodeId'}));
  const metricIds=new Set(); const emittedClaims=new Set();
  for (const [nodeIndex,node] of nodes.entries()) {
    const pointer=`/nodes/${nodeIndex}`; rejectUnknown(node,['id','kind','title','capabilitySlots','actions'],findings,file,pointer); requireId(node?.id,findings,file,`${pointer}/id`); requireTextMap(node?.title,findings,file,`${pointer}/title`);
    if (!['briefing','calculation','construction','simulation','decision','checkpoint','debrief'].includes(node?.kind)) findings.push(finding('error','COURSEWARE_MISSION_NODE_INVALID',`节点 ${node?.id ?? nodeIndex} 的 kind 无效。`,{path:file,pointer:`${pointer}/kind`}));
    for (const slot of requireIdList(node?.capabilitySlots ?? [],findings,file,`${pointer}/capabilitySlots`,{allowEmpty:true})) if (!slots.has(slot)) findings.push(finding('error','COURSEWARE_MISSION_SLOT_REFERENCE_INVALID',`节点 ${node.id} 引用了未声明能力槽 ${slot}。`,{path:file,pointer:`${pointer}/capabilitySlots`}));
    const actions=Array.isArray(node?.actions)?node.actions:[]; const actionIds=new Set(actions.map(action=>action?.id));
    if (!actions.length || actionIds.size !== actions.length) findings.push(finding('error','COURSEWARE_MISSION_ACTION_INVALID',`节点 ${node?.id ?? nodeIndex} 必须有无重复行动。`,{path:file,pointer:`${pointer}/actions`}));
    for (const [actionIndex,action] of actions.entries()) {
      const actionPointer=`${pointer}/actions/${actionIndex}`; requireFields(action,['id','title','success','onSuccess'],findings,file,actionPointer); rejectUnknown(action,['id','title','clockCosts','resourceCosts','success','onSuccess','onFailure','evidence'],findings,file,actionPointer); requireId(action?.id,findings,file,`${actionPointer}/id`); requireTextMap(action?.title,findings,file,`${actionPointer}/title`);
      for (const [field,meterSet] of [['clockCosts',meters.clocks],['resourceCosts',meters.resources]]) for (const [id,amount] of Object.entries(action?.[field] ?? {})) if (!meterSet.has(id) || !Number.isFinite(amount) || amount < 0) findings.push(finding('error','COURSEWARE_MISSION_COST_INVALID',`行动 ${action?.id} 的 ${field}.${id} 无效。`,{path:file,pointer:`${actionPointer}/${field}/${id}`}));
      if(!Array.isArray(action?.success))findings.push(finding('error','COURSEWARE_MISSION_ACTION_INVALID',`行动 ${action?.id ?? actionIndex} 的 success 必须是条件数组。`,{path:file,pointer:`${actionPointer}/success`}));
      for (const [conditionIndex,condition] of (Array.isArray(action?.success)?action.success:[]).entries()) validateMissionCondition(condition,findings,file,`${actionPointer}/success/${conditionIndex}`,meters,metricIds);
      for (const field of ['onSuccess','onFailure']) if (action?.[field] !== undefined) {
        if(!requireFields(action[field],['to'],findings,file,`${actionPointer}/${field}`))continue;
        rejectUnknown(action[field],['to','when'],findings,file,`${actionPointer}/${field}`);
        if (!nodeIds.has(action[field].to)) findings.push(finding('error','COURSEWARE_MISSION_NODE_REFERENCE_INVALID',`行动 ${action.id} 指向不存在的节点 ${action[field].to}。`,{path:file,pointer:`${actionPointer}/${field}/to`}));
        const when=action[field].when;
        if(when!==undefined&&!Array.isArray(when))findings.push(finding('error','COURSEWARE_MISSION_CONDITION_INVALID',`行动 ${action.id} 的 ${field}.when 必须是条件数组。`,{path:file,pointer:`${actionPointer}/${field}/when`}));
        for (const [conditionIndex,condition] of (Array.isArray(when)?when:[]).entries()) validateMissionCondition(condition,findings,file,`${actionPointer}/${field}/when/${conditionIndex}`,meters,metricIds);
      }
      const evidenceItems=action?.evidence;
      if(evidenceItems!==undefined&&!Array.isArray(evidenceItems))findings.push(finding('error','COURSEWARE_MISSION_EVIDENCE_INVALID',`行动 ${action?.id ?? actionIndex} 的 evidence 必须是证据数组。`,{path:file,pointer:`${actionPointer}/evidence`}));
      for (const [evidenceIndex,evidence] of (Array.isArray(evidenceItems)?evidenceItems:[]).entries()) {
        const evidencePointer=`${actionPointer}/evidence/${evidenceIndex}`; requireFields(evidence,['claimId','kind'],findings,file,evidencePointer); rejectUnknown(evidence,['claimId','kind','strength'],findings,file,evidencePointer); requireId(evidence?.claimId,findings,file,`${evidencePointer}/claimId`);
        if(!['prediction','calculation','configuration','measurement','comparison','explanation','transfer'].includes(evidence?.kind)||(evidence?.strength!==undefined&&(!Number.isFinite(evidence.strength)||evidence.strength<0||evidence.strength>1)))findings.push(finding('error','COURSEWARE_MISSION_EVIDENCE_INVALID',`行动 ${action?.id ?? actionIndex} 的证据类型或强度无效。`,{path:file,pointer:evidencePointer}));
        emittedClaims.add(evidence?.claimId);
      }
    }
  }
  const outcomes=Array.isArray(mission.outcomes)?mission.outcomes:[]; const outcomeIds=new Set(outcomes.map(outcome=>outcome?.id));
  if (!outcomes.length || outcomeIds.size !== outcomes.length) findings.push(finding('error','COURSEWARE_MISSION_OUTCOME_INVALID','任务必须声明无重复的结局。',{path:file,pointer:'/outcomes'}));
  for (const [index,outcome] of outcomes.entries()) { const pointer=`/outcomes/${index}`; rejectUnknown(outcome,['id','kind','title','when'],findings,file,pointer); requireId(outcome?.id,findings,file,`${pointer}/id`); requireTextMap(outcome?.title,findings,file,`${pointer}/title`); if (!['success','partial','failure'].includes(outcome?.kind)) findings.push(finding('error','COURSEWARE_MISSION_OUTCOME_INVALID',`结局 ${outcome?.id ?? index} kind 无效。`,{path:file,pointer:`${pointer}/kind`})); if(!Array.isArray(outcome?.when)||outcome.when.length===0)findings.push(finding('error','COURSEWARE_MISSION_CONDITION_INVALID',`结局 ${outcome?.id ?? index} 的 when 必须是非空条件数组。`,{path:file,pointer:`${pointer}/when`})); for(const [conditionIndex,condition] of (Array.isArray(outcome?.when)?outcome.when:[]).entries()) validateMissionCondition(condition,findings,file,`${pointer}/when/${conditionIndex}`,meters,metricIds); }
  return { id:mission.id,slots,nodeIds,metricIds,emittedClaims };
}

function validateCapabilityBindings(document, findings, file, missionInfo, moduleGraph=null) {
  const fields=['format','schemaVersion','missionId','bindings']; if(!requireFields(document,fields,findings,file))return null; rejectUnknown(document,fields,findings,file);
  if(document.format!=='mooyu.mission-capability-binding'||document.schemaVersion!==1||document.missionId!==missionInfo?.id)findings.push(finding('error','COURSEWARE_MISSION_BINDING_INVALID','能力绑定格式、版本或 missionId 不匹配。',{path:file,pointer:'/missionId'}));
  const bindings=Array.isArray(document.bindings)?document.bindings:[]; const slots=new Set(); const metrics=new Set();
  for(const [index,binding] of bindings.entries()){
    const pointer=`/bindings/${index}`; requireFields(binding,['slot','moduleId','capability','metrics'],findings,file,pointer); rejectUnknown(binding,['slot','moduleId','capability','query','metrics'],findings,file,pointer); requireId(binding?.slot,findings,file,`${pointer}/slot`); requireId(binding?.moduleId,findings,file,`${pointer}/moduleId`); requireId(binding?.capability,findings,file,`${pointer}/capability`);
    if(slots.has(binding?.slot)||!missionInfo?.slots.has(binding?.slot))findings.push(finding('error','COURSEWARE_MISSION_SLOT_REFERENCE_INVALID',`能力槽 ${binding?.slot} 重复或未在任务中声明。`,{path:file,pointer:`${pointer}/slot`})); slots.add(binding?.slot);
    const bindingMetrics=binding?.metrics;
    if(!Array.isArray(bindingMetrics)||bindingMetrics.length===0)findings.push(finding('error','COURSEWARE_MISSION_BINDING_INVALID',`能力槽 ${binding?.slot ?? index} 的 metrics 必须是非空数组。`,{path:file,pointer:`${pointer}/metrics`}));
    for(const [metricIndex,metric] of (Array.isArray(bindingMetrics)?bindingMetrics:[]).entries()){
      const metricPointer=`${pointer}/metrics/${metricIndex}`; requireFields(metric,['id','path'],findings,file,metricPointer); rejectUnknown(metric,['id','path'],findings,file,metricPointer); requireId(metric?.id,findings,file,`${metricPointer}/id`);
      if(typeof metric?.path!=='string'||metric.path.length>255||!/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/u.test(metric.path))findings.push(finding('error','COURSEWARE_MISSION_BINDING_INVALID',`指标 ${metric?.id ?? metricIndex} 的 path 无效。`,{path:file,pointer:`${metricPointer}/path`}));
      if(metrics.has(metric?.id))findings.push(finding('error','COURSEWARE_MISSION_METRIC_DUPLICATE',`指标 ${metric?.id} 被重复绑定。`,{path:file,pointer:`${metricPointer}/id`})); metrics.add(metric?.id);
    }
    if(moduleGraph){ const record=moduleGraph.records.find(item=>item.module.id===binding?.moduleId); if(!record)findings.push(finding('error','COURSEWARE_MISSION_MODULE_REFERENCE_INVALID',`能力槽 ${binding?.slot} 绑定了未发布模块 ${binding?.moduleId}。`,{path:file,pointer:`${pointer}/moduleId`})); else if(!record.module.capabilities.includes(binding?.capability))findings.push(finding('error','COURSEWARE_MISSION_CAPABILITY_INVALID',`模块 ${binding.moduleId} 不提供能力 ${binding.capability}。`,{path:file,pointer:`${pointer}/capability`})); }
  }
  for(const slot of missionInfo?.slots??[])if(!slots.has(slot))findings.push(finding('error','COURSEWARE_MISSION_SLOT_UNBOUND',`任务能力槽 ${slot} 未绑定。`,{path:file,pointer:'/bindings'}));
  for(const metric of missionInfo?.metricIds??[])if(!metrics.has(metric))findings.push(finding('error','COURSEWARE_MISSION_METRIC_UNBOUND',`任务条件指标 ${metric} 未绑定。`,{path:file,pointer:'/bindings'}));
  return { metrics };
}

function validateLearningEvidenceModel(model, findings, file, missionInfo, courseSets) {
  const fields=['format','schemaVersion','id','objectiveIds','claims']; if(!requireFields(model,fields,findings,file))return; rejectUnknown(model,fields,findings,file);
  if(model.format!=='mooyu.learning-evidence-model'||model.schemaVersion!==1)findings.push(finding('error','COURSEWARE_LEARNING_EVIDENCE_FORMAT_INVALID','evidenceModel 格式或版本无效。',{path:file,pointer:'/format'}));
  const objectives=new Set(requireIdList(model.objectiveIds,findings,file,'/objectiveIds'));
  for(const objective of objectives)if(courseSets&&!courseSets.objectiveIds.has(objective))findings.push(finding('error','COURSEWARE_OBJECTIVE_REFERENCE_INVALID',`学习证据模型引用了不存在的目标 ${objective}。`,{path:file,pointer:'/objectiveIds'}));
  const claims=Array.isArray(model.claims)?model.claims:[]; const claimIds=new Set(claims.map(claim=>claim?.id)); if(!claims.length||claimIds.size!==claims.length)findings.push(finding('error','COURSEWARE_LEARNING_EVIDENCE_INVALID','学习证据声明必须非空且 ID 无重复。',{path:file,pointer:'/claims'}));
  for(const [index,claim] of claims.entries()){
    const pointer=`/claims/${index}`; requireFields(claim,['id','objectiveId','kind','weight','minimumStrength'],findings,file,pointer); rejectUnknown(claim,['id','objectiveId','kind','weight','minimumStrength','required'],findings,file,pointer); requireId(claim?.id,findings,file,`${pointer}/id`);
    if(!objectives.has(claim?.objectiveId))findings.push(finding('error','COURSEWARE_OBJECTIVE_REFERENCE_INVALID',`证据声明 ${claim?.id} 引用了未声明目标 ${claim?.objectiveId}。`,{path:file,pointer:`${pointer}/objectiveId`}));
    if(!['prediction','calculation','configuration','measurement','comparison','explanation','transfer'].includes(claim?.kind)||!Number.isFinite(claim?.weight)||claim.weight<=0||claim.weight>100||!Number.isFinite(claim?.minimumStrength)||claim.minimumStrength<0||claim.minimumStrength>1||(claim.required!==undefined&&typeof claim.required!=='boolean'))findings.push(finding('error','COURSEWARE_LEARNING_EVIDENCE_INVALID',`证据声明 ${claim?.id ?? index} 的类型、权重、阈值或 required 无效。`,{path:file,pointer}));
  }
  for(const claimId of missionInfo?.emittedClaims??[])if(!claimIds.has(claimId))findings.push(finding('error','COURSEWARE_MISSION_EVIDENCE_REFERENCE_INVALID',`任务发射了未在学习证据模型声明的 ${claimId}。`,{path:file,pointer:'/claims'}));
}

export async function inspectCoursewareProject(root) {
  const projectRoot = path.resolve(root); const findings = [];
  const manifest = await readJson(projectRoot, 'mooyu-courseware.json', findings, 'COURSEWARE_MANIFEST_INVALID');
  if (manifest) validateManifest(manifest, findings);
  const coursePath = safeRelativePath(manifest?.course) ? manifest.course : 'courseware/course.json';
  const evidencePath = safeRelativePath(manifest?.evidence) ? manifest.evidence : 'evidence/sources.json';
  const testsPath = safeRelativePath(manifest?.tests) ? manifest.tests : 'tests/journeys.json';
  const course = manifest ? await readJson(projectRoot, coursePath, findings) : null;
  const courseSets = course ? validateCourse(course, findings, coursePath) : null;
  const experiencePath = safeRelativePath(manifest?.experience) ? manifest.experience : null;
  const experience = experiencePath ? await readJson(projectRoot, experiencePath, findings) : null;
  if (experience) validateExperience(experience, findings, experiencePath, courseSets);
  const missionPath=safeRelativePath(manifest?.mission)?manifest.mission:null;
  const bindingsPath=safeRelativePath(manifest?.capabilityBindings)?manifest.capabilityBindings:null;
  const evidenceModelPath=safeRelativePath(manifest?.evidenceModel)?manifest.evidenceModel:null;
  const mission=missionPath?await readJson(projectRoot,missionPath,findings):null;
  const bindings=bindingsPath?await readJson(projectRoot,bindingsPath,findings):null;
  const evidenceModel=evidenceModelPath?await readJson(projectRoot,evidenceModelPath,findings):null;
  const missionInfo=mission?validateMission(mission,findings,missionPath):null;
  if(bindings&&missionInfo)validateCapabilityBindings(bindings,findings,bindingsPath,missionInfo);
  if(evidenceModel&&missionInfo)validateLearningEvidenceModel(evidenceModel,findings,evidenceModelPath,missionInfo,courseSets);
  const evidence = manifest ? await readJson(projectRoot, evidencePath, findings) : null;
  if (evidence) validateEvidence(evidence, findings, evidencePath, course, coursePath);
  const journeys = manifest ? await readJson(projectRoot, testsPath, findings) : null;
  if (journeys) validateJourneys(journeys, findings, testsPath, courseSets);
  if (manifest?.build?.profile === 'mooyu-structured-v1' && !findings.some(value => value.severity === 'error' && value.path === 'mooyu-courseware.json')) {
    try {
      const graph = await resolveCoursewareModuleGraph(projectRoot, manifest);
      if(bindings&&missionInfo)validateCapabilityBindings(bindings,findings,bindingsPath,missionInfo,graph);
      findings.push(finding('info', 'COURSEWARE_MODULE_GRAPH_READY', `${graph.records.length} 个模块的依赖、API 版本与入口完整性已通过检查。`, { path:'mooyu-courseware.json',pointer:'/runtime/modules' }));
    } catch (error) {
      findings.push(finding('error', error.code ?? 'COURSEWARE_MODULE_GRAPH_INVALID', error.message, { path:error.path ?? 'mooyu-courseware.json',pointer:error.pointer ?? '/runtime/modules' }));
    }
  }
  const entry = manifest?.build?.entry ?? 'dist/index.html';
  if (safeRelativePath(entry)) try {
    const stat = await fs.lstat(path.join(projectRoot, ...entry.split('/')));
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 16) throw new Error('不是有效普通文件');
  } catch (error) { findings.push(finding('error', 'COURSEWARE_ENTRY_MISSING', `构建入口 ${entry} 不可用：${error.message}`, { path: 'mooyu-courseware.json', pointer: '/build/entry' })); }
  if (!findings.some(value => value.severity === 'error')) findings.push(finding('info', 'COURSEWARE_CONTRACT_READY', `课程结构、证据链、学习路径${experience ? '、体验模式' : ''}${mission ? '、综合任务' : ''}和构建入口通过 L0 契约检查。`));
  findings.push(finding('warning', 'COURSEWARE_DOCTOR_LIMIT', 'L0 Doctor 验证结构与引用完整性，不替代学科专家审校、无障碍审计或浏览器旅程执行。'));
  const summary = { errors: findings.filter(value => value.severity === 'error').length, warnings: findings.filter(value => value.severity === 'warning').length, info: findings.filter(value => value.severity === 'info').length };
  return { reportVersion: COURSEWARE_DOCTOR_REPORT_VERSION, validatorVersion: COURSEWARE_VALIDATOR_VERSION, projectDigest: await publishableProjectDigest(projectRoot,manifest), root: projectRoot, ok: summary.errors === 0, summary, findings };
}
