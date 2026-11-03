import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const inside = (base, value) => { const relative = path.relative(base, value); return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); };
const readJson = file => fs.readFile(file, 'utf8').then(JSON.parse);
function normalized(bytes, file, exclusions) {
  const lines = exclusions.find(x => x.file === file)?.lines;
  return lines ? Buffer.from(bytes.toString('utf8').split(/\r?\n/).filter(line => !lines.includes(line.trim())).join('\n')) : bytes;
}
async function assets(directory, prefix = '') {
  const result = [];
  for (const entry of await fs.readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw Error('PAPER_BUILD_ASSET_LINK_DENIED');
    if (entry.isDirectory()) result.push(...await assets(directory, relative));
    else result.push({ file: relative, sha256: hash(await fs.readFile(path.join(directory, relative))) });
  }
  return result;
}
export async function sealPaperStudyBuild(directory, scope) {
  const source = path.join(directory, 'source'), exclusions = scope.excludeLines ?? [];
  const sourceFiles = await Promise.all(scope.files.map(async file => ({ file, sha256: hash(normalized(await fs.readFile(path.join(source, file)), file, exclusions)) })));
  const assetFiles = await assets(path.join(source, '.runtime/desktop-shell/web'));
  await fs.writeFile(path.join(directory, 'paper-study-build.json'), JSON.stringify({ sourceFiles, assetFiles, exclusions }, null, 2));
}
export async function resolvePaperStudyBuild({ root, source: requestedSource } = {}) {
  root = await fs.realpath(root);
  const exportsRoot = await fs.realpath(path.join(root, '.runtime/desktop-auth-clean'));
  const latest = requestedSource ? null : await readJson(path.join(root, '.runtime/paper-study/clean-latest.json'));
  if (latest && (!latest.passed || !latest.buildPassed)) throw Error('PAPER_BUILD_CHECK_REQUIRED');
  const source = await fs.realpath(requestedSource ?? path.join(latest.directory, 'source'));
  const directory = path.dirname(source);
  if (path.dirname(directory) !== exportsRoot || path.basename(source) !== 'source') throw Error('PAPER_BUILD_SOURCE_OUTSIDE_EXPORT');
  const report = await readJson(path.join(directory, 'report.json'));
  if (!report.passed || !report.buildPassed || report.failed !== 0) throw Error('PAPER_BUILD_CHECK_REQUIRED');
  const seal = await readJson(path.join(directory, 'paper-study-build.json'));
  if (!seal.sourceFiles?.length || !seal.assetFiles?.length) throw Error('PAPER_BUILD_SEAL_REQUIRED');
  for (const row of seal.sourceFiles) {
    const current = path.resolve(root, row.file), exported = path.resolve(source, row.file);
    if (!inside(root, current) || !inside(source, exported) || row.file.startsWith('.runtime/')) throw Error('PAPER_BUILD_SOURCE_PATH_DENIED');
    for (const file of [current, exported]) if (hash(normalized(await fs.readFile(file), row.file, seal.exclusions)) !== row.sha256) throw Error('PAPER_BUILD_SOURCE_STALE');
  }
  const assetRoot = path.join(source, '.runtime/desktop-shell/web');
  for (const row of seal.assetFiles) {
    const file = path.resolve(assetRoot, row.file);
    if (!inside(assetRoot, file) || hash(await fs.readFile(file)) !== row.sha256) throw Error('PAPER_BUILD_ASSET_STALE');
  }
  await fs.access(path.join(assetRoot, 'index.html'));
  // The known local runtime configuration supplies the executable only. Its old
  // assetRoot and entry are never used to select the frontend being verified.
  const runtime = await readJson(path.join(root, '.runtime/desktop-shell/launch.json'));
  if (!path.isAbsolute(runtime.electronExecutable ?? '')) throw Error('PAPER_BUILD_ELECTRON_CONFIG_INVALID');
  await fs.access(runtime.electronExecutable);
  return { source, assetRoot, electronExecutable: runtime.electronExecutable, directory };
}
