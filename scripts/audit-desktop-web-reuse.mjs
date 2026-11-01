#!/usr/bin/env node
// Static source inventory only: no server, credentials, database or model access.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const target = path.join(root, 'docs/mooyu-desktop-web-inventory.json');
const clientRoot = 'packages/platform-client/src/';
const read = relative => fs.readFile(path.join(root, relative), 'utf8');
const hash = text => createHash('sha256').update(text.replace(/\r\n?/gu, '\n')).digest('hex');
const unique = items => [...new Set(items)].sort();
const app = await read(clientRoot + 'App.jsx');
const lines = app.split(/\r?\n/u);
const routeBranches = [];
for (let index = 0; index < lines.length; index++) {
  const line = lines[index], offset = line.indexOf('content =');
  if (offset < 0 || !/^\s*(?:if|else if)\s*\(/u.test(line)) continue;
  const condition = line.slice(0, offset).trim();
  const community = condition.includes("parts[0] === 'community'") || condition.includes("route === '/community")
    || condition.includes("route === '/social'") || condition.includes("route === '/contribute'");
  routeBranches.push({ source: clientRoot + 'App.jsx', line: index + 1, condition,
    components: unique([...line.slice(offset).matchAll(/<([A-Z][A-Za-z0-9]+)/gu)].map(m => m[1])),
    sourceStatus: community ? 'paused-by-community-flag' : line.includes('<RetiredStudioPage') ? 'retired-notice'
      : line.includes('<LegacyChangeRadarRedirect') ? 'legacy-redirect'
        : condition.includes("'/saves'") ? 'local-save-notice' : 'implemented-route',
  });
}
const names = (await fs.readdir(path.join(root, clientRoot))).filter(n => /\.(?:jsx|mjs|css)$/u.test(n)).sort();
const modules = await Promise.all(names.map(async name => {
  const source = clientRoot + name, text = await read(source);
  const apiCalls = unique([...text.matchAll(/\bapi(?:Client)?\.([A-Za-z][A-Za-z0-9_]*)\s*\(/gu)].map(m => m[1]));
  const browserDependencies = ['indexedDB', 'localStorage', 'sessionStorage', 'Worker', 'WebSocket', 'FormData', 'XMLHttpRequest',
    'createObjectURL', 'showSaveFilePicker', 'navigator.share', 'clipboard', 'requestFullscreen', 'postMessage']
    .filter(value => text.includes(value));
  return { source, sha256: hash(text), apiCalls, browserDependencies };
}));
const dependencies = ['apps/web/package.json', 'apps/web/src/main.jsx', 'apps/web/vite.config.mjs',
  'packages/platform-client/package.json', 'packages/host-contract/src/index.mjs',
  'packages/host-contract/src/browser-account.mjs', 'packages/platform-api-client/src/index.mjs',
  'packages/platform-api-client/src/community.mjs', 'packages/player-core/src/index.mjs', 'apps/api/src/app.mjs',
  'apps/capability-executor/src/desktop-release-contracts.mjs', 'apps/capability-executor/src/desktop-product-manager.mjs',
  'apps/capability-executor/src/desktop-shell-ipc.mjs', 'apps/capability-executor/src/desktop-file-grants.mjs',
  'apps/capability-executor/src/desktop-node-supervisor.mjs', 'apps/capability-executor/src/windows-desktop-updater.mjs',
  'apps/capability-executor/src/credential-vault.mjs', 'scripts/windows-desktop-product-host.mjs'];
const sourceReferences = await Promise.all(dependencies.map(async source => ({ source, sha256: hash(await read(source)) })));
const apiSource = await read('packages/platform-api-client/src/index.mjs');
const apiMethods = new Set([...apiSource.matchAll(/^\s+([A-Za-z][A-Za-z0-9_]*):[^\r\n]*=>/gmu)].map(m => m[1]));
const communitySource = await read('packages/platform-api-client/src/community.mjs');
for (const m of communitySource.matchAll(/^\s+([A-Za-z][A-Za-z0-9_]*):[^\r\n]*=>/gmu)) apiMethods.add(m[1]);
const toolSource = await read(clientRoot + 'official-tools.mjs');
const report = {
  schemaVersion: 'mooyu-desktop-web-inventory-v1',
  scope: 'current-worktree-static-sources-not-production-feature-verification',
  caveats: ['Route branches are not page or feature counts.', 'Lexical API and browser usage scans supplement the reviewed feature matrix; dynamic calls require manual review.',
    'Implemented source routes are not evidence of production availability, runtime permissions or successful desktop execution.'],
  summary: { routeBranchCount: routeBranches.length, sharedClientModuleCount: modules.length,
    referencedApiMethodCount: unique(modules.flatMap(m => m.apiCalls)).length,
    declaredApiMethodCandidateCount: apiMethods.size,
    communityEnabled: /COMMUNITY_ENABLED\s*=\s*true/u.test(await read(clientRoot + 'community-availability.mjs')),
    officialToolModules: [...toolSource.matchAll(/^\s+'([^']+)':\(\)=>import\(/gmu)].map(m => m[1]) },
  routeBranches,
  fallback: { source: clientRoot + 'App.jsx', line: lines.findIndex(line => line.includes('else content = <DiscoverPage')) + 1,
    component: 'DiscoverPage', note: 'Includes /discover and unmatched routes; not a separate router branch.' },
  apiMethodCandidates: [...apiMethods].sort(), modules, sourceReferences,
};
const serialized = JSON.stringify(report, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (await fs.readFile(target, 'utf8') !== serialized) throw new Error('Desktop inventory is stale; regenerate after reviewing source changes.');
} else await fs.writeFile(target, serialized, 'utf8');
console.log(JSON.stringify({ ...report.summary, output: path.relative(root, target), checked: process.argv.includes('--check') }));
