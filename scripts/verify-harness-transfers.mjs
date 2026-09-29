// Integration check against a running, authenticated local Harness test profile.
// GAMEHUB_TEST_TOKEN is its startup token; never write it to the report.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = new URL(process.argv[2] || 'http://127.0.0.1:3082/');
assert.equal(base.hostname, '127.0.0.1', 'Run only against the local test instance');
assert.ok(process.env.GAMEHUB_TEST_TOKEN, 'Set the test instance startup token');
const source = process.argv[3];
assert.ok(source, 'Pass the original file used for the UI upload');
const root = fileURLToPath(new URL('../.runtime/m0/', import.meta.url));
await mkdir(root, { recursive: true });
const auth = new URL(base);
auth.searchParams.set('token', process.env.GAMEHUB_TEST_TOKEN);
const login = await fetch(auth, { redirect: 'manual' });
assert.equal(login.status, 303);
const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
assert.ok(cookie);
const endpoint = action => new URL(`api/gamehub/${action}`, base);
assert.equal((await fetch(endpoint('files'))).status, 401);
assert.equal((await fetch(endpoint('files'), { headers: { Cookie: cookie, Origin: 'https://untrusted.example' } })).status, 403);
const list = await (await fetch(endpoint('files'), { headers: { Cookie: cookie } })).json();
assert.equal(list.ok, true);
const record = list.files.find(file => file.name === path.basename(source));
assert.ok(record, 'Upload the file through the UI first');
const downloadUrl = endpoint('download');
downloadUrl.searchParams.set('id', record.id);
const download = await fetch(downloadUrl, { headers: { Cookie: cookie } });
assert.equal(download.status, 200);
assert.match(download.headers.get('content-disposition'), /^attachment;/);
const destination = path.join(root, `download-check-${Date.now()}.exe`);
await pipeline(Readable.fromWeb(download.body), createWriteStream(destination, { flags: 'wx' }));
async function digest(file) {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(file)) { hash.update(chunk); size += chunk.length; }
  return { size, sha256: hash.digest('hex') };
}
const original = await digest(source);
const downloaded = await digest(destination);
assert.deepEqual(downloaded, original);
assert.equal(downloaded.sha256, record.sha256);
const verifyUrl = endpoint('verify');
verifyUrl.searchParams.set('id', record.id);
const verify = await fetch(verifyUrl, {
  method: 'POST', duplex: 'half', body: Readable.toWeb(createReadStream(destination)),
  headers: { Cookie: cookie, 'Content-Type': 'application/octet-stream', 'X-GameHub-Client': '1', 'X-GameHub-Size': String(downloaded.size) },
});
assert.equal(verify.status, 200);
assert.equal((await verify.json()).matches, true);
const report = { checkedAt: new Date().toISOString(), recordId: record.id, filename: record.name, ...downloaded, destination, authenticatedDownload: 'passed', anonymousRequest: '401', crossOriginRequest: '403', verifyDownloadedFile: 'passed' };
await writeFile(path.join(root, 'transfer-check-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
