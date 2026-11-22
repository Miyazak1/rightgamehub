// Browser checks the actual image-served production bundle; API responses are fixtures.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const release=path.resolve(process.argv[2]??''),manifest=JSON.parse(fs.readFileSync(path.join(release,'release-manifest.json'),'utf8')),out=path.join(release,'verification'),id=crypto.randomUUID().replaceAll('-',''),name='mooyu-unified-web-'+id;
const docker=(args)=>{const r=cp.spawnSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:6000000});if(r.status!==0){fs.writeFileSync(path.join(out,'web-last-command-error.txt'),r.stderr??'');throw Error('WEB_IMAGE_COMMAND_FAILED');}return r.stdout.trim();};
const inventory=image=>new Map(docker(['run','--rm','--network','none','--read-only','--entrypoint','sh',image,'-c','find /srv/gamehub -type f -exec sha256sum {} +']).split('\n').map(line=>[line.slice(66),line.slice(0,64)]));
async function main(){let started=false,browser;
 try{
  fs.mkdirSync(out,{recursive:true});
  const previous=inventory(manifest.images.web.baseImageId),current=inventory(manifest.images.web.id);
  const changed=[...previous].filter(([file,sha])=>file!=='/srv/gamehub/index.html'&&current.get(file)!==sha).map(([file,sha])=>({file,previous:sha,current:current.get(file)??null}));
  fs.writeFileSync(path.join(out,'static-resource-comparison.json'),JSON.stringify({changed},null,2));const preserved=changed.length===0;assert(preserved,'old downloads/courseware/assets changed');
  const caddy=path.join(out,'web-test.Caddyfile');fs.writeFileSync(caddy,':8080 {\n root * /srv/gamehub\n try_files {path} /index.html\n file_server\n}\n');
  docker(['run','-d','--name',name,'--label','mooyu.unified.webtest='+id,'--publish','127.0.0.1::8080','--read-only','--tmpfs','/config','--tmpfs','/data','--cap-drop','ALL','--cap-add','NET_BIND_SERVICE','--mount',`type=bind,source=${caddy},target=/acceptance/Caddyfile,readonly`,'--entrypoint','caddy',manifest.images.web.id,'run','--config','/acceptance/Caddyfile']);started=true;
  const port=docker(['port',name,'8080/tcp']).match(/127\.0\.0\.1:(\d+)/)[1],url='http://127.0.0.1:'+port;
  const {chromium}=require(process.env.GAMEHUB_COMMUNITY_PLAYWRIGHT_PATH);browser=await chromium.launch({headless:true,channel:process.env.GAMEHUB_BROWSER_CHANNEL??'chrome'});const page=await browser.newPage({viewport:{width:1200,height:1000}}),errors=[],assets=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(new URL(r.url()).pathname.startsWith('/assets/'))assets.push({url:new URL(r.url()).pathname,status:r.status()});});
  const agent='11111111-1111-4111-8111-111111111111',operator='22222222-2222-4222-8222-222222222222';
  const profile={id:operator,displayName:'本地发布验收',role:'admin',accountType:'human',canPublish:true,createdAt:'2026-01-01T00:00:00Z',avatar:{kind:'preset',presetKey:'xiaomoyu'}};
  const plugins={checkedAt:new Date().toISOString(),paperEnabled:false,plugins:[{id:'mooyu.github',name:'GitHub 项目研究',kind:'capability',version:'1.0.0',enabled:true,state:'assembled',admission:{state:'ready'},grants:[],recentFaults:[]},{id:'mooyu.qq',name:'QQ 沟通渠道',kind:'channel',version:'1.0.0',enabled:true,state:'running',responseEnabled:true,connection:{loggedIn:true,connected:true,accountMatches:true}}]};
  await page.route('**/v1/**',route=>{const p=new URL(route.request().url()).pathname;let data,status=200;
   if(p==='/v1/auth/session')data={authenticated:true,profile};
   else if(p==='/v1/me')data=profile;
   else if(p==='/v1/admin/agents')data=[{agentUserId:agent,displayName:'小墨鱼',handle:'mooyu-release-test',status:'active',accountType:'agent',agentDisclosure:{operatorLabel:'独立本地验收',badgeLabel:'AI 助手'},providerKey:{configured:false},automation:{enabled:false},capabilities:['blog:auto-publish']}];
   else if(p.endsWith('/plugins'))data=plugins;
   else if(p.endsWith('/channel-participants'))data=[];
   else if(p.endsWith('/qq'))data={revision:1,loginRevision:1,settings:{enabled:true,groupId:'200000001',allowedUsers:['300000001'],dailyCalls:20,dailyTokens:100000,userDailyCalls:10,userMinuteMessages:3,groupMinuteMessages:10},runtime:{available:true,loggedIn:true,coreReady:true,accountMatches:true,groupReady:true,connected:true,phase:'ready'},binding:{executionMode:'agent'},status:{budget:{calls:0,tokens:0},review:[]},audit:[]};
   else if(p.endsWith('/blog-publication-cutover-preflight'))data={owner:{activePublisher:'foundation',generation:2},blockers:[]};
   else if(p.endsWith('/runtime-runs'))data=[];
   else if(p.endsWith('/runtime-overview'))data={acceptance:{readyForShadowScheduleReview:true,consecutivePasses:3,requiredConsecutivePasses:3},schedule:{enabled:false},publicOperations:{manualRun:{ready:false,blockers:[]},requestNow:{ready:false,blockers:[]},activation:{ready:false},scheduler:{configured:true,workerLive:true,workerState:'idle',timezone:'Asia/Shanghai',localTime:'10:00',blockers:[]},limits:{monthlyProviderCalls:56,monthlyCostMicrousd:8000000,dailyPublicationRuns:1},observed:{providerCallsMonth:0,costMicrousdMonth:0,publicationRunsToday:0}}};
   else{status=503;}
   return route.fulfill({status,contentType:'application/json',body:JSON.stringify(status===200?{data}:{error:{code:'LOCAL_FIXTURE_NOT_CONFIGURED',message:'此项未加入发布夹具'}})});
  });
  await page.goto(url+'/admin?panel=agents');await page.getByRole('heading',{name:'插件管理',exact:true}).waitFor({timeout:30000});
  const panel=page.getByRole('region',{name:'插件管理',exact:true});await panel.getByText('已登录并连接',{exact:true}).waitFor();assert.equal(await panel.getByText('mooyu.github · v1.0.0',{exact:true}).count(),1);
  await panel.screenshot({path:path.join(out,'image-admin-desktop.png')});await page.setViewportSize({width:390,height:1000});assert(await panel.evaluate(el=>el.getBoundingClientRect().width<=innerWidth));await panel.screenshot({path:path.join(out,'image-admin-mobile.png')});assert.deepEqual(errors,[]);assert(assets.length&&assets.every(a=>a.status===200));
  const result={result:'PASSED',sourceCommit:manifest.sourceCommit,productionBundleServedFromImage:true,apiResponses:'synthetic scoped admin fixtures',pluginAdminRendered:true,mobileLayout:true,oldStaticFilesPreserved:preserved,oldStaticFileCount:previous.size,newStaticFileCount:current.size,assetResponses:assets,pageErrors:errors,productionChanged:false,paperEnabled:false};fs.writeFileSync(path.join(out,'web-image-acceptance.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await browser?.close();if(started){const c=JSON.parse(docker(['inspect',name]))[0];if(c.Config.Labels['mooyu.unified.webtest']!==id)throw Error('WEB_TEST_CLEANUP_IDENTITY');docker(['rm','--force',name]);}}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
