const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const moduleUrl=name=>pathToFileURL(path.resolve(__dirname,'../../apps/api/src',name));

test('community project routes expose browse, create, apply, decide and leave without changing post routes',async t=>{
  const {createApp}=await import(moduleUrl('app.mjs'));
  const {AuthError}=await import(moduleUrl('auth-service.mjs'));
  const projectId=crypto.randomUUID(),roleId=crypto.randomUUID(),applicationId=crypto.randomUUID(),calls=[];
  const projects={
    list:async(actor,query)=>{calls.push(['list',actor,query]);return [{id:projectId,title:'移动端适配'}];},
    create:async(actor,body)=>{calls.push(['create',actor,body]);return {id:projectId,version:1,...body};},
    get:async(actor,id)=>{calls.push(['get',actor,id]);return {id,version:2,title:'移动端适配'};},
    update:async(actor,id,body)=>{calls.push(['update',actor,id,body]);return {id,version:body.expectedVersion+1};},
    apply:async(actor,id,body)=>{calls.push(['apply',actor,id,body]);return {id:applicationId,state:'pending'};},
    decide:async(actor,id,aid,body)=>{calls.push(['decide',actor,id,aid,body]);return {id:aid,state:'approved'};},
    leave:async(actor,id)=>{calls.push(['leave',actor,id]);return {left:true};},
  };
  const service={config:{enabled:true,imagesEnabled:false},projects};
  const app=createApp({config:{requestBodyLimit:65536,community:{enabled:true}},database:{ping:async()=>true},migrations:{status:async()=>({ready:true})},communityService:service,communityMediaService:{},authService:{authenticateBearer:async authorization=>{if(!authorization)throw new AuthError('AUTH_REQUIRED',401,'Authentication required.');return {userId:crypto.randomUUID()};}}});
  t.after(()=>app.close());

  const listed=await app.inject({method:'GET',url:'/v1/community/projects'});
  assert.equal(listed.statusCode,200);assert.equal(listed.json().data[0].id,projectId);assert.equal(calls[0][1],undefined);
  const created=await app.inject({method:'POST',url:'/v1/community/projects',headers:{authorization:'Bearer token'},payload:{title:'移动端适配',summary:'让手机玩家可以顺利开始游戏',description:'补齐触控提示、响应式排版以及真实设备验证记录。',roles:[{name:'前端协作者',capacity:2,requiredSkills:['CSS']}]}});
  assert.equal(created.statusCode,200);assert.equal(created.headers.etag,'"1"');
  const applied=await app.inject({method:'POST',url:`/v1/community/projects/${projectId}/applications`,headers:{authorization:'Bearer token'},payload:{roleId,message:'我可以处理响应式样式并补充验证记录。'}});
  assert.equal(applied.statusCode,200);assert.equal(applied.json().data.state,'pending');
  const decided=await app.inject({method:'POST',url:`/v1/community/projects/${projectId}/applications/${applicationId}/decision`,headers:{authorization:'Bearer token'},payload:{decision:'approve',expectedVersion:1}});
  assert.equal(decided.statusCode,200);assert.equal(decided.json().data.state,'approved');
  const left=await app.inject({method:'POST',url:`/v1/community/projects/${projectId}/leave`,headers:{authorization:'Bearer token'}});
  assert.equal(left.statusCode,200);assert.equal(left.json().data.left,true);
  assert.deepEqual(calls.map(call=>call[0]),['list','create','apply','decide','leave']);
});

test('community project migration keeps projects, applications and task links as constrained domains',async()=>{
  const fs=require('node:fs/promises');
  const sql=await fs.readFile('apps/api/migrations/0058_community_projects.sql','utf8');
  assert.match(sql,/CREATE TABLE community_projects/);
  assert.match(sql,/CREATE TABLE community_project_roles/);
  assert.match(sql,/CREATE TABLE community_project_members/);
  assert.match(sql,/CREATE TABLE community_project_applications/);
  assert.match(sql,/CREATE TABLE community_project_posts/);
  assert.match(sql,/ALTER TABLE contribution_tasks ADD COLUMN project_id/);
  assert.match(sql,/validate_contribution_project_work/);
  assert.match(sql,/community project events are append-only/);
});

test('community project queries place viewer ownership inside the SELECT list',async()=>{
  const {CommunityProjectService}=await import(moduleUrl('community-project-service.mjs'));
  let query='';
  const service=new CommunityProjectService({pool:{query:async sql=>{query=sql;return {rows:[]};}}});
  assert.deepEqual(await service.list(undefined,{}),[]);
  assert.match(query,/\(p\.owner_id=\$1\) AS is_owner,[\s\S]+FROM community_projects p/);
  assert.doesNotMatch(query,/FROM community_projects[\s\S]+,\(p\.owner_id=\$1\) AS is_owner/);
});

test('community posts can carry a governed project update context',async()=>{
  const fs=require('node:fs/promises');
  const [service,routes]=await Promise.all([fs.readFile('apps/api/src/community-service.mjs','utf8'),fs.readFile('apps/api/src/community-routes.mjs','utf8')]);
  assert.match(routes,/projectId:\{type:\['string','null'\],format:'uuid'\}/);
  assert.match(service,/community_project_posts\(project_id,post_id,relation_kind\)/);
  assert.match(service,/只能关联你正在参与的公开项目/);
  assert.match(service,/project:row\.project_id\?/);
});
