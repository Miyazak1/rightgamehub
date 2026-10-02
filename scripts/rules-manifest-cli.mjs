import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { digestRulesBundle, inspectRulesBundle, loadRulesRegistry, RULES_MANIFEST_PROTOCOL, signRulesManifest } from '../packages/rules-sdk/src/index.mjs';

const fail = message => { process.stderr.write(`${message}\n`); process.exitCode = 1; };
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8',flag: 'w' });
const identityKey = value => `${value.workId}:${value.modeKey}:${value.rulesetVersion}`;
const resolveManifest = value => {
  const absolute = path.resolve(value);
  return fs.statSync(absolute).isDirectory() ? path.join(absolute,'manifest.json') : absolute;
};
const resolveBundle = (root, value) => {
  const bundle = String(value ?? '');
  if (!bundle.endsWith('.cjs') || bundle.includes('\\') || path.posix.isAbsolute(bundle) || bundle.split('/').some(part => !part || part === '.' || part === '..')) throw new Error(`Invalid rules bundle path: ${bundle}`);
  const realRoot = fs.realpathSync(root);
  const realBundle = fs.realpathSync(path.resolve(realRoot, ...bundle.split('/')));
  const relative = path.relative(realRoot, realBundle);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Rules bundle escapes the manifest directory: ${bundle}`);
  return realBundle;
};
const usage = `Usage:
  node scripts/rules-manifest-cli.mjs keygen <key-id> <private-key.pem> <public-key.json>
  node scripts/rules-manifest-cli.mjs stage <release-dir> <key-id> <bundle.cjs> <work-id> <mode-key> <ruleset-version> [current-manifest.json|-] [trusted-keys.json|-]
  node scripts/rules-manifest-cli.mjs sign <manifest.json> <private-key.pem> [output.json]
  node scripts/rules-manifest-cli.mjs verify <manifest.json> <trusted-keys.json>
  node scripts/rules-manifest-cli.mjs verify-release <release-dir|manifest.json> <trusted-keys.json>
  node scripts/rules-manifest-cli.mjs materialize <manifest.json> <trusted-keys.json> <output-dir>

The unsigned manifest must contain protocol, createdAt, keyId and entries. Each entry contains
workId, modeKey, rulesetVersion and bundle; sign recomputes every bundle sha256 before signing.
`;

const copyManifestBundles = (manifestFile,entries,targetRoot) => {
  const sourceRoot = path.dirname(path.resolve(manifestFile));
  for (const entry of entries) {
    const source = resolveBundle(sourceRoot,entry.bundle);
    const target = path.resolve(targetRoot,...entry.bundle.split('/'));
    if (!target.startsWith(`${path.resolve(targetRoot)}${path.sep}`)) throw new Error(`Rules bundle escapes the release directory: ${entry.bundle}`);
    fs.mkdirSync(path.dirname(target),{ recursive: true });
    fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL);
  }
};
const atomicDirectory = (target,writer) => {
  const absolute = path.resolve(target);
  if (fs.existsSync(absolute)) throw new Error(`Refusing to overwrite an existing release directory: ${absolute}`);
  const temporary = `${absolute}.partial-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  fs.mkdirSync(temporary,{ recursive: true,mode: 0o700 });
  try { writer(temporary); fs.renameSync(temporary,absolute); }
  catch (error) { fs.rmSync(temporary,{ recursive: true,force: true }); throw error; }
  return absolute;
};

try {
  const [command,...args] = process.argv.slice(2);
  if (command === 'keygen') {
    const [keyId,privateFile,publicFile] = args;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(keyId ?? '') || !privateFile || !publicFile) throw new Error(usage);
    if (fs.existsSync(privateFile) || fs.existsSync(publicFile)) throw new Error('Refusing to overwrite an existing key file.');
    const { privateKey,publicKey } = crypto.generateKeyPairSync('ed25519');
    fs.writeFileSync(privateFile, privateKey.export({ format: 'pem',type: 'pkcs8' }), { mode: 0o600,flag: 'wx' });
    writeJson(publicFile, { [keyId]: publicKey.export({ format: 'der',type: 'spki' }).toString('base64') });
    process.stdout.write(`Created offline private key ${privateFile} and trusted public key ${publicFile}.\n`);
  } else if (command === 'stage') {
    const [releaseDir,keyId,bundleFile,workId,modeKey,rulesetVersion,currentManifest = '-',trustedKeysFile = '-'] = args;
    if (!releaseDir || !bundleFile || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(keyId ?? '')) throw new Error(usage);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(workId ?? '')) throw new Error('work-id must be a UUID.');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(modeKey ?? '') || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(rulesetVersion ?? '')) throw new Error('mode-key and ruleset-version must be safe manifest identifiers.');
    const bundleBytes = fs.readFileSync(path.resolve(bundleFile));
    const inspected = inspectRulesBundle(bundleBytes,{ filename: path.resolve(bundleFile) });
    if (inspected.workId !== workId || inspected.modeKey !== modeKey || inspected.rulesetVersion !== rulesetVersion) throw new Error('The new rules bundle identity does not match the requested release identity.');
    let previousManifestFile = null; let previousManifest = null; let previousDescription = null;
    if (currentManifest !== '-') {
      if (trustedKeysFile === '-') throw new Error('trusted-keys.json is required when carrying forward a current manifest.');
      previousManifestFile = resolveManifest(currentManifest);
      const registry = loadRulesRegistry({ manifestPath: previousManifestFile,trustedKeys: readJson(path.resolve(trustedKeysFile)) });
      previousDescription = registry.describe(); previousManifest = readJson(previousManifestFile);
    }
    const previousEntries = previousManifest?.entries ?? [];
    if (previousEntries.some(entry => identityKey(entry) === identityKey({ workId,modeKey,rulesetVersion }))) throw new Error('This immutable rules identity already exists in the current release. Use a new rulesetVersion.');
    const bundleRelative = `adapters/${workId.toLowerCase()}/${modeKey}-${rulesetVersion}.cjs`;
    if (previousEntries.some(entry => entry.bundle === bundleRelative)) throw new Error('The target rules bundle path already exists in the current release.');
    const entries = [...previousEntries.map(entry => ({ ...entry })),{ workId,modeKey,rulesetVersion,bundle: bundleRelative,sha256: inspected.sha256 }]
      .sort((left,right) => identityKey(left).localeCompare(identityKey(right),'en'));
    const absoluteRelease = atomicDirectory(releaseDir,target => {
      if (previousManifestFile) copyManifestBundles(previousManifestFile,previousEntries,target);
      const targetBundle = path.resolve(target,...bundleRelative.split('/')); fs.mkdirSync(path.dirname(targetBundle),{ recursive: true }); fs.writeFileSync(targetBundle,bundleBytes,{ flag: 'wx',mode: 0o600 });
      const unsigned = { protocol: RULES_MANIFEST_PROTOCOL,createdAt: new Date().toISOString(),keyId,entries };
      writeJson(path.join(target,'manifest.unsigned.json'),unsigned);
      writeJson(path.join(target,'release-plan.json'),{
        protocol: 'gamehub.rules-release-plan.v1',createdAt: unsigned.createdAt,keyId,
        previousManifestSha256: previousDescription?.manifestSha256 ?? null,
        added: { workId,modeKey,rulesetVersion,bundle: bundleRelative,sha256: inspected.sha256,bytes: inspected.bytes },
        adapterCount: entries.length,
      });
    });
    process.stdout.write(`${JSON.stringify({ status: 'staged',releaseDir: absoluteRelease,unsignedManifest: path.join(absoluteRelease,'manifest.unsigned.json'),adapterCount: entries.length,added: inspected })}\n`);
  } else if (command === 'sign') {
    const [manifestFile,privateFile,outputFile = manifestFile] = args;
    if (!manifestFile || !privateFile) throw new Error(usage);
    const absoluteManifest = path.resolve(manifestFile);
    const root = path.dirname(absoluteManifest);
    const unsigned = readJson(absoluteManifest);
    const entries = (unsigned.entries ?? []).map(entry => {
      const bundle = fs.readFileSync(resolveBundle(root, entry.bundle));
      return { ...entry,sha256: digestRulesBundle(bundle) };
    });
    const signed = signRulesManifest({ ...unsigned,protocol: unsigned.protocol ?? RULES_MANIFEST_PROTOCOL,entries,signature: undefined }, fs.readFileSync(privateFile, 'utf8'));
    writeJson(path.resolve(outputFile), signed);
    process.stdout.write(`Signed ${entries.length} rules adapter(s) into ${outputFile}.\n`);
  } else if (command === 'verify') {
    const [manifestFile,trustedKeysFile] = args;
    if (!manifestFile || !trustedKeysFile) throw new Error(usage);
    const registry = loadRulesRegistry({ manifestPath: path.resolve(manifestFile),trustedKeys: readJson(path.resolve(trustedKeysFile)) });
    process.stdout.write(`Verified ${registry.list().length} trusted rules adapter(s).\n`);
  } else if (command === 'verify-release') {
    const [release,trustedKeysFile] = args;
    if (!release || !trustedKeysFile) throw new Error(usage);
    const manifestFile = resolveManifest(release);
    const registry = loadRulesRegistry({ manifestPath: manifestFile,trustedKeys: readJson(path.resolve(trustedKeysFile)) });
    process.stdout.write(`${JSON.stringify({ status: 'verified',manifestPath: manifestFile,...registry.describe() })}\n`);
  } else if (command === 'materialize') {
    const [manifest,trustedKeysFile,outputDir] = args;
    if (!manifest || !trustedKeysFile || !outputDir) throw new Error(usage);
    const manifestFile = resolveManifest(manifest);
    const trustedKeys = readJson(path.resolve(trustedKeysFile));
    const registry = loadRulesRegistry({ manifestPath: manifestFile,trustedKeys });
    const parsed = readJson(manifestFile);
    const absoluteOutput = atomicDirectory(outputDir,target => {
      copyManifestBundles(manifestFile,parsed.entries,target);
      fs.copyFileSync(manifestFile,path.join(target,'manifest.json'),fs.constants.COPYFILE_EXCL);
      const copied = loadRulesRegistry({ manifestPath: path.join(target,'manifest.json'),trustedKeys });
      if (copied.describe().manifestSha256 !== registry.describe().manifestSha256) throw new Error('Materialized manifest digest changed unexpectedly.');
    });
    process.stdout.write(`${JSON.stringify({ status: 'materialized',releaseDir: absoluteOutput,...registry.describe() })}\n`);
  } else {
    fail(usage);
  }
} catch (error) {
  fail(error?.message ?? String(error));
}
