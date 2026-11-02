import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {sha256File} from './lib/desktop-runtime.mjs';
import {validateDesktopDownloadManifest} from '../packages/platform-client/src/desktop-download.mjs';

// Own disposable LOCAL Docker Desktop container only. Never contacts production.
const root=fileURLToPath(new URL('../',import.meta.url));
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){if(!['--web','--data','--playwright','--chromium'].includes(args[i])||!args[i+1])throw Error('VERIFY_ARGUMENT_INVALID');options[args[i].slice(2)]=path.resolve(args[i+1]);}
if(!options.web)throw Error('VERIFY_REQUIRES_CLEAN_WEB_DIST');
const data=options.data??path.join(root,'.runtime/desktop-downloads/data');
const out=path.join(root,'.runtime/desktop-downloads/verification-'+Date.now());await fs.mkdir(out,{recursive:true});
const docker=(...args)=>execFileSync('docker',['--context','desktop-linux',...args],{encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:2**20}).trim();
const endpoint=JSON.parse(docker('context','inspect','desktop-linux'))[0].Endpoints.docker.Host;
assert.equal(endpoint,'npipe:////./pipe/dockerDesktopLinuxEngine','Refuse non-local Docker endpoint');
const image=docker('image','inspect','gamehub-production-web:latest','--format','{{.Id}}');
const manifest=validateDesktopDownloadManifest(JSON.parse(await fs.readFile(path.join(data,'manifest.json'),'utf8'))),release=manifest.windowsX64;
const source=await fs.readFile(path.join(root,'deploy/Caddyfile'),'utf8');
const block=source.match(/  # mooyu-desktop-downloads begin[\s\S]*?  # mooyu-desktop-downloads end/)?.[0];assert.ok(block);
const config=`{\n admin off\n auto_https off\n}\n:8080 {\n${block}\n handle /v1/* {\n respond \`{"error":{"code":"AUTH_REQUIRED"}}\` 401\n }\n handle /downloads/manifest.json {\n header Content-Type application/json\n respond \`{"agent":"unchanged"}\`\n }\n handle {\n root * /site\n try_files {path} /index.html\n file_server\n }\n}\n`;
await fs.writeFile(path.join(out,'Caddyfile'),config+'\n:8081 {\n'+block.replace('/srv/desktop-downloads','/srv/unmounted-desktop-downloads')+'\n handle {\n respond \"SPA fallback must not serve downloads\" 200\n }\n}\n');
const label='mooyu.desktop.download-verification',owner=crypto.randomUUID(),name='mooyu-download-check-'+owner;
const report={passed:false,productionConnected:false,uploaded:false,deployed:false,version:release.version};let container;
const checked=async(url,init)=>{const response=await fetch(url,init);return response;};
try{
  docker('run','--rm','--network','none','--mount',`type=bind,source=${path.join(root,'deploy/Caddyfile')},target=/tmp/production.Caddyfile,readonly`,'-e','APP_DOMAIN=main.example.test','-e','RUNTIME_DOMAIN=runtime.example.test','-e','ACME_EMAIL=test@example.test','-e','ALIYUN_ACCESS_KEY_ID=dummy','-e','ALIYUN_ACCESS_KEY_SECRET=dummy',image,'caddy','validate','--config','/tmp/production.Caddyfile','--adapter','caddyfile');
  report.productionConfigValid=true;
  const network='mooyu-download-net-'+owner;docker('network','create','--opt','com.docker.network.bridge.enable_ip_masquerade=false','--label',`${label}=${owner}`,network);report.network=network;
  container=docker('run','-d','--name',name,'--label',`${label}=${owner}`,'--network',network,'-p','127.0.0.1::8080','-p','127.0.0.1::8081','--mount',`type=bind,source=${out},target=/config,readonly`,'--mount',`type=bind,source=${data},target=/srv/desktop-downloads,readonly`,'--mount',`type=bind,source=${options.web},target=/site,readonly`,image,'caddy','run','--config','/config/Caddyfile','--adapter','caddyfile');
  const inspected=JSON.parse(docker('inspect',container))[0];
  let port=inspected.NetworkSettings.Ports?.['8080/tcp']?.[0]?.HostPort;
  if(!port)throw Error('LOCAL_PORT_UNAVAILABLE: '+docker('logs',container));
  const base='http://127.0.0.1:'+port;report.localOrigin=base;
  let ready=false;for(let i=0;i<40;i++){try{if((await fetch(base+'/download')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,150));}assert.ok(ready,'Caddy startup');
  const latest=await checked(base+'/downloads/desktop/manifest.json');assert.equal(latest.status,200);assert.match(latest.headers.get('cache-control'),/no-store/);assert.deepEqual(await latest.json(),manifest);
  const signedFeed=path.join(data,'updates/preview.json');
  if(await fs.access(signedFeed).then(()=>true,()=>false)){
    const response=await checked(base+'/downloads/desktop/updates/preview.json');assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/application\/json/);assert.match(response.headers.get('cache-control'),/no-store/);assert.deepEqual(await response.json(),JSON.parse(await fs.readFile(signedFeed,'utf8')));report.signedUpdateFeedServed=true;
  }
  const url=base+release.url,head=await checked(url,{method:'HEAD'});assert.equal(head.status,200);assert.equal(Number(head.headers.get('content-length')),release.sizeBytes);assert.equal(head.headers.get('accept-ranges'),'bytes');assert.match(head.headers.get('content-disposition'),/attachment/);assert.equal(head.headers.get('x-content-type-options'),'nosniff');assert.match(head.headers.get('cache-control'),/immutable/);
  const hash=crypto.createHash('sha256'),full=await checked(url);assert.equal(full.status,200);let size=0;for await(const chunk of full.body){hash.update(chunk);size+=chunk.length;}assert.equal(size,release.sizeBytes);assert.equal(hash.digest('hex'),release.sha256);report.fullDownloadHashPassed=true;
  const resumed=crypto.createHash('sha256'),split=1048576;for(const [start,end] of [[0,split-1],[split,release.sizeBytes-1]]){const response=await checked(url,{headers:{Range:`bytes=${start}-${end}`}});assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),`bytes ${start}-${end}/${release.sizeBytes}`);for await(const chunk of response.body)resumed.update(chunk);}assert.equal(resumed.digest('hex'),release.sha256);report.resumeHashPassed=true;
  const invalidRange=await checked(url,{headers:{Range:`bytes=${release.sizeBytes}-`}});assert.equal(invalidRange.status,416);assert.doesNotMatch(invalidRange.headers.get('cache-control')??'',/immutable/);await invalidRange.arrayBuffer();
  for(const suffix of ['', '/', '/missing.exe','/missing/manifest.json','/0.2.0-preview.999/MooyuWorkshop-0.2.0-preview.999-x64-Setup.exe','/.prepare.lock','/report.json']){const response=await checked(base+'/downloads/desktop'+suffix);assert.equal(response.status,404,suffix);assert.doesNotMatch(response.headers.get('cache-control')??'',/immutable/);assert.doesNotMatch(await response.text(),/<html|root|<script/i);}
  assert.equal((await checked(url,{method:'POST'})).status,405);
  assert.deepEqual(await(await checked(base+'/downloads/manifest.json')).json(),{agent:'unchanged'});
  const sums=await(await checked(base+release.checksumUrl)).text();assert.equal(sums,`${release.sha256}  ${release.filename}\n`);
  const emptyPort=inspected.NetworkSettings.Ports['8081/tcp'][0].HostPort;for(const suffix of ['/manifest.json',release.url.slice('/downloads/desktop'.length)]){const missing=await fetch('http://127.0.0.1:'+emptyPort+'/downloads/desktop'+suffix);assert.equal(missing.status,404);assert.doesNotMatch(await missing.text(),/SPA fallback/);}report.unmounted404Passed=true;
  report.true404Passed=true;report.range416Passed=true;report.agentNamespacePreserved=true;
  if(options.playwright){
    const require=createRequire(import.meta.url),{chromium}=require(options.playwright);const browser=await chromium.launch({headless:true,executablePath:options.chromium});
    try{
      const page=await browser.newPage({viewport:{width:1360,height:1000}});const blocked=[];
      await page.route('**/*',route=>{if(new URL(route.request().url()).origin===base)return route.continue();blocked.push(route.request().url());return route.abort();});
      const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
      let releaseManifest;const pending=new Promise(resolve=>{releaseManifest=resolve;});await page.route('**/downloads/desktop/manifest.json',async route=>{await pending;await route.continue();});
      await page.goto(base+'/download?lang=zh-CN');await page.getByRole('status').filter({hasText:'正在读取版本信息'}).waitFor();assert.equal(await page.locator('.desktop-download-card button').isDisabled(),true);releaseManifest();await page.unroute('**/downloads/desktop/manifest.json');await page.locator('.desktop-download-cta').waitFor();assert.equal(await page.locator('.desktop-download-cta').getAttribute('href'),release.url);assert.equal(await page.locator('.desktop-download-cta').getAttribute('download'),release.filename);
      const [download]=await Promise.all([page.waitForEvent('download'),page.locator('.desktop-download-cta').click()]);assert.equal(download.suggestedFilename(),release.filename);const browserFile=path.join(out,release.filename);await download.saveAs(browserFile);assert.equal(await download.failure(),null);assert.equal(await sha256File(browserFile),release.sha256);await fs.unlink(browserFile);report.browserDownloadHashPassed=true;
      await page.screenshot({path:path.join(out,'desktop.png'),fullPage:true});
      for(const width of [960,390]){await page.setViewportSize({width,height:900});await page.screenshot({path:path.join(out,`width-${width}.png`),fullPage:true});const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false,'horizontal overflow at '+width);const bounds=await page.evaluate(()=>{const brand=document.querySelector('.brand-button').getBoundingClientRect(),tools=document.querySelector('.header__tools').getBoundingClientRect();return {overlap:brand.right>tools.left,left:tools.left,right:tools.right};});assert.equal(bounds.overlap,false,'header overlap at '+width);assert.ok(bounds.left>=0&&bounds.right<=width,'header clipped');}
      await page.setViewportSize({width:1360,height:1000});
      await page.locator('.desktop-download-agent button').click();await page.locator('.install-desktop-link button').click();await page.locator('.desktop-download-cta').waitFor();assert.ok(await page.locator('.desktop-download-footer a[href="/download"]').isVisible());
      for(let i=0;i<3;i++){await page.locator('button[title="切换主题"]').click();await page.screenshot({path:path.join(out,`theme-${i}.png`),fullPage:true});}
      await page.goto(base+'/download?lang=en');await page.getByRole('heading',{name:'MOOYU.FUN for Windows',exact:true}).waitFor();await page.screenshot({path:path.join(out,'english.png'),fullPage:true});
      await page.route('**/downloads/desktop/manifest.json',route=>route.fulfill({status:404,body:'Not found'}));await page.reload();await page.getByRole('heading',{name:'Download unavailable',exact:true}).waitFor();assert.equal(await page.locator('.desktop-download-cta').count(),0);
      await page.unroute('**/downloads/desktop/manifest.json');await page.getByRole('button',{name:'Try again',exact:true}).click();await page.locator('.desktop-download-cta').waitFor();
      await page.route('**/downloads/desktop/manifest.json',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({...manifest,windowsX64:{...release,url:'https://outside.invalid/file.exe'}})}));await page.reload();await page.getByRole('heading',{name:'Download unavailable',exact:true}).waitFor();assert.equal(await page.locator('.desktop-download-cta').count(),0);
      assert.deepEqual(blocked,[],'No external or production requests allowed');assert.deepEqual(pageErrors,[]);report.browserPassed=true;
    }finally{await browser.close();}
  }
  report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{
  if(container){assert.equal(docker('inspect',container,'--format',`{{index .Config.Labels "${label}"}}`),owner);docker('rm','-f','-v',container);}
  if(report.network){assert.equal(docker('network','inspect',report.network,'--format',`{{index .Labels "${label}"}}`),owner);docker('network','rm',report.network);}
  await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,directory:out},null,2));
}
