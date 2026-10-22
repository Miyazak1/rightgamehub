import { officialToolCapabilities, toOfficialToolClientMetadata } from '@gamehub/agent-capabilities';

export const TOOL_DOCUMENT_FORMAT='mooyu.tool-document';
export const TOOL_DOCUMENT_SCHEMA_VERSION=1;

const toolLoaders=Object.freeze({
  'knowledge-map':()=>import('./KnowledgeMapTool.jsx'),
  'pdf-reader':()=>import('./PdfReaderTool.jsx'),
  'change-radar':()=>import('./ChangeRadarTool.jsx'),
  'privacy-redactor':()=>import('./PrivacyRedactorTool.jsx'),
  'document-compare':()=>import('./DocumentCompareTool.jsx'),
  'spreadsheet-audit':()=>import('./SpreadsheetAuditTool.jsx'),
});

export const officialTools=Object.freeze(officialToolCapabilities.map(capability=>Object.freeze({
  ...toOfficialToolClientMetadata(capability),
  load:toolLoaders[capability.toolId],
})));

export function findOfficialTool(id){return officialTools.find(tool=>tool.id===id)??null;}
export function createToolDocument(toolId,{documentId=globalThis.crypto?.randomUUID?.()??`${toolId}-${Date.now()}`,content={},view={},metadata={}}={}){
  if(!findOfficialTool(toolId))throw new Error(`Unknown official tool: ${toolId}`);
  return {format:TOOL_DOCUMENT_FORMAT,schemaVersion:TOOL_DOCUMENT_SCHEMA_VERSION,toolId,toolSchemaVersion:1,documentId,revision:0,content,view,metadata};
}
export function assertToolDocument(value,toolId){
  if(!value||value.format!==TOOL_DOCUMENT_FORMAT||value.schemaVersion!==TOOL_DOCUMENT_SCHEMA_VERSION||value.toolId!==toolId||!Number.isInteger(value.revision)||value.revision<0)throw new Error('Invalid official tool document');
  return value;
}
