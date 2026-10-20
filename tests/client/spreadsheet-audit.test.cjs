const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');

const modulePromise=import(pathToFileURL(path.resolve('packages/platform-client/src/spreadsheet-audit.mjs')).href);
const workbook=cells=>({name:'book.xlsx',sheets:[{name:'Sheet1',cells:cells.map(cell=>({column:1,row:1,value:'',formula:'',...cell}))}]});

test('formula patterns are location independent and shared formulas can be shifted',async()=>{
  const {canonicalizeFormula,shiftFormula}=await modulePromise;
  assert.equal(canonicalizeFormula('=B2+C2',{sheet:'Sheet1',address:'A2'}),canonicalizeFormula('=B9+C9',{sheet:'Sheet1',address:'A9'}));
  assert.equal(canonicalizeFormula('=A1_NAME+1',{sheet:'Sheet1',address:'A2'}),'A1_NAME+1');
  assert.equal(shiftFormula('=A1+$B$2+C$3+$D4','A1','C3','Sheet1'),'=C3+$B$2+E$3+$D6');
  assert.equal(shiftFormula("='Sales Data'!A1",'A1','B2','Sheet1'),"='Sales Data'!B2");
});

test('audit detects broken, external, circular, pattern, and fixed-value clues',async()=>{
  const {analyzeWorkbook}=await modulePromise;
  const result=analyzeWorkbook(workbook([
    {address:'A1',row:1,column:1,formula:'=A1'},
    {address:'D1',row:1,column:4,formula:'=#REF!+1'},
    {address:'E1',row:1,column:5,formula:'=[Budget.xlsx]Jan!A1'},
    {address:'A2',row:2,column:1,formula:'=B2+C2'},
    {address:'A3',row:3,column:1,formula:'=B3-C3'},
    {address:'A4',row:4,column:1,formula:'=B4+C4'},
    {address:'F2',row:2,column:6,formula:'=G2*2'},
    {address:'F3',row:3,column:6,value:'99'},
    {address:'F4',row:4,column:6,formula:'=G4*2'},
    {address:'B2',row:2,column:2,value:'10'},
    {address:'C2',row:2,column:3,value:'20'},
  ]));
  const codes=new Set(result.issues.map(item=>item.code));
  for(const code of ['self-reference','broken-reference','external-workbook','pattern-outlier','formula-replaced'])assert.ok(codes.has(code),`missing ${code}`);
  assert.equal(result.relations('Sheet1','A2').precedents.length,2);
  assert.equal(result.relations('Sheet1','B2').dependents[0].key,'Sheet1!A2');
});

test('workbook comparison reports formula additions, removals, and edits',async()=>{
  const {compareWorkbooks}=await modulePromise;
  const before=workbook([{address:'A1',row:1,column:1,formula:'=B1'},{address:'A2',row:2,column:1,formula:'=B2'}]);
  const after=workbook([{address:'A1',row:1,column:1,formula:'=C1'},{address:'A3',row:3,column:1,formula:'=B3'}]);
  const result=compareWorkbooks(before,after);
  assert.deepEqual(result.stats,{added:1,removed:1,changed:1});
  assert.deepEqual(result.changes.map(item=>item.type).sort(),['added','changed','removed']);
});
