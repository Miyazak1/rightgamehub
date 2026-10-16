import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCoursewareModuleLock, validateCoursewareModuleManifest } from '../../courseware-runtime/src/index.mjs';

const safeRelativePath = value => typeof value === 'string' && value.length > 0 && value.length <= 255
  && !path.isAbsolute(value) && !value.includes('\\') && value.split('/').every(part => part && part !== '.' && part !== '..');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const runtimeSourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../courseware-runtime/src');

function fail(code, message, details = {}) {
  throw Object.assign(new Error(message), { code, ...details });
}

function resolveEntryPath(manifestPath, entry) {
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(manifestPath), entry));
  if (!safeRelativePath(resolved) || !resolved.endsWith('.mjs')) fail('COURSEWARE_MODULE_ENTRY_INVALID', `模块入口 ${entry} 不能离开模块目录。`, { path:manifestPath,pointer:'/entry' });
  const directory = `${path.posix.dirname(manifestPath)}/`;
  if (!resolved.startsWith(directory)) fail('COURSEWARE_MODULE_ENTRY_INVALID', `模块入口 ${entry} 不能离开模块目录。`, { path:manifestPath,pointer:'/entry' });
  return resolved;
}

async function ordinaryFile(root, relative) {
  if (!safeRelativePath(relative)) fail('COURSEWARE_MODULE_PATH_INVALID', `不安全的模块路径：${relative}`, { path:relative });
  const absolute = path.join(root, ...relative.split('/'));
  const stat = await fs.lstat(absolute).catch(error => error?.code === 'ENOENT' ? null : Promise.reject(error));
  if (!stat?.isFile() || stat.isSymbolicLink()) fail('COURSEWARE_MODULE_FILE_MISSING', `模块文件 ${relative} 不存在或不是普通文件。`, { path:relative });
  const bytes = await fs.readFile(absolute);
  return { relative, absolute, bytes, size:bytes.length, sha256:sha256(bytes) };
}

export async function resolveCoursewareModuleGraph(projectRoot, manifest) {
  if (manifest?.build?.profile !== 'mooyu-structured-v1') return null;
  const runtime = manifest.runtime ?? {};
  if (!Array.isArray(runtime.modules) || !runtime.modules.length || !Array.isArray(runtime.rootModules) || !runtime.rootModules.length) {
    fail('COURSEWARE_MODULE_GRAPH_INVALID', '结构化课件必须声明 runtime.modules 与 runtime.rootModules。', { path:'mooyu-courseware.json',pointer:'/runtime' });
  }
  const records = [];
  for (const manifestPath of runtime.modules) {
    const manifestFile = await ordinaryFile(projectRoot, manifestPath);
    let module;
    try { module = validateCoursewareModuleManifest(JSON.parse(manifestFile.bytes.toString('utf8'))); }
    catch (error) { fail(error.code ?? 'COURSEWARE_MODULE_MANIFEST_INVALID', `${manifestPath}: ${error.message}`, { path:manifestPath,pointer:error.pointer ?? '/' }); }
    const entryPath = resolveEntryPath(manifestPath, module.entry);
    const entryFile = await ordinaryFile(projectRoot, entryPath);
    if (module.integrity !== `sha256:${entryFile.sha256}`) fail('COURSEWARE_MODULE_INTEGRITY_MISMATCH', `模块 ${module.id} 的入口哈希与清单不一致。`, { moduleId:module.id,path:entryPath,pointer:'/integrity' });
    const source = entryFile.bytes.toString('utf8');
    if (/(?:^|\n)\s*import\s*(?:["'{*]|[$\w]+\s*(?:,|\s+from))|(?:^|\n)\s*export\s+[^;\n]*\sfrom\s*["']|\bimport\s*\(/u.test(source)) fail('COURSEWARE_MODULE_BUNDLE_REQUIRED', `模块 ${module.id} 必须由固定 Builder 产出无外部 import 的单文件 ESM。`, { moduleId:module.id,path:entryPath });
    records.push({ manifestPath,manifestFile,entryPath,entryFile,module });
  }
  records.sort((left, right) => left.module.id.localeCompare(right.module.id, 'en'));
  if (new Set(records.map(record => record.manifestPath)).size !== records.length) fail('COURSEWARE_MODULE_GRAPH_INVALID', 'runtime.modules 不能包含重复路径。', { path:'mooyu-courseware.json',pointer:'/runtime/modules' });
  const lock = validateCoursewareModuleLock({
    format:'mooyu.courseware-module-lock',
    schemaVersion:1,
    runtimeApiVersion:1,
    roots:[...runtime.rootModules],
    modules:records.map(record => ({
      manifest:record.manifestPath,
      entry:record.entryPath,
      manifestIntegrity:`sha256:${record.manifestFile.sha256}`,
      module:record.module,
    })),
  });
  const lockBytes = Buffer.from(`${JSON.stringify(lock, null, 2)}\n`);
  return { lock,lockBytes,lockSha256:sha256(lockBytes),records };
}

export async function verifyCoursewareModuleLock(projectRoot, manifest, graph = null, { required = false } = {}) {
  if (manifest?.build?.profile !== 'mooyu-structured-v1') return null;
  const resolved = graph ?? await resolveCoursewareModuleGraph(projectRoot, manifest);
  const lockPath = manifest.runtime?.moduleLock;
  if (!safeRelativePath(lockPath)) fail('COURSEWARE_MODULE_LOCK_INVALID', 'runtime.moduleLock 必须是安全的包内路径。', { path:'mooyu-courseware.json',pointer:'/runtime/moduleLock' });
  const absolute = path.join(projectRoot, ...lockPath.split('/'));
  const existing = await fs.readFile(absolute).catch(error => error?.code === 'ENOENT' ? null : Promise.reject(error));
  if (!existing) {
    if (required) fail('COURSEWARE_MODULE_LOCK_MISSING', `发布包缺少 ${lockPath}。`, { path:lockPath });
    return { ...resolved,lockPath,present:false };
  }
  let parsed;
  try { parsed = validateCoursewareModuleLock(JSON.parse(existing.toString('utf8'))); }
  catch (error) { fail(error.code ?? 'COURSEWARE_MODULE_LOCK_INVALID', `${lockPath}: ${error.message}`, { path:lockPath,pointer:error.pointer ?? '/' }); }
  if (JSON.stringify(parsed) !== JSON.stringify(resolved.lock)) fail('COURSEWARE_MODULE_LOCK_STALE', `${lockPath} 与当前模块图不一致，请重新执行固定 Builder。`, { path:lockPath });
  return { ...resolved,lockPath,present:true };
}

export const coursewareModuleFiles = graph => graph ? graph.records.flatMap(record => [record.manifestFile,record.entryFile]) : [];

export async function coursewareRuntimeFiles(manifest) {
  if (manifest?.build?.profile !== 'mooyu-structured-v1') return [];
  const records = [];
  for (const name of ['index.mjs', 'browser-loader.mjs', 'module-contract.mjs', 'module-lock.mjs', 'runtime.mjs']) {
    const absolute = path.join(runtimeSourceRoot, name); const bytes = await fs.readFile(absolute);
    records.push({ relative:`dist/_mooyu/runtime/${name}`,absolute,bytes,size:bytes.length,sha256:sha256(bytes),generated:true });
  }
  const bootstrap = Buffer.from(`import { CoursewareModuleRegistry, CoursewareRuntime, loadCoursewareModuleRelease } from './runtime/index.mjs';\ntry {\n  const registry = new CoursewareModuleRegistry();\n  const releaseBaseUrl = new URL('../../../', import.meta.url);\n  const release = await loadCoursewareModuleRelease({ registry, releaseBaseUrl, lockUrl: '${manifest.runtime.moduleLock}' });\n  const runtime = new CoursewareRuntime({ registry, locale: document.documentElement.lang || '${manifest.defaultLocale}' });\n  runtime.activate(release.roots);\n  globalThis.mooyuCoursewareRuntime = runtime;\n  document.documentElement.dataset.mooyuRuntime = 'ready';\n  globalThis.dispatchEvent(new CustomEvent('mooyu:runtime-ready', { detail: { runtime, release } }));\n} catch (error) {\n  document.documentElement.dataset.mooyuRuntime = 'error';\n  document.documentElement.dataset.mooyuRuntimeError = error?.code ?? 'COURSEWARE_RUNTIME_BOOT_FAILED';\n  globalThis.dispatchEvent(new CustomEvent('mooyu:runtime-error', { detail: { code: error?.code ?? 'COURSEWARE_RUNTIME_BOOT_FAILED', message: error?.message ?? String(error) } }));\n  console.error('[MOOYU courseware runtime]', error);\n}\n`);
  records.push({ relative:'dist/_mooyu/bootstrap.mjs',absolute:null,bytes:bootstrap,size:bootstrap.length,sha256:sha256(bootstrap),generated:true });
  return records;
}
