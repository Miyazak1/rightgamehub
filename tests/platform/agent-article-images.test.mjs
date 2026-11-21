import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {once} from 'node:events';
import {paginateAgentArticle,renderAgentArticlePage} from '../../apps/api/src/agent-article-images.mjs';
import {validateArticleImage} from '../../apps/qq-channel/src/article-image.mjs';
import {QQAgentBridge} from '../../apps/qq-channel/src/agent-bridge.mjs';
import {OneBotGateway} from '../../apps/qq-channel/src/onebot.mjs';
import {parseConfig} from '../../apps/qq-channel/src/config.mjs';
const article={revision_id:randomUUID(),publication_state:'draft',title:'小墨鱼文章分页验收',summary:'正文与参考资料完整保留。',blocks:Array.from({length:35},(_,i)=>({type:'paragraph',text:`段落${i}：`+'源码阅读与引用校验，长文章按页发送。'.repeat(12),citationIds:['source']})),citations:[{id:'source',title:'项目官方资料',url:'https://github.com/owner/project',locator:'固定源码版本'}]};
test('pagination retains all paragraphs and citations, escapes markup and bounds page dimensions',()=>{
 const pages=paginateAgentArticle({...article,title:'<script>&文章'});assert.ok(pages.length>2&&pages.length<=24);
 const all=pages.join('');assert.ok(all.includes('&lt;script&gt;&amp;文章'));assert.ok(!all.includes('<script>'));
 for(let i=0;i<35;i++)assert.ok(all.includes('段落'+i+'：'));
 assert.ok(all.includes('https://github.com/owner/project'));assert.ok(all.includes('[1]'));
 for(const page of pages){assert.match(page,/width="1080" height="1600"/);for(const y of page.matchAll(/ y="(\d+(?:\.\d+)?)"/g))assert.ok(Number(y[1])<=1550);}
 assert.throws(()=>paginateAgentArticle({...article,blocks:[{type:'external-html',text:'unsafe'}]}),{code:'AGENT_ARTICLE_IMAGE_BLOCK_UNSUPPORTED'});
});
test('actual PNG renderer and channel validation preserve hash, page and immutable revision',async()=>{
 const page=await renderAgentArticlePage(article,0);assert.equal(validateArticleImage(page).revisionId,article.revision_id);assert.ok(page.pageCount>2);
 assert.throws(()=>validateArticleImage({...page,sha256:'0'.repeat(64)}),{code:'QQ_AGENT_IMAGE_INVALID'});
 assert.throws(()=>validateArticleImage({...page,page:page.pageCount}));
 await assert.rejects(renderAgentArticlePage(article,24),{code:'AGENT_ARTICLE_IMAGE_PAGE_INVALID'});
});
test('bridge fetches the complete frozen image set before settling and retries mixed revisions',async()=>{
 const page=await renderAgentArticlePage({...article,blocks:[article.blocks[0]]},0),calls=[],finished=[],row={message_id:'42',task_id:randomUUID(),user_id:'100000003',origin_group_id:'100000002'};
 let mixed=false;const repo={agentPending:async()=>row,agentPollLater:async()=>calls.push('later'),agentFinish:async(_c,_r,value)=>finished.push(value)};
 const client=async body=>{calls.push(body);return body.operation==='status'?{kind:'github-article',state:'completed',articleRevisionId:article.revision_id,reply:'已保存草稿'}:{...page,page:body.page,pageCount:2,...(mixed&&body.page===1?{revisionId:randomUUID()}:{})};};
 const bridge=new QQAgentBridge({repository:repo,client}),config={botId:'100000001',groupId:'100000002',allowedUsers:[row.user_id]};
 await bridge.poll(null,config);assert.equal(finished.length,1);assert.equal(finished[0].pages.length,2);
 mixed=true;await bridge.poll(null,config);assert.equal(finished.length,1);assert.ok(calls.includes('later'));
});
test('real OneBot transport uses an image segment without exposing files or URLs',async t=>{
 const {WebSocket}=createRequire(new URL('../../apps/qq-channel/package.json',import.meta.url))('ws');
 const config=parseConfig({enabled:true,botId:'100000001',groupId:'100000002',allowedUsers:['100000003']},{QQ_ACCESS_TOKEN:'test-image-token-'.repeat(3),QQ_DATABASE_URL:'postgresql://127.0.0.1/mooyu_qq_local_image'});
 const gateway=new OneBotGateway(config,{receive:async()=>{}});await gateway.start({port:0});t.after(()=>gateway.stop());
 const socket=new WebSocket('ws://127.0.0.1:'+gateway.server.address().port+'/onebot/v11',{headers:{authorization:'Bearer '+config.accessToken,'x-self-id':config.botId}});await once(socket,'open');t.after(()=>socket.close());
 const png=await renderAgentArticlePage(article,0),observed=once(socket,'message'),send=gateway.send({message_id:'-1',reply_to_message_id:'42',user_id:'100000003',reply:'第1页',image_data:Buffer.from(png.data,'base64')});
 const packet=JSON.parse((await observed)[0]);assert.equal(packet.params.group_id,100000002);assert.deepEqual(packet.params.message.at(-1),{type:'image',data:{file:'base64://'+png.data}});
 socket.send(JSON.stringify({status:'ok',retcode:0,echo:packet.echo,data:{message_id:123}}));assert.equal(await send,'123');
});
