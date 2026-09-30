import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { digestRulesBundle, loadRulesRegistry, RULES_MANIFEST_PROTOCOL, signRulesManifest } from '../packages/rules-sdk/src/index.mjs';

const fail = message => { process.stderr.write(`${message}\n`); process.exitCode = 1; };
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8',flag: 'w' });
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
  node scripts/rules-manifest-cli.mjs sign <manifest.json> <private-key.pem> [output.json]
  node scripts/rules-manifest-cli.mjs verify <manifest.json> <trusted-keys.json>

The unsigned manifest must contain protocol, createdAt, keyId and entries. Each entry contains
workId, modeKey, rulesetVersion and bundle; sign recomputes every bundle sha256 before signing.
`;

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
  } else {
    fail(usage);
  }
} catch (error) {
  fail(error?.message ?? String(error));
}
