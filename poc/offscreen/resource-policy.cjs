'use strict';
const path = require('node:path');
const { fileURLToPath } = require('node:url');

function createResourcePolicy(files) {
  const normalize = file => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
  const allowed = new Set(files.map(normalize));
  return details => {
    try {
      const url = new URL(details.url);
      return details.method === 'GET' && url.protocol === 'file:' && !url.host &&
        !['subFrame', 'object', 'webSocket'].includes(details.resourceType) && allowed.has(normalize(fileURLToPath(url)));
    } catch { return false; }
  };
}
module.exports = { createResourcePolicy };
