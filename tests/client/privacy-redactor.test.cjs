const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {pathToFileURL}=require('node:url');

const moduleUrl=pathToFileURL(path.resolve('packages/platform-client/src/privacy-redactor.mjs')).href;

test('privacy scanner finds supported sensitive values and rejects invalid lookalikes',async()=>{
  const {scanSensitiveText}=await import(moduleUrl);
  const input='邮箱 alice@example.com，手机 13812345678，身份证 11010519491231002X，银行卡 4539 1488 0343 6467，IP 192.168.1.10，普通数字 1234567890123456。';
  const findings=scanSensitiveText(input);
  assert.deepEqual(findings.map(item=>item.type),['email','phone','idCard','bankCard','ipAddress']);
  assert.ok(findings.every(item=>item.value===input.slice(item.start,item.end)));
});

test('privacy scanner detects secrets and custom terms without returning overlaps',async()=>{
  const {scanSensitiveText}=await import(moduleUrl);
  const input='项目海风使用 sk-abcdefghijklmnopqrstuvwxyz123456，联系人海风。';
  const findings=scanSensitiveText(input,{types:['secret','custom'],customTerms:['海风']});
  assert.deepEqual(findings.map(item=>item.type),['custom','secret','custom']);
  assert.equal(new Set(findings.map(item=>item.id)).size,3);
});

test('privacy redaction supports reversible-looking labels and irreversible masks',async()=>{
  const {scanSensitiveText,redactSensitiveText}=await import(moduleUrl);
  const input='alice@example.com / 13812345678',findings=scanSensitiveText(input,{types:['email','phone']});
  assert.equal(redactSensitiveText(input,findings),'[EMAIL_1] / [PHONE_1]');
  assert.equal(redactSensitiveText(input,findings,{mode:'mask'}),'a***@example.com / 138****5678');
  assert.equal(redactSensitiveText(input,findings,{selectedIds:[findings[1].id]}),'alice@example.com / [PHONE_1]');
});

test('privacy workspace keeps content local and exports a re-encoded image',async()=>{
  const source=await fs.readFile(path.resolve('packages/platform-client/src/PrivacyRedactorTool.jsx'),'utf8');
  assert.doesNotMatch(source,/\bfetch\s*\(/u);
  assert.doesNotMatch(source,/localStorage|sessionStorage/u);
  assert.match(source,/canvasRef\.current\.toBlob/u);
  assert.match(source,/new globalThis\.FaceDetector/u);
  assert.doesNotMatch(source,/filter\s*=|blur\(/u);
});

test('privacy PDF export rasterizes pages into a new document',async()=>{
  const source=await fs.readFile(path.resolve('packages/platform-client/src/PdfPrivacyPanel.jsx'),'utf8');
  assert.doesNotMatch(source,/\bfetch\s*\(/u);
  assert.doesNotMatch(source,/localStorage|sessionStorage/u);
  assert.match(source,/PDFDocument\.create\(\)/u);
  assert.match(source,/page\.render\(\{canvasContext:context,viewport\}\)/u);
  assert.match(source,/output\.embedJpg/u);
  assert.match(source,/output\.addPage/u);
  assert.doesNotMatch(source,/PDFDocument\.load/u);
});
