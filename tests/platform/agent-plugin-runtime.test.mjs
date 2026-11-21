import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createAgentBlogPublicRuntime} from '../../apps/api/src/agent-blog-public-runtime.mjs';
import {createAgentBlogPrivateCanaryRuntime} from '../../apps/api/src/agent-blog-private-canary-runtime.mjs';
import {createAgentRuntimeServices} from '../../apps/api/src/agent-runtime-services.mjs';

test('legacy public factory retains scheduler, article and shared ports without opening a connection',async()=>{
 let queries=0,ends=0;const pool={query(){queries++;throw Error('unexpected connection');},end(){ends++;}};
 const env={AGENT_BLOG_PUBLIC_RUNTIME_ENABLED:'true',AGENT_BLOG_PUBLIC_RUNTIME_AGENT_USER_ID:randomUUID(),AGENT_SECRET_ENCRYPTION_KEY:'cd'.repeat(32)};
 const runtime=createAgentBlogPublicRuntime({env,pool});
 assert.equal(typeof runtime.runner.run,'function');assert.equal(typeof runtime.paperArticleRunner.run,'function');
 assert.ok(runtime.paperArticleAcceptance);assert.ok(runtime.interactionPorts.preflightRepository);assert.equal(runtime.pool,pool);
 await runtime.close();assert.equal(queries,0);assert.equal(ends,0);
 assert.throws(()=>createAgentBlogPublicRuntime({env:{...env,AGENT_PLUGINS_DISABLED:'mooyu.github'},pool}),{code:'AGENT_PLUGIN_DISABLED'});
 assert.equal(queries,0);
});

test('private compatibility factory constructs original runners with plugin-provided GitHub tools',async()=>{
 const pool={query(){throw Error('unexpected connection');}};
 const env={AGENT_BLOG_PRIVATE_CANARY_ENABLED:'true',AGENT_BLOG_PRIVATE_CANARY_AGENT_USER_ID:randomUUID(),AGENT_SECRET_ENCRYPTION_KEY:'cd'.repeat(32)};
 const runtime=createAgentBlogPrivateCanaryRuntime({env,pool});
 assert.equal(typeof runtime.supervisor.run,'function');await runtime.close();
 const disabled=createAgentBlogPrivateCanaryRuntime({env:{...env,AGENT_PLUGINS_DISABLED:'mooyu.github'},pool});
 await assert.rejects(disabled.supervisor.run({requestId:randomUUID()}),{code:'AGENT_PLUGIN_DISABLED'});await disabled.close();
});

test('neutral kernel never lets plugin configuration replace host repositories or policy',async()=>{
 const pool={query(){throw Error('unexpected connection');}},injected={bad:true};
 const core=createAgentRuntimeServices({env:{AGENT_SECRET_ENCRYPTION_KEY:'cd'.repeat(32)},pool,toolConfiguration:{runtimeRepository:injected,policyService:injected}});
 assert.notEqual(core.runtimeRepository,injected);assert.notEqual(core.policyService,injected);assert.equal(core.pool,pool);await core.close();
});
