import test from 'node:test';
import assert from 'node:assert/strict';
import {createGitHubCodeAdapter,validateGitHubCodeInput,validateGitHubCodeOutput} from '../../apps/api/src/agent-github-code-tool.mjs';
import {validateGitHubQuestionPlan,validateGitHubQuestionAnswer,renderGitHubQuestionAnswer} from '../../apps/api/src/agent-github-question.mjs';
import {createAgentInteractionService} from '../../apps/api/src/agent-interaction-service.mjs';
const revision='a'.repeat(40),repository='https://github.com/owner/project';
test('public GitHub source reads pin every file, exclude symlinks and preserve real line ranges',async()=>{
 const calls=[],adapter=createGitHubCodeAdapter({fetchImpl:async(url,options)=>{
  calls.push(url);assert.equal(options.redirect,'error');
  if(url.endsWith('/repos/owner/project'))return Response.json({private:false,full_name:'owner/project',default_branch:'main'});
  if(url.endsWith('/commits/main'))return Response.json({sha:revision});
  if(url.includes('/git/trees/'))return Response.json({tree:[{path:'src/index.ts',type:'blob',mode:'100644'},{path:'README.md',type:'blob',mode:'100644'},{path:'submodule',type:'commit',mode:'160000'},{path:'shortcut',type:'blob',mode:'120000'}],truncated:false});
  assert.ok(url.endsWith('/contents/src/index.ts?ref='+revision));return new Response('first\r\nsecond\r\nthird');
 }});
 const tree=(await adapter({request:{repository,operation:'inspect'}})).output;assert.deepEqual(tree.files,['src/index.ts','README.md']);assert.equal(tree.revision,revision);
 const file=(await adapter({request:{repository,operation:'file',revision,path:'src/index.ts',fromLine:2}})).output;
 assert.equal(file.sources[0].text,'second\nthird');assert.equal(file.sources[0].fromLine,2);assert.equal(file.sources[0].toLine,3);assert.equal(file.sources[0].truncated,true);assert.equal(calls.length,5);
 assert.throws(()=>validateGitHubCodeOutput({...file,sources:[{...file.sources[0],url:'https://example.com/fake'}]}));
});
test('code adapter rejects private repositories, path escape, mutable refs and oversized streams',async()=>{
 for(const path of ['../x','src/../x','src\\x','/x','x%2fy','a?b'])assert.throws(()=>validateGitHubCodeInput({repository,operation:'file',revision,path}));
 assert.throws(()=>validateGitHubCodeInput({repository,operation:'file',revision:'main',path:'x'}));
 let calls=0;await assert.rejects(createGitHubCodeAdapter({fetchImpl:async()=>{calls++;return Response.json({private:true,full_name:'owner/project'});}})({request:{repository,operation:'inspect'}}),{code:'AGENT_GITHUB_CODE_PUBLIC_REPOSITORY_REQUIRED'});assert.equal(calls,1);
 let cancelled=false,n=0;
 await assert.rejects(createGitHubCodeAdapter({fetchImpl:async()=>++n===1?Response.json({private:false,full_name:'owner/project'}):new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array(1048577));},cancel(){cancelled=true;}}))})({request:{repository,operation:'inspect'}}),{code:'AGENT_GITHUB_CODE_RESPONSE_TOO_LARGE'});assert.equal(cancelled,true);
});
test('lexical locators expose unread definition positions without treating them as read evidence',async()=>{
 const code=['unique(candidate);',...Array(198).fill('// filler'),'export function unique(selector) {',' return document.querySelectorAll(selector).length === 1;','}'].join('\n');
 const adapter=createGitHubCodeAdapter({fetchImpl:async url=>url.endsWith('/repos/owner/project')?Response.json({private:false,full_name:'owner/project'}):new Response(code)});
 const first=(await adapter({request:{repository,operation:'file',revision,path:'finder.ts',fromLine:1}})).output;
 assert.equal(first.sources[0].toLine,140);assert.deepEqual(first.symbols,[{name:'unique',line:200}]);assert.doesNotMatch(first.sources[0].text,/export function/);
 const later=(await adapter({request:{repository,operation:'file',revision,path:'finder.ts',fromLine:200}})).output;
 assert.equal(later.sources[0].fromLine,200);assert.equal(later.sources[0].toLine,202);assert.match(later.sources[0].text,/querySelectorAll/);
});
test('answer citations must match fetched source lines and README cannot prove a code fact',()=>{
 const claim={kind:'code-fact',text:'它检查选择器命中数量。',references:[{source:1,fromLine:12,toLine:14}]},answer=validateGitHubQuestionAnswer({claims:[claim],limitations:['没有实际运行性能测试。']}),evidence={repository,revision,treeTruncated:false,sources:[{path:'src/index.ts',url:repository+'/blob/'+revision+'/src/index.ts',fromLine:10,toLine:20,truncated:false}]};
 assert.match(renderGitHubQuestionAnswer(answer,evidence),/#L12-L14/);
 assert.throws(()=>renderGitHubQuestionAnswer({...answer,claims:[{...claim,references:[{source:1,fromLine:9,toLine:12}]}]},evidence),{code:'AGENT_GITHUB_QUESTION_CITATION_INVALID'});
 assert.throws(()=>renderGitHubQuestionAnswer(answer,{...evidence,sources:[{...evidence.sources[0],path:'README.md'}]}),{code:'AGENT_GITHUB_QUESTION_CITATION_KIND_INVALID'});
 assert.throws(()=>validateGitHubQuestionPlan({files:Array.from({length:5},(_,i)=>({path:'src/'+i,fromLine:1}))}));
 assert.throws(()=>validateGitHubQuestionAnswer({claims:[{...claim,references:[]}],limitations:[]}));
 assert.match(renderGitHubQuestionAnswer(validateGitHubQuestionAnswer({claims:[],limitations:['没有定位到相关源码。']}),{...evidence,sources:[]}),/没有定位到/);
});
test('question delegation is read-only, freezes current project and does not infer an ambiguous project',async()=>{
 let prior=null,spec;const row={id:'request',origin_json:{channel:'qq'},input_json:{message:'那它怎么保证唯一性？'}},agent={id:'agent'},repo={agent:async()=>agent,principal:async()=>({canInvoke:false}),researchContext:async()=>prior,attachTask:async(_row,value)=>{spec=value;return {id:'task',kind:value.kind,state:'queued'};}};
 const service=createAgentInteractionService({repository:repo,agentId:'10000000-0000-4000-8000-000000000001',readQQPolicy:async()=>({agentId:'10000000-0000-4000-8000-000000000001',enabled:true,allowedUsers:['caller']})});row.origin_json.actorRef='caller';
 const tools=await service.tools(row);
 assert.equal((await tools.execute(null,'github_answer_question',{question:'怎么保证唯一性？'})).error.code,'AGENT_INTERACTION_PROJECT_REQUIRED');
 prior={repositoryUrl:repository,revision,previous:{question:'如何实现？',reply:'先搜索再验证。'}};
 assert.equal((await tools.execute(null,'github_answer_question',{question:'怎么保证唯一性？'})).task.kind,'github-question');assert.equal(spec.revision,revision);assert.equal(spec.previous.reply,'先搜索再验证。');
 await tools.execute(null,'github_answer_question',{question:'另一个项目怎么实现？',repositoryUrl:'https://github.com/other/repo'});assert.equal(spec.revision,null);assert.equal(spec.previous,null);assert.equal(spec.kind,'github-question');
 row.input_json.message='只回答这个问题，不写文章';assert.equal((await tools.execute(null,'github_write_article',{topic:'技术实现'})).error.code,'AGENT_INTERACTION_QUESTION_ONLY');
});
