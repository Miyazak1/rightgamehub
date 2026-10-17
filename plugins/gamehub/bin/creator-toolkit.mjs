// scripts/creator-toolkit-cli.mjs
import fs5 from "node:fs/promises";
import path5 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// packages/creator-tools/src/index.mjs
import fs4 from "node:fs/promises";
import path4 from "node:path";

// packages/rules-sdk/src/index.mjs
var RULES_MANIFEST_PROTOCOL = "gamehub.rules-manifest.v1";
var RULES_MANIFEST_MAX_BYTES = 64 * 1024;
var RULES_BUNDLE_MAX_BYTES = 1024 * 1024;
var emptyReleaseDescription = Object.freeze({
  installed: false,
  protocol: RULES_MANIFEST_PROTOCOL,
  manifestSha256: null,
  keyId: null,
  createdAt: null,
  adapterCount: 0
});

// packages/creator-tools/src/courseware.mjs
import crypto2 from "node:crypto";
import fs2 from "node:fs/promises";
import path2 from "node:path";

// packages/creator-tools/src/courseware-modules.mjs
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// packages/courseware-runtime/src/module-contract.mjs
var COURSEWARE_MODULE_FORMAT = "mooyu.courseware-module";
var COURSEWARE_MODULE_SCHEMA_VERSION = 1;
var COURSEWARE_MODULE_API_VERSION = 1;
var COURSEWARE_MODULE_KINDS = Object.freeze([
  "domain",
  "scenario",
  "construction",
  "challenge",
  "component",
  "instrument",
  "journey",
  "embed"
]);
var COURSEWARE_HOT_SWAP_MODES = Object.freeze(["live", "paused", "session"]);
var idPattern = /^[a-z][a-z0-9._-]{0,127}$/u;
var semverPattern = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/u;
var integrityPattern = /^sha256:[a-f0-9]{64}$/u;
var allowedRootFields = /* @__PURE__ */ new Set([
  "format",
  "schemaVersion",
  "id",
  "version",
  "kind",
  "apiVersion",
  "entry",
  "integrity",
  "hotSwap",
  "stateSchemaVersion",
  "capabilities",
  "commands",
  "dependencies"
]);
var allowedDependencyFields = /* @__PURE__ */ new Set(["id", "apiVersion", "capabilities", "optional"]);
var hotSwapByKind = Object.freeze({
  domain: /* @__PURE__ */ new Set(["paused", "session"]),
  scenario: /* @__PURE__ */ new Set(["paused", "session"]),
  construction: /* @__PURE__ */ new Set(["paused", "session"]),
  challenge: /* @__PURE__ */ new Set(["paused", "session"]),
  component: /* @__PURE__ */ new Set(["live", "paused", "session"]),
  instrument: /* @__PURE__ */ new Set(["live", "paused", "session"]),
  journey: /* @__PURE__ */ new Set(["paused", "session"]),
  embed: /* @__PURE__ */ new Set(["session"])
});
function fail(code, message, details = {}) {
  throw Object.assign(new Error(message), { code, ...details });
}
function exactFields(value, allowed, pointer) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("COURSEWARE_MODULE_MANIFEST_INVALID", `${pointer} must be an object.`, { pointer });
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail("COURSEWARE_MODULE_MANIFEST_INVALID", `${pointer} contains unknown field ${key}.`, { pointer: `${pointer}/${key}` });
}
function ids(value, pointer, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || !allowEmpty && value.length === 0 || value.length > 128 || new Set(value).size !== value.length || value.some((item2) => !idPattern.test(item2))) {
    fail("COURSEWARE_MODULE_MANIFEST_INVALID", `${pointer} must be a bounded list of unique stable identifiers.`, { pointer });
  }
  return [...value];
}
function safeEntry(value) {
  return typeof value === "string" && /^\.\/[a-zA-Z0-9._/-]+\.mjs$/u.test(value) && !value.split("/").some((part) => part === ".." || part === "");
}
function validateCoursewareModuleManifest(value) {
  exactFields(value, allowedRootFields, "/");
  for (const field of ["format", "schemaVersion", "id", "version", "kind", "apiVersion", "entry", "integrity", "hotSwap", "stateSchemaVersion", "capabilities", "commands", "dependencies"]) {
    if (!(field in value)) fail("COURSEWARE_MODULE_MANIFEST_INVALID", `Module manifest is missing ${field}.`, { pointer: `/${field}` });
  }
  if (value.format !== COURSEWARE_MODULE_FORMAT || value.schemaVersion !== COURSEWARE_MODULE_SCHEMA_VERSION) fail("COURSEWARE_MODULE_FORMAT_UNSUPPORTED", "Unsupported courseware module format.", { pointer: "/format" });
  if (!idPattern.test(value.id)) fail("COURSEWARE_MODULE_MANIFEST_INVALID", "Module id is invalid.", { pointer: "/id" });
  if (!semverPattern.test(value.version)) fail("COURSEWARE_MODULE_MANIFEST_INVALID", "Module version must be semantic versioning.", { pointer: "/version" });
  if (!COURSEWARE_MODULE_KINDS.includes(value.kind)) fail("COURSEWARE_MODULE_MANIFEST_INVALID", "Module kind is invalid.", { pointer: "/kind" });
  if (!Number.isInteger(value.apiVersion) || value.apiVersion < 1) fail("COURSEWARE_MODULE_MANIFEST_INVALID", "apiVersion must be a positive integer.", { pointer: "/apiVersion" });
  if (!safeEntry(value.entry)) fail("COURSEWARE_MODULE_MANIFEST_INVALID", "entry must be a safe local .mjs path.", { pointer: "/entry" });
  if (!integrityPattern.test(value.integrity)) fail("COURSEWARE_MODULE_MANIFEST_INVALID", "integrity must be a SHA-256 release digest.", { pointer: "/integrity" });
  if (!hotSwapByKind[value.kind].has(value.hotSwap)) fail("COURSEWARE_MODULE_HOT_SWAP_INVALID", `${value.kind} modules cannot use ${value.hotSwap} hot swap.`, { pointer: "/hotSwap" });
  if (!Number.isInteger(value.stateSchemaVersion) || value.stateSchemaVersion < 1) fail("COURSEWARE_MODULE_MANIFEST_INVALID", "stateSchemaVersion must be a positive integer.", { pointer: "/stateSchemaVersion" });
  const capabilities = ids(value.capabilities, "/capabilities");
  const commands = ids(value.commands, "/commands");
  if (!Array.isArray(value.dependencies) || value.dependencies.length > 64) fail("COURSEWARE_MODULE_MANIFEST_INVALID", "dependencies must be a bounded array.", { pointer: "/dependencies" });
  const dependencies = value.dependencies.map((dependency, index) => {
    const pointer = `/dependencies/${index}`;
    exactFields(dependency, allowedDependencyFields, pointer);
    if (!idPattern.test(dependency.id) || dependency.id === value.id) fail("COURSEWARE_MODULE_MANIFEST_INVALID", "Dependency id is invalid.", { pointer: `${pointer}/id` });
    if (!Number.isInteger(dependency.apiVersion) || dependency.apiVersion < 1) fail("COURSEWARE_MODULE_MANIFEST_INVALID", "Dependency apiVersion must be a positive integer.", { pointer: `${pointer}/apiVersion` });
    if (dependency.optional !== void 0 && typeof dependency.optional !== "boolean") fail("COURSEWARE_MODULE_MANIFEST_INVALID", "Dependency optional must be boolean.", { pointer: `${pointer}/optional` });
    return Object.freeze({ id: dependency.id, apiVersion: dependency.apiVersion, capabilities: Object.freeze(ids(dependency.capabilities ?? [], `${pointer}/capabilities`)), optional: dependency.optional === true });
  });
  if (new Set(dependencies.map((item2) => item2.id)).size !== dependencies.length) fail("COURSEWARE_MODULE_MANIFEST_INVALID", "Dependency ids must be unique.", { pointer: "/dependencies" });
  return Object.freeze({
    format: value.format,
    schemaVersion: value.schemaVersion,
    id: value.id,
    version: value.version,
    kind: value.kind,
    apiVersion: value.apiVersion,
    entry: value.entry,
    integrity: value.integrity,
    hotSwap: value.hotSwap,
    stateSchemaVersion: value.stateSchemaVersion,
    capabilities: Object.freeze(capabilities),
    commands: Object.freeze(commands),
    dependencies: Object.freeze(dependencies)
  });
}

// packages/courseware-runtime/src/module-lock.mjs
var COURSEWARE_MODULE_LOCK_FORMAT = "mooyu.courseware-module-lock";
var COURSEWARE_MODULE_LOCK_SCHEMA_VERSION = 1;
var pathPattern = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\)[A-Za-z0-9][A-Za-z0-9._/-]*$/u;
var integrityPattern2 = /^sha256:[a-f0-9]{64}$/u;
var idPattern2 = /^[a-z][a-z0-9._-]{0,127}$/u;
var allowedRootFields2 = /* @__PURE__ */ new Set(["format", "schemaVersion", "runtimeApiVersion", "roots", "modules"]);
var allowedRecordFields = /* @__PURE__ */ new Set(["manifest", "entry", "manifestIntegrity", "module"]);
function fail2(code, message, details = {}) {
  throw Object.assign(new Error(message), { code, ...details });
}
function exactObject(value, allowed, pointer) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail2("COURSEWARE_MODULE_LOCK_INVALID", `${pointer} must be an object.`, { pointer });
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail2("COURSEWARE_MODULE_LOCK_INVALID", `${pointer} contains unknown field ${key}.`, { pointer: `${pointer}/${key}` });
}
function safePath(value, pointer, extension) {
  if (typeof value !== "string" || value.length > 255 || !pathPattern.test(value) || extension && !value.endsWith(extension)) {
    fail2("COURSEWARE_MODULE_LOCK_INVALID", `${pointer} must be a safe package-relative ${extension ?? ""} path.`, { pointer });
  }
  return value;
}
function validateCoursewareModuleLock(value) {
  exactObject(value, allowedRootFields2, "/");
  for (const field of ["format", "schemaVersion", "runtimeApiVersion", "roots", "modules"]) {
    if (!(field in value)) fail2("COURSEWARE_MODULE_LOCK_INVALID", `Module lock is missing ${field}.`, { pointer: `/${field}` });
  }
  if (value.format !== COURSEWARE_MODULE_LOCK_FORMAT || value.schemaVersion !== COURSEWARE_MODULE_LOCK_SCHEMA_VERSION) {
    fail2("COURSEWARE_MODULE_LOCK_UNSUPPORTED", "Unsupported courseware module lock format.", { pointer: "/format" });
  }
  if (value.runtimeApiVersion !== COURSEWARE_MODULE_API_VERSION) fail2("COURSEWARE_MODULE_LOCK_UNSUPPORTED", "Module lock runtime API version is unsupported.", { pointer: "/runtimeApiVersion" });
  if (!Array.isArray(value.roots) || value.roots.length === 0 || value.roots.length > 64 || new Set(value.roots).size !== value.roots.length || value.roots.some((id) => !idPattern2.test(id))) {
    fail2("COURSEWARE_MODULE_LOCK_INVALID", "roots must be a bounded list of unique module ids.", { pointer: "/roots" });
  }
  if (!Array.isArray(value.modules) || value.modules.length === 0 || value.modules.length > 256) fail2("COURSEWARE_MODULE_LOCK_INVALID", "modules must be a bounded non-empty array.", { pointer: "/modules" });
  const modules = value.modules.map((record, index) => {
    const pointer = `/modules/${index}`;
    exactObject(record, allowedRecordFields, pointer);
    for (const field of ["manifest", "entry", "manifestIntegrity", "module"]) if (!(field in record)) fail2("COURSEWARE_MODULE_LOCK_INVALID", `Module record is missing ${field}.`, { pointer: `${pointer}/${field}` });
    const manifest = safePath(record.manifest, `${pointer}/manifest`, ".json");
    const entry = safePath(record.entry, `${pointer}/entry`, ".mjs");
    if (!integrityPattern2.test(record.manifestIntegrity)) fail2("COURSEWARE_MODULE_LOCK_INVALID", "manifestIntegrity must be a SHA-256 digest.", { pointer: `${pointer}/manifestIntegrity` });
    const module = validateCoursewareModuleManifest(record.module);
    return Object.freeze({ manifest, entry, manifestIntegrity: record.manifestIntegrity, module });
  });
  const ids2 = modules.map((record) => record.module.id);
  if (new Set(ids2).size !== ids2.length) fail2("COURSEWARE_MODULE_LOCK_INVALID", "Module ids must be unique.", { pointer: "/modules" });
  if (value.roots.some((id) => !ids2.includes(id))) fail2("COURSEWARE_MODULE_LOCK_INVALID", "Every root must identify a locked module.", { pointer: "/roots" });
  const byId = new Map(modules.map((record) => [record.module.id, record.module]));
  for (const record of modules) for (const dependency of record.module.dependencies) {
    const target = byId.get(dependency.id);
    if (!target) {
      if (!dependency.optional) fail2("COURSEWARE_MODULE_DEPENDENCY_MISSING", `Locked module ${record.module.id} requires ${dependency.id}.`, { moduleId: record.module.id, dependencyId: dependency.id });
      continue;
    }
    if (target.apiVersion !== dependency.apiVersion || dependency.capabilities.some((capability) => !target.capabilities.includes(capability))) {
      fail2("COURSEWARE_MODULE_DEPENDENCY_INCOMPATIBLE", `Locked module ${record.module.id} has an incompatible dependency on ${dependency.id}.`, { moduleId: record.module.id, dependencyId: dependency.id });
    }
  }
  const visiting = /* @__PURE__ */ new Set();
  const visited = /* @__PURE__ */ new Set();
  const visit = (id) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) fail2("COURSEWARE_MODULE_DEPENDENCY_CYCLE", `Locked module dependency cycle contains ${id}.`, { moduleId: id });
    visiting.add(id);
    for (const dependency of byId.get(id).dependencies) if (byId.has(dependency.id)) visit(dependency.id);
    visiting.delete(id);
    visited.add(id);
  };
  ids2.forEach(visit);
  return Object.freeze({
    format: value.format,
    schemaVersion: value.schemaVersion,
    runtimeApiVersion: value.runtimeApiVersion,
    roots: Object.freeze([...value.roots]),
    modules: Object.freeze(modules)
  });
}

// packages/creator-tools/src/courseware-modules.mjs
var safeRelativePath = (value) => typeof value === "string" && value.length > 0 && value.length <= 255 && !path.isAbsolute(value) && !value.includes("\\") && value.split("/").every((part) => part && part !== "." && part !== "..");
var sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
var runtimeSourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../courseware-runtime/src");
function fail3(code, message, details = {}) {
  throw Object.assign(new Error(message), { code, ...details });
}
function resolveEntryPath(manifestPath, entry) {
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(manifestPath), entry));
  if (!safeRelativePath(resolved) || !resolved.endsWith(".mjs")) fail3("COURSEWARE_MODULE_ENTRY_INVALID", `\u6A21\u5757\u5165\u53E3 ${entry} \u4E0D\u80FD\u79BB\u5F00\u6A21\u5757\u76EE\u5F55\u3002`, { path: manifestPath, pointer: "/entry" });
  const directory = `${path.posix.dirname(manifestPath)}/`;
  if (!resolved.startsWith(directory)) fail3("COURSEWARE_MODULE_ENTRY_INVALID", `\u6A21\u5757\u5165\u53E3 ${entry} \u4E0D\u80FD\u79BB\u5F00\u6A21\u5757\u76EE\u5F55\u3002`, { path: manifestPath, pointer: "/entry" });
  return resolved;
}
async function ordinaryFile(root, relative) {
  if (!safeRelativePath(relative)) fail3("COURSEWARE_MODULE_PATH_INVALID", `\u4E0D\u5B89\u5168\u7684\u6A21\u5757\u8DEF\u5F84\uFF1A${relative}`, { path: relative });
  const absolute = path.join(root, ...relative.split("/"));
  const stat = await fs.lstat(absolute).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (!stat?.isFile() || stat.isSymbolicLink()) fail3("COURSEWARE_MODULE_FILE_MISSING", `\u6A21\u5757\u6587\u4EF6 ${relative} \u4E0D\u5B58\u5728\u6216\u4E0D\u662F\u666E\u901A\u6587\u4EF6\u3002`, { path: relative });
  const bytes = await fs.readFile(absolute);
  return { relative, absolute, bytes, size: bytes.length, sha256: sha256(bytes) };
}
async function resolveCoursewareModuleGraph(projectRoot, manifest) {
  if (manifest?.build?.profile !== "mooyu-structured-v1") return null;
  const runtime = manifest.runtime ?? {};
  if (!Array.isArray(runtime.modules) || !runtime.modules.length || !Array.isArray(runtime.rootModules) || !runtime.rootModules.length) {
    fail3("COURSEWARE_MODULE_GRAPH_INVALID", "\u7ED3\u6784\u5316\u8BFE\u4EF6\u5FC5\u987B\u58F0\u660E runtime.modules \u4E0E runtime.rootModules\u3002", { path: "mooyu-courseware.json", pointer: "/runtime" });
  }
  const records = [];
  for (const manifestPath of runtime.modules) {
    const manifestFile = await ordinaryFile(projectRoot, manifestPath);
    let module;
    try {
      module = validateCoursewareModuleManifest(JSON.parse(manifestFile.bytes.toString("utf8")));
    } catch (error) {
      fail3(error.code ?? "COURSEWARE_MODULE_MANIFEST_INVALID", `${manifestPath}: ${error.message}`, { path: manifestPath, pointer: error.pointer ?? "/" });
    }
    const entryPath = resolveEntryPath(manifestPath, module.entry);
    const entryFile = await ordinaryFile(projectRoot, entryPath);
    if (module.integrity !== `sha256:${entryFile.sha256}`) fail3("COURSEWARE_MODULE_INTEGRITY_MISMATCH", `\u6A21\u5757 ${module.id} \u7684\u5165\u53E3\u54C8\u5E0C\u4E0E\u6E05\u5355\u4E0D\u4E00\u81F4\u3002`, { moduleId: module.id, path: entryPath, pointer: "/integrity" });
    const source = entryFile.bytes.toString("utf8");
    if (/(?:^|\n)\s*import\s*(?:["'{*]|[$\w]+\s*(?:,|\s+from))|(?:^|\n)\s*export\s+[^;\n]*\sfrom\s*["']|\bimport\s*\(/u.test(source)) fail3("COURSEWARE_MODULE_BUNDLE_REQUIRED", `\u6A21\u5757 ${module.id} \u5FC5\u987B\u7531\u56FA\u5B9A Builder \u4EA7\u51FA\u65E0\u5916\u90E8 import \u7684\u5355\u6587\u4EF6 ESM\u3002`, { moduleId: module.id, path: entryPath });
    records.push({ manifestPath, manifestFile, entryPath, entryFile, module });
  }
  records.sort((left, right) => left.module.id.localeCompare(right.module.id, "en"));
  if (new Set(records.map((record) => record.manifestPath)).size !== records.length) fail3("COURSEWARE_MODULE_GRAPH_INVALID", "runtime.modules \u4E0D\u80FD\u5305\u542B\u91CD\u590D\u8DEF\u5F84\u3002", { path: "mooyu-courseware.json", pointer: "/runtime/modules" });
  const lock = validateCoursewareModuleLock({
    format: "mooyu.courseware-module-lock",
    schemaVersion: 1,
    runtimeApiVersion: 1,
    roots: [...runtime.rootModules],
    modules: records.map((record) => ({
      manifest: record.manifestPath,
      entry: record.entryPath,
      manifestIntegrity: `sha256:${record.manifestFile.sha256}`,
      module: record.module
    }))
  });
  const lockBytes = Buffer.from(`${JSON.stringify(lock, null, 2)}
`);
  return { lock, lockBytes, lockSha256: sha256(lockBytes), records };
}
var coursewareModuleFiles = (graph) => graph ? graph.records.flatMap((record) => [record.manifestFile, record.entryFile]) : [];
async function coursewareRuntimeFiles(manifest) {
  if (manifest?.build?.profile !== "mooyu-structured-v1") return [];
  const records = [];
  for (const name of ["index.mjs", "browser-loader.mjs", "module-contract.mjs", "module-lock.mjs", "runtime.mjs"]) {
    const absolute = path.join(runtimeSourceRoot, name);
    const bytes = await fs.readFile(absolute);
    records.push({ relative: `dist/_mooyu/runtime/${name}`, absolute, bytes, size: bytes.length, sha256: sha256(bytes), generated: true });
  }
  const bootstrap = Buffer.from(`import { CoursewareModuleRegistry, CoursewareRuntime, loadCoursewareModuleRelease } from './runtime/index.mjs';
try {
  const registry = new CoursewareModuleRegistry();
  const releaseBaseUrl = new URL('../../', import.meta.url);
  const release = await loadCoursewareModuleRelease({ registry, releaseBaseUrl, lockUrl: '${manifest.runtime.moduleLock}' });
  const runtime = new CoursewareRuntime({ registry, locale: document.documentElement.lang || '${manifest.defaultLocale}' });
  runtime.activate(release.roots);
  globalThis.mooyuCoursewareRuntime = runtime;
  document.documentElement.dataset.mooyuRuntime = 'ready';
  globalThis.dispatchEvent(new CustomEvent('mooyu:runtime-ready', { detail: { runtime, release } }));
} catch (error) {
  document.documentElement.dataset.mooyuRuntime = 'error';
  document.documentElement.dataset.mooyuRuntimeError = error?.code ?? 'COURSEWARE_RUNTIME_BOOT_FAILED';
  globalThis.dispatchEvent(new CustomEvent('mooyu:runtime-error', { detail: { code: error?.code ?? 'COURSEWARE_RUNTIME_BOOT_FAILED', message: error?.message ?? String(error) } }));
  console.error('[MOOYU courseware runtime]', error);
}
`);
  records.push({ relative: "dist/_mooyu/bootstrap.mjs", absolute: null, bytes: bootstrap, size: bootstrap.length, sha256: sha256(bootstrap), generated: true });
  return records;
}

// packages/creator-tools/src/courseware.mjs
var COURSEWARE_FORMAT = "mooyu.courseware";
var COURSEWARE_SCHEMA_VERSION = 1;
var COURSEWARE_DOCTOR_REPORT_VERSION = 1;
var COURSEWARE_VALIDATOR_VERSION = "0.2.0";
var idPattern3 = /^[a-z][a-z0-9._-]{0,63}$/u;
var localePattern = /^[a-z]{2,3}(?:-[A-Z][A-Za-z0-9]{1,7})?$/u;
var audienceStages = /* @__PURE__ */ new Set(["primary", "lower-secondary", "upper-secondary", "higher-education", "professional", "lifelong"]);
var runtimeCapabilities = /* @__PURE__ */ new Set(["fullscreen", "pointerLock", "localSave", "fileExport", "shareLinks", "learningProgress", "learningEvents", "assessmentResult"]);
var sceneTypes = /* @__PURE__ */ new Set(["explain", "explore", "simulate", "practice", "assess", "reflect"]);
var checkpointKinds = /* @__PURE__ */ new Set(["observation", "prediction", "multiple-choice", "numeric", "ordering", "free-response"]);
var sourceTypes = /* @__PURE__ */ new Set(["book", "paper", "standard", "documentation", "dataset", "web"]);
var verificationKinds = /* @__PURE__ */ new Set(["primary-source", "cross-checked", "reviewed", "author-asserted"]);
var journeyActions = /* @__PURE__ */ new Set(["enter", "set", "click", "answer", "assert", "complete"]);
var experienceModeKinds = /* @__PURE__ */ new Set(["textbook-lab", "free-sandbox", "scenario-challenge"]);
var experienceViewKinds = /* @__PURE__ */ new Set(["explore", "model", "analyse"]);
var freedomLevels = /* @__PURE__ */ new Set(["F0", "F1", "F2", "F3"]);
var experienceCommands = /* @__PURE__ */ new Set(["object.add", "object.remove", "object.place", "object.connect", "object.configure", "simulation.run", "simulation.pause", "simulation.step", "simulation.reset", "measurement.record", "snapshot.save", "snapshot.compare"]);
var instrumentKinds = /* @__PURE__ */ new Set(["probe", "trace", "vector", "graph", "table", "comparison", "annotation", "replay"]);
var sandboxMinimumCommands = ["object.add", "object.remove", "object.place", "object.configure", "simulation.run", "simulation.reset", "measurement.record", "snapshot.save"];
var ignoredDirectories = /* @__PURE__ */ new Set([".git", ".gamehub", ".mooyu", "node_modules"]);
var finding = (severity, code, message, details = {}) => ({ severity, code, message, ...details });
var isObject = (value) => Boolean(value) && !Array.isArray(value) && typeof value === "object";
var isTextMap = (value) => isObject(value) && Object.keys(value).length > 0 && Object.entries(value).every(([locale, text]) => localePattern.test(locale) && typeof text === "string" && text.trim().length > 0);
var safeRelativePath2 = (value) => typeof value === "string" && value.length > 0 && value.length <= 255 && !path2.isAbsolute(value) && !value.includes("\\") && value.split("/").every((part) => part && part !== "." && part !== "..");
function rejectUnknown(value, allowed, findings, file, pointer = "") {
  if (!isObject(value)) return;
  for (const key of Object.keys(value)) if (!allowed.includes(key)) {
    findings.push(finding("error", "COURSEWARE_ADDITIONAL_PROPERTY", `${file} \u5305\u542B\u672A\u5B9A\u4E49\u5B57\u6BB5 ${key}\u3002`, { path: file, pointer: `${pointer}/${key}` }));
  }
}
function requireFields(value, required, findings, file, pointer = "") {
  if (!isObject(value)) {
    findings.push(finding("error", "COURSEWARE_OBJECT_REQUIRED", `${file}${pointer || "/"} \u5FC5\u987B\u662F JSON \u5BF9\u8C61\u3002`, { path: file, pointer: pointer || "/" }));
    return false;
  }
  for (const key of required) if (!(key in value)) {
    findings.push(finding("error", "COURSEWARE_FIELD_REQUIRED", `${file} \u7F3A\u5C11\u5B57\u6BB5 ${key}\u3002`, { path: file, pointer: `${pointer}/${key}` }));
  }
  return true;
}
function requireId(value, findings, file, pointer) {
  if (!idPattern3.test(value ?? "")) findings.push(finding("error", "COURSEWARE_ID_INVALID", `${file}${pointer} \u5FC5\u987B\u662F\u7A33\u5B9A\u7684\u5C0F\u5199\u6807\u8BC6\u7B26\u3002`, { path: file, pointer }));
}
function requireIdList(value, findings, file, pointer, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || !allowEmpty && value.length === 0 || value.some((id) => !idPattern3.test(id)) || new Set(value).size !== value.length) {
    findings.push(finding("error", "COURSEWARE_ID_LIST_INVALID", `${file}${pointer} \u5FC5\u987B\u662F${allowEmpty ? "" : "\u975E\u7A7A"}\u3001\u65E0\u91CD\u590D\u7684\u7A33\u5B9A\u6807\u8BC6\u7B26\u6570\u7EC4\u3002`, { path: file, pointer }));
    return [];
  }
  return value;
}
function requireTextMap(value, findings, file, pointer) {
  if (!isTextMap(value)) findings.push(finding("error", "COURSEWARE_LOCALIZED_TEXT_INVALID", `${file}${pointer} \u5FC5\u987B\u662F\u975E\u7A7A\u7684\u8BED\u8A00\u5230\u6587\u5B57\u6620\u5C04\u3002`, { path: file, pointer }));
}
async function readJson(projectRoot, relative, findings, code = "COURSEWARE_JSON_INVALID") {
  if (!safeRelativePath2(relative)) {
    findings.push(finding("error", "COURSEWARE_PATH_INVALID", `\u8BFE\u7A0B\u5305\u8DEF\u5F84 ${String(relative)} \u4E0D\u5B89\u5168\u3002`, { path: "mooyu-courseware.json", pointer: "/" }));
    return null;
  }
  try {
    const absolute = path2.join(projectRoot, ...relative.split("/"));
    const stat = await fs2.lstat(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("\u4E0D\u662F\u666E\u901A\u6587\u4EF6");
    return JSON.parse(await fs2.readFile(absolute, "utf8"));
  } catch (error) {
    findings.push(finding("error", code, `${relative} \u65E0\u6CD5\u8BFB\u53D6\u4E3A\u666E\u901A JSON \u6587\u4EF6\uFF1A${error.message}`, { path: relative, pointer: "/" }));
    return null;
  }
}
async function projectDigest(projectRoot) {
  const hash = crypto2.createHash("sha256");
  const walk = async (directory, prefix = "") => {
    const entries = await fs2.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "en"))) {
      if (entry.isSymbolicLink()) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) await walk(path2.join(directory, entry.name), relative);
      } else if (entry.isFile()) {
        hash.update(relative.replaceAll("\\", "/"));
        hash.update("\0");
        hash.update(await fs2.readFile(path2.join(directory, entry.name)));
        hash.update("\0");
      }
    }
  };
  try {
    await walk(projectRoot);
  } catch (error) {
    hash.update(`unreadable:${error.message}`);
  }
  return hash.digest("hex");
}
async function publishableProjectDigest(projectRoot, manifest) {
  const fixed = ["mooyu-courseware.json", manifest?.course, manifest?.experience, manifest?.mission, manifest?.capabilityBindings, manifest?.evidenceModel, manifest?.evidence, manifest?.tests].filter(Boolean);
  if (fixed.some((relative) => !safeRelativePath2(relative))) return projectDigest(projectRoot);
  const records = [];
  const add = async (relative) => records.push({ relative, bytes: await fs2.readFile(path2.join(projectRoot, ...relative.split("/"))) });
  try {
    for (const relative of fixed) await add(relative);
    const moduleGraph = await resolveCoursewareModuleGraph(projectRoot, manifest);
    if (moduleGraph) {
      for (const record of moduleGraph.records) {
        records.push({ relative: record.manifestFile.relative, bytes: record.manifestFile.bytes });
        records.push({ relative: record.entryFile.relative, bytes: record.entryFile.bytes });
      }
      records.push({ relative: manifest.runtime.moduleLock, bytes: moduleGraph.lockBytes });
      for (const record of await coursewareRuntimeFiles(manifest)) records.push({ relative: record.relative, bytes: record.bytes });
    }
    const walk = async (directory, prefix = "dist") => {
      for (const entry of await fs2.readdir(directory, { withFileTypes: true })) {
        const relative = `${prefix}/${entry.name}`;
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) await walk(path2.join(directory, entry.name), relative);
        else if (entry.isFile() && relative !== manifest?.runtime?.moduleLock && !relative.startsWith("dist/_mooyu/")) await add(relative);
      }
    };
    await walk(path2.join(projectRoot, "dist"));
    const hash = crypto2.createHash("sha256");
    for (const record of [...new Map(records.map((record2) => [record2.relative, record2])).values()].sort((left, right) => left.relative.localeCompare(right.relative, "en"))) {
      hash.update(record.relative);
      hash.update("\0");
      hash.update(record.bytes);
      hash.update("\0");
    }
    return hash.digest("hex");
  } catch {
    return projectDigest(projectRoot);
  }
}
function validateManifest(manifest, findings) {
  const file = "mooyu-courseware.json";
  const allowed = ["format", "schemaVersion", "id", "title", "summary", "defaultLocale", "locales", "subjects", "audience", "catalog", "course", "experience", "mission", "capabilityBindings", "evidenceModel", "evidence", "tests", "build", "runtime", "licenses"];
  const required = ["format", "schemaVersion", "id", "title", "defaultLocale", "locales", "subjects", "audience", "course", "evidence", "tests", "build", "runtime", "licenses"];
  if (!requireFields(manifest, required, findings, file)) return;
  rejectUnknown(manifest, allowed, findings, file);
  if (manifest.format !== COURSEWARE_FORMAT || manifest.schemaVersion !== COURSEWARE_SCHEMA_VERSION) findings.push(finding("error", "COURSEWARE_FORMAT_UNSUPPORTED", "\u8BFE\u7A0B\u5305\u5FC5\u987B\u4F7F\u7528 mooyu.courseware schemaVersion 1\u3002", { path: file, pointer: "/format" }));
  requireId(manifest.id, findings, file, "/id");
  requireTextMap(manifest.title, findings, file, "/title");
  if (manifest.summary !== void 0) requireTextMap(manifest.summary, findings, file, "/summary");
  if (!localePattern.test(manifest.defaultLocale ?? "") || !Array.isArray(manifest.locales) || !manifest.locales.includes(manifest.defaultLocale) || new Set(manifest.locales).size !== manifest.locales.length || manifest.locales.some((locale) => !localePattern.test(locale))) findings.push(finding("error", "COURSEWARE_LOCALES_INVALID", "defaultLocale \u5FC5\u987B\u51FA\u73B0\u5728\u65E0\u91CD\u590D\u7684 locales \u5217\u8868\u4E2D\u3002", { path: file, pointer: "/locales" }));
  requireIdList(manifest.subjects, findings, file, "/subjects");
  if (!isObject(manifest.audience) || !Array.isArray(manifest.audience.stages) || !manifest.audience.stages.length || new Set(manifest.audience.stages).size !== manifest.audience.stages.length || manifest.audience.stages.some((stage) => !audienceStages.has(stage))) findings.push(finding("error", "COURSEWARE_AUDIENCE_INVALID", "audience.stages \u5FC5\u987B\u662F\u65E0\u91CD\u590D\u7684\u53D7\u652F\u6301\u5B66\u4E60\u9636\u6BB5\u3002", { path: file, pointer: "/audience" }));
  else rejectUnknown(manifest.audience, ["stages", "minimumAge", "maximumAge"], findings, file, "/audience");
  if (manifest.catalog !== void 0) {
    const catalogFields = ["category", "topic", "estimatedMinutes", "order", "cover"];
    if (requireFields(manifest.catalog, ["category", "topic", "estimatedMinutes", "cover"], findings, file, "/catalog")) {
      rejectUnknown(manifest.catalog, catalogFields, findings, file, "/catalog");
      requireTextMap(manifest.catalog.topic, findings, file, "/catalog/topic");
      if (!["simulations", "practice", "tools", "topics"].includes(manifest.catalog.category) || !Number.isInteger(manifest.catalog.estimatedMinutes) || manifest.catalog.estimatedMinutes < 1 || manifest.catalog.estimatedMinutes > 240 || manifest.catalog.order !== void 0 && (!Number.isInteger(manifest.catalog.order) || manifest.catalog.order < 0)) findings.push(finding("error", "COURSEWARE_CATALOG_INVALID", "catalog \u5FC5\u987B\u58F0\u660E\u6709\u6548\u5206\u7C7B\u3001\u4E3B\u9898\u3001\u65F6\u957F\u4E0E\u6392\u5E8F\u3002", { path: file, pointer: "/catalog" }));
      if (!isObject(manifest.catalog.cover) || typeof manifest.catalog.cover.symbol !== "string" || !manifest.catalog.cover.symbol.trim() || !idPattern3.test(manifest.catalog.cover.tone ?? "")) findings.push(finding("error", "COURSEWARE_CATALOG_COVER_INVALID", "catalog.cover \u5FC5\u987B\u58F0\u660E\u77ED\u7B26\u53F7\u4E0E\u5408\u6CD5\u8272\u8C03 ID\u3002", { path: file, pointer: "/catalog/cover" }));
      else rejectUnknown(manifest.catalog.cover, ["symbol", "tone"], findings, file, "/catalog/cover");
    }
  }
  for (const key of ["course", "evidence", "tests"]) if (!safeRelativePath2(manifest[key])) findings.push(finding("error", "COURSEWARE_PATH_INVALID", `${key} \u5FC5\u987B\u662F\u5305\u5185\u5B89\u5168\u76F8\u5BF9\u8DEF\u5F84\u3002`, { path: file, pointer: `/${key}` }));
  for (const key of ["experience", "mission", "capabilityBindings", "evidenceModel"]) if (manifest[key] !== void 0 && !safeRelativePath2(manifest[key])) findings.push(finding("error", "COURSEWARE_PATH_INVALID", `${key} \u5FC5\u987B\u662F\u5305\u5185\u5B89\u5168\u76F8\u5BF9\u8DEF\u5F84\u3002`, { path: file, pointer: `/${key}` }));
  const missionPaths = ["mission", "capabilityBindings", "evidenceModel"].filter((key) => manifest[key] !== void 0);
  if (missionPaths.length !== 0 && missionPaths.length !== 3) findings.push(finding("error", "COURSEWARE_MISSION_DOCUMENTS_INCOMPLETE", "\u7EFC\u5408\u4EFB\u52A1\u5FC5\u987B\u540C\u65F6\u58F0\u660E mission\u3001capabilityBindings \u4E0E evidenceModel\u3002", { path: file, pointer: "/mission" }));
  if (!isObject(manifest.build) || !["mooyu-static-v1", "mooyu-structured-v1"].includes(manifest.build.profile) || manifest.build.entry !== "dist/index.html") findings.push(finding("error", "COURSEWARE_BUILD_PROFILE_INVALID", "build \u5FC5\u987B\u4F7F\u7528\u53D7\u652F\u6301\u7684\u56FA\u5B9A\u6784\u5EFA\u914D\u7F6E\u548C dist/index.html\u3002", { path: file, pointer: "/build" }));
  else rejectUnknown(manifest.build, ["profile", "entry"], findings, file, "/build");
  if (!isObject(manifest.runtime) || manifest.runtime.learningSdk !== 1 || !["static-web", "static-wasm"].includes(manifest.runtime.kind) || !Array.isArray(manifest.runtime.capabilities) || new Set(manifest.runtime.capabilities).size !== manifest.runtime.capabilities.length || manifest.runtime.capabilities.some((capability) => !runtimeCapabilities.has(capability))) findings.push(finding("error", "COURSEWARE_RUNTIME_INVALID", "runtime \u5FC5\u987B\u58F0\u660E\u9759\u6001\u8FD0\u884C\u7C7B\u578B\u3001Learning SDK v1 \u4E0E\u65E0\u91CD\u590D\u7684\u5DF2\u77E5\u80FD\u529B\u6570\u7EC4\u3002", { path: file, pointer: "/runtime" }));
  else {
    rejectUnknown(manifest.runtime, ["kind", "learningSdk", "capabilities", "profile", "modules", "rootModules", "moduleLock"], findings, file, "/runtime");
    const structured = manifest.build?.profile === "mooyu-structured-v1";
    if (structured && (manifest.runtime.profile !== "structured-courseware" || !Array.isArray(manifest.runtime.modules) || manifest.runtime.modules.length === 0 || new Set(manifest.runtime.modules).size !== manifest.runtime.modules.length || manifest.runtime.modules.some((modulePath) => !safeRelativePath2(modulePath) || !modulePath.endsWith(".json")) || !Array.isArray(manifest.runtime.rootModules) || manifest.runtime.rootModules.length === 0 || new Set(manifest.runtime.rootModules).size !== manifest.runtime.rootModules.length || manifest.runtime.rootModules.some((id) => !idPattern3.test(id)) || manifest.runtime.moduleLock !== "dist/mooyu-modules.lock.json")) findings.push(finding("error", "COURSEWARE_MODULE_GRAPH_INVALID", "\u7ED3\u6784\u5316\u8BFE\u4EF6\u5FC5\u987B\u58F0\u660E\u6A21\u5757\u6E05\u5355\u3001\u6839\u6A21\u5757\u4E0E\u56FA\u5B9A\u6A21\u5757\u9501\u8DEF\u5F84\u3002", { path: file, pointer: "/runtime" }));
    if (!structured && manifest.runtime.profile !== void 0 && manifest.runtime.profile !== "legacy-web") findings.push(finding("error", "COURSEWARE_RUNTIME_PROFILE_INVALID", "\u9759\u6001\u8BFE\u4EF6\u53EA\u80FD\u58F0\u660E legacy-web \u8FD0\u884C\u914D\u7F6E\u3002", { path: file, pointer: "/runtime/profile" }));
  }
  if (!isObject(manifest.licenses) || typeof manifest.licenses.code !== "string" || typeof manifest.licenses.content !== "string") findings.push(finding("error", "COURSEWARE_LICENSE_INVALID", "licenses \u5FC5\u987B\u58F0\u660E code \u4E0E content\u3002", { path: file, pointer: "/licenses" }));
  else rejectUnknown(manifest.licenses, ["code", "content"], findings, file, "/licenses");
}
function validateCourse(course, findings, file) {
  const required = ["schemaVersion", "objectives", "prerequisites", "misconceptions", "scenes", "checkpoints", "completion"];
  if (!requireFields(course, required, findings, file)) return null;
  rejectUnknown(course, required, findings, file);
  if (course.schemaVersion !== 1) findings.push(finding("error", "COURSEWARE_COURSE_VERSION_INVALID", "course schemaVersion \u5FC5\u987B\u4E3A 1\u3002", { path: file, pointer: "/schemaVersion" }));
  const collections = [["objectives", course.objectives], ["scenes", course.scenes], ["checkpoints", course.checkpoints]];
  const sets = {};
  for (const [name, values] of collections) {
    if (!Array.isArray(values) || values.length === 0) {
      findings.push(finding("error", "COURSEWARE_COLLECTION_EMPTY", `${name} \u81F3\u5C11\u9700\u8981\u4E00\u9879\u3002`, { path: file, pointer: `/${name}` }));
      sets[name] = /* @__PURE__ */ new Set();
      continue;
    }
    const ids2 = values.map((value) => value?.id);
    sets[name] = new Set(ids2);
    ids2.forEach((id, index) => requireId(id, findings, file, `/${name}/${index}/id`));
    if (sets[name].size !== ids2.length) findings.push(finding("error", "COURSEWARE_ID_DUPLICATE", `${name} \u4E2D\u5B58\u5728\u91CD\u590D ID\u3002`, { path: file, pointer: `/${name}` }));
  }
  for (const [index, objective] of (course.objectives ?? []).entries()) {
    rejectUnknown(objective, ["id", "text"], findings, file, `/objectives/${index}`);
    requireTextMap(objective?.text, findings, file, `/objectives/${index}/text`);
  }
  if (!Array.isArray(course.prerequisites) || course.prerequisites.some((value) => !isTextMap(value))) findings.push(finding("error", "COURSEWARE_PREREQUISITES_INVALID", "prerequisites \u5FC5\u987B\u662F\u672C\u5730\u5316\u6587\u5B57\u6570\u7EC4\u3002", { path: file, pointer: "/prerequisites" }));
  if (!Array.isArray(course.misconceptions)) findings.push(finding("error", "COURSEWARE_MISCONCEPTIONS_INVALID", "misconceptions \u5FC5\u987B\u662F\u6570\u7EC4\u3002", { path: file, pointer: "/misconceptions" }));
  for (const [index, misconception] of (course.misconceptions ?? []).entries()) {
    rejectUnknown(misconception, ["id", "text", "objectiveIds"], findings, file, `/misconceptions/${index}`);
    requireId(misconception?.id, findings, file, `/misconceptions/${index}/id`);
    requireTextMap(misconception?.text, findings, file, `/misconceptions/${index}/text`);
    for (const id of requireIdList(misconception?.objectiveIds, findings, file, `/misconceptions/${index}/objectiveIds`)) if (!sets.objectives.has(id)) findings.push(finding("error", "COURSEWARE_OBJECTIVE_REFERENCE_INVALID", `\u8BEF\u533A ${misconception?.id} \u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u76EE\u6807 ${id}\u3002`, { path: file, pointer: `/misconceptions/${index}/objectiveIds` }));
  }
  for (const [index, scene] of (course.scenes ?? []).entries()) {
    rejectUnknown(scene, ["id", "type", "title", "objectiveIds", "evidenceIds", "component", "fallback"], findings, file, `/scenes/${index}`);
    requireTextMap(scene?.title, findings, file, `/scenes/${index}/title`);
    requireTextMap(scene?.fallback, findings, file, `/scenes/${index}/fallback`);
    if (!sceneTypes.has(scene?.type)) findings.push(finding("error", "COURSEWARE_SCENE_TYPE_INVALID", `\u573A\u666F ${scene?.id ?? index} \u7684 type \u4E0D\u53D7\u652F\u6301\u3002`, { path: file, pointer: `/scenes/${index}/type` }));
    const objectiveIds = requireIdList(scene?.objectiveIds, findings, file, `/scenes/${index}/objectiveIds`);
    for (const id of objectiveIds) if (!sets.objectives.has(id)) findings.push(finding("error", "COURSEWARE_OBJECTIVE_REFERENCE_INVALID", `\u573A\u666F ${scene?.id} \u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u76EE\u6807 ${id}\u3002`, { path: file, pointer: `/scenes/${index}/objectiveIds` }));
    requireIdList(scene?.evidenceIds, findings, file, `/scenes/${index}/evidenceIds`, { allowEmpty: true });
    if (!isObject(scene?.component) || !idPattern3.test(scene.component.type ?? "") || scene.component.config !== void 0 && !isObject(scene.component.config)) findings.push(finding("error", "COURSEWARE_COMPONENT_INVALID", `\u573A\u666F ${scene?.id ?? index} \u7F3A\u5C11\u7A33\u5B9A\u7EC4\u4EF6\u7C7B\u578B\u6216 config \u4E0D\u662F\u5BF9\u8C61\u3002`, { path: file, pointer: `/scenes/${index}/component` }));
    else rejectUnknown(scene.component, ["type", "config"], findings, file, `/scenes/${index}/component`);
  }
  for (const [index, checkpoint] of (course.checkpoints ?? []).entries()) {
    rejectUnknown(checkpoint, ["id", "sceneId", "objectiveIds", "kind", "prompt", "answer"], findings, file, `/checkpoints/${index}`);
    if (!checkpointKinds.has(checkpoint?.kind)) findings.push(finding("error", "COURSEWARE_CHECKPOINT_KIND_INVALID", `\u68C0\u67E5\u70B9 ${checkpoint?.id ?? index} \u7684 kind \u4E0D\u53D7\u652F\u6301\u3002`, { path: file, pointer: `/checkpoints/${index}/kind` }));
    if (!sets.scenes.has(checkpoint?.sceneId)) findings.push(finding("error", "COURSEWARE_SCENE_REFERENCE_INVALID", `\u68C0\u67E5\u70B9 ${checkpoint?.id} \u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u573A\u666F ${checkpoint?.sceneId}\u3002`, { path: file, pointer: `/checkpoints/${index}/sceneId` }));
    const objectiveIds = requireIdList(checkpoint?.objectiveIds, findings, file, `/checkpoints/${index}/objectiveIds`);
    for (const id of objectiveIds) if (!sets.objectives.has(id)) findings.push(finding("error", "COURSEWARE_OBJECTIVE_REFERENCE_INVALID", `\u68C0\u67E5\u70B9 ${checkpoint?.id} \u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u76EE\u6807 ${id}\u3002`, { path: file, pointer: `/checkpoints/${index}/objectiveIds` }));
    requireTextMap(checkpoint?.prompt, findings, file, `/checkpoints/${index}/prompt`);
  }
  const completionObjectives = requireIdList(course.completion?.objectiveIds, findings, file, "/completion/objectiveIds");
  const completionCheckpoints = requireIdList(course.completion?.checkpointIds, findings, file, "/completion/checkpointIds");
  rejectUnknown(course.completion, ["objectiveIds", "checkpointIds"], findings, file, "/completion");
  for (const id of completionObjectives) if (!sets.objectives.has(id)) findings.push(finding("error", "COURSEWARE_COMPLETION_REFERENCE_INVALID", `\u5B8C\u6210\u89C4\u5219\u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u76EE\u6807 ${id}\u3002`, { path: file, pointer: "/completion/objectiveIds" }));
  for (const id of completionCheckpoints) if (!sets.checkpoints.has(id)) findings.push(finding("error", "COURSEWARE_COMPLETION_REFERENCE_INVALID", `\u5B8C\u6210\u89C4\u5219\u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u68C0\u67E5\u70B9 ${id}\u3002`, { path: file, pointer: "/completion/checkpointIds" }));
  for (const id of sets.objectives) {
    if (!(course.scenes ?? []).some((scene) => scene.objectiveIds?.includes(id))) findings.push(finding("error", "COURSEWARE_OBJECTIVE_UNCOVERED", `\u5B66\u4E60\u76EE\u6807 ${id} \u6CA1\u6709\u573A\u666F\u8986\u76D6\u3002`, { path: file, pointer: "/scenes" }));
    if (!(course.checkpoints ?? []).some((checkpoint) => checkpoint.objectiveIds?.includes(id))) findings.push(finding("error", "COURSEWARE_OBJECTIVE_UNASSESSED", `\u5B66\u4E60\u76EE\u6807 ${id} \u6CA1\u6709\u68C0\u67E5\u70B9\u9A8C\u8BC1\u3002`, { path: file, pointer: "/checkpoints" }));
  }
  return { objectiveIds: sets.objectives, sceneIds: sets.scenes, checkpointIds: sets.checkpoints };
}
function validateEvidence(evidence, findings, file, course, courseFile) {
  if (!requireFields(evidence, ["schemaVersion", "sources", "claims"], findings, file)) return;
  rejectUnknown(evidence, ["schemaVersion", "sources", "claims", "assets"], findings, file);
  if (evidence.schemaVersion !== 1) findings.push(finding("error", "COURSEWARE_EVIDENCE_VERSION_INVALID", "evidence schemaVersion \u5FC5\u987B\u4E3A 1\u3002", { path: file, pointer: "/schemaVersion" }));
  const sources = Array.isArray(evidence.sources) ? evidence.sources : [];
  const claims = Array.isArray(evidence.claims) ? evidence.claims : [];
  if (!sources.length || !claims.length) findings.push(finding("error", "COURSEWARE_EVIDENCE_EMPTY", "\u8BC1\u636E\u6587\u4EF6\u81F3\u5C11\u9700\u8981\u4E00\u4E2A\u6765\u6E90\u548C\u4E00\u4E2A\u4E8B\u5B9E\u58F0\u660E\u3002", { path: file, pointer: "/" }));
  const sourceIds = new Set(sources.map((source) => source?.id));
  const claimIds = new Set(claims.map((claim) => claim?.id));
  if (sourceIds.size !== sources.length || claimIds.size !== claims.length) findings.push(finding("error", "COURSEWARE_ID_DUPLICATE", "\u8BC1\u636E\u6765\u6E90\u6216\u58F0\u660E\u5B58\u5728\u91CD\u590D ID\u3002", { path: file, pointer: "/" }));
  for (const [index, source] of sources.entries()) {
    rejectUnknown(source, ["id", "type", "title", "authors", "publisher", "url", "publishedAt", "accessedAt", "license", "locator"], findings, file, `/sources/${index}`);
    requireId(source?.id, findings, file, `/sources/${index}/id`);
    if (typeof source?.title !== "string" || !source.title.trim() || !sourceTypes.has(source?.type)) findings.push(finding("error", "COURSEWARE_SOURCE_INVALID", "\u6765\u6E90\u5FC5\u987B\u6709\u6807\u9898\u548C\u53D7\u652F\u6301\u7684 type\u3002", { path: file, pointer: `/sources/${index}` }));
  }
  for (const [index, claim] of claims.entries()) {
    rejectUnknown(claim, ["id", "text", "sourceIds", "locators", "verification"], findings, file, `/claims/${index}`);
    requireId(claim?.id, findings, file, `/claims/${index}/id`);
    requireTextMap(claim?.text, findings, file, `/claims/${index}/text`);
    if (!verificationKinds.has(claim?.verification)) findings.push(finding("error", "COURSEWARE_VERIFICATION_INVALID", `\u58F0\u660E ${claim?.id ?? index} \u7684 verification \u4E0D\u53D7\u652F\u6301\u3002`, { path: file, pointer: `/claims/${index}/verification` }));
    for (const id of requireIdList(claim?.sourceIds, findings, file, `/claims/${index}/sourceIds`)) if (!sourceIds.has(id)) findings.push(finding("error", "COURSEWARE_SOURCE_REFERENCE_INVALID", `\u58F0\u660E ${claim?.id} \u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u6765\u6E90 ${id}\u3002`, { path: file, pointer: `/claims/${index}/sourceIds` }));
  }
  for (const [index, asset] of (evidence.assets ?? []).entries()) {
    rejectUnknown(asset, ["path", "sourceIds", "license"], findings, file, `/assets/${index}`);
    if (!safeRelativePath2(asset?.path) || typeof asset?.license !== "string" || !asset.license.trim()) findings.push(finding("error", "COURSEWARE_ASSET_INVALID", `\u7D20\u6750 ${index} \u7F3A\u5C11\u5B89\u5168\u8DEF\u5F84\u6216\u8BB8\u53EF\u8BC1\u3002`, { path: file, pointer: `/assets/${index}` }));
    for (const id of requireIdList(asset?.sourceIds, findings, file, `/assets/${index}/sourceIds`)) if (!sourceIds.has(id)) findings.push(finding("error", "COURSEWARE_SOURCE_REFERENCE_INVALID", `\u7D20\u6750 ${asset?.path ?? index} \u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u6765\u6E90 ${id}\u3002`, { path: file, pointer: `/assets/${index}/sourceIds` }));
  }
  for (const [index, scene] of (course?.scenes ?? []).entries()) for (const id of scene.evidenceIds ?? []) if (!claimIds.has(id)) findings.push(finding("error", "COURSEWARE_EVIDENCE_REFERENCE_INVALID", `\u573A\u666F ${scene.id} \u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u8BC1\u636E\u58F0\u660E ${id}\u3002`, { path: courseFile, pointer: `/scenes/${index}/evidenceIds` }));
}
function validateJourneys(journeys, findings, file, courseSets) {
  if (!requireFields(journeys, ["schemaVersion", "journeys"], findings, file)) return;
  rejectUnknown(journeys, ["schemaVersion", "journeys"], findings, file);
  if (journeys.schemaVersion !== 1) findings.push(finding("error", "COURSEWARE_JOURNEY_VERSION_INVALID", "journeys schemaVersion \u5FC5\u987B\u4E3A 1\u3002", { path: file, pointer: "/schemaVersion" }));
  if (!Array.isArray(journeys.journeys) || !journeys.journeys.length) {
    findings.push(finding("error", "COURSEWARE_JOURNEY_EMPTY", "\u81F3\u5C11\u9700\u8981\u4E00\u6761\u5B66\u4E60\u8DEF\u5F84\u3002", { path: file, pointer: "/journeys" }));
    return;
  }
  const ids2 = journeys.journeys.map((journey) => journey?.id);
  if (new Set(ids2).size !== ids2.length) findings.push(finding("error", "COURSEWARE_ID_DUPLICATE", "\u5B66\u4E60\u8DEF\u5F84\u5B58\u5728\u91CD\u590D ID\u3002", { path: file, pointer: "/journeys" }));
  for (const [index, journey] of journeys.journeys.entries()) {
    rejectUnknown(journey, ["id", "title", "locale", "steps", "expectsCompletion"], findings, file, `/journeys/${index}`);
    requireId(journey?.id, findings, file, `/journeys/${index}/id`);
    if (typeof journey?.title !== "string" || !journey.title.trim() || !localePattern.test(journey?.locale ?? "") || typeof journey?.expectsCompletion !== "boolean") findings.push(finding("error", "COURSEWARE_JOURNEY_INVALID", `\u5B66\u4E60\u8DEF\u5F84 ${journey?.id ?? index} \u7684\u6807\u9898\u3001\u8BED\u8A00\u6216\u5B8C\u6210\u58F0\u660E\u65E0\u6548\u3002`, { path: file, pointer: `/journeys/${index}` }));
    if (!Array.isArray(journey?.steps) || !journey.steps.length) findings.push(finding("error", "COURSEWARE_JOURNEY_STEPS_EMPTY", `\u5B66\u4E60\u8DEF\u5F84 ${journey?.id} \u6CA1\u6709\u6B65\u9AA4\u3002`, { path: file, pointer: `/journeys/${index}/steps` }));
    for (const [stepIndex, step] of (journey?.steps ?? []).entries()) {
      rejectUnknown(step, ["action", "target", "value", "expect"], findings, file, `/journeys/${index}/steps/${stepIndex}`);
      if (!journeyActions.has(step?.action) || !idPattern3.test(step?.target ?? "")) findings.push(finding("error", "COURSEWARE_JOURNEY_STEP_INVALID", `\u5B66\u4E60\u8DEF\u5F84 ${journey?.id} \u5305\u542B\u65E0\u6548\u6B65\u9AA4\u3002`, { path: file, pointer: `/journeys/${index}/steps/${stepIndex}` }));
      if (step?.action === "enter" && !courseSets?.sceneIds.has(step.target)) findings.push(finding("error", "COURSEWARE_JOURNEY_SCENE_INVALID", `\u5B66\u4E60\u8DEF\u5F84 ${journey?.id} \u8FDB\u5165\u4E86\u4E0D\u5B58\u5728\u7684\u573A\u666F ${step.target}\u3002`, { path: file, pointer: `/journeys/${index}/steps/${stepIndex}/target` }));
    }
  }
  if (!journeys.journeys.some((journey) => journey.expectsCompletion === true && journey.steps?.some((step) => step.action === "complete"))) findings.push(finding("error", "COURSEWARE_COMPLETION_JOURNEY_MISSING", "\u81F3\u5C11\u9700\u8981\u4E00\u6761\u53EF\u5B8C\u6210\u8BFE\u7A0B\u7684\u9A8C\u6536\u8DEF\u5F84\u3002", { path: file, pointer: "/journeys" }));
}
function validateExperience(experience, findings, file, courseSets) {
  const rootFields = ["format", "schemaVersion", "engine", "defaultMode", "modes", "defaultView", "views", "instruments"];
  if (!requireFields(experience, ["format", "schemaVersion", "engine", "defaultMode", "modes"], findings, file)) return;
  rejectUnknown(experience, rootFields, findings, file);
  if (experience.format !== "mooyu.courseware-experience" || experience.schemaVersion !== 1) findings.push(finding("error", "COURSEWARE_EXPERIENCE_FORMAT_INVALID", "experience \u5FC5\u987B\u4F7F\u7528 mooyu.courseware-experience schemaVersion 1\u3002", { path: file, pointer: "/format" }));
  const engine = experience.engine;
  const engineFields = ["id", "version", "deterministic", "snapshot", "stateVariables"];
  if (requireFields(engine, engineFields, findings, file, "/engine")) {
    rejectUnknown(engine, engineFields, findings, file, "/engine");
    requireId(engine.id, findings, file, "/engine/id");
    if (!Number.isInteger(engine.version) || engine.version < 1 || engine.deterministic !== true || engine.snapshot !== true) findings.push(finding("error", "COURSEWARE_EXPERIENCE_ENGINE_INVALID", "\u5B9E\u9A8C\u5F15\u64CE\u5FC5\u987B\u6709\u6B63\u6574\u6570\u7248\u672C\uFF0C\u5E76\u652F\u6301\u786E\u5B9A\u6027\u91CD\u653E\u548C\u72B6\u6001\u5FEB\u7167\u3002", { path: file, pointer: "/engine" }));
    requireIdList(engine.stateVariables, findings, file, "/engine/stateVariables");
  }
  const instruments = Array.isArray(experience.instruments) ? experience.instruments : [];
  if (experience.instruments !== void 0 && !Array.isArray(experience.instruments)) findings.push(finding("error", "COURSEWARE_EXPERIENCE_INSTRUMENTS_INVALID", "experience.instruments \u5FC5\u987B\u662F\u6570\u7EC4\u3002", { path: file, pointer: "/instruments" }));
  const instrumentIds = new Set(instruments.map((value) => value?.id));
  if (instrumentIds.size !== instruments.length) findings.push(finding("error", "COURSEWARE_ID_DUPLICATE", "experience \u4E2D\u5B58\u5728\u91CD\u590D\u5DE5\u5177 ID\u3002", { path: file, pointer: "/instruments" }));
  for (const [index, instrument] of instruments.entries()) {
    const pointer = `/instruments/${index}`;
    if (!requireFields(instrument, ["id", "kind", "title"], findings, file, pointer)) continue;
    rejectUnknown(instrument, ["id", "kind", "title"], findings, file, pointer);
    requireId(instrument.id, findings, file, `${pointer}/id`);
    requireTextMap(instrument.title, findings, file, `${pointer}/title`);
    if (!instrumentKinds.has(instrument.kind)) findings.push(finding("error", "COURSEWARE_EXPERIENCE_INSTRUMENT_INVALID", `\u5DE5\u5177 ${instrument.id ?? index} \u7684 kind \u4E0D\u53D7\u652F\u6301\u3002`, { path: file, pointer: `${pointer}/kind` }));
  }
  const declaresViews = experience.defaultView !== void 0 || experience.views !== void 0;
  if (declaresViews) {
    if (!requireFields(experience, ["defaultView", "views"], findings, file)) return;
    const views = Array.isArray(experience.views) ? experience.views : [];
    if (!views.length) findings.push(finding("error", "COURSEWARE_EXPERIENCE_VIEWS_EMPTY", "experience \u81F3\u5C11\u9700\u8981\u4E00\u4E2A\u89C2\u5BDF\u89C6\u56FE\u3002", { path: file, pointer: "/views" }));
    const viewIds = new Set(views.map((value) => value?.id));
    if (viewIds.size !== views.length) findings.push(finding("error", "COURSEWARE_ID_DUPLICATE", "experience \u4E2D\u5B58\u5728\u91CD\u590D\u89C6\u56FE ID\u3002", { path: file, pointer: "/views" }));
    if (!viewIds.has(experience.defaultView)) findings.push(finding("error", "COURSEWARE_EXPERIENCE_DEFAULT_VIEW_INVALID", "defaultView \u5FC5\u987B\u5F15\u7528\u5DF2\u58F0\u660E\u7684\u89C6\u56FE\u3002", { path: file, pointer: "/defaultView" }));
    for (const [index, view] of views.entries()) {
      const pointer = `/views/${index}`;
      const fields = ["id", "kind", "title", "purpose", "instrumentIds"];
      if (!requireFields(view, fields, findings, file, pointer)) continue;
      rejectUnknown(view, fields, findings, file, pointer);
      requireId(view.id, findings, file, `${pointer}/id`);
      requireTextMap(view.title, findings, file, `${pointer}/title`);
      requireTextMap(view.purpose, findings, file, `${pointer}/purpose`);
      if (!experienceViewKinds.has(view.kind)) findings.push(finding("error", "COURSEWARE_EXPERIENCE_VIEW_KIND_INVALID", `\u89C6\u56FE ${view.id ?? index} \u7684 kind \u4E0D\u53D7\u652F\u6301\u3002`, { path: file, pointer: `${pointer}/kind` }));
      for (const instrumentId of requireIdList(view.instrumentIds, findings, file, `${pointer}/instrumentIds`, { allowEmpty: true })) if (!instrumentIds.has(instrumentId)) findings.push(finding("error", "COURSEWARE_EXPERIENCE_INSTRUMENT_REFERENCE_INVALID", `\u89C6\u56FE ${view.id} \u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u5DE5\u5177 ${instrumentId}\u3002`, { path: file, pointer: `${pointer}/instrumentIds` }));
    }
  }
  const modes = Array.isArray(experience.modes) ? experience.modes : [];
  if (!modes.length) findings.push(finding("error", "COURSEWARE_EXPERIENCE_MODES_EMPTY", "experience \u81F3\u5C11\u9700\u8981\u4E00\u79CD\u771F\u5B9E\u53EF\u7528\u7684\u4F53\u9A8C\u6A21\u5F0F\u3002", { path: file, pointer: "/modes" }));
  const modeIds = new Set(modes.map((value) => value?.id));
  if (modeIds.size !== modes.length) findings.push(finding("error", "COURSEWARE_ID_DUPLICATE", "experience \u4E2D\u5B58\u5728\u91CD\u590D\u6A21\u5F0F ID\u3002", { path: file, pointer: "/modes" }));
  if (!modeIds.has(experience.defaultMode)) findings.push(finding("error", "COURSEWARE_EXPERIENCE_DEFAULT_MODE_INVALID", "defaultMode \u5FC5\u987B\u5F15\u7528\u5DF2\u58F0\u660E\u7684\u6A21\u5F0F\u3002", { path: file, pointer: "/defaultMode" }));
  for (const [index, mode] of modes.entries()) {
    const pointer = `/modes/${index}`;
    const fields = ["id", "kind", "title", "sceneIds", "freedomLevel", "allowedCommands", "instrumentIds", "curiosityHook"];
    if (!requireFields(mode, fields, findings, file, pointer)) continue;
    rejectUnknown(mode, [...fields, "challenge"], findings, file, pointer);
    requireId(mode.id, findings, file, `${pointer}/id`);
    requireTextMap(mode.title, findings, file, `${pointer}/title`);
    requireTextMap(mode.curiosityHook, findings, file, `${pointer}/curiosityHook`);
    if (!experienceModeKinds.has(mode.kind)) findings.push(finding("error", "COURSEWARE_EXPERIENCE_MODE_KIND_INVALID", `\u6A21\u5F0F ${mode.id ?? index} \u7684 kind \u4E0D\u53D7\u652F\u6301\u3002`, { path: file, pointer: `${pointer}/kind` }));
    if (!freedomLevels.has(mode.freedomLevel)) findings.push(finding("error", "COURSEWARE_EXPERIENCE_FREEDOM_INVALID", `\u6A21\u5F0F ${mode.id ?? index} \u7684 freedomLevel \u65E0\u6548\u3002`, { path: file, pointer: `${pointer}/freedomLevel` }));
    for (const sceneId of requireIdList(mode.sceneIds, findings, file, `${pointer}/sceneIds`)) if (!courseSets?.sceneIds.has(sceneId)) findings.push(finding("error", "COURSEWARE_EXPERIENCE_SCENE_INVALID", `\u6A21\u5F0F ${mode.id} \u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u573A\u666F ${sceneId}\u3002`, { path: file, pointer: `${pointer}/sceneIds` }));
    const commands = requireIdList(mode.allowedCommands, findings, file, `${pointer}/allowedCommands`, { allowEmpty: true });
    for (const command2 of commands) if (!experienceCommands.has(command2)) findings.push(finding("error", "COURSEWARE_EXPERIENCE_COMMAND_INVALID", `\u6A21\u5F0F ${mode.id} \u58F0\u660E\u4E86\u672A\u77E5\u547D\u4EE4 ${command2}\u3002`, { path: file, pointer: `${pointer}/allowedCommands` }));
    for (const instrumentId of requireIdList(mode.instrumentIds, findings, file, `${pointer}/instrumentIds`, { allowEmpty: true })) if (!instrumentIds.has(instrumentId)) findings.push(finding("error", "COURSEWARE_EXPERIENCE_INSTRUMENT_REFERENCE_INVALID", `\u6A21\u5F0F ${mode.id} \u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u5DE5\u5177 ${instrumentId}\u3002`, { path: file, pointer: `${pointer}/instrumentIds` }));
    if (mode.kind === "free-sandbox") {
      const missing = sandboxMinimumCommands.filter((command2) => !commands.includes(command2));
      if (!["F2", "F3"].includes(mode.freedomLevel) || missing.length) findings.push(finding("error", "COURSEWARE_SANDBOX_FREEDOM_INSUFFICIENT", `\u81EA\u7531\u5B9E\u9A8C\u5FC5\u987B\u8FBE\u5230 F2/F3\uFF0C\u5E76\u652F\u6301\u81EA\u7531\u589E\u5220\u3001\u653E\u7F6E\u3001\u914D\u7F6E\u3001\u8FD0\u884C\u3001\u590D\u4F4D\u3001\u8BB0\u5F55\u548C\u5FEB\u7167\uFF1B\u7F3A\u5C11\uFF1A${missing.join("\u3001") || "\u65E0"}\u3002`, { path: file, pointer }));
    }
    if (mode.kind !== "scenario-challenge") {
      if (mode.challenge !== void 0) findings.push(finding("error", "COURSEWARE_CHALLENGE_UNEXPECTED", `\u975E\u573A\u666F\u6311\u6218\u6A21\u5F0F ${mode.id} \u4E0D\u5E94\u58F0\u660E challenge\u3002`, { path: file, pointer: `${pointer}/challenge` }));
      continue;
    }
    const challenge = mode.challenge;
    const challengeFields = ["id", "title", "goal", "success", "attemptPolicy"];
    if (!requireFields(challenge, challengeFields, findings, file, `${pointer}/challenge`)) continue;
    rejectUnknown(challenge, challengeFields, findings, file, `${pointer}/challenge`);
    requireId(challenge.id, findings, file, `${pointer}/challenge/id`);
    requireTextMap(challenge.title, findings, file, `${pointer}/challenge/title`);
    requireTextMap(challenge.goal, findings, file, `${pointer}/challenge/goal`);
    if (!Array.isArray(challenge.success) || !challenge.success.length) findings.push(finding("error", "COURSEWARE_CHALLENGE_RULES_INVALID", `\u6311\u6218 ${challenge.id ?? index} \u7F3A\u5C11\u6210\u529F\u6761\u4EF6\u3002`, { path: file, pointer: `${pointer}/challenge/success` }));
    for (const [conditionIndex, condition] of (challenge.success ?? []).entries()) {
      const conditionPointer = `${pointer}/challenge/success/${conditionIndex}`;
      if (!isObject(condition) || !idPattern3.test(condition.metric ?? "") || !["eq", "gte", "lte", "between"].includes(condition.operator)) {
        findings.push(finding("error", "COURSEWARE_CHALLENGE_RULES_INVALID", `\u6311\u6218 ${challenge.id ?? index} \u5305\u542B\u65E0\u6548\u6210\u529F\u6761\u4EF6\u3002`, { path: file, pointer: conditionPointer }));
        continue;
      }
      rejectUnknown(condition, condition.operator === "between" ? ["metric", "operator", "values"] : ["metric", "operator", "value"], findings, file, conditionPointer);
      if (condition.operator === "between" ? !Array.isArray(condition.values) || condition.values.length !== 2 || condition.values.some((value) => typeof value !== "number") || condition.values[0] > condition.values[1] : typeof condition.value !== "number") findings.push(finding("error", "COURSEWARE_CHALLENGE_RULES_INVALID", `\u6311\u6218 ${challenge.id ?? index} \u7684\u6210\u529F\u9608\u503C\u65E0\u6548\u3002`, { path: file, pointer: conditionPointer }));
    }
    const attempt = challenge.attemptPolicy;
    if (!isObject(attempt) || !Number.isInteger(attempt.maxAttempts) || attempt.maxAttempts < 1 || attempt.maxAttempts > 100 || !["instant", "after-feedback"].includes(attempt.retry)) findings.push(finding("error", "COURSEWARE_CHALLENGE_ATTEMPT_POLICY_INVALID", `\u6311\u6218 ${challenge.id ?? index} \u7684\u5C1D\u8BD5\u89C4\u5219\u65E0\u6548\u3002`, { path: file, pointer: `${pointer}/challenge/attemptPolicy` }));
    else rejectUnknown(attempt, ["maxAttempts", "retry"], findings, file, `${pointer}/challenge/attemptPolicy`);
  }
}
function validateMissionCondition(condition, findings, file, pointer, meters, metricIds) {
  if (!isObject(condition) || !["metric", "resource", "clock", "state", "evidence"].includes(condition.source) || !idPattern3.test(condition.id ?? "") || !["eq", "neq", "gt", "gte", "lt", "lte", "between", "truthy", "falsy"].includes(condition.operator)) {
    findings.push(finding("error", "COURSEWARE_MISSION_CONDITION_INVALID", `${file}${pointer} \u5305\u542B\u65E0\u6548\u4EFB\u52A1\u6761\u4EF6\u3002`, { path: file, pointer }));
    return;
  }
  rejectUnknown(condition, ["source", "id", "operator", "value", "values"], findings, file, pointer);
  if (condition.source === "metric") metricIds.add(condition.id);
  if (condition.source === "clock" && !meters.clocks.has(condition.id)) findings.push(finding("error", "COURSEWARE_MISSION_METER_REFERENCE_INVALID", `\u4EFB\u52A1\u6761\u4EF6\u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u65F6\u949F ${condition.id}\u3002`, { path: file, pointer }));
  if (condition.source === "resource" && !meters.resources.has(condition.id)) findings.push(finding("error", "COURSEWARE_MISSION_METER_REFERENCE_INVALID", `\u4EFB\u52A1\u6761\u4EF6\u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u8D44\u6E90 ${condition.id}\u3002`, { path: file, pointer }));
  if (condition.operator === "between") {
    if (!Array.isArray(condition.values) || condition.values.length !== 2 || condition.values.some((value) => !Number.isFinite(value)) || condition.values[0] > condition.values[1]) findings.push(finding("error", "COURSEWARE_MISSION_CONDITION_INVALID", "between \u6761\u4EF6\u5FC5\u987B\u63D0\u4F9B\u9012\u589E\u7684\u4E24\u4E2A\u6570\u503C\u3002", { path: file, pointer: `${pointer}/values` }));
  } else if (!["truthy", "falsy"].includes(condition.operator) && !["number", "string", "boolean"].includes(typeof condition.value)) findings.push(finding("error", "COURSEWARE_MISSION_CONDITION_INVALID", "\u4EFB\u52A1\u6BD4\u8F83\u6761\u4EF6\u7F3A\u5C11\u6709\u6548 value\u3002", { path: file, pointer: `${pointer}/value` }));
}
function validateMission(mission, findings, file) {
  const rootFields = ["format", "schemaVersion", "id", "version", "title", "initialNodeId", "capabilitySlots", "clocks", "resources", "nodes", "outcomes"];
  if (!requireFields(mission, rootFields, findings, file)) return null;
  rejectUnknown(mission, rootFields, findings, file);
  if (mission.format !== "mooyu.learning-mission" || mission.schemaVersion !== 1) findings.push(finding("error", "COURSEWARE_MISSION_FORMAT_INVALID", "mission \u5FC5\u987B\u4F7F\u7528 mooyu.learning-mission schemaVersion 1\u3002", { path: file, pointer: "/format" }));
  requireId(mission.id, findings, file, "/id");
  requireTextMap(mission.title, findings, file, "/title");
  if (!/^\d+\.\d+\.\d+$/u.test(mission.version ?? "")) findings.push(finding("error", "COURSEWARE_MISSION_VERSION_INVALID", "mission.version \u5FC5\u987B\u4F7F\u7528\u7A33\u5B9A\u8BED\u4E49\u7248\u672C\u3002", { path: file, pointer: "/version" }));
  const slots = new Set(requireIdList(mission.capabilitySlots, findings, file, "/capabilitySlots", { allowEmpty: true }));
  const meters = { clocks: /* @__PURE__ */ new Set(), resources: /* @__PURE__ */ new Set() };
  for (const [kind, items] of [["clocks", mission.clocks], ["resources", mission.resources]]) {
    if (!Array.isArray(items) || kind === "clocks" && items.length === 0) {
      findings.push(finding("error", "COURSEWARE_MISSION_METER_INVALID", `${kind} \u5FC5\u987B\u662F${kind === "clocks" ? "\u975E\u7A7A" : ""}\u6570\u7EC4\u3002`, { path: file, pointer: `/${kind}` }));
      continue;
    }
    for (const [index, meter] of items.entries()) {
      const pointer = `/${kind}/${index}`;
      rejectUnknown(meter, ["id", "initial", "minimum", "maximum"], findings, file, pointer);
      requireId(meter?.id, findings, file, `${pointer}/id`);
      if (meters[kind].has(meter?.id)) findings.push(finding("error", "COURSEWARE_ID_DUPLICATE", `${kind} \u5B58\u5728\u91CD\u590D ID ${meter?.id}\u3002`, { path: file, pointer }));
      meters[kind].add(meter?.id);
      if (![meter?.initial, meter?.minimum, meter?.maximum].every(Number.isFinite) || meter.minimum > meter.maximum || meter.initial < meter.minimum || meter.initial > meter.maximum) findings.push(finding("error", "COURSEWARE_MISSION_METER_INVALID", `\u4EFB\u52A1\u91CF\u8868 ${meter?.id ?? index} \u7684\u521D\u59CB\u503C\u6216\u8303\u56F4\u65E0\u6548\u3002`, { path: file, pointer }));
    }
  }
  const nodes = Array.isArray(mission.nodes) ? mission.nodes : [];
  const nodeIds = new Set(nodes.map((node) => node?.id));
  if (!nodes.length || nodeIds.size !== nodes.length) findings.push(finding("error", "COURSEWARE_MISSION_NODE_INVALID", "\u4EFB\u52A1\u8282\u70B9\u5FC5\u987B\u975E\u7A7A\u4E14 ID \u65E0\u91CD\u590D\u3002", { path: file, pointer: "/nodes" }));
  if (!nodeIds.has(mission.initialNodeId)) findings.push(finding("error", "COURSEWARE_MISSION_NODE_REFERENCE_INVALID", `\u521D\u59CB\u8282\u70B9 ${mission.initialNodeId} \u4E0D\u5B58\u5728\u3002`, { path: file, pointer: "/initialNodeId" }));
  const metricIds = /* @__PURE__ */ new Set();
  const emittedClaims = /* @__PURE__ */ new Set();
  for (const [nodeIndex, node] of nodes.entries()) {
    const pointer = `/nodes/${nodeIndex}`;
    rejectUnknown(node, ["id", "kind", "title", "capabilitySlots", "actions"], findings, file, pointer);
    requireId(node?.id, findings, file, `${pointer}/id`);
    requireTextMap(node?.title, findings, file, `${pointer}/title`);
    if (!["briefing", "calculation", "construction", "simulation", "decision", "checkpoint", "debrief"].includes(node?.kind)) findings.push(finding("error", "COURSEWARE_MISSION_NODE_INVALID", `\u8282\u70B9 ${node?.id ?? nodeIndex} \u7684 kind \u65E0\u6548\u3002`, { path: file, pointer: `${pointer}/kind` }));
    for (const slot of requireIdList(node?.capabilitySlots ?? [], findings, file, `${pointer}/capabilitySlots`, { allowEmpty: true })) if (!slots.has(slot)) findings.push(finding("error", "COURSEWARE_MISSION_SLOT_REFERENCE_INVALID", `\u8282\u70B9 ${node.id} \u5F15\u7528\u4E86\u672A\u58F0\u660E\u80FD\u529B\u69FD ${slot}\u3002`, { path: file, pointer: `${pointer}/capabilitySlots` }));
    const actions = Array.isArray(node?.actions) ? node.actions : [];
    const actionIds = new Set(actions.map((action) => action?.id));
    if (!actions.length || actionIds.size !== actions.length) findings.push(finding("error", "COURSEWARE_MISSION_ACTION_INVALID", `\u8282\u70B9 ${node?.id ?? nodeIndex} \u5FC5\u987B\u6709\u65E0\u91CD\u590D\u884C\u52A8\u3002`, { path: file, pointer: `${pointer}/actions` }));
    for (const [actionIndex, action] of actions.entries()) {
      const actionPointer = `${pointer}/actions/${actionIndex}`;
      requireFields(action, ["id", "title", "success", "onSuccess"], findings, file, actionPointer);
      rejectUnknown(action, ["id", "title", "clockCosts", "resourceCosts", "success", "onSuccess", "onFailure", "evidence"], findings, file, actionPointer);
      requireId(action?.id, findings, file, `${actionPointer}/id`);
      requireTextMap(action?.title, findings, file, `${actionPointer}/title`);
      for (const [field, meterSet] of [["clockCosts", meters.clocks], ["resourceCosts", meters.resources]]) for (const [id, amount] of Object.entries(action?.[field] ?? {})) if (!meterSet.has(id) || !Number.isFinite(amount) || amount < 0) findings.push(finding("error", "COURSEWARE_MISSION_COST_INVALID", `\u884C\u52A8 ${action?.id} \u7684 ${field}.${id} \u65E0\u6548\u3002`, { path: file, pointer: `${actionPointer}/${field}/${id}` }));
      if (!Array.isArray(action?.success)) findings.push(finding("error", "COURSEWARE_MISSION_ACTION_INVALID", `\u884C\u52A8 ${action?.id ?? actionIndex} \u7684 success \u5FC5\u987B\u662F\u6761\u4EF6\u6570\u7EC4\u3002`, { path: file, pointer: `${actionPointer}/success` }));
      for (const [conditionIndex, condition] of (Array.isArray(action?.success) ? action.success : []).entries()) validateMissionCondition(condition, findings, file, `${actionPointer}/success/${conditionIndex}`, meters, metricIds);
      for (const field of ["onSuccess", "onFailure"]) if (action?.[field] !== void 0) {
        if (!requireFields(action[field], ["to"], findings, file, `${actionPointer}/${field}`)) continue;
        rejectUnknown(action[field], ["to", "when"], findings, file, `${actionPointer}/${field}`);
        if (!nodeIds.has(action[field].to)) findings.push(finding("error", "COURSEWARE_MISSION_NODE_REFERENCE_INVALID", `\u884C\u52A8 ${action.id} \u6307\u5411\u4E0D\u5B58\u5728\u7684\u8282\u70B9 ${action[field].to}\u3002`, { path: file, pointer: `${actionPointer}/${field}/to` }));
        const when = action[field].when;
        if (when !== void 0 && !Array.isArray(when)) findings.push(finding("error", "COURSEWARE_MISSION_CONDITION_INVALID", `\u884C\u52A8 ${action.id} \u7684 ${field}.when \u5FC5\u987B\u662F\u6761\u4EF6\u6570\u7EC4\u3002`, { path: file, pointer: `${actionPointer}/${field}/when` }));
        for (const [conditionIndex, condition] of (Array.isArray(when) ? when : []).entries()) validateMissionCondition(condition, findings, file, `${actionPointer}/${field}/when/${conditionIndex}`, meters, metricIds);
      }
      const evidenceItems = action?.evidence;
      if (evidenceItems !== void 0 && !Array.isArray(evidenceItems)) findings.push(finding("error", "COURSEWARE_MISSION_EVIDENCE_INVALID", `\u884C\u52A8 ${action?.id ?? actionIndex} \u7684 evidence \u5FC5\u987B\u662F\u8BC1\u636E\u6570\u7EC4\u3002`, { path: file, pointer: `${actionPointer}/evidence` }));
      for (const [evidenceIndex, evidence] of (Array.isArray(evidenceItems) ? evidenceItems : []).entries()) {
        const evidencePointer = `${actionPointer}/evidence/${evidenceIndex}`;
        requireFields(evidence, ["claimId", "kind"], findings, file, evidencePointer);
        rejectUnknown(evidence, ["claimId", "kind", "strength"], findings, file, evidencePointer);
        requireId(evidence?.claimId, findings, file, `${evidencePointer}/claimId`);
        if (!["prediction", "calculation", "configuration", "measurement", "comparison", "explanation", "transfer"].includes(evidence?.kind) || evidence?.strength !== void 0 && (!Number.isFinite(evidence.strength) || evidence.strength < 0 || evidence.strength > 1)) findings.push(finding("error", "COURSEWARE_MISSION_EVIDENCE_INVALID", `\u884C\u52A8 ${action?.id ?? actionIndex} \u7684\u8BC1\u636E\u7C7B\u578B\u6216\u5F3A\u5EA6\u65E0\u6548\u3002`, { path: file, pointer: evidencePointer }));
        emittedClaims.add(evidence?.claimId);
      }
    }
  }
  const outcomes = Array.isArray(mission.outcomes) ? mission.outcomes : [];
  const outcomeIds = new Set(outcomes.map((outcome) => outcome?.id));
  if (!outcomes.length || outcomeIds.size !== outcomes.length) findings.push(finding("error", "COURSEWARE_MISSION_OUTCOME_INVALID", "\u4EFB\u52A1\u5FC5\u987B\u58F0\u660E\u65E0\u91CD\u590D\u7684\u7ED3\u5C40\u3002", { path: file, pointer: "/outcomes" }));
  for (const [index, outcome] of outcomes.entries()) {
    const pointer = `/outcomes/${index}`;
    rejectUnknown(outcome, ["id", "kind", "title", "when"], findings, file, pointer);
    requireId(outcome?.id, findings, file, `${pointer}/id`);
    requireTextMap(outcome?.title, findings, file, `${pointer}/title`);
    if (!["success", "partial", "failure"].includes(outcome?.kind)) findings.push(finding("error", "COURSEWARE_MISSION_OUTCOME_INVALID", `\u7ED3\u5C40 ${outcome?.id ?? index} kind \u65E0\u6548\u3002`, { path: file, pointer: `${pointer}/kind` }));
    if (!Array.isArray(outcome?.when)) findings.push(finding("error", "COURSEWARE_MISSION_CONDITION_INVALID", `\u7ED3\u5C40 ${outcome?.id ?? index} \u7684 when \u5FC5\u987B\u662F\u6761\u4EF6\u6570\u7EC4\u3002`, { path: file, pointer: `${pointer}/when` }));
    for (const [conditionIndex, condition] of (Array.isArray(outcome?.when) ? outcome.when : []).entries()) validateMissionCondition(condition, findings, file, `${pointer}/when/${conditionIndex}`, meters, metricIds);
  }
  return { id: mission.id, slots, nodeIds, metricIds, emittedClaims };
}
function validateCapabilityBindings(document2, findings, file, missionInfo, moduleGraph = null) {
  const fields = ["format", "schemaVersion", "missionId", "bindings"];
  if (!requireFields(document2, fields, findings, file)) return null;
  rejectUnknown(document2, fields, findings, file);
  if (document2.format !== "mooyu.mission-capability-binding" || document2.schemaVersion !== 1 || document2.missionId !== missionInfo?.id) findings.push(finding("error", "COURSEWARE_MISSION_BINDING_INVALID", "\u80FD\u529B\u7ED1\u5B9A\u683C\u5F0F\u3001\u7248\u672C\u6216 missionId \u4E0D\u5339\u914D\u3002", { path: file, pointer: "/missionId" }));
  const bindings = Array.isArray(document2.bindings) ? document2.bindings : [];
  const slots = /* @__PURE__ */ new Set();
  const metrics = /* @__PURE__ */ new Set();
  for (const [index, binding] of bindings.entries()) {
    const pointer = `/bindings/${index}`;
    rejectUnknown(binding, ["slot", "moduleId", "capability", "query", "metrics"], findings, file, pointer);
    requireId(binding?.slot, findings, file, `${pointer}/slot`);
    requireId(binding?.moduleId, findings, file, `${pointer}/moduleId`);
    requireId(binding?.capability, findings, file, `${pointer}/capability`);
    if (slots.has(binding?.slot) || !missionInfo?.slots.has(binding?.slot)) findings.push(finding("error", "COURSEWARE_MISSION_SLOT_REFERENCE_INVALID", `\u80FD\u529B\u69FD ${binding?.slot} \u91CD\u590D\u6216\u672A\u5728\u4EFB\u52A1\u4E2D\u58F0\u660E\u3002`, { path: file, pointer: `${pointer}/slot` }));
    slots.add(binding?.slot);
    for (const [metricIndex, metric] of (binding?.metrics ?? []).entries()) {
      rejectUnknown(metric, ["id", "path"], findings, file, `${pointer}/metrics/${metricIndex}`);
      requireId(metric?.id, findings, file, `${pointer}/metrics/${metricIndex}/id`);
      if (metrics.has(metric?.id)) findings.push(finding("error", "COURSEWARE_MISSION_METRIC_DUPLICATE", `\u6307\u6807 ${metric?.id} \u88AB\u91CD\u590D\u7ED1\u5B9A\u3002`, { path: file, pointer: `${pointer}/metrics/${metricIndex}/id` }));
      metrics.add(metric?.id);
    }
    if (moduleGraph) {
      const record = moduleGraph.records.find((item2) => item2.module.id === binding?.moduleId);
      if (!record) findings.push(finding("error", "COURSEWARE_MISSION_MODULE_REFERENCE_INVALID", `\u80FD\u529B\u69FD ${binding?.slot} \u7ED1\u5B9A\u4E86\u672A\u53D1\u5E03\u6A21\u5757 ${binding?.moduleId}\u3002`, { path: file, pointer: `${pointer}/moduleId` }));
      else if (!record.module.capabilities.includes(binding?.capability)) findings.push(finding("error", "COURSEWARE_MISSION_CAPABILITY_INVALID", `\u6A21\u5757 ${binding.moduleId} \u4E0D\u63D0\u4F9B\u80FD\u529B ${binding.capability}\u3002`, { path: file, pointer: `${pointer}/capability` }));
    }
  }
  for (const slot of missionInfo?.slots ?? []) if (!slots.has(slot)) findings.push(finding("error", "COURSEWARE_MISSION_SLOT_UNBOUND", `\u4EFB\u52A1\u80FD\u529B\u69FD ${slot} \u672A\u7ED1\u5B9A\u3002`, { path: file, pointer: "/bindings" }));
  for (const metric of missionInfo?.metricIds ?? []) if (!metrics.has(metric)) findings.push(finding("error", "COURSEWARE_MISSION_METRIC_UNBOUND", `\u4EFB\u52A1\u6761\u4EF6\u6307\u6807 ${metric} \u672A\u7ED1\u5B9A\u3002`, { path: file, pointer: "/bindings" }));
  return { metrics };
}
function validateLearningEvidenceModel(model, findings, file, missionInfo, courseSets) {
  const fields = ["format", "schemaVersion", "id", "objectiveIds", "claims"];
  if (!requireFields(model, fields, findings, file)) return;
  rejectUnknown(model, fields, findings, file);
  if (model.format !== "mooyu.learning-evidence-model" || model.schemaVersion !== 1) findings.push(finding("error", "COURSEWARE_LEARNING_EVIDENCE_FORMAT_INVALID", "evidenceModel \u683C\u5F0F\u6216\u7248\u672C\u65E0\u6548\u3002", { path: file, pointer: "/format" }));
  const objectives = new Set(requireIdList(model.objectiveIds, findings, file, "/objectiveIds"));
  for (const objective of objectives) if (courseSets && !courseSets.objectiveIds.has(objective)) findings.push(finding("error", "COURSEWARE_OBJECTIVE_REFERENCE_INVALID", `\u5B66\u4E60\u8BC1\u636E\u6A21\u578B\u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u76EE\u6807 ${objective}\u3002`, { path: file, pointer: "/objectiveIds" }));
  const claims = Array.isArray(model.claims) ? model.claims : [];
  const claimIds = new Set(claims.map((claim) => claim?.id));
  if (!claims.length || claimIds.size !== claims.length) findings.push(finding("error", "COURSEWARE_LEARNING_EVIDENCE_INVALID", "\u5B66\u4E60\u8BC1\u636E\u58F0\u660E\u5FC5\u987B\u975E\u7A7A\u4E14 ID \u65E0\u91CD\u590D\u3002", { path: file, pointer: "/claims" }));
  for (const [index, claim] of claims.entries()) {
    const pointer = `/claims/${index}`;
    requireFields(claim, ["id", "objectiveId", "kind", "weight", "minimumStrength"], findings, file, pointer);
    rejectUnknown(claim, ["id", "objectiveId", "kind", "weight", "minimumStrength", "required"], findings, file, pointer);
    requireId(claim?.id, findings, file, `${pointer}/id`);
    if (!objectives.has(claim?.objectiveId)) findings.push(finding("error", "COURSEWARE_OBJECTIVE_REFERENCE_INVALID", `\u8BC1\u636E\u58F0\u660E ${claim?.id} \u5F15\u7528\u4E86\u672A\u58F0\u660E\u76EE\u6807 ${claim?.objectiveId}\u3002`, { path: file, pointer: `${pointer}/objectiveId` }));
    if (!["prediction", "calculation", "configuration", "measurement", "comparison", "explanation", "transfer"].includes(claim?.kind) || !Number.isFinite(claim?.weight) || claim.weight <= 0 || claim.weight > 100 || !Number.isFinite(claim?.minimumStrength) || claim.minimumStrength < 0 || claim.minimumStrength > 1 || claim.required !== void 0 && typeof claim.required !== "boolean") findings.push(finding("error", "COURSEWARE_LEARNING_EVIDENCE_INVALID", `\u8BC1\u636E\u58F0\u660E ${claim?.id ?? index} \u7684\u7C7B\u578B\u3001\u6743\u91CD\u3001\u9608\u503C\u6216 required \u65E0\u6548\u3002`, { path: file, pointer }));
  }
  for (const claimId of missionInfo?.emittedClaims ?? []) if (!claimIds.has(claimId)) findings.push(finding("error", "COURSEWARE_MISSION_EVIDENCE_REFERENCE_INVALID", `\u4EFB\u52A1\u53D1\u5C04\u4E86\u672A\u5728\u5B66\u4E60\u8BC1\u636E\u6A21\u578B\u58F0\u660E\u7684 ${claimId}\u3002`, { path: file, pointer: "/claims" }));
}
async function inspectCoursewareProject(root) {
  const projectRoot = path2.resolve(root);
  const findings = [];
  const manifest = await readJson(projectRoot, "mooyu-courseware.json", findings, "COURSEWARE_MANIFEST_INVALID");
  if (manifest) validateManifest(manifest, findings);
  const coursePath = safeRelativePath2(manifest?.course) ? manifest.course : "courseware/course.json";
  const evidencePath = safeRelativePath2(manifest?.evidence) ? manifest.evidence : "evidence/sources.json";
  const testsPath = safeRelativePath2(manifest?.tests) ? manifest.tests : "tests/journeys.json";
  const course = manifest ? await readJson(projectRoot, coursePath, findings) : null;
  const courseSets = course ? validateCourse(course, findings, coursePath) : null;
  const experiencePath = safeRelativePath2(manifest?.experience) ? manifest.experience : null;
  const experience = experiencePath ? await readJson(projectRoot, experiencePath, findings) : null;
  if (experience) validateExperience(experience, findings, experiencePath, courseSets);
  const missionPath = safeRelativePath2(manifest?.mission) ? manifest.mission : null;
  const bindingsPath = safeRelativePath2(manifest?.capabilityBindings) ? manifest.capabilityBindings : null;
  const evidenceModelPath = safeRelativePath2(manifest?.evidenceModel) ? manifest.evidenceModel : null;
  const mission = missionPath ? await readJson(projectRoot, missionPath, findings) : null;
  const bindings = bindingsPath ? await readJson(projectRoot, bindingsPath, findings) : null;
  const evidenceModel = evidenceModelPath ? await readJson(projectRoot, evidenceModelPath, findings) : null;
  const missionInfo = mission ? validateMission(mission, findings, missionPath) : null;
  if (bindings && missionInfo) validateCapabilityBindings(bindings, findings, bindingsPath, missionInfo);
  if (evidenceModel && missionInfo) validateLearningEvidenceModel(evidenceModel, findings, evidenceModelPath, missionInfo, courseSets);
  const evidence = manifest ? await readJson(projectRoot, evidencePath, findings) : null;
  if (evidence) validateEvidence(evidence, findings, evidencePath, course, coursePath);
  const journeys = manifest ? await readJson(projectRoot, testsPath, findings) : null;
  if (journeys) validateJourneys(journeys, findings, testsPath, courseSets);
  if (manifest?.build?.profile === "mooyu-structured-v1" && !findings.some((value) => value.severity === "error" && value.path === "mooyu-courseware.json")) {
    try {
      const graph = await resolveCoursewareModuleGraph(projectRoot, manifest);
      if (bindings && missionInfo) validateCapabilityBindings(bindings, findings, bindingsPath, missionInfo, graph);
      findings.push(finding("info", "COURSEWARE_MODULE_GRAPH_READY", `${graph.records.length} \u4E2A\u6A21\u5757\u7684\u4F9D\u8D56\u3001API \u7248\u672C\u4E0E\u5165\u53E3\u5B8C\u6574\u6027\u5DF2\u901A\u8FC7\u68C0\u67E5\u3002`, { path: "mooyu-courseware.json", pointer: "/runtime/modules" }));
    } catch (error) {
      findings.push(finding("error", error.code ?? "COURSEWARE_MODULE_GRAPH_INVALID", error.message, { path: error.path ?? "mooyu-courseware.json", pointer: error.pointer ?? "/runtime/modules" }));
    }
  }
  const entry = manifest?.build?.entry ?? "dist/index.html";
  if (safeRelativePath2(entry)) try {
    const stat = await fs2.lstat(path2.join(projectRoot, ...entry.split("/")));
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 16) throw new Error("\u4E0D\u662F\u6709\u6548\u666E\u901A\u6587\u4EF6");
  } catch (error) {
    findings.push(finding("error", "COURSEWARE_ENTRY_MISSING", `\u6784\u5EFA\u5165\u53E3 ${entry} \u4E0D\u53EF\u7528\uFF1A${error.message}`, { path: "mooyu-courseware.json", pointer: "/build/entry" }));
  }
  if (!findings.some((value) => value.severity === "error")) findings.push(finding("info", "COURSEWARE_CONTRACT_READY", `\u8BFE\u7A0B\u7ED3\u6784\u3001\u8BC1\u636E\u94FE\u3001\u5B66\u4E60\u8DEF\u5F84${experience ? "\u3001\u4F53\u9A8C\u6A21\u5F0F" : ""}${mission ? "\u3001\u7EFC\u5408\u4EFB\u52A1" : ""}\u548C\u6784\u5EFA\u5165\u53E3\u901A\u8FC7 L0 \u5951\u7EA6\u68C0\u67E5\u3002`));
  findings.push(finding("warning", "COURSEWARE_DOCTOR_LIMIT", "L0 Doctor \u9A8C\u8BC1\u7ED3\u6784\u4E0E\u5F15\u7528\u5B8C\u6574\u6027\uFF0C\u4E0D\u66FF\u4EE3\u5B66\u79D1\u4E13\u5BB6\u5BA1\u6821\u3001\u65E0\u969C\u788D\u5BA1\u8BA1\u6216\u6D4F\u89C8\u5668\u65C5\u7A0B\u6267\u884C\u3002"));
  const summary = { errors: findings.filter((value) => value.severity === "error").length, warnings: findings.filter((value) => value.severity === "warning").length, info: findings.filter((value) => value.severity === "info").length };
  return { reportVersion: COURSEWARE_DOCTOR_REPORT_VERSION, validatorVersion: COURSEWARE_VALIDATOR_VERSION, projectDigest: await publishableProjectDigest(projectRoot, manifest), root: projectRoot, ok: summary.errors === 0, summary, findings };
}

// packages/creator-tools/src/courseware-toolkit.mjs
import crypto3 from "node:crypto";
import fs3 from "node:fs/promises";
import http from "node:http";
import path3 from "node:path";
import { createRequire } from "node:module";
import { crc32, deflateRawSync } from "node:zlib";
var require2 = createRequire(import.meta.url);
var managedDirectory = ".mooyu";
var mimeTypes = /* @__PURE__ */ new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".webp", "image/webp"],
  [".woff2", "font/woff2"]
]);
var CoursewareToolkitError = class extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "CoursewareToolkitError";
    this.code = code;
    this.details = details;
  }
};
var sha2562 = (value) => crypto3.createHash("sha256").update(value).digest("hex");
var safeRelativePath3 = (value) => typeof value === "string" && value.length > 0 && value.length <= 255 && !path3.isAbsolute(value) && !value.includes("\\") && value.split("/").every((part) => part && part !== "." && part !== "..");
var readJson2 = async (file) => JSON.parse(await fs3.readFile(file, "utf8"));
async function assertNoSymlinkAncestors(target) {
  const resolved = path3.resolve(target);
  const parsed = path3.parse(resolved);
  let current = parsed.root;
  for (const part of resolved.slice(parsed.root.length).split(path3.sep).filter(Boolean)) {
    current = path3.join(current, part);
    const stat = await fs3.lstat(current).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (stat?.isSymbolicLink()) throw new CoursewareToolkitError("COURSEWARE_OUTPUT_SYMLINK_FORBIDDEN", `\u8F93\u51FA\u8DEF\u5F84\u4E0D\u80FD\u7ECF\u8FC7\u7B26\u53F7\u94FE\u63A5\uFF1A${current}`);
    if (!stat) break;
  }
}
async function fileRecord(root, relative) {
  if (!safeRelativePath3(relative)) throw new CoursewareToolkitError("COURSEWARE_PATH_INVALID", `\u4E0D\u5B89\u5168\u7684\u8BFE\u7A0B\u5305\u8DEF\u5F84\uFF1A${relative}`);
  const absolute = path3.join(root, ...relative.split("/"));
  const stat = await fs3.lstat(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new CoursewareToolkitError("COURSEWARE_FILE_INVALID", `${relative} \u5FC5\u987B\u662F\u666E\u901A\u6587\u4EF6\u3002`);
  const bytes = await fs3.readFile(absolute);
  return { relative, absolute, bytes, size: bytes.length, sha256: sha2562(bytes) };
}
async function loadCoursewareInventory(root) {
  const projectRoot = path3.resolve(root);
  const manifest = await readJson2(path3.join(projectRoot, "mooyu-courseware.json"));
  const fixed = ["mooyu-courseware.json", manifest.course, manifest.experience, manifest.evidence, manifest.tests].filter(Boolean);
  const records = [];
  for (const relative of fixed) records.push(await fileRecord(projectRoot, relative));
  const moduleGraph = await resolveCoursewareModuleGraph(projectRoot, manifest);
  if (moduleGraph) {
    records.push(...coursewareModuleFiles(moduleGraph));
    records.push({ relative: manifest.runtime.moduleLock, absolute: null, bytes: moduleGraph.lockBytes, size: moduleGraph.lockBytes.length, sha256: moduleGraph.lockSha256, generated: true });
    records.push(...await coursewareRuntimeFiles(manifest));
  }
  const distRoot = path3.join(projectRoot, "dist");
  const walk = async (directory, prefix = "dist") => {
    for (const entry of (await fs3.readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name, "en"))) {
      const relative = `${prefix}/${entry.name}`;
      if (relative === manifest.runtime?.moduleLock) continue;
      if (entry.isSymbolicLink()) throw new CoursewareToolkitError("COURSEWARE_SYMLINK_FORBIDDEN", `${relative} \u662F\u7B26\u53F7\u94FE\u63A5\u3002`);
      if (entry.isDirectory()) await walk(path3.join(directory, entry.name), relative);
      else if (entry.isFile()) records.push(await fileRecord(projectRoot, relative));
      else throw new CoursewareToolkitError("COURSEWARE_FILE_INVALID", `${relative} \u4E0D\u662F\u666E\u901A\u6587\u4EF6\u3002`);
      if (records.length > 2e3) throw new CoursewareToolkitError("COURSEWARE_FILE_COUNT_EXCEEDED", "\u8BFE\u7A0B\u5305\u6587\u4EF6\u8D85\u8FC7 2000 \u4E2A\u3002");
    }
  };
  await walk(distRoot);
  const deduplicated = [...new Map(records.map((record) => [record.relative, record])).values()].sort((left, right) => left.relative.localeCompare(right.relative, "en"));
  const totalBytes = deduplicated.reduce((sum, record) => sum + record.size, 0);
  if (totalBytes > 128 * 1024 * 1024) throw new CoursewareToolkitError("COURSEWARE_PROJECT_TOO_LARGE", "\u8BFE\u7A0B\u5305\u8D85\u8FC7 128 MiB\u3002");
  const digest = sha2562(Buffer.concat(deduplicated.flatMap((record) => [Buffer.from(record.relative), Buffer.from([0]), record.bytes, Buffer.from([0])])));
  return { root: projectRoot, manifest, moduleGraph, files: deduplicated, totalBytes, projectDigest: digest };
}
async function describeCoursewareProject(root, inspect) {
  const report = await inspect(root);
  let inventory = null;
  try {
    inventory = await loadCoursewareInventory(root);
  } catch {
  }
  if (!inventory) return { kind: "interactive-courseware", root: path3.resolve(root), ok: false, report };
  const course = await readJson2(path3.join(inventory.root, ...inventory.manifest.course.split("/")));
  const experience = inventory.manifest.experience ? await readJson2(path3.join(inventory.root, ...inventory.manifest.experience.split("/"))) : null;
  const evidence = await readJson2(path3.join(inventory.root, ...inventory.manifest.evidence.split("/")));
  const journeys = await readJson2(path3.join(inventory.root, ...inventory.manifest.tests.split("/")));
  return {
    kind: "interactive-courseware",
    root: inventory.root,
    ok: report.ok,
    id: inventory.manifest.id,
    title: inventory.manifest.title,
    defaultLocale: inventory.manifest.defaultLocale,
    locales: inventory.manifest.locales,
    subjects: inventory.manifest.subjects,
    counts: { objectives: course.objectives?.length ?? 0, scenes: course.scenes?.length ?? 0, checkpoints: course.checkpoints?.length ?? 0, modes: experience?.modes?.length ?? 0, challenges: experience?.modes?.filter((mode) => mode.kind === "scenario-challenge").length ?? 0, modules: inventory.moduleGraph?.records.length ?? 0, sources: evidence.sources?.length ?? 0, claims: evidence.claims?.length ?? 0, journeys: journeys.journeys?.length ?? 0, files: inventory.files.length },
    totalBytes: inventory.totalBytes,
    projectDigest: inventory.projectDigest,
    report
  };
}
async function initializeCoursewareProject({ templateRoot, targetRoot }) {
  const source = path3.resolve(templateRoot);
  const target = path3.resolve(targetRoot);
  const sourceStat = await fs3.lstat(source).catch(() => null);
  if (!sourceStat?.isDirectory() || sourceStat.isSymbolicLink()) throw new CoursewareToolkitError("COURSEWARE_TEMPLATE_INVALID", "\u8BFE\u4EF6\u6A21\u677F\u76EE\u5F55\u4E0D\u53EF\u7528\u3002");
  await assertNoSymlinkAncestors(path3.dirname(target));
  const targetStat = await fs3.lstat(target).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (targetStat) throw new CoursewareToolkitError("COURSEWARE_TARGET_EXISTS", "\u76EE\u6807\u76EE\u5F55\u5DF2\u7ECF\u5B58\u5728\uFF1B\u4E3A\u907F\u514D\u8986\u76D6\uFF0C\u672C\u5730\u521D\u59CB\u5316\u5DF2\u505C\u6B62\u3002");
  await fs3.cp(source, target, { recursive: true, errorOnExist: true, force: false });
  const manifest = await readJson2(path3.join(target, "mooyu-courseware.json"));
  return { action: "created", template: path3.basename(source), target, id: manifest.id };
}
async function ensureOutputDirectory(directory) {
  await assertNoSymlinkAncestors(directory);
  const stat = await fs3.lstat(directory).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (!stat) {
    await fs3.mkdir(directory, { recursive: true });
    return;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new CoursewareToolkitError("COURSEWARE_OUTPUT_INVALID", "\u8F93\u51FA\u4F4D\u7F6E\u5FC5\u987B\u662F\u666E\u901A\u76EE\u5F55\u3002");
  if ((await fs3.readdir(directory)).length) throw new CoursewareToolkitError("COURSEWARE_OUTPUT_NOT_EMPTY", "\u81EA\u5B9A\u4E49\u8F93\u51FA\u76EE\u5F55\u5FC5\u987B\u4E3A\u7A7A\uFF0C\u907F\u514D\u8986\u76D6\u73B0\u6709\u6587\u4EF6\u3002");
}
async function buildCoursewareProject(root, { inspect, outputDirectory } = {}) {
  const report = await inspect(root);
  if (!report.ok) throw new CoursewareToolkitError("COURSEWARE_DOCTOR_FAILED", "Doctor \u672A\u901A\u8FC7\uFF0C\u4E0D\u80FD\u6784\u5EFA\u8BFE\u4EF6\u3002", report);
  const inventory = await loadCoursewareInventory(root);
  const defaultOutput = path3.join(inventory.root, managedDirectory, "build", inventory.projectDigest);
  const output2 = path3.resolve(outputDirectory ?? defaultOutput);
  const existingReport = await readJson2(path3.join(output2, "build-report.json")).catch(() => null);
  if (!outputDirectory && existingReport?.projectDigest === inventory.projectDigest) return { ...existingReport, output: output2, reused: true };
  await ensureOutputDirectory(output2);
  for (const file of inventory.files) {
    const destination = path3.join(output2, ...file.relative.split("/"));
    await fs3.mkdir(path3.dirname(destination), { recursive: true });
    if (file.absolute) await fs3.copyFile(file.absolute, destination);
    else await fs3.writeFile(destination, file.bytes, { flag: "wx" });
  }
  const buildReport = {
    format: "mooyu.courseware-build",
    version: 1,
    coursewareId: inventory.manifest.id,
    projectDigest: inventory.projectDigest,
    files: inventory.files.map(({ relative, size, sha256: hash, generated }) => ({ path: relative, bytes: size, sha256: hash, ...generated ? { generated: true } : {} })),
    totalBytes: inventory.totalBytes,
    ...inventory.moduleGraph ? { moduleLock: { path: inventory.manifest.runtime.moduleLock, sha256: inventory.moduleGraph.lockSha256, modules: inventory.moduleGraph.records.length, roots: inventory.moduleGraph.lock.roots } } : {}
  };
  await fs3.writeFile(path3.join(output2, "build-report.json"), `${JSON.stringify(buildReport, null, 2)}
`, { flag: "wx" });
  return { ...buildReport, output: output2, reused: false };
}
function zipBuffer(records) {
  const files = [];
  const central = [];
  let offset = 0;
  for (const record of records) {
    const name = Buffer.from(record.relative, "utf8");
    const packed = deflateRawSync(record.bytes, { level: 9 });
    const checksum = crc32(record.bytes);
    const flags = 2048;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(67324752);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(33, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(record.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(33639248);
    header.writeUInt16LE(788, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(flags, 8);
    header.writeUInt16LE(8, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt16LE(33, 14);
    header.writeUInt32LE(checksum, 16);
    header.writeUInt32LE(packed.length, 20);
    header.writeUInt32LE(record.bytes.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(33188 << 16 >>> 0, 38);
    header.writeUInt32LE(offset, 42);
    files.push(local, name, packed);
    central.push(header, name);
    offset += local.length + name.length + packed.length;
  }
  const table = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(101010256);
  end.writeUInt16LE(records.length, 8);
  end.writeUInt16LE(records.length, 10);
  end.writeUInt32LE(table.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...files, table, end]);
}
async function packageCoursewareProject(root, { inspect, outputPath } = {}) {
  const report = await inspect(root);
  if (!report.ok) throw new CoursewareToolkitError("COURSEWARE_DOCTOR_FAILED", "Doctor \u672A\u901A\u8FC7\uFF0C\u4E0D\u80FD\u6253\u5305\u8BFE\u4EF6\u3002", report);
  const inventory = await loadCoursewareInventory(root);
  const bytes = zipBuffer(inventory.files);
  const artifactSha256 = sha2562(bytes);
  const destination = path3.resolve(outputPath ?? path3.join(inventory.root, managedDirectory, "packages", `${inventory.manifest.id}-${inventory.projectDigest.slice(0, 12)}.zip`));
  if (path3.extname(destination).toLowerCase() !== ".zip") throw new CoursewareToolkitError("COURSEWARE_PACKAGE_EXTENSION_INVALID", "\u8BFE\u4EF6\u5305\u8F93\u51FA\u5FC5\u987B\u4F7F\u7528 .zip \u6269\u5C55\u540D\u3002");
  await assertNoSymlinkAncestors(destination);
  const destinationStat = await fs3.lstat(destination).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (destinationStat?.isSymbolicLink() || destinationStat && !destinationStat.isFile()) throw new CoursewareToolkitError("COURSEWARE_PACKAGE_PATH_INVALID", "\u8BFE\u4EF6\u5305\u8F93\u51FA\u5FC5\u987B\u662F\u666E\u901A ZIP \u6587\u4EF6\uFF0C\u4E0D\u80FD\u662F\u7B26\u53F7\u94FE\u63A5\u3002");
  const current = destinationStat ? await fs3.readFile(destination) : null;
  if (current) {
    if (sha2562(current) !== artifactSha256) throw new CoursewareToolkitError("COURSEWARE_PACKAGE_EXISTS", "\u76EE\u6807\u5305\u5DF2\u5B58\u5728\u4E14\u5185\u5BB9\u4E0D\u540C\uFF1B\u4E0D\u4F1A\u8986\u76D6\u3002");
    return { format: "mooyu.courseware-package", version: 1, coursewareId: inventory.manifest.id, projectDigest: inventory.projectDigest, artifactSha256, artifactBytes: bytes.length, path: destination, reused: true };
  }
  await fs3.mkdir(path3.dirname(destination), { recursive: true });
  await fs3.writeFile(destination, bytes, { flag: "wx" });
  return { format: "mooyu.courseware-package", version: 1, coursewareId: inventory.manifest.id, projectDigest: inventory.projectDigest, artifactSha256, artifactBytes: bytes.length, path: destination, reused: false };
}
function createCoursewarePreviewHandler(root) {
  const projectRoot = path3.resolve(root);
  return async (request, response) => {
    try {
      const inventory = await loadCoursewareInventory(projectRoot);
      const requestUrl = new URL(request.url ?? "/", "http://localhost");
      let relative = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, "");
      if (!relative || relative.endsWith("/")) relative = inventory.manifest.build.entry;
      if (!safeRelativePath3(relative)) {
        response.writeHead(400);
        response.end("Bad request");
        return;
      }
      let file = inventory.files.find((record) => record.relative === relative);
      if (!file) {
        const entryDirectory = path3.posix.dirname(inventory.manifest.build.entry);
        const entryRelative = entryDirectory === "." ? relative : path3.posix.join(entryDirectory, relative);
        if (safeRelativePath3(entryRelative)) file = inventory.files.find((record) => record.relative === entryRelative);
      }
      if (!file && !path3.extname(relative)) file = inventory.files.find((record) => record.relative === inventory.manifest.build.entry);
      if (!file) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      const structured = inventory.manifest.build.profile === "mooyu-structured-v1";
      response.writeHead(200, {
        "Content-Type": mimeTypes.get(path3.extname(file.relative).toLowerCase()) ?? "application/octet-stream",
        "Content-Length": file.bytes.length,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": `default-src 'self' data: blob:; script-src 'self'${structured ? " blob:" : ""} 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src '${structured ? "self" : "none"}'; img-src 'self' data: blob:; font-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'`
      });
      response.end(file.bytes);
    } catch {
      response.writeHead(500);
      response.end("Preview error");
    }
  };
}
async function createCoursewarePreviewServer(root, { inspect, host = "127.0.0.1", port = 0 } = {}) {
  if (host !== "127.0.0.1" && host !== "::1" && host !== "localhost") throw new CoursewareToolkitError("COURSEWARE_PREVIEW_HOST_INVALID", "\u9884\u89C8\u4EC5\u5141\u8BB8\u7ED1\u5B9A loopback \u5730\u5740\u3002");
  const report = await inspect(root);
  if (!report.ok) throw new CoursewareToolkitError("COURSEWARE_DOCTOR_FAILED", "Doctor \u672A\u901A\u8FC7\uFF0C\u4E0D\u80FD\u542F\u52A8\u9884\u89C8\u3002", report);
  const server = http.createServer(createCoursewarePreviewHandler(root));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host, port }, resolve);
  });
  const address = server.address();
  const url = `http://${host === "::1" ? "[::1]" : host}:${address.port}/`;
  return { server, url, host, port: address.port, close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}
async function testCoursewareProject(root, { inspect, browserModule = process.env.GAMEHUB_COMMUNITY_PLAYWRIGHT_PATH } = {}) {
  if (!browserModule) throw new CoursewareToolkitError("COURSEWARE_BROWSER_DRIVER_MISSING", "\u771F\u5B9E\u65C5\u7A0B\u6D4B\u8BD5\u9700\u8981 Playwright\uFF1B\u901A\u8FC7 --browser-module \u6216 GAMEHUB_COMMUNITY_PLAYWRIGHT_PATH \u63D0\u4F9B\u6A21\u5757\u8DEF\u5F84\u3002");
  let driver;
  try {
    driver = require2(browserModule);
  } catch (error) {
    throw new CoursewareToolkitError("COURSEWARE_BROWSER_DRIVER_INVALID", `\u65E0\u6CD5\u52A0\u8F7D\u6D4F\u89C8\u5668\u6A21\u5757\uFF1A${error.message}`);
  }
  if (!driver?.chromium) throw new CoursewareToolkitError("COURSEWARE_BROWSER_DRIVER_INVALID", "\u6D4F\u89C8\u5668\u6A21\u5757\u6CA1\u6709\u5BFC\u51FA chromium\u3002");
  const inventory = await loadCoursewareInventory(root);
  const course = await readJson2(path3.join(inventory.root, ...inventory.manifest.course.split("/")));
  const tests = await readJson2(path3.join(inventory.root, ...inventory.manifest.tests.split("/")));
  const preview = await createCoursewarePreviewServer(root, { inspect });
  let browser;
  const results = [];
  try {
    browser = await driver.chromium.launch({ headless: true });
    for (const journey of tests.journeys) {
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => {
        window.__mooyuLearningMessages = [];
        window.addEventListener("message", (event) => {
          if (event.data?.protocol === "mooyu.learning.v1") window.__mooyuLearningMessages.push(event.data);
        });
      });
      await page.goto(preview.url, { waitUntil: "load" });
      await page.evaluate((locale) => window.postMessage({
        protocol: "mooyu.learning.v1",
        direction: "host-to-courseware",
        type: "host.command",
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        payload: { name: "locale.set", value: { locale } }
      }, location.origin), journey.locale);
      try {
        await page.waitForFunction((locale) => document.documentElement.lang === locale, journey.locale);
      } catch {
        throw new CoursewareToolkitError("COURSEWARE_LOCALE_NOT_APPLIED", `${journey.id} \u672A\u5E94\u7528 Journey \u58F0\u660E\u7684\u8BED\u8A00 ${journey.locale}\u3002`);
      }
      for (const step of journey.steps) {
        if (step.action === "enter") await page.locator(`[data-mooyu-scene="${step.target}"]`).waitFor();
        else if (step.action === "set") await page.locator(`[data-mooyu-target="${step.target}"],#${step.target}`).first().evaluate((element, value) => {
          element.value = String(value);
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
        }, step.value);
        else if (step.action === "click") await page.locator(`[data-mooyu-action="${step.target}"],#${step.target}`).first().click();
        else if (step.action === "answer") await page.locator(`[data-mooyu-checkpoint="${step.target}"] [data-answer="${step.value}"]`).click();
        else if (step.action === "assert" && step.target === "assessment.correct") {
          try {
            await page.waitForFunction((expected) => [...window.__mooyuLearningMessages].reverse().find((message) => message.type === "assessment.result")?.payload?.correct === expected, step.expect);
          } catch {
            throw new CoursewareToolkitError("COURSEWARE_JOURNEY_ASSERTION_FAILED", `${journey.id} \u7684 assessment.correct \u672A\u8FBE\u5230\u671F\u671B ${step.expect}\u3002`);
          }
        } else if (step.action === "complete") {
          try {
            await page.waitForFunction((required) => {
              const complete = [...window.__mooyuLearningMessages].reverse().find((message) => message.type === "learning.progress")?.payload?.completedCheckpointIds ?? [];
              return required.every((id) => complete.includes(id));
            }, course.completion.checkpointIds);
          } catch {
            throw new CoursewareToolkitError("COURSEWARE_JOURNEY_COMPLETION_FAILED", `${journey.id} \u672A\u4EA7\u751F\u5B8C\u6574\u5B66\u4E60\u8FDB\u5EA6\u3002`);
          }
        }
      }
      if (errors.length) throw new CoursewareToolkitError("COURSEWARE_BROWSER_ERROR", `${journey.id} \u53D1\u751F\u6D4F\u89C8\u5668\u9519\u8BEF\uFF1A${errors.join("; ")}`);
      results.push({ id: journey.id, ok: true, steps: journey.steps.length });
      await page.close();
    }
    return { format: "mooyu.courseware-test", version: 1, coursewareId: inventory.manifest.id, projectDigest: inventory.projectDigest, ok: true, journeys: results };
  } finally {
    if (browser) await browser.close();
    await preview.close();
  }
}

// packages/creator-tools/src/index.mjs
var CREATOR_DOCTOR_REPORT_VERSION = 1;
var item = (severity, code, message, fix) => ({ severity, code, message, ...fix ? { fix } : {} });
var result = (root, findings) => ({
  version: CREATOR_DOCTOR_REPORT_VERSION,
  root,
  ok: !findings.some((value) => value.severity === "error"),
  summary: { errors: findings.filter((value) => value.severity === "error").length, warnings: findings.filter((value) => value.severity === "warning").length, info: findings.filter((value) => value.severity === "info").length },
  findings
});
var staticTextExtensions = /* @__PURE__ */ new Set([".html", ".htm", ".css", ".js", ".mjs", ".json", ".txt", ".md", ".xml", ".svg", ".twee", ".bitsy", ".puzzlescript"]);
var staticForbiddenExtensions = /* @__PURE__ */ new Set([".exe", ".dll", ".msi", ".bat", ".cmd", ".ps1", ".com", ".scr", ".sys", ".dylib", ".so", ".app", ".apk", ".jar", ".zip", ".rar", ".7z"]);
var staticSecretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{20,}\b/u,
  /\b(?:access|refresh|api)[_-]?token\s*[:=]\s*["'][^"']{12,}["']/iu,
  /\bapi[_-]?key\s*[:=]\s*["'][^"']{12,}["']/iu
];
async function inspectStaticWebProject(root) {
  const projectRoot = path4.resolve(root);
  const findings = [];
  const files = [];
  let totalBytes = 0;
  const walk = async (directory, prefix = "") => {
    let entries;
    try {
      entries = await fs4.readdir(directory, { withFileTypes: true });
    } catch (error) {
      findings.push(item("error", "WEB_PROJECT_UNREADABLE", `\u65E0\u6CD5\u8BFB\u53D6 ${prefix || "\u9879\u76EE\u76EE\u5F55"}\uFF1A${error.message}`));
      return;
    }
    for (const entry2 of entries) {
      const relative = prefix ? `${prefix}/${entry2.name}` : entry2.name;
      if (entry2.isSymbolicLink()) {
        findings.push(item("error", "WEB_SYMLINK_FORBIDDEN", `${relative} \u662F\u7B26\u53F7\u94FE\u63A5\u3002`, "\u5C06\u76EE\u6807\u5185\u5BB9\u590D\u5236\u4E3A\u9879\u76EE\u5185\u666E\u901A\u6587\u4EF6\u3002"));
        continue;
      }
      if (entry2.isDirectory()) {
        if (entry2.name === ".git" || entry2.name === "node_modules" || entry2.name === ".gamehub") continue;
        await walk(path4.join(directory, entry2.name), relative);
        continue;
      }
      if (!entry2.isFile()) {
        findings.push(item("error", "WEB_FILE_TYPE_INVALID", `${relative} \u4E0D\u662F\u666E\u901A\u6587\u4EF6\u3002`));
        continue;
      }
      const absolute = path4.join(directory, entry2.name);
      const stat = await fs4.stat(absolute);
      totalBytes += stat.size;
      files.push({ relative, absolute, size: stat.size, extension: path4.extname(entry2.name).toLowerCase() });
      if (files.length > 2e3) {
        findings.push(item("error", "WEB_FILE_COUNT_EXCEEDED", "\u9879\u76EE\u6587\u4EF6\u8D85\u8FC7 2000 \u4E2A\u3002", "\u5220\u9664\u6784\u5EFA\u7F13\u5B58\u3001\u6E90\u7801\u4F9D\u8D56\u548C\u65E0\u5173\u6587\u4EF6\uFF0C\u53EA\u4FDD\u7559\u6D4F\u89C8\u5668\u8FD0\u884C\u6240\u9700\u8D44\u6E90\u3002"));
        return;
      }
    }
  };
  await walk(projectRoot);
  const entry = files.find((file) => file.relative === "index.html");
  if (!entry) findings.push(item("error", "WEB_ENTRY_MISSING", "\u9879\u76EE\u6839\u76EE\u5F55\u7F3A\u5C11 index.html\u3002", "\u628A\u53EF\u73A9\u7684\u7F51\u9875\u5165\u53E3\u653E\u5728\u9879\u76EE\u6839\u76EE\u5F55\u5E76\u547D\u540D\u4E3A index.html\u3002"));
  else if (entry.size < 16 || entry.size > 5 * 1024 * 1024) findings.push(item("error", "WEB_ENTRY_SIZE_INVALID", "index.html \u5FC5\u987B\u662F 16 \u5B57\u8282\u81F3 5 MiB \u7684\u666E\u901A\u6587\u4EF6\u3002"));
  if (totalBytes > 128 * 1024 * 1024) findings.push(item("error", "WEB_PROJECT_TOO_LARGE", "\u9879\u76EE\u6587\u4EF6\u603B\u91CF\u8D85\u8FC7 128 MiB\u3002", "\u79FB\u9664\u6E90\u7D20\u6750\u3001\u7F16\u8F91\u5668\u7F13\u5B58\u548C\u672A\u4F7F\u7528\u8D44\u6E90\u3002"));
  for (const file of files) {
    if (staticForbiddenExtensions.has(file.extension)) findings.push(item("error", "WEB_EXECUTABLE_FORBIDDEN", `${file.relative} \u4E0D\u662F\u7F51\u9875\u53D1\u5E03\u7269\u5141\u8BB8\u7684\u6587\u4EF6\u7C7B\u578B\u3002`, "\u7F51\u9875\u5305\u53EA\u5E94\u5305\u542B\u6D4F\u89C8\u5668\u53EF\u8BFB\u53D6\u7684\u9759\u6001\u8D44\u6E90\u3002"));
    if (/^(?:\.env(?:\.|$)|credentials?|secrets?)(?:\.|$)/iu.test(path4.basename(file.relative))) findings.push(item("error", "WEB_SECRET_FILE", `${file.relative} \u770B\u8D77\u6765\u662F\u51ED\u636E\u6587\u4EF6\u3002`, "\u4ECE\u53D1\u5E03\u76EE\u5F55\u5220\u9664\u51ED\u636E\uFF0C\u5E76\u7ACB\u5373\u8F6E\u6362\u5DF2\u7ECF\u66B4\u9732\u7684\u5BC6\u94A5\u3002"));
    if (!staticTextExtensions.has(file.extension) || file.size > 1024 * 1024) continue;
    let source;
    try {
      source = await fs4.readFile(file.absolute, "utf8");
    } catch {
      continue;
    }
    if (staticSecretPatterns.some((pattern) => pattern.test(source))) findings.push(item("error", "WEB_SECRET_REFERENCE", `${file.relative} \u7591\u4F3C\u5305\u542B\u5BC6\u94A5\u6216\u4EE4\u724C\u3002`, "\u4ECE\u6210\u54C1\u4E2D\u79FB\u9664\u51ED\u636E\uFF0C\u5E76\u4F7F\u7528\u5E73\u53F0\u63D0\u4F9B\u7684\u53D7\u9650\u80FD\u529B\u6865\u3002"));
    if (/<(?:script|link)\b[^>]*(?:src|href)\s*=\s*["']https?:\/\//iu.test(source)) findings.push(item("warning", "WEB_REMOTE_RUNTIME", `${file.relative} \u5F15\u7528\u4E86\u8FDC\u7A0B\u811A\u672C\u6216\u6837\u5F0F\u3002`, "\u5C06\u8FD0\u884C\u4F9D\u8D56\u4FDD\u5B58\u5230\u9879\u76EE\u5185\uFF0C\u786E\u4FDD\u79BB\u7EBF\u548C\u9694\u79BB\u73AF\u5883\u53EF\u8FD0\u884C\u3002"));
    if (/\b(?:file:\/\/\/|[A-Z]:\\Users\\|\/home\/[^/]+\/)/u.test(source)) findings.push(item("warning", "WEB_LOCAL_PATH_REFERENCE", `${file.relative} \u53EF\u80FD\u5305\u542B\u672C\u673A\u7EDD\u5BF9\u8DEF\u5F84\u3002`, "\u6539\u7528\u9879\u76EE\u5185\u76F8\u5BF9\u8DEF\u5F84\u3002"));
  }
  if (!findings.some((finding2) => finding2.severity === "error")) findings.push(item("info", "WEB_PROJECT_READY", `\u672C\u5730\u7F51\u9875\u9879\u76EE\u5305\u542B ${files.length} \u4E2A\u6587\u4EF6\u3001${totalBytes} \u5B57\u8282\uFF0C\u53EF\u4EE5\u7EE7\u7EED\u538B\u7F29\u5E76\u4E0A\u4F20\u5E73\u53F0\u6821\u9A8C\u3002`));
  findings.push(item("warning", "LOCAL_DOCTOR_LIMIT", "\u672C\u5730 Doctor \u53EA\u68C0\u67E5\u53D1\u5E03\u7ED3\u6784\u548C\u660E\u663E\u6CC4\u6F0F\uFF1B\u5E73\u53F0\u4ECD\u4F1A\u91CD\u65B0\u89E3\u5305\u3001\u626B\u63CF\u5E76\u5728\u9694\u79BB\u73AF\u5883\u4E2D\u9A8C\u8BC1\u3002"));
  return result(projectRoot, findings);
}
async function inspectCoursewareProject2(root) {
  const contract = await inspectCoursewareProject(root);
  const runtime = await inspectStaticWebProject(path4.join(path4.resolve(root), "dist"));
  const findings = [...contract.findings, ...runtime.findings.map((value) => ({ ...value, path: value.path ? `dist/${value.path}` : "dist" }))];
  const summary = { errors: findings.filter((value) => value.severity === "error").length, warnings: findings.filter((value) => value.severity === "warning").length, info: findings.filter((value) => value.severity === "info").length };
  return { ...contract, ok: summary.errors === 0, summary, findings };
}
var describeCoursewareProject2 = (root) => describeCoursewareProject(root, inspectCoursewareProject2);
var buildCoursewareProject2 = (root, options2 = {}) => buildCoursewareProject(root, { ...options2, inspect: inspectCoursewareProject2 });
var packageCoursewareProject2 = (root, options2 = {}) => packageCoursewareProject(root, { ...options2, inspect: inspectCoursewareProject2 });
var createCoursewarePreviewServer2 = (root, options2 = {}) => createCoursewarePreviewServer(root, { ...options2, inspect: inspectCoursewareProject2 });
var testCoursewareProject2 = (root, options2 = {}) => testCoursewareProject(root, { ...options2, inspect: inspectCoursewareProject2 });

// scripts/creator-toolkit-cli.mjs
async function loadCatalog() {
  const candidates = [new URL("../plugins/gamehub/toolkits/catalog.json", import.meta.url), new URL("../toolkits/catalog.json", import.meta.url)];
  for (const candidate of candidates) try {
    return JSON.parse(await fs5.readFile(candidate, "utf8"));
  } catch {
  }
  throw new Error("\u58A8\u9C7C\u5DE5\u574A\u521B\u4F5C\u5DE5\u5177\u76EE\u5F55\u7F3A\u5931\uFF0C\u8BF7\u91CD\u65B0\u5B89\u88C5\u6216\u66F4\u65B0\u58A8\u9C7C\u5DE5\u574A Agent \u63D2\u4EF6\u3002");
}
function parseArguments(values) {
  const positionals2 = [];
  const options2 = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) {
      positionals2.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = values[index + 1];
    if (next !== void 0 && !next.startsWith("--")) {
      options2[key] = next;
      index += 1;
    } else options2[key] = true;
  }
  return { positionals: positionals2, options: options2 };
}
function printDoctor(report, label) {
  console.log(`${label}: ${report.ok ? "PASS" : "FAIL"} \xB7 ${report.summary.errors} error \xB7 ${report.summary.warnings} warning \xB7 ${report.summary.info} info`);
  for (const finding2 of report.findings) console.log(`[${finding2.severity.toUpperCase()}] ${finding2.code}: ${finding2.message}${finding2.fix ? `
  \u4FEE\u590D\uFF1A${finding2.fix}` : ""}`);
}
function output(value, asJson2, formatter) {
  if (asJson2) process.stdout.write(`${JSON.stringify(value, null, 2)}
`);
  else if (formatter) formatter(value);
  else console.log(value);
}
async function findTemplate(name) {
  const candidates = [new URL(`../templates/courseware/${name}/`, import.meta.url), new URL(`../plugins/gamehub/templates/courseware/${name}/`, import.meta.url)];
  for (const candidate of candidates) try {
    if ((await fs5.stat(candidate)).isDirectory() && (await fs5.stat(new URL("mooyu-courseware.json", candidate))).isFile()) return path5.resolve(fileURLToPath2(candidate));
  } catch {
  }
  throw new CoursewareToolkitError("COURSEWARE_TEMPLATE_UNKNOWN", `\u672A\u77E5\u6216\u672A\u5B89\u88C5\u7684\u8BFE\u4EF6\u6A21\u677F\uFF1A${name || "(missing)"}`);
}
var catalog = await loadCatalog();
var [command = "list", ...rawArguments] = process.argv.slice(2);
var { positionals, options } = parseArguments(rawArguments);
var asJson = options.json === true;
var keyOrPath = positionals[0];
var findToolkit = (key) => catalog.toolkits.find((toolkit) => toolkit.key === key);
function printToolkit(toolkit) {
  if (asJson) return process.stdout.write(`${JSON.stringify(toolkit, null, 2)}
`);
  console.log(`${toolkit.name} (${toolkit.key}) \xB7 ${toolkit.status}`);
  console.log(`\u9002\u5408\uFF1A${toolkit.bestFor.join("\u3001")}`);
  console.log(`\u672C\u5730\u6E90\u7801\uFF1A${toolkit.sourceFormat} \xB7 \u4EA7\u51FA\uFF1A${toolkit.output}`);
  console.log(`
\u4EA4\u7ED9 Agent \u7684\u4EFB\u52A1\uFF1A
${toolkit.agentPrompt}`);
  if (toolkit.template) console.log(`
\u5B98\u65B9\u6A21\u677F\uFF1A${toolkit.template}`);
  if (toolkit.upstream) console.log(`
\u4E0A\u6E38\uFF1A${toolkit.upstream.project} \xB7 ${toolkit.upstream.license} \xB7 ${toolkit.upstream.source}`);
}
try {
  if (command === "list") {
    if (asJson) process.stdout.write(`${JSON.stringify(catalog, null, 2)}
`);
    else {
      console.log(`\u58A8\u9C7C\u5DE5\u574A Agent \u521B\u4F5C\u5DE5\u5177 \xB7 ${catalog.version}`);
      for (const toolkit of catalog.toolkits) console.log(`- ${toolkit.key.padEnd(22)} ${toolkit.name} \xB7 ${toolkit.status} \xB7 ${toolkit.bestFor.join(" / ")}`);
      console.log("\n\u4F7F\u7528 show <key> \u67E5\u770B\u4EFB\u52A1\uFF1B\u8BFE\u4EF6\u4F7F\u7528 init/inspect/doctor/test/preview/build/package\u3002");
    }
  } else if (command === "show" || command === "prompt") {
    const toolkit = findToolkit(keyOrPath);
    if (!toolkit) throw new CoursewareToolkitError("TOOLKIT_UNKNOWN", `\u672A\u77E5\u5DE5\u5177\uFF1A${keyOrPath || "(missing)"}`);
    if (command === "prompt") process.stdout.write(`${toolkit.agentPrompt}
`);
    else printToolkit(toolkit);
  } else if (command === "init") {
    const [template, target] = positionals;
    if (!template || !target) throw new CoursewareToolkitError("COURSEWARE_INIT_USAGE", "\u7528\u6CD5\uFF1Acreator-toolkit init <\u8BFE\u4EF6\u6A21\u677F\u540D> <\u65B0\u76EE\u5F55> [--json]");
    const result2 = await initializeCoursewareProject({ templateRoot: await findTemplate(template), targetRoot: target });
    output(result2, asJson, (value) => console.log(`\u5DF2\u4ECE ${value.template} \u521B\u5EFA ${value.target}
\u4E0B\u4E00\u6B65\uFF1Acreator-toolkit doctor "${value.target}"`));
  } else if (command === "inspect") {
    if (!keyOrPath) throw new CoursewareToolkitError("COURSEWARE_INSPECT_USAGE", "\u7528\u6CD5\uFF1Acreator-toolkit inspect <\u8BFE\u4EF6\u76EE\u5F55> [--json]");
    const result2 = await describeCoursewareProject2(path5.resolve(keyOrPath));
    output(result2, asJson, (value) => console.log(`${value.id} \xB7 ${value.ok ? "READY" : "NEEDS FIX"} \xB7 ${value.counts.scenes} scene \xB7 ${value.counts.checkpoints} checkpoint \xB7 ${value.totalBytes} bytes
Digest: ${value.projectDigest}`));
    if (!result2.ok) process.exitCode = 1;
  } else if (command === "doctor") {
    if (!keyOrPath) throw new CoursewareToolkitError("DOCTOR_USAGE", "\u7528\u6CD5\uFF1Acreator-toolkit doctor <\u672C\u5730\u9879\u76EE\u76EE\u5F55> [--json]");
    const target = path5.resolve(keyOrPath);
    const isCourseware = await fs5.access(path5.join(target, "mooyu-courseware.json")).then(() => true, () => false);
    const report = isCourseware ? await inspectCoursewareProject2(target) : await inspectStaticWebProject(target);
    output(report, asJson, (value) => printDoctor(value, isCourseware ? "Interactive Courseware" : "Local Web Project"));
    if (!report.ok) process.exitCode = 1;
  } else if (command === "test") {
    if (!keyOrPath) throw new CoursewareToolkitError("COURSEWARE_TEST_USAGE", "\u7528\u6CD5\uFF1Acreator-toolkit test <\u8BFE\u4EF6\u76EE\u5F55> [--browser-module <path>] [--json]");
    if (options["browser-module"] === true) throw new CoursewareToolkitError("COURSEWARE_TEST_USAGE", "--browser-module \u540E\u5FC5\u987B\u63D0\u4F9B\u5DF2\u5B89\u88C5\u6A21\u5757\u7684\u7EDD\u5BF9\u8DEF\u5F84\u6216\u5305\u540D\u3002");
    const result2 = await testCoursewareProject2(path5.resolve(keyOrPath), { browserModule: options["browser-module"] });
    output(result2, asJson, (value) => console.log(`Browser journeys: PASS \xB7 ${value.journeys.length} journey \xB7 ${value.journeys.reduce((sum, item2) => sum + item2.steps, 0)} steps`));
  } else if (command === "preview") {
    if (!keyOrPath) throw new CoursewareToolkitError("COURSEWARE_PREVIEW_USAGE", "\u7528\u6CD5\uFF1Acreator-toolkit preview <\u8BFE\u4EF6\u76EE\u5F55> [--port <\u7AEF\u53E3>]");
    if (options.port === true) throw new CoursewareToolkitError("COURSEWARE_PREVIEW_PORT_INVALID", "--port \u540E\u5FC5\u987B\u63D0\u4F9B\u7AEF\u53E3\u53F7\u3002");
    const parsedPort = options.port === void 0 ? 4173 : Number(options.port);
    if (!Number.isInteger(parsedPort) || parsedPort < 0 || parsedPort > 65535) throw new CoursewareToolkitError("COURSEWARE_PREVIEW_PORT_INVALID", "\u9884\u89C8\u7AEF\u53E3\u5FC5\u987B\u662F 0 \u5230 65535 \u7684\u6574\u6570\u3002");
    const preview = await createCoursewarePreviewServer2(path5.resolve(keyOrPath), { port: parsedPort });
    console.log(`MOOYU.FUN courseware preview: ${preview.url}
\u6309 Ctrl+C \u505C\u6B62\u3002`);
    const close = async () => {
      await preview.close();
      process.exit(0);
    };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
  } else if (command === "build") {
    if (!keyOrPath) throw new CoursewareToolkitError("COURSEWARE_BUILD_USAGE", "\u7528\u6CD5\uFF1Acreator-toolkit build <\u8BFE\u4EF6\u76EE\u5F55> [--output <\u7A7A\u76EE\u5F55>] [--json]");
    if (options.output === true) throw new CoursewareToolkitError("COURSEWARE_BUILD_USAGE", "--output \u540E\u5FC5\u987B\u63D0\u4F9B\u7A7A\u76EE\u5F55\u3002");
    const result2 = await buildCoursewareProject2(path5.resolve(keyOrPath), { outputDirectory: typeof options.output === "string" ? path5.resolve(options.output) : void 0 });
    output(result2, asJson, (value) => console.log(`Build ${value.reused ? "reused" : "created"}: ${value.output}
${value.files.length} files \xB7 ${value.totalBytes} bytes \xB7 ${value.projectDigest}`));
  } else if (command === "package") {
    if (!keyOrPath) throw new CoursewareToolkitError("COURSEWARE_PACKAGE_USAGE", "\u7528\u6CD5\uFF1Acreator-toolkit package <\u8BFE\u4EF6\u76EE\u5F55> [--output <zip>] [--json]");
    if (options.output === true) throw new CoursewareToolkitError("COURSEWARE_PACKAGE_USAGE", "--output \u540E\u5FC5\u987B\u63D0\u4F9B ZIP \u8DEF\u5F84\u3002");
    const result2 = await packageCoursewareProject2(path5.resolve(keyOrPath), { outputPath: typeof options.output === "string" ? path5.resolve(options.output) : void 0 });
    output(result2, asJson, (value) => console.log(`Package ${value.reused ? "reused" : "created"}: ${value.path}
${value.artifactBytes} bytes \xB7 SHA-256 ${value.artifactSha256}`));
  } else throw new CoursewareToolkitError("CLI_USAGE", "\u7528\u6CD5\uFF1Acreator-toolkit <list|show|prompt|init|inspect|doctor|test|preview|build|package> [...args]");
} catch (error) {
  const payload = { ok: false, error: { code: error.code ?? "CREATOR_TOOLKIT_FAILED", message: error.message, details: error.details ?? void 0 } };
  if (asJson) process.stderr.write(`${JSON.stringify(payload, null, 2)}
`);
  else console.error(`${payload.error.code}: ${payload.error.message}`);
  process.exitCode = error.code?.endsWith("_USAGE") || error.code === "CLI_USAGE" ? 2 : 1;
}
