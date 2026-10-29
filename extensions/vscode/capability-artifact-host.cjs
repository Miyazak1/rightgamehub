const { createHash } = require('node:crypto');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const ARTIFACT_NAME = /^[a-z][a-z0-9.-]{2,119}$/;
const OPEN_MODES = new Set(['host-preview', 'external-app', 'download']);
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 1024 * 1024;
const DIRECTIVE_KEYS = ['schemaVersion', 'artifactId', 'runId', 'name', 'mediaType',
  'sizeBytes', 'sha256', 'openMode', 'locator', 'expiresAt'];
const ARTIFACT_KEYS = ['schemaVersion', 'artifactId', 'runId', 'name', 'mediaType',
  'sizeBytes', 'sha256', 'content'];

const fail = (message, code) => {
  throw Object.assign(new Error(message), { code });
};
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, keys) => plainObject(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));

const stableArtifactJson = value => {
  const active = new Set();
  const visit = item => {
    if (item === null) return 'null';
    if (typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item);
    if (!item || typeof item !== 'object' || active.has(item)) {
      fail('产物正文格式无效。', 'CAPABILITY_HOST_ARTIFACT_CONTENT_INVALID');
    }
    active.add(item);
    try {
      if (Array.isArray(item)) {
        if (Object.keys(item).some(key => !/^\d+$/.test(key) || String(Number(key)) !== key
          || Number(key) >= item.length)) {
          fail('产物正文格式无效。', 'CAPABILITY_HOST_ARTIFACT_CONTENT_INVALID');
        }
        return `[${item.map((entry, index) => {
          if (!Object.hasOwn(item, index)) {
            fail('产物正文格式无效。', 'CAPABILITY_HOST_ARTIFACT_CONTENT_INVALID');
          }
          return visit(entry);
        }).join(',')}]`;
      }
      if (![Object.prototype, null].includes(Object.getPrototypeOf(item))) {
        fail('产物正文格式无效。', 'CAPABILITY_HOST_ARTIFACT_CONTENT_INVALID');
      }
      return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${visit(item[key])}`).join(',')}}`;
    } finally {
      active.delete(item);
    }
  };
  return visit(value);
};

const verifyCapabilityArtifactPayload = (value, now = Date.now()) => {
  const directive = value?.directive;
  const artifact = value?.artifact;
  const expiresAt = Date.parse(directive?.expiresAt);
  if (!exact(directive, DIRECTIVE_KEYS) || !exact(artifact, ARTIFACT_KEYS)
    || directive.schemaVersion !== 'capability-artifact-open-v1'
    || artifact.schemaVersion !== 'capability-artifact-content-v1'
    || !UUID.test(String(directive.artifactId)) || !UUID.test(String(directive.runId))
    || !ARTIFACT_NAME.test(String(directive.name))
    || directive.artifactId !== artifact.artifactId || directive.runId !== artifact.runId
    || directive.name !== artifact.name || directive.mediaType !== 'application/json'
    || artifact.mediaType !== 'application/json' || directive.sizeBytes !== artifact.sizeBytes
    || !Number.isSafeInteger(directive.sizeBytes) || directive.sizeBytes < 1
    || directive.sizeBytes > MAX_ARTIFACT_BYTES
    || directive.sha256 !== artifact.sha256 || !SHA256.test(String(directive.sha256))
    || !OPEN_MODES.has(directive.openMode)
    || directive.locator !== `mooyu-artifact://${directive.openMode}/${directive.artifactId}`
    || !Number.isFinite(expiresAt) || expiresAt <= now
    || expiresAt > now + 5 * 60 * 1000 + 5000
    || !plainObject(artifact.content)
    || createHash('sha256').update(stableArtifactJson(artifact.content)).digest('hex') !== directive.sha256) {
    fail('产物摘要、权限或有效期校验失败。', 'CAPABILITY_HOST_ARTIFACT_INTEGRITY');
  }
  return { directive, artifact };
};

const createCapabilityArtifactHost = ({ vscode, now = Date.now,
  maxPreviewBytes = MAX_PREVIEW_BYTES } = {}) => {
  if (!vscode?.window || !vscode?.workspace?.fs || !vscode?.Uri
    || typeof now !== 'function' || !Number.isSafeInteger(maxPreviewBytes)
    || maxPreviewBytes < 1024 || maxPreviewBytes > MAX_PREVIEW_BYTES) {
    fail('可信产物宿主没有正确初始化。', 'CAPABILITY_HOST_ARTIFACT_HOST_INVALID');
  }
  return Object.freeze({
    async open(value) {
      const { directive, artifact } = verifyCapabilityArtifactPayload(value, now());
      const content = `${JSON.stringify(artifact.content, null, 2)}\n`;
      if (Buffer.byteLength(content) > maxPreviewBytes) {
        fail('产物预览超过本机限制。', 'CAPABILITY_HOST_ARTIFACT_TOO_LARGE');
      }
      if (directive.openMode === 'download') {
        const target = await vscode.window.showSaveDialog({
          title: '保存墨鱼工坊任务产物', saveLabel: '保存已校验产物',
          defaultUri: vscode.Uri.file(`${directive.name}.json`),
          filters: { JSON: ['json'] },
        });
        if (!target) return { opened: false, cancelled: true };
        await vscode.workspace.fs.writeFile(target, Buffer.from(content, 'utf8'));
        return { opened: true, cancelled: false };
      }
      const document = await vscode.workspace.openTextDocument({ language: 'json', content });
      await vscode.window.showTextDocument(document, { preview: true, preserveFocus: false });
      return { opened: true, cancelled: false };
    },
  });
};

module.exports = { createCapabilityArtifactHost, stableArtifactJson,
  verifyCapabilityArtifactPayload };
