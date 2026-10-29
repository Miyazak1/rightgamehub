import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const fail = code => { const error = new Error(code); error.code = code; throw error; };
const requestFile = process.env.MOOYU_CAPABILITY_REQUEST;
const resultFile = process.env.MOOYU_CAPABILITY_RESULT;
const outputDirectory = process.env.MOOYU_CAPABILITY_OUTPUT_DIR;

if (![requestFile, resultFile, outputDirectory].every(value => path.isAbsolute(value ?? ''))) {
  fail('PAPER_LAYOUT_WORKER_ENVIRONMENT_INVALID');
}

const defaultModule = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'paper-layout.mjs');
const modulePath = process.env.MOOYU_PAPER_LAYOUT_MODULE
  ? path.resolve(process.env.MOOYU_PAPER_LAYOUT_MODULE) : defaultModule;
const { PAPER_LAYOUT_CONTRACT, decidePaperLayoutRoute } = await import(pathToFileURL(modulePath).href);
const request = JSON.parse(await fs.promises.readFile(requestFile, 'utf8'));
if (request?.schemaVersion !== 'capability-native-request-v1'
  || request?.contract?.key !== PAPER_LAYOUT_CONTRACT.key
  || request?.contract?.version !== PAPER_LAYOUT_CONTRACT.version
  || !Array.isArray(request.fileGrants) || request.fileGrants.length !== 1
  || !path.isAbsolute(request.fileGrants[0]?.sourcePath ?? '')
  || request.fileGrants[0]?.access !== 'read') fail('PAPER_LAYOUT_WORKER_REQUEST_INVALID');

const sourcePath = request.fileGrants[0].sourcePath;
const stats = await fs.promises.stat(sourcePath);
if (!stats.isFile() || stats.size !== request.input?.artifact?.sizeBytes) {
  fail('PAPER_LAYOUT_SOURCE_IDENTITY_MISMATCH');
}
const hash = crypto.createHash('sha256');
for await (const chunk of fs.createReadStream(sourcePath)) hash.update(chunk);
if (hash.digest('hex') !== request.input?.artifact?.sha256) fail('PAPER_LAYOUT_SOURCE_IDENTITY_MISMATCH');

const decision = decidePaperLayoutRoute(request.input);
await fs.promises.mkdir(outputDirectory, { recursive: true });
const artifactPath = path.join(outputDirectory, 'paper-layout-decision.json');
await fs.promises.writeFile(artifactPath, JSON.stringify(decision), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
await fs.promises.writeFile(resultFile, JSON.stringify({
  schemaVersion: 'capability-native-result-v1',
  artifact: { path: 'paper-layout-decision.json',
    mediaType: 'application/vnd.mooyu.paper-layout-decision+json',
    metadata: { route: decision.route, textLayerPages: decision.textLayerPages.length,
      localLayoutPages: decision.localLayoutPages.length, localOcrPages: decision.localOcrPages.length } },
}), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
