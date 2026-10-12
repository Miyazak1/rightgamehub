import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const publicRoot = new URL('apps/web/public/downloads/', root);
const sha256 = content => createHash('sha256').update(content).digest('hex');

await mkdir(publicRoot, { recursive: true });
const updaterContent = await readFile(new URL('apps/web/public/agent-update.ps1', root));
const portableUpdaterContent = await readFile(new URL('apps/web/public/agent-update.mjs', root));

const extensionPackage = JSON.parse(await readFile(new URL('extensions/vscode/package.json', root), 'utf8'));
const filename = `${extensionPackage.name}-${extensionPackage.version}.vsix`;
const artifact = new URL(`artifacts/${filename}`, root);
const extensionContent = await readFile(artifact);
await copyFile(artifact, new URL(filename, publicRoot));
await copyFile(artifact, new URL('gamehub-agent-latest.vsix', publicRoot));

const harnessPackage = JSON.parse(await readFile(new URL('extensions/harness/package.json', root), 'utf8'));
const harnessFilename = `${harnessPackage.name}-${harnessPackage.version}.tgz`;
const harnessArtifact = new URL(`artifacts/${harnessFilename}`, root);
const harnessContent = await readFile(harnessArtifact);
await copyFile(harnessArtifact, new URL(harnessFilename, publicRoot));
await copyFile(harnessArtifact, new URL('gamehub-dsh-plugin-latest.tgz', publicRoot));

const portablePlugin = JSON.parse(await readFile(new URL('plugins/gamehub/plugin.json', root), 'utf8'));
const marketplacePaths = [
  '.agents/plugins/marketplace.json',
  '.claude-plugin/marketplace.json',
];
const marketplace = JSON.parse(await readFile(new URL(marketplacePaths[0], root), 'utf8'));
const listFiles = async relativeRoot => {
  const entries = await readdir(new URL(`${relativeRoot}/`, root), { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => {
    const relative = `${relativeRoot}/${entry.name}`;
    return entry.isDirectory() ? listFiles(relative) : [relative];
  }));
  return nested.flat();
};
const pluginRoots = marketplace.plugins.map(item => {
  const relative = String(item?.source?.path || '').replace(/^\.\//u, '').replace(/\/$/u, '');
  if (!/^plugins\/[A-Za-z0-9._-]+$/u.test(relative)) throw new Error(`Unsafe marketplace plugin path: ${item?.source?.path}`);
  return relative;
});
const pluginPaths = [...new Set([...marketplacePaths, ...(await Promise.all(pluginRoots.map(listFiles))).flat()])].sort();
const pluginFiles = await Promise.all(pluginPaths.map(async path => {
  const content = await readFile(new URL(path, root));
  return { path, contentBase64: content.toString('base64'), sha256: sha256(content) };
}));
const pluginBundle = Buffer.from(JSON.stringify({
  schemaVersion: 1,
  name: portablePlugin.name,
  version: portablePlugin.version,
  files: pluginFiles,
}, null, 2) + '\n');
const pluginFilename = `gamehub-agent-plugin-${portablePlugin.version}.json`;
await writeFile(new URL(pluginFilename, publicRoot), pluginBundle);
const creatorToolkitCatalog = await readFile(new URL('plugins/gamehub/toolkits/catalog.json', root));
await writeFile(new URL('gamehub-creator-tools-v1.json', publicRoot), creatorToolkitCatalog);

await writeFile(new URL('manifest.json', publicRoot), JSON.stringify({
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  channel: 'stable',
  updatePolicy: {
    consent: 'on-first-install',
    checkIntervalHours: 6,
    download: 'background',
    apply: 'on-host-restart',
    rollbackVersions: 0,
    failurePolicy: 'report-and-retry',
    integrity: ['sha256'],
  },
  updater: {
    version: 2,
    windows: { filename: 'agent-update.ps1', url: 'https://mooyu.fun/agent-update.ps1', sha256: sha256(updaterContent) },
    portable: { filename: 'agent-update.mjs', url: 'https://mooyu.fun/agent-update.mjs', sha256: sha256(portableUpdaterContent) },
  },
  hostAdapters: {
    harness: { strategy: 'gamehub-staged-package', artifact: 'harnessPlugin', restartRequired: true },
    code: { strategy: 'editor-self-update', artifact: 'editorExtension', restartRequired: true },
    cursor: { strategy: 'editor-self-update', artifact: 'editorExtension', restartRequired: true },
    codex: { strategy: 'native-marketplace', marketplace: 'gamehub', restartRequired: true },
    claude: { strategy: 'native-marketplace', marketplace: 'gamehub', restartRequired: true },
    opencode: { strategy: 'browser-fallback', restartRequired: false },
  },
  editorExtension: {
    version: extensionPackage.version,
    extensionId: `${extensionPackage.publisher}.${extensionPackage.name}`,
    filename,
    url: `https://mooyu.fun/downloads/${filename}`,
    sha256: sha256(extensionContent),
    supportedHosts: ['cursor', 'code'],
  },
  harnessPlugin: {
    version: harnessPackage.version,
    filename: harnessFilename,
    url: `https://mooyu.fun/downloads/${harnessFilename}`,
    sha256: sha256(harnessContent),
    supportedHosts: ['harness'],
  },
  agentPlugin: {
    version: portablePlugin.version,
    filename: pluginFilename,
    url: `https://mooyu.fun/downloads/${pluginFilename}`,
    sha256: sha256(pluginBundle),
    supportedHosts: ['codex', 'claude'],
    updateScope: 'all-marketplace-plugins',
    activation: 'on-host-restart',
  },
  creatorTools: {
    version: JSON.parse(creatorToolkitCatalog).version,
    filename: 'gamehub-creator-tools-v1.json',
    url: 'https://mooyu.fun/downloads/gamehub-creator-tools-v1.json',
    sha256: sha256(creatorToolkitCatalog),
    execution: 'user-local-agent',
  },
}, null, 2) + '\n');
console.log(`Prepared GameHub downloads: ${filename}, ${harnessFilename}, and ${pluginFilename}`);
