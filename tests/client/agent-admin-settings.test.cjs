const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const{pathToFileURL}=require('node:url');

test('Agent automation payload whitelists writable fields and rejects a short topic scope',async()=>{
  const{buildAgentAutomationPayload}=await import(pathToFileURL(path.resolve(__dirname,'../../packages/platform-client/src/agent-admin-settings.mjs')));
  const payload=buildAgentAutomationPayload({enabled:true,model:'deepseek-flash',intervalHours:84,monthlyArticleLimit:8,topicScope:'  人工智能与大众科技知识  ',nextRunAt:'2026-10-24T00:00:00.000Z',serverOnly:'must-not-leak'});
  assert.deepEqual(payload,{enabled:true,model:'deepseek-flash',intervalHours:84,monthlyArticleLimit:8,topicScope:'人工智能与大众科技知识'});
  assert.equal(Object.hasOwn(payload,'nextRunAt'),false);
  assert.equal(Object.hasOwn(payload,'serverOnly'),false);
  assert.throws(()=>buildAgentAutomationPayload({...payload,topicScope:'ai'}),/至少填写 10 个字符/);
});
