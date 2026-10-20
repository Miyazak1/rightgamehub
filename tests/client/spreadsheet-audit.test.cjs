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

test('Agent audit payload is bounded and never includes ordinary cell values',async()=>{
  const {analyzeWorkbook,buildSpreadsheetAgentPayload}=await modulePromise;
  const cells=Array.from({length:45},(_,index)=>({address:`A${index+1}`,row:index+1,column:1,formula:'=#REF!+B1',value:`private-value-${index}`}));
  const analysis=analyzeWorkbook(workbook(cells));
  const payload=buildSpreadsheetAgentPayload({analysis,currentName:'finance\u0000.xlsx',hasMacros:true});
  assert.equal(payload.kind,'spreadsheet-formula-audit');
  assert.equal(payload.workbook.name,'finance .xlsx');
  assert.equal(payload.workbook.hasMacros,true);
  assert.equal(payload.issues.length,40);
  assert.equal(payload.issuesOmitted,5);
  assert.equal(payload.disclosure.rawWorkbookShared,false);
  assert.equal(payload.disclosure.ordinaryCellValuesShared,false);
  const serialized=JSON.stringify(payload);
  assert.doesNotMatch(serialized,/private-value/u);
  assert.doesNotMatch(serialized,/"value"/u);
});

test('embedded Agent bridge submits a bounded message and accepts status only from its parent',async()=>{
  const bridge=await import(pathToFileURL(path.resolve('packages/platform-client/src/agent-tool-bridge.mjs')).href);
  const listeners=new Map(),posted=[];
  const parent={postMessage:message=>posted.push(message)};
  const windowImpl={addEventListener:(name,handler)=>listeners.set(name,handler),removeEventListener:(name,handler)=>{if(listeners.get(name)===handler)listeners.delete(name);}};
  assert.equal(bridge.isEmbeddedAgentTool({pathname:'/mcp-app',search:'?gh_host=mcp-app'}),true);
  assert.equal(bridge.isEmbeddedAgentTool({pathname:'/tools/spreadsheet-audit',search:''}),false);
  const requestId=bridge.submitSpreadsheetAudit({kind:'spreadsheet-formula-audit'},{parentWindow:parent,currentWindow:windowImpl,cryptoImpl:{randomUUID:()=> 'audit-id'}});
  assert.equal(requestId,'audit-id');
  assert.equal(posted[0].type,bridge.SPREADSHEET_AUDIT_SUBMIT);
  let received=null;
  const unsubscribe=bridge.subscribeSpreadsheetAuditStatus(message=>{received=message;},{parentWindow:parent,windowImpl});
  listeners.get('message')({source:{},data:{type:bridge.SPREADSHEET_AUDIT_STATUS,requestId,status:'sent'}});
  assert.equal(received,null);
  listeners.get('message')({source:parent,data:{type:bridge.SPREADSHEET_AUDIT_STATUS,requestId,status:'sent'}});
  assert.equal(received.status,'sent');
  unsubscribe();
  assert.equal(listeners.has('message'),false);
});

test('embedded Agent bridge automatically syncs PDF context without submitting a chat message',async()=>{
  const bridge=await import(pathToFileURL(path.resolve('packages/platform-client/src/agent-tool-bridge.mjs')).href);
  const listeners=new Map(),posted=[];
  const parent={postMessage:message=>posted.push(message)};
  const windowImpl={addEventListener:(name,handler)=>listeners.set(name,handler),removeEventListener:()=>{}};
  assert.equal(bridge.syncPdfReaderContext({kind:'pdf-reader-context'},{parentWindow:parent,currentWindow:windowImpl}),true);
  assert.equal(posted[0].type,bridge.PDF_READER_CONTEXT);
  assert.equal(posted[0].payload.kind,'pdf-reader-context');
  let received=null;
  bridge.subscribePdfReaderStatus(message=>{received=message;},{parentWindow:parent,windowImpl});
  listeners.get('message')({source:parent,data:{type:bridge.PDF_READER_STATUS,status:'synced'}});
  assert.equal(received.status,'synced');
});
