// scripts/creator-toolkit-cli.mjs
import fs2 from "node:fs/promises";
import path2 from "node:path";

// packages/creator-tools/src/index.mjs
import fs from "node:fs/promises";
import path from "node:path";

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
  const projectRoot = path.resolve(root);
  const findings = [];
  const files = [];
  let totalBytes = 0;
  const walk = async (directory, prefix = "") => {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
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
        await walk(path.join(directory, entry2.name), relative);
        continue;
      }
      if (!entry2.isFile()) {
        findings.push(item("error", "WEB_FILE_TYPE_INVALID", `${relative} \u4E0D\u662F\u666E\u901A\u6587\u4EF6\u3002`));
        continue;
      }
      const absolute = path.join(directory, entry2.name);
      const stat = await fs.stat(absolute);
      totalBytes += stat.size;
      files.push({ relative, absolute, size: stat.size, extension: path.extname(entry2.name).toLowerCase() });
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
    if (/^(?:\.env(?:\.|$)|credentials?|secrets?)(?:\.|$)/iu.test(path.basename(file.relative))) findings.push(item("error", "WEB_SECRET_FILE", `${file.relative} \u770B\u8D77\u6765\u662F\u51ED\u636E\u6587\u4EF6\u3002`, "\u4ECE\u53D1\u5E03\u76EE\u5F55\u5220\u9664\u51ED\u636E\uFF0C\u5E76\u7ACB\u5373\u8F6E\u6362\u5DF2\u7ECF\u66B4\u9732\u7684\u5BC6\u94A5\u3002"));
    if (!staticTextExtensions.has(file.extension) || file.size > 1024 * 1024) continue;
    let source;
    try {
      source = await fs.readFile(file.absolute, "utf8");
    } catch {
      continue;
    }
    if (staticSecretPatterns.some((pattern) => pattern.test(source))) findings.push(item("error", "WEB_SECRET_REFERENCE", `${file.relative} \u7591\u4F3C\u5305\u542B\u5BC6\u94A5\u6216\u4EE4\u724C\u3002`, "\u4ECE\u6210\u54C1\u4E2D\u79FB\u9664\u51ED\u636E\uFF0C\u5E76\u4F7F\u7528\u5E73\u53F0\u63D0\u4F9B\u7684\u53D7\u9650\u80FD\u529B\u6865\u3002"));
    if (/<(?:script|link)\b[^>]*(?:src|href)\s*=\s*["']https?:\/\//iu.test(source)) findings.push(item("warning", "WEB_REMOTE_RUNTIME", `${file.relative} \u5F15\u7528\u4E86\u8FDC\u7A0B\u811A\u672C\u6216\u6837\u5F0F\u3002`, "\u5C06\u8FD0\u884C\u4F9D\u8D56\u4FDD\u5B58\u5230\u9879\u76EE\u5185\uFF0C\u786E\u4FDD\u79BB\u7EBF\u548C\u9694\u79BB\u73AF\u5883\u53EF\u8FD0\u884C\u3002"));
    if (/\b(?:file:\/\/\/|[A-Z]:\\Users\\|\/home\/[^/]+\/)/u.test(source)) findings.push(item("warning", "WEB_LOCAL_PATH_REFERENCE", `${file.relative} \u53EF\u80FD\u5305\u542B\u672C\u673A\u7EDD\u5BF9\u8DEF\u5F84\u3002`, "\u6539\u7528\u9879\u76EE\u5185\u76F8\u5BF9\u8DEF\u5F84\u3002"));
  }
  if (!findings.some((finding) => finding.severity === "error")) findings.push(item("info", "WEB_PROJECT_READY", `\u672C\u5730\u7F51\u9875\u9879\u76EE\u5305\u542B ${files.length} \u4E2A\u6587\u4EF6\u3001${totalBytes} \u5B57\u8282\uFF0C\u53EF\u4EE5\u7EE7\u7EED\u538B\u7F29\u5E76\u4E0A\u4F20\u5E73\u53F0\u6821\u9A8C\u3002`));
  findings.push(item("warning", "LOCAL_DOCTOR_LIMIT", "\u672C\u5730 Doctor \u53EA\u68C0\u67E5\u53D1\u5E03\u7ED3\u6784\u548C\u660E\u663E\u6CC4\u6F0F\uFF1B\u5E73\u53F0\u4ECD\u4F1A\u91CD\u65B0\u89E3\u5305\u3001\u626B\u63CF\u5E76\u5728\u9694\u79BB\u73AF\u5883\u4E2D\u9A8C\u8BC1\u3002"));
  return result(projectRoot, findings);
}

// scripts/creator-toolkit-cli.mjs
async function loadCatalog() {
  const candidates = [
    new URL("../plugins/gamehub/toolkits/catalog.json", import.meta.url),
    new URL("../toolkits/catalog.json", import.meta.url)
  ];
  for (const candidate of candidates) {
    try {
      return JSON.parse(await fs2.readFile(candidate, "utf8"));
    } catch {
    }
  }
  throw new Error("GameHub creator toolkit catalog is missing. Reinstall or update the GameHub Agent plugin.");
}
var catalog = await loadCatalog();
var [command = "list", keyOrPath, ...flags] = process.argv.slice(2);
var asJson = flags.includes("--json") || process.argv.includes("--json");
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
if (command === "list") {
  if (asJson) process.stdout.write(`${JSON.stringify(catalog, null, 2)}
`);
  else {
    console.log(`GameHub Agent \u521B\u4F5C\u5DE5\u5177 \xB7 ${catalog.version}`);
    for (const toolkit of catalog.toolkits) console.log(`- ${toolkit.key.padEnd(14)} ${toolkit.name} \xB7 ${toolkit.status} \xB7 ${toolkit.bestFor.join(" / ")}`);
    console.log("\n\u4F7F\u7528 show <key> \u67E5\u770B\u4EA4\u7ED9 Agent \u7684\u672C\u5730\u5236\u4F5C\u4EFB\u52A1\u3002");
  }
} else if (command === "show" || command === "prompt") {
  const toolkit = findToolkit(keyOrPath);
  if (!toolkit) {
    console.error(`\u672A\u77E5\u5DE5\u5177\uFF1A${keyOrPath || "(missing)"}`);
    console.error(`\u53EF\u7528\u5DE5\u5177\uFF1A${catalog.toolkits.map((item2) => item2.key).join(", ")}`);
    process.exitCode = 2;
  } else if (command === "prompt") process.stdout.write(`${toolkit.agentPrompt}
`);
  else printToolkit(toolkit);
} else if (command === "doctor") {
  if (!keyOrPath) {
    console.error("\u7528\u6CD5\uFF1Acreator-toolkit doctor <\u672C\u5730\u7F51\u9875\u9879\u76EE\u76EE\u5F55> [--json]");
    process.exitCode = 2;
  } else {
    const report = await inspectStaticWebProject(path2.resolve(keyOrPath));
    if (asJson) process.stdout.write(`${JSON.stringify(report, null, 2)}
`);
    else {
      console.log(`Local Web Project: ${report.ok ? "PASS" : "FAIL"} \xB7 ${report.summary.errors} error \xB7 ${report.summary.warnings} warning \xB7 ${report.summary.info} info`);
      for (const finding of report.findings) console.log(`[${finding.severity.toUpperCase()}] ${finding.code}: ${finding.message}${finding.fix ? `
  \u4FEE\u590D\uFF1A${finding.fix}` : ""}`);
    }
    if (!report.ok) process.exitCode = 1;
  }
} else {
  console.error("\u7528\u6CD5\uFF1Acreator-toolkit <list|show|prompt|doctor> [key|directory] [--json]");
  process.exitCode = 2;
}
