// packages/creator-tools/src/index.mjs
import fs3 from "node:fs/promises";
import path3 from "node:path";

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
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
var COURSEWARE_FORMAT = "mooyu.courseware";
var COURSEWARE_SCHEMA_VERSION = 1;
var COURSEWARE_DOCTOR_REPORT_VERSION = 1;
var COURSEWARE_VALIDATOR_VERSION = "0.1.0";
var idPattern = /^[a-z][a-z0-9._-]{0,63}$/u;
var localePattern = /^[a-z]{2,3}(?:-[A-Z][A-Za-z0-9]{1,7})?$/u;
var audienceStages = /* @__PURE__ */ new Set(["primary", "lower-secondary", "upper-secondary", "higher-education", "professional", "lifelong"]);
var runtimeCapabilities = /* @__PURE__ */ new Set(["fullscreen", "pointerLock", "localSave", "fileExport", "shareLinks", "learningProgress", "learningEvents", "assessmentResult"]);
var sceneTypes = /* @__PURE__ */ new Set(["explain", "explore", "simulate", "practice", "assess", "reflect"]);
var checkpointKinds = /* @__PURE__ */ new Set(["observation", "prediction", "multiple-choice", "numeric", "ordering", "free-response"]);
var sourceTypes = /* @__PURE__ */ new Set(["book", "paper", "standard", "documentation", "dataset", "web"]);
var verificationKinds = /* @__PURE__ */ new Set(["primary-source", "cross-checked", "reviewed", "author-asserted"]);
var journeyActions = /* @__PURE__ */ new Set(["enter", "set", "click", "answer", "assert", "complete"]);
var ignoredDirectories = /* @__PURE__ */ new Set([".git", ".gamehub", ".mooyu", "node_modules"]);
var finding = (severity, code, message, details = {}) => ({ severity, code, message, ...details });
var isObject = (value) => Boolean(value) && !Array.isArray(value) && typeof value === "object";
var isTextMap = (value) => isObject(value) && Object.keys(value).length > 0 && Object.entries(value).every(([locale, text]) => localePattern.test(locale) && typeof text === "string" && text.trim().length > 0);
var safeRelativePath = (value) => typeof value === "string" && value.length > 0 && value.length <= 255 && !path.isAbsolute(value) && !value.includes("\\") && value.split("/").every((part) => part && part !== "." && part !== "..");
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
  if (!idPattern.test(value ?? "")) findings.push(finding("error", "COURSEWARE_ID_INVALID", `${file}${pointer} \u5FC5\u987B\u662F\u7A33\u5B9A\u7684\u5C0F\u5199\u6807\u8BC6\u7B26\u3002`, { path: file, pointer }));
}
function requireIdList(value, findings, file, pointer, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || !allowEmpty && value.length === 0 || value.some((id) => !idPattern.test(id)) || new Set(value).size !== value.length) {
    findings.push(finding("error", "COURSEWARE_ID_LIST_INVALID", `${file}${pointer} \u5FC5\u987B\u662F${allowEmpty ? "" : "\u975E\u7A7A"}\u3001\u65E0\u91CD\u590D\u7684\u7A33\u5B9A\u6807\u8BC6\u7B26\u6570\u7EC4\u3002`, { path: file, pointer }));
    return [];
  }
  return value;
}
function requireTextMap(value, findings, file, pointer) {
  if (!isTextMap(value)) findings.push(finding("error", "COURSEWARE_LOCALIZED_TEXT_INVALID", `${file}${pointer} \u5FC5\u987B\u662F\u975E\u7A7A\u7684\u8BED\u8A00\u5230\u6587\u5B57\u6620\u5C04\u3002`, { path: file, pointer }));
}
async function readJson(projectRoot, relative, findings, code = "COURSEWARE_JSON_INVALID") {
  if (!safeRelativePath(relative)) {
    findings.push(finding("error", "COURSEWARE_PATH_INVALID", `\u8BFE\u7A0B\u5305\u8DEF\u5F84 ${String(relative)} \u4E0D\u5B89\u5168\u3002`, { path: "mooyu-courseware.json", pointer: "/" }));
    return null;
  }
  try {
    const absolute = path.join(projectRoot, ...relative.split("/"));
    const stat = await fs.lstat(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("\u4E0D\u662F\u666E\u901A\u6587\u4EF6");
    return JSON.parse(await fs.readFile(absolute, "utf8"));
  } catch (error) {
    findings.push(finding("error", code, `${relative} \u65E0\u6CD5\u8BFB\u53D6\u4E3A\u666E\u901A JSON \u6587\u4EF6\uFF1A${error.message}`, { path: relative, pointer: "/" }));
    return null;
  }
}
async function projectDigest(projectRoot) {
  const hash = crypto.createHash("sha256");
  const walk = async (directory, prefix = "") => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "en"))) {
      if (entry.isSymbolicLink()) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) await walk(path.join(directory, entry.name), relative);
      } else if (entry.isFile()) {
        hash.update(relative.replaceAll("\\", "/"));
        hash.update("\0");
        hash.update(await fs.readFile(path.join(directory, entry.name)));
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
  const fixed = ["mooyu-courseware.json", manifest?.course, manifest?.evidence, manifest?.tests];
  if (fixed.some((relative) => !safeRelativePath(relative))) return projectDigest(projectRoot);
  const records = [];
  const add = async (relative) => records.push({ relative, bytes: await fs.readFile(path.join(projectRoot, ...relative.split("/"))) });
  try {
    for (const relative of fixed) await add(relative);
    const walk = async (directory, prefix = "dist") => {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const relative = `${prefix}/${entry.name}`;
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) await walk(path.join(directory, entry.name), relative);
        else if (entry.isFile()) await add(relative);
      }
    };
    await walk(path.join(projectRoot, "dist"));
    const hash = crypto.createHash("sha256");
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
  const allowed = ["format", "schemaVersion", "id", "title", "summary", "defaultLocale", "locales", "subjects", "audience", "course", "evidence", "tests", "build", "runtime", "licenses"];
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
  for (const key of ["course", "evidence", "tests"]) if (!safeRelativePath(manifest[key])) findings.push(finding("error", "COURSEWARE_PATH_INVALID", `${key} \u5FC5\u987B\u662F\u5305\u5185\u5B89\u5168\u76F8\u5BF9\u8DEF\u5F84\u3002`, { path: file, pointer: `/${key}` }));
  if (!isObject(manifest.build) || manifest.build.profile !== "mooyu-static-v1" || manifest.build.entry !== "dist/index.html") findings.push(finding("error", "COURSEWARE_BUILD_PROFILE_INVALID", "build \u5FC5\u987B\u4F7F\u7528 mooyu-static-v1 \u548C dist/index.html\u3002", { path: file, pointer: "/build" }));
  else rejectUnknown(manifest.build, ["profile", "entry"], findings, file, "/build");
  if (!isObject(manifest.runtime) || manifest.runtime.learningSdk !== 1 || !["static-web", "static-wasm"].includes(manifest.runtime.kind) || !Array.isArray(manifest.runtime.capabilities) || new Set(manifest.runtime.capabilities).size !== manifest.runtime.capabilities.length || manifest.runtime.capabilities.some((capability) => !runtimeCapabilities.has(capability))) findings.push(finding("error", "COURSEWARE_RUNTIME_INVALID", "runtime \u5FC5\u987B\u58F0\u660E\u9759\u6001\u8FD0\u884C\u7C7B\u578B\u3001Learning SDK v1 \u4E0E\u65E0\u91CD\u590D\u7684\u5DF2\u77E5\u80FD\u529B\u6570\u7EC4\u3002", { path: file, pointer: "/runtime" }));
  else rejectUnknown(manifest.runtime, ["kind", "learningSdk", "capabilities"], findings, file, "/runtime");
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
    const ids = values.map((value) => value?.id);
    sets[name] = new Set(ids);
    ids.forEach((id, index) => requireId(id, findings, file, `/${name}/${index}/id`));
    if (sets[name].size !== ids.length) findings.push(finding("error", "COURSEWARE_ID_DUPLICATE", `${name} \u4E2D\u5B58\u5728\u91CD\u590D ID\u3002`, { path: file, pointer: `/${name}` }));
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
    if (!isObject(scene?.component) || !idPattern.test(scene.component.type ?? "") || scene.component.config !== void 0 && !isObject(scene.component.config)) findings.push(finding("error", "COURSEWARE_COMPONENT_INVALID", `\u573A\u666F ${scene?.id ?? index} \u7F3A\u5C11\u7A33\u5B9A\u7EC4\u4EF6\u7C7B\u578B\u6216 config \u4E0D\u662F\u5BF9\u8C61\u3002`, { path: file, pointer: `/scenes/${index}/component` }));
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
    if (!safeRelativePath(asset?.path) || typeof asset?.license !== "string" || !asset.license.trim()) findings.push(finding("error", "COURSEWARE_ASSET_INVALID", `\u7D20\u6750 ${index} \u7F3A\u5C11\u5B89\u5168\u8DEF\u5F84\u6216\u8BB8\u53EF\u8BC1\u3002`, { path: file, pointer: `/assets/${index}` }));
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
  const ids = journeys.journeys.map((journey) => journey?.id);
  if (new Set(ids).size !== ids.length) findings.push(finding("error", "COURSEWARE_ID_DUPLICATE", "\u5B66\u4E60\u8DEF\u5F84\u5B58\u5728\u91CD\u590D ID\u3002", { path: file, pointer: "/journeys" }));
  for (const [index, journey] of journeys.journeys.entries()) {
    rejectUnknown(journey, ["id", "title", "locale", "steps", "expectsCompletion"], findings, file, `/journeys/${index}`);
    requireId(journey?.id, findings, file, `/journeys/${index}/id`);
    if (typeof journey?.title !== "string" || !journey.title.trim() || !localePattern.test(journey?.locale ?? "") || typeof journey?.expectsCompletion !== "boolean") findings.push(finding("error", "COURSEWARE_JOURNEY_INVALID", `\u5B66\u4E60\u8DEF\u5F84 ${journey?.id ?? index} \u7684\u6807\u9898\u3001\u8BED\u8A00\u6216\u5B8C\u6210\u58F0\u660E\u65E0\u6548\u3002`, { path: file, pointer: `/journeys/${index}` }));
    if (!Array.isArray(journey?.steps) || !journey.steps.length) findings.push(finding("error", "COURSEWARE_JOURNEY_STEPS_EMPTY", `\u5B66\u4E60\u8DEF\u5F84 ${journey?.id} \u6CA1\u6709\u6B65\u9AA4\u3002`, { path: file, pointer: `/journeys/${index}/steps` }));
    for (const [stepIndex, step] of (journey?.steps ?? []).entries()) {
      rejectUnknown(step, ["action", "target", "value", "expect"], findings, file, `/journeys/${index}/steps/${stepIndex}`);
      if (!journeyActions.has(step?.action) || !idPattern.test(step?.target ?? "")) findings.push(finding("error", "COURSEWARE_JOURNEY_STEP_INVALID", `\u5B66\u4E60\u8DEF\u5F84 ${journey?.id} \u5305\u542B\u65E0\u6548\u6B65\u9AA4\u3002`, { path: file, pointer: `/journeys/${index}/steps/${stepIndex}` }));
      if (step?.action === "enter" && !courseSets?.sceneIds.has(step.target)) findings.push(finding("error", "COURSEWARE_JOURNEY_SCENE_INVALID", `\u5B66\u4E60\u8DEF\u5F84 ${journey?.id} \u8FDB\u5165\u4E86\u4E0D\u5B58\u5728\u7684\u573A\u666F ${step.target}\u3002`, { path: file, pointer: `/journeys/${index}/steps/${stepIndex}/target` }));
    }
  }
  if (!journeys.journeys.some((journey) => journey.expectsCompletion === true && journey.steps?.some((step) => step.action === "complete"))) findings.push(finding("error", "COURSEWARE_COMPLETION_JOURNEY_MISSING", "\u81F3\u5C11\u9700\u8981\u4E00\u6761\u53EF\u5B8C\u6210\u8BFE\u7A0B\u7684\u9A8C\u6536\u8DEF\u5F84\u3002", { path: file, pointer: "/journeys" }));
}
async function inspectCoursewareProject(root) {
  const projectRoot = path.resolve(root);
  const findings = [];
  const manifest = await readJson(projectRoot, "mooyu-courseware.json", findings, "COURSEWARE_MANIFEST_INVALID");
  if (manifest) validateManifest(manifest, findings);
  const coursePath = safeRelativePath(manifest?.course) ? manifest.course : "courseware/course.json";
  const evidencePath = safeRelativePath(manifest?.evidence) ? manifest.evidence : "evidence/sources.json";
  const testsPath = safeRelativePath(manifest?.tests) ? manifest.tests : "tests/journeys.json";
  const course = manifest ? await readJson(projectRoot, coursePath, findings) : null;
  const courseSets = course ? validateCourse(course, findings, coursePath) : null;
  const evidence = manifest ? await readJson(projectRoot, evidencePath, findings) : null;
  if (evidence) validateEvidence(evidence, findings, evidencePath, course, coursePath);
  const journeys = manifest ? await readJson(projectRoot, testsPath, findings) : null;
  if (journeys) validateJourneys(journeys, findings, testsPath, courseSets);
  const entry = manifest?.build?.entry ?? "dist/index.html";
  if (safeRelativePath(entry)) try {
    const stat = await fs.lstat(path.join(projectRoot, ...entry.split("/")));
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 16) throw new Error("\u4E0D\u662F\u6709\u6548\u666E\u901A\u6587\u4EF6");
  } catch (error) {
    findings.push(finding("error", "COURSEWARE_ENTRY_MISSING", `\u6784\u5EFA\u5165\u53E3 ${entry} \u4E0D\u53EF\u7528\uFF1A${error.message}`, { path: "mooyu-courseware.json", pointer: "/build/entry" }));
  }
  if (!findings.some((value) => value.severity === "error")) findings.push(finding("info", "COURSEWARE_CONTRACT_READY", "\u8BFE\u7A0B\u7ED3\u6784\u3001\u8BC1\u636E\u94FE\u3001\u5B66\u4E60\u8DEF\u5F84\u548C\u6784\u5EFA\u5165\u53E3\u901A\u8FC7 L0 \u5951\u7EA6\u68C0\u67E5\u3002"));
  findings.push(finding("warning", "COURSEWARE_DOCTOR_LIMIT", "L0 Doctor \u9A8C\u8BC1\u7ED3\u6784\u4E0E\u5F15\u7528\u5B8C\u6574\u6027\uFF0C\u4E0D\u66FF\u4EE3\u5B66\u79D1\u4E13\u5BB6\u5BA1\u6821\u3001\u65E0\u969C\u788D\u5BA1\u8BA1\u6216\u6D4F\u89C8\u5668\u65C5\u7A0B\u6267\u884C\u3002"));
  const summary = { errors: findings.filter((value) => value.severity === "error").length, warnings: findings.filter((value) => value.severity === "warning").length, info: findings.filter((value) => value.severity === "info").length };
  return { reportVersion: COURSEWARE_DOCTOR_REPORT_VERSION, validatorVersion: COURSEWARE_VALIDATOR_VERSION, projectDigest: await publishableProjectDigest(projectRoot, manifest), root: projectRoot, ok: summary.errors === 0, summary, findings };
}

// packages/creator-tools/src/courseware-toolkit.mjs
import crypto2 from "node:crypto";
import fs2 from "node:fs/promises";
import http from "node:http";
import path2 from "node:path";
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
var sha256 = (value) => crypto2.createHash("sha256").update(value).digest("hex");
var safeRelativePath2 = (value) => typeof value === "string" && value.length > 0 && value.length <= 255 && !path2.isAbsolute(value) && !value.includes("\\") && value.split("/").every((part) => part && part !== "." && part !== "..");
var readJson2 = async (file) => JSON.parse(await fs2.readFile(file, "utf8"));
async function assertNoSymlinkAncestors(target) {
  const resolved = path2.resolve(target);
  const parsed = path2.parse(resolved);
  let current = parsed.root;
  for (const part of resolved.slice(parsed.root.length).split(path2.sep).filter(Boolean)) {
    current = path2.join(current, part);
    const stat = await fs2.lstat(current).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (stat?.isSymbolicLink()) throw new CoursewareToolkitError("COURSEWARE_OUTPUT_SYMLINK_FORBIDDEN", `\u8F93\u51FA\u8DEF\u5F84\u4E0D\u80FD\u7ECF\u8FC7\u7B26\u53F7\u94FE\u63A5\uFF1A${current}`);
    if (!stat) break;
  }
}
async function fileRecord(root, relative) {
  if (!safeRelativePath2(relative)) throw new CoursewareToolkitError("COURSEWARE_PATH_INVALID", `\u4E0D\u5B89\u5168\u7684\u8BFE\u7A0B\u5305\u8DEF\u5F84\uFF1A${relative}`);
  const absolute = path2.join(root, ...relative.split("/"));
  const stat = await fs2.lstat(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new CoursewareToolkitError("COURSEWARE_FILE_INVALID", `${relative} \u5FC5\u987B\u662F\u666E\u901A\u6587\u4EF6\u3002`);
  const bytes = await fs2.readFile(absolute);
  return { relative, absolute, bytes, size: bytes.length, sha256: sha256(bytes) };
}
async function loadCoursewareInventory(root) {
  const projectRoot = path2.resolve(root);
  const manifest = await readJson2(path2.join(projectRoot, "mooyu-courseware.json"));
  const fixed = ["mooyu-courseware.json", manifest.course, manifest.evidence, manifest.tests];
  const records = [];
  for (const relative of fixed) records.push(await fileRecord(projectRoot, relative));
  const distRoot = path2.join(projectRoot, "dist");
  const walk = async (directory, prefix = "dist") => {
    for (const entry of (await fs2.readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name, "en"))) {
      const relative = `${prefix}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new CoursewareToolkitError("COURSEWARE_SYMLINK_FORBIDDEN", `${relative} \u662F\u7B26\u53F7\u94FE\u63A5\u3002`);
      if (entry.isDirectory()) await walk(path2.join(directory, entry.name), relative);
      else if (entry.isFile()) records.push(await fileRecord(projectRoot, relative));
      else throw new CoursewareToolkitError("COURSEWARE_FILE_INVALID", `${relative} \u4E0D\u662F\u666E\u901A\u6587\u4EF6\u3002`);
      if (records.length > 2e3) throw new CoursewareToolkitError("COURSEWARE_FILE_COUNT_EXCEEDED", "\u8BFE\u7A0B\u5305\u6587\u4EF6\u8D85\u8FC7 2000 \u4E2A\u3002");
    }
  };
  await walk(distRoot);
  const deduplicated = [...new Map(records.map((record) => [record.relative, record])).values()].sort((left, right) => left.relative.localeCompare(right.relative, "en"));
  const totalBytes = deduplicated.reduce((sum, record) => sum + record.size, 0);
  if (totalBytes > 128 * 1024 * 1024) throw new CoursewareToolkitError("COURSEWARE_PROJECT_TOO_LARGE", "\u8BFE\u7A0B\u5305\u8D85\u8FC7 128 MiB\u3002");
  const digest = sha256(Buffer.concat(deduplicated.flatMap((record) => [Buffer.from(record.relative), Buffer.from([0]), record.bytes, Buffer.from([0])])));
  return { root: projectRoot, manifest, files: deduplicated, totalBytes, projectDigest: digest };
}
async function describeCoursewareProject(root, inspect) {
  const report = await inspect(root);
  let inventory = null;
  try {
    inventory = await loadCoursewareInventory(root);
  } catch {
  }
  if (!inventory) return { kind: "interactive-courseware", root: path2.resolve(root), ok: false, report };
  const course = await readJson2(path2.join(inventory.root, ...inventory.manifest.course.split("/")));
  const evidence = await readJson2(path2.join(inventory.root, ...inventory.manifest.evidence.split("/")));
  const journeys = await readJson2(path2.join(inventory.root, ...inventory.manifest.tests.split("/")));
  return {
    kind: "interactive-courseware",
    root: inventory.root,
    ok: report.ok,
    id: inventory.manifest.id,
    title: inventory.manifest.title,
    defaultLocale: inventory.manifest.defaultLocale,
    locales: inventory.manifest.locales,
    subjects: inventory.manifest.subjects,
    counts: { objectives: course.objectives?.length ?? 0, scenes: course.scenes?.length ?? 0, checkpoints: course.checkpoints?.length ?? 0, sources: evidence.sources?.length ?? 0, claims: evidence.claims?.length ?? 0, journeys: journeys.journeys?.length ?? 0, files: inventory.files.length },
    totalBytes: inventory.totalBytes,
    projectDigest: inventory.projectDigest,
    report
  };
}
async function initializeCoursewareProject({ templateRoot, targetRoot }) {
  const source = path2.resolve(templateRoot);
  const target = path2.resolve(targetRoot);
  const sourceStat = await fs2.lstat(source).catch(() => null);
  if (!sourceStat?.isDirectory() || sourceStat.isSymbolicLink()) throw new CoursewareToolkitError("COURSEWARE_TEMPLATE_INVALID", "\u8BFE\u4EF6\u6A21\u677F\u76EE\u5F55\u4E0D\u53EF\u7528\u3002");
  await assertNoSymlinkAncestors(path2.dirname(target));
  const targetStat = await fs2.lstat(target).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (targetStat) throw new CoursewareToolkitError("COURSEWARE_TARGET_EXISTS", "\u76EE\u6807\u76EE\u5F55\u5DF2\u7ECF\u5B58\u5728\uFF1B\u4E3A\u907F\u514D\u8986\u76D6\uFF0C\u672C\u5730\u521D\u59CB\u5316\u5DF2\u505C\u6B62\u3002");
  await fs2.cp(source, target, { recursive: true, errorOnExist: true, force: false });
  const manifest = await readJson2(path2.join(target, "mooyu-courseware.json"));
  return { action: "created", template: path2.basename(source), target, id: manifest.id };
}
async function ensureOutputDirectory(directory) {
  await assertNoSymlinkAncestors(directory);
  const stat = await fs2.lstat(directory).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (!stat) {
    await fs2.mkdir(directory, { recursive: true });
    return;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new CoursewareToolkitError("COURSEWARE_OUTPUT_INVALID", "\u8F93\u51FA\u4F4D\u7F6E\u5FC5\u987B\u662F\u666E\u901A\u76EE\u5F55\u3002");
  if ((await fs2.readdir(directory)).length) throw new CoursewareToolkitError("COURSEWARE_OUTPUT_NOT_EMPTY", "\u81EA\u5B9A\u4E49\u8F93\u51FA\u76EE\u5F55\u5FC5\u987B\u4E3A\u7A7A\uFF0C\u907F\u514D\u8986\u76D6\u73B0\u6709\u6587\u4EF6\u3002");
}
async function buildCoursewareProject(root, { inspect, outputDirectory } = {}) {
  const report = await inspect(root);
  if (!report.ok) throw new CoursewareToolkitError("COURSEWARE_DOCTOR_FAILED", "Doctor \u672A\u901A\u8FC7\uFF0C\u4E0D\u80FD\u6784\u5EFA\u8BFE\u4EF6\u3002", report);
  const inventory = await loadCoursewareInventory(root);
  const defaultOutput = path2.join(inventory.root, managedDirectory, "build", inventory.projectDigest);
  const output = path2.resolve(outputDirectory ?? defaultOutput);
  const existingReport = await readJson2(path2.join(output, "build-report.json")).catch(() => null);
  if (!outputDirectory && existingReport?.projectDigest === inventory.projectDigest) return { ...existingReport, output, reused: true };
  await ensureOutputDirectory(output);
  for (const file of inventory.files) {
    const destination = path2.join(output, ...file.relative.split("/"));
    await fs2.mkdir(path2.dirname(destination), { recursive: true });
    await fs2.copyFile(file.absolute, destination);
  }
  const buildReport = {
    format: "mooyu.courseware-build",
    version: 1,
    coursewareId: inventory.manifest.id,
    projectDigest: inventory.projectDigest,
    files: inventory.files.map(({ relative, size, sha256: hash }) => ({ path: relative, bytes: size, sha256: hash })),
    totalBytes: inventory.totalBytes
  };
  await fs2.writeFile(path2.join(output, "build-report.json"), `${JSON.stringify(buildReport, null, 2)}
`, { flag: "wx" });
  return { ...buildReport, output, reused: false };
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
  const artifactSha256 = sha256(bytes);
  const destination = path2.resolve(outputPath ?? path2.join(inventory.root, managedDirectory, "packages", `${inventory.manifest.id}-${inventory.projectDigest.slice(0, 12)}.zip`));
  if (path2.extname(destination).toLowerCase() !== ".zip") throw new CoursewareToolkitError("COURSEWARE_PACKAGE_EXTENSION_INVALID", "\u8BFE\u4EF6\u5305\u8F93\u51FA\u5FC5\u987B\u4F7F\u7528 .zip \u6269\u5C55\u540D\u3002");
  await assertNoSymlinkAncestors(destination);
  const destinationStat = await fs2.lstat(destination).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (destinationStat?.isSymbolicLink() || destinationStat && !destinationStat.isFile()) throw new CoursewareToolkitError("COURSEWARE_PACKAGE_PATH_INVALID", "\u8BFE\u4EF6\u5305\u8F93\u51FA\u5FC5\u987B\u662F\u666E\u901A ZIP \u6587\u4EF6\uFF0C\u4E0D\u80FD\u662F\u7B26\u53F7\u94FE\u63A5\u3002");
  const current = destinationStat ? await fs2.readFile(destination) : null;
  if (current) {
    if (sha256(current) !== artifactSha256) throw new CoursewareToolkitError("COURSEWARE_PACKAGE_EXISTS", "\u76EE\u6807\u5305\u5DF2\u5B58\u5728\u4E14\u5185\u5BB9\u4E0D\u540C\uFF1B\u4E0D\u4F1A\u8986\u76D6\u3002");
    return { format: "mooyu.courseware-package", version: 1, coursewareId: inventory.manifest.id, projectDigest: inventory.projectDigest, artifactSha256, artifactBytes: bytes.length, path: destination, reused: true };
  }
  await fs2.mkdir(path2.dirname(destination), { recursive: true });
  await fs2.writeFile(destination, bytes, { flag: "wx" });
  return { format: "mooyu.courseware-package", version: 1, coursewareId: inventory.manifest.id, projectDigest: inventory.projectDigest, artifactSha256, artifactBytes: bytes.length, path: destination, reused: false };
}
function createCoursewarePreviewHandler(root) {
  const distRoot = path2.join(path2.resolve(root), "dist");
  return async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://localhost");
      let relative = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, "");
      if (!relative || relative.endsWith("/")) relative += "index.html";
      if (!safeRelativePath2(relative)) {
        response.writeHead(400);
        response.end("Bad request");
        return;
      }
      let absolute = path2.resolve(distRoot, ...relative.split("/"));
      if (absolute !== distRoot && !absolute.startsWith(`${distRoot}${path2.sep}`)) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
      }
      let stat = await fs2.lstat(absolute).catch(() => null);
      if ((!stat || !stat.isFile()) && !path2.extname(relative)) {
        absolute = path2.join(distRoot, "index.html");
        stat = await fs2.lstat(absolute).catch(() => null);
      }
      if (!stat?.isFile() || stat.isSymbolicLink()) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      const content = await fs2.readFile(absolute);
      response.writeHead(200, {
        "Content-Type": mimeTypes.get(path2.extname(absolute).toLowerCase()) ?? "application/octet-stream",
        "Content-Length": content.length,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data: blob:; font-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'"
      });
      response.end(content);
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
  const course = await readJson2(path2.join(inventory.root, ...inventory.manifest.course.split("/")));
  const tests = await readJson2(path2.join(inventory.root, ...inventory.manifest.tests.split("/")));
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
  const projectRoot = path3.resolve(root);
  const findings = [];
  const files = [];
  let totalBytes = 0;
  const walk = async (directory, prefix = "") => {
    let entries;
    try {
      entries = await fs3.readdir(directory, { withFileTypes: true });
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
        await walk(path3.join(directory, entry2.name), relative);
        continue;
      }
      if (!entry2.isFile()) {
        findings.push(item("error", "WEB_FILE_TYPE_INVALID", `${relative} \u4E0D\u662F\u666E\u901A\u6587\u4EF6\u3002`));
        continue;
      }
      const absolute = path3.join(directory, entry2.name);
      const stat = await fs3.stat(absolute);
      totalBytes += stat.size;
      files.push({ relative, absolute, size: stat.size, extension: path3.extname(entry2.name).toLowerCase() });
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
    if (/^(?:\.env(?:\.|$)|credentials?|secrets?)(?:\.|$)/iu.test(path3.basename(file.relative))) findings.push(item("error", "WEB_SECRET_FILE", `${file.relative} \u770B\u8D77\u6765\u662F\u51ED\u636E\u6587\u4EF6\u3002`, "\u4ECE\u53D1\u5E03\u76EE\u5F55\u5220\u9664\u51ED\u636E\uFF0C\u5E76\u7ACB\u5373\u8F6E\u6362\u5DF2\u7ECF\u66B4\u9732\u7684\u5BC6\u94A5\u3002"));
    if (!staticTextExtensions.has(file.extension) || file.size > 1024 * 1024) continue;
    let source;
    try {
      source = await fs3.readFile(file.absolute, "utf8");
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
  const runtime = await inspectStaticWebProject(path3.join(path3.resolve(root), "dist"));
  const findings = [...contract.findings, ...runtime.findings.map((value) => ({ ...value, path: value.path ? `dist/${value.path}` : "dist" }))];
  const summary = { errors: findings.filter((value) => value.severity === "error").length, warnings: findings.filter((value) => value.severity === "warning").length, info: findings.filter((value) => value.severity === "info").length };
  return { ...contract, ok: summary.errors === 0, summary, findings };
}
var describeCoursewareProject2 = (root) => describeCoursewareProject(root, inspectCoursewareProject2);
var buildCoursewareProject2 = (root, options = {}) => buildCoursewareProject(root, { ...options, inspect: inspectCoursewareProject2 });
var packageCoursewareProject2 = (root, options = {}) => packageCoursewareProject(root, { ...options, inspect: inspectCoursewareProject2 });
var createCoursewarePreviewServer2 = (root, options = {}) => createCoursewarePreviewServer(root, { ...options, inspect: inspectCoursewareProject2 });
var testCoursewareProject2 = (root, options = {}) => testCoursewareProject(root, { ...options, inspect: inspectCoursewareProject2 });
export {
  CoursewareToolkitError,
  buildCoursewareProject2 as buildCoursewareProject,
  createCoursewarePreviewServer2 as createCoursewarePreviewServer,
  describeCoursewareProject2 as describeCoursewareProject,
  initializeCoursewareProject,
  inspectCoursewareProject2 as inspectCoursewareProject,
  packageCoursewareProject2 as packageCoursewareProject,
  testCoursewareProject2 as testCoursewareProject
};
