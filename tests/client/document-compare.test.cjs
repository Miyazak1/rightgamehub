const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {pathToFileURL}=require('node:url');

const moduleUrl=pathToFileURL(path.resolve('packages/platform-client/src/document-diff.mjs')).href;

test('document comparison reports line additions, removals and similarity',async()=>{
  const {compareDocuments}=await import(moduleUrl);
  const result=compareDocuments('标题\n旧内容\n保留','标题\n新内容\n保留',{mode:'lines'});
  assert.equal(result.mode,'lines');
  assert.ok(result.stats.added>0);
  assert.ok(result.stats.removed>0);
  assert.ok(result.stats.similarity<100);
  assert.ok(result.parts.some(part=>part.added));
  assert.ok(result.parts.some(part=>part.removed));
});

test('side-by-side rows align replacements and retain both line numbers',async()=>{
  const {buildSideBySideRows}=await import(moduleUrl);
  const rows=buildSideBySideRows('one\ntwo\nthree','one\nTWO\nthree');
  const changed=rows.find(row=>row.status==='changed');
  assert.deepEqual(changed,{id:changed.id,status:'changed',before:'two',after:'TWO',beforeNumber:2,afterNumber:2});
});

test('word comparison and Markdown report preserve reviewable changes',async()=>{
  const {buildDiffReport,compareDocuments}=await import(moduleUrl);
  const result=compareDocuments('price is 10','price is 12',{mode:'words'});
  assert.ok(result.parts.some(part=>part.removed&&part.value.includes('10')));
  assert.ok(result.parts.some(part=>part.added&&part.value.includes('12')));
  const report=buildDiffReport({beforeLabel:'Contract v1',afterLabel:'Contract v2',before:'price is 10',after:'price is 12'});
  assert.match(report,/# Contract v1 ↔ Contract v2/u);
  assert.match(report,/price is 10/u);
  assert.match(report,/price is 12/u);
});

test('ignore options behave consistently at every comparison granularity',async()=>{
  const {compareDocuments}=await import(moduleUrl);
  for(const mode of ['lines','words','characters']){
    const result=compareDocuments('A  b\n','a b\n',{mode,ignoreWhitespace:true,ignoreCase:true});
    assert.equal(result.stats.changes,0,mode);
    assert.equal(result.stats.similarity,100,mode);
  }
});

test('document comparison readers remain local and support PDF and DOCX extraction',async()=>{
  const [reader,tool]=await Promise.all([
    fs.readFile(path.resolve('packages/platform-client/src/document-reader.mjs'),'utf8'),
    fs.readFile(path.resolve('packages/platform-client/src/DocumentCompareTool.jsx'),'utf8'),
  ]);
  assert.match(reader,/mammoth\.extractRawText/u);
  assert.match(reader,/pdfjsLib\.getDocument/u);
  assert.match(reader,/getTextContent/u);
  assert.doesNotMatch(reader,/\bfetch\s*\(/u);
  assert.doesNotMatch(reader,/localStorage|sessionStorage/u);
  assert.doesNotMatch(tool,/\bfetch\s*\(/u);
  assert.doesNotMatch(tool,/localStorage|sessionStorage/u);
});
