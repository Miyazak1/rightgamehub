export const TOOL_DOCUMENT_FORMAT='mooyu.tool-document';
export const TOOL_DOCUMENT_SCHEMA_VERSION=1;

export const officialTools=[Object.freeze({
  id:'knowledge-map',route:'/tools/knowledge-map',titleKey:'tools.knowledgeMap.title',descriptionKey:'tools.knowledgeMap.description',status:'coming-soon',runtime:'trusted-react',layouts:['sidebar','canvas'],capabilities:['document.create','document.read','document.patch','document.export'],load:null,
})];

export function findOfficialTool(id){return officialTools.find(tool=>tool.id===id)??null;}
export function createToolDocument(toolId,{documentId=globalThis.crypto?.randomUUID?.()??`${toolId}-${Date.now()}`,content={},view={},metadata={}}={}){
  if(!findOfficialTool(toolId))throw new Error(`Unknown official tool: ${toolId}`);
  return {format:TOOL_DOCUMENT_FORMAT,schemaVersion:TOOL_DOCUMENT_SCHEMA_VERSION,toolId,toolSchemaVersion:1,documentId,revision:0,content,view,metadata};
}
export function assertToolDocument(value,toolId){
  if(!value||value.format!==TOOL_DOCUMENT_FORMAT||value.schemaVersion!==TOOL_DOCUMENT_SCHEMA_VERSION||value.toolId!==toolId||!Number.isInteger(value.revision)||value.revision<0)throw new Error('Invalid official tool document');
  return value;
}
