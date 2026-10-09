var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// extensions/vscode/src/file-export.mjs
var file_export_exports = {};
__export(file_export_exports, {
  exportNativeFile: () => exportNativeFile
});
module.exports = __toCommonJS(file_export_exports);
var import_node_path = __toESM(require("node:path"), 1);
var import_node_os = __toESM(require("node:os"), 1);

// packages/web-game-sdk/src/sharing-protocol.mjs
var SHARE_PAYLOAD_BYTES = 16 * 1024;
var FILE_EXPORT_BYTES = 2 * 1024 * 1024;
function capabilityError(code, message, retryable = false) {
  return Object.assign(new Error(message), { code, retryable });
}
function validateJson(value, { maxBytes = SHARE_PAYLOAD_BYTES, maxNodes = 2e3 } = {}) {
  let nodes = 0;
  const walk = (item, depth) => {
    if (++nodes > maxNodes || depth > 12) throw capabilityError("SHARE_PAYLOAD_INVALID", "JSON \u7ED3\u6784\u8FC7\u6DF1\u6216\u8FC7\u5927\u3002");
    if (item === null || typeof item === "boolean") return;
    if (typeof item === "string" && item.length <= maxBytes) return;
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (Array.isArray(item)) {
      for (const child of item) walk(child, depth + 1);
      return;
    }
    if (item && typeof item === "object" && Object.getPrototypeOf(item) === Object.prototype) {
      for (const [key, child] of Object.entries(item)) {
        if (key.length > 128 || ["__proto__", "prototype", "constructor"].includes(key)) throw capabilityError("SHARE_PAYLOAD_INVALID", "JSON \u5B57\u6BB5\u65E0\u6548\u3002");
        walk(child, depth + 1);
      }
      return;
    }
    throw capabilityError("SHARE_PAYLOAD_INVALID", "\u53EA\u5141\u8BB8\u6709\u9650\u7684 JSON \u6570\u636E\u3002");
  };
  walk(value, 0);
  const text = JSON.stringify(value);
  if (new TextEncoder().encode(text).length > maxBytes) throw capabilityError("SHARE_PAYLOAD_INVALID", "JSON \u6570\u636E\u8D85\u51FA\u5927\u5C0F\u9650\u5236\u3002");
  return text;
}
function validateFileExport(input) {
  const fail = () => {
    throw capabilityError("FILE_EXPORT_INVALID", "\u4EC5\u652F\u6301\u5B89\u5168\u6587\u4EF6\u540D\u7684 PNG\uFF082 MiB \u5185\uFF09\u6216 JSON\uFF08256 KiB \u5185\uFF09\u3002");
  };
  if (!input || Object.keys(input).some((key) => !["filename", "mimeType", "data"].includes(key))) fail();
  const { filename, mimeType, data } = input;
  if (typeof filename !== "string" || filename.length > 120 || !/^[\p{L}\p{N}_()-][\p{L}\p{N} ._()-]*\.(png|json)$/u.test(filename) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:[ .]|$)/iu.test(filename) || filename.includes("..")) fail();
  if (!(data instanceof ArrayBuffer) || !data.byteLength || data.byteLength > FILE_EXPORT_BYTES) fail();
  const bytes = new Uint8Array(data);
  if (mimeType === "application/json" && filename.endsWith(".json")) {
    if (bytes.length > 256 * 1024) fail();
    try {
      validateJson(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), { maxBytes: 256 * 1024, maxNodes: 2e4 });
    } catch {
      fail();
    }
  } else if (mimeType === "image/png" && filename.endsWith(".png")) {
    if (bytes.length < 57 || [137, 80, 78, 71, 13, 10, 26, 10].some((b, i) => bytes[i] !== b)) fail();
    const view = new DataView(data);
    let offset = 8, image = false, end = false, chunks = 0;
    while (offset < bytes.length) {
      if (++chunks > 4096 || offset + 12 > bytes.length) fail();
      const size = view.getUint32(offset), type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      if (size > bytes.length - offset - 12 || !/^[A-Za-z]{4}$/u.test(type) || type === "acTL") fail();
      if (offset === 8) {
        if (type !== "IHDR" || size !== 13) fail();
        const w = view.getUint32(offset + 8), h = view.getUint32(offset + 12);
        if (!w || !h || w > 4096 || h > 4096 || w * h > 16777216) fail();
      } else if (type === "IHDR") fail();
      let crc = 4294967295;
      for (let i = offset + 4; i < offset + 8 + size; i++) {
        crc ^= bytes[i];
        for (let b = 0; b < 8; b++) crc = crc >>> 1 ^ (crc & 1 ? 3988292384 : 0);
      }
      if ((crc ^ 4294967295) >>> 0 !== view.getUint32(offset + 8 + size)) fail();
      if (type === "IDAT") image = true;
      offset += size + 12;
      if (type === "IEND") {
        if (size || offset !== bytes.length || !image) fail();
        end = true;
      }
    }
    if (!end) fail();
  } else fail();
  return { filename, mimeType, data };
}

// extensions/vscode/src/file-export.mjs
async function exportNativeFile(input, { vscode, apiOrigin, signal, remote = false, fetchImpl = globalThis.fetch }) {
  if (remote) throw capabilityError("FILE_EXPORT_UNSUPPORTED", "\u8FDC\u7A0B\u7F16\u8F91\u5668\u6682\u4E0D\u652F\u6301\u672C\u673A\u5BFC\u51FA\uFF0C\u8BF7\u4F7F\u7528\u7F51\u9875\u7248\u3002");
  const uuid = /^[0-9a-f-]{36}$/iu;
  if (!input || !uuid.test(input.workId) || !uuid.test(input.releaseId) || typeof input.dataBase64 !== "string" || input.dataBase64.length > Math.ceil(FILE_EXPORT_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(input.dataBase64)) throw capabilityError("FILE_EXPORT_INVALID", "\u5BFC\u51FA\u6570\u636E\u65E0\u6548\u3002");
  const bytes = Buffer.from(input.dataBase64, "base64");
  if (bytes.toString("base64") !== input.dataBase64) throw capabilityError("FILE_EXPORT_INVALID", "\u5BFC\u51FA\u7F16\u7801\u65E0\u6548\u3002");
  const file = validateFileExport({ filename: input.filename, mimeType: input.mimeType, data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  const check = () => {
    if (signal?.aborted) throw capabilityError("FILE_EXPORT_CANCELLED", "\u6E38\u620F\u5DF2\u7ED3\u675F\u6216\u5BFC\u51FA\u5DF2\u53D6\u6D88\u3002");
  };
  const verify = async () => {
    check();
    const response = await fetchImpl(new URL("/v1/works/" + encodeURIComponent(input.workId) + "/launch?releaseId=" + encodeURIComponent(input.releaseId), apiOrigin), { signal, redirect: "error", headers: { accept: "application/json", "cache-control": "no-cache" } });
    if (!response.ok) throw capabilityError("BRIDGE_CAPABILITY_NOT_GRANTED", "\u6B64\u7248\u672C\u5DF2\u4E0D\u53EF\u7528\u3002");
    const { data } = await response.json();
    if (data?.workId !== input.workId || data?.releaseId !== input.releaseId || data?.capabilities?.fileExport !== true) throw capabilityError("BRIDGE_CAPABILITY_NOT_GRANTED", "\u6B64\u7248\u672C\u4E0D\u5141\u8BB8\u5BFC\u51FA\u3002");
    check();
  };
  await verify();
  const uri = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(import_node_path.default.join(import_node_os.default.homedir(), file.filename)), saveLabel: "\u4FDD\u5B58\u6E38\u620F\u6587\u4EF6", filters: file.mimeType === "image/png" ? { "PNG \u56FE\u7247": ["png"] } : { "JSON \u6570\u636E": ["json"] } });
  if (!uri) throw capabilityError("FILE_EXPORT_CANCELLED", "\u4FDD\u5B58\u5DF2\u53D6\u6D88\u3002");
  if (uri.scheme !== "file") throw capabilityError("FILE_EXPORT_UNSUPPORTED", "\u8BF7\u9009\u62E9\u672C\u673A\u6587\u4EF6\u8DEF\u5F84\u3002");
  validateFileExport({ ...file, filename: import_node_path.default.basename(uri.fsPath) });
  await verify();
  check();
  try {
    await vscode.workspace.fs.writeFile(uri, new Uint8Array(file.data));
  } catch {
    throw capabilityError("FILE_EXPORT_FAILED", "\u6587\u4EF6\u5199\u5165\u5931\u8D25\uFF0C\u8BF7\u91CD\u65B0\u5C1D\u8BD5\u3002", true);
  }
  return { status: "saved", filename: import_node_path.default.basename(uri.fsPath) };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  exportNativeFile
});
