const ERROR_MESSAGES = Object.freeze({
  ENTRY_MISSING: 'ZIP 中没有可用的网页入口。若只有一个 HTML 文件，平台会自动识别；若包含多个 HTML，请把主入口命名为 index.html 并放在 ZIP 根目录。',
});

export function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export function uploadErrorMessage(code) {
  if (!code) return '处理未完成，请检查文件后重试。';
  return ERROR_MESSAGES[code] ?? `处理未完成：${code}`;
}
