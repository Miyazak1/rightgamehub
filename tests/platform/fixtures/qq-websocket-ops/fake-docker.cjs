// Command double used only inside a network-isolated disposable Linux container.
const fs=require('fs'),crypto=require('crypto'),path=require('path'),root=process.env.WS_OPERATOR_FIXTURE;
if(!root||process.env.WS_OPERATOR_ISOLATED!=='1')process.exit(91);
const a=process.argv.slice(2),file=root+'/docker.json',s=JSON.parse(fs.readFileSync(file)),save=()=>fs.writeFileSync(file,JSON.stringify(s));
fs.appendFileSync(root+'/commands.jsonl',JSON.stringify(a)+'\n');
const by=id=>s.containers.find(c=>[c.Id,c.Name,c.Name.slice(1)].includes(id));
const out=v=>console.log(typeof v==='string'?v:JSON.stringify(v));
const G='mooyu-qq-napcat-1',W='mooyu-qq-worker-1',base='sha256:ac32edd020830d3f9437ef2e46e462b0ee02390a76bd19167848ad0b2a69412d',candidate='sha256:'+'c'.repeat(64);
const patched='0af3b82fcb931bcb1f859f1536f905aaca1964ecff6981a191aab9b4e9a32d3c',original='7967149b1c4f3d30e0506c842f84b7b925c2d361e3c9c75ebf0d4ff24dbdedaa';
const workerSources={'napcat-control.mjs':'4296ce27f472f1da08ae1b8e8d4399da2a1372a2a575d142e6a9693bc09ca166','control-server.mjs':'9f2965af83672215acc79aa40ff1bced2910bbc8839c73f15b1e2c705e5fc247','control-store.mjs':'453080b190e283172c44d42924533627ee11d09d048644bbe2d07db4a0a43586','plugins/qq/runtime.mjs':'634527f5bd330271e88da93ffa12c17839aba90d9e07c8d312efcfb392048a33'};
if(a[0]==='ps')out(s.containers.map(c=>c.Id).join('\n'));
else if(a[0]==='inspect'){const cs=a.slice(1).map(by);if(cs.some(c=>!c))process.exit(2);out(cs);}
else if(a[0]==='image'&&a[1]==='inspect'){const image=s.images[a[2]];if(!image)process.exit(2);out([image]);}
else if(a[0]==='volume'&&a[1]==='inspect')out([{Name:'synthetic_login',Mountpoint:root+'/login'}]);
else if(a[0]==='tag'){s.images[a[2]]=s.images[a[1]];save();}
else if(a[0]==='build'){
 if(s.failAt==='build')process.exit(8);const context=a.at(-1),text=fs.readFileSync(context+'/napcat.mjs');if(crypto.createHash('sha256').update(text).digest('hex')!==patched)process.exit(9);
 const image={...s.images[base],Id:candidate,RootFS:{Layers:[...s.images[base].RootFS.Layers,'sha256:'+'d'.repeat(64)]}};s.images[candidate]=image;s.images[a[a.indexOf('-t')+1]]=image;save();out('build verified');
}
else if(a[0]==='run'){if(a.at(-1).includes('Object.fromEntries'))out(workerSources);else out(a.includes(base)?original:patched);}
else if(a[0]==='cp'&&a[1]==='-a'&&a[2]===G+':/data/.'&&a[3]==='-')process.stdout.write(fs.readFileSync(root+'/login.tar'));
else if(a[0]==='stop'&&[G,W].includes(a.at(-1))){const c=by(a.at(-1));c.State.Running=false;save();out(c.Id);}
else if(a[0]==='start'&&a[1]===W){const c=by(W);c.State.Running=true;c.State.StartedAt=new Date().toISOString();save();out(c.Id);}
else if(a[0]==='exec'){
 const sql=a.at(-1),name=a.find(v=>v==='gamehub-production-postgres-1'||v==='mooyu-qq-postgres-1');
 if(a.includes('psql')){
  if(sql.includes('to_regclass('))out('1');
  else if(sql.startsWith('SELECT count(*) FROM schema_migrations'))out('166');
  else if(sql.includes('pg_database_size'))out('4096');
  else if(sql.startsWith('SELECT count(*)'))out('0');
  else if(sql.includes("'retainedCompleted'"))out(s.outboxProof??{total:139,retainedCompleted:139});
  else if(sql.includes("'protocol'"))out([{enabled:true,next:new Date(Date.now()+86400000).toISOString(),protocol:'1'}]);
  else if(sql.includes('QQ连接修复验收20261127R1'))out(s.newMessage?[{createdAt:new Date().toISOString(),state:'delivered',replyDelivered:true}]:[]);
  else if(sql.includes('md5('))out('unchanged-'+name);
  else process.exit(10);
 }else if(a.includes('pg_dump')){if(s.failAt==='coldBackup')process.exit(8);process.stdout.write(Buffer.alloc(8192,7));}
 else if(a.includes('pg_restore')){process.stdin.resume();}
 else if(a[1]===G&&sql.includes('process.stdout.write'))process.stdout.write(fs.readFileSync('/vendor/napcat.mjs'));
 else if(a[1]===G&&sql.includes('sha256'))out(by(G).Image===base?original:patched);
 else if(a[1]==='gamehub-production-api-1'&&sql.includes('/usr/local/bin/node'))out(crypto.createHash('sha256').update(fs.readFileSync(process.execPath)).digest('hex'));
 else if(a[1]===W&&sql.includes('qqSignature')){const now=new Date().toISOString();out({binding:{botId:'3922489710'},groupId:'905757031',paperEnabled:false,runtime:{snapshotVersion:2,available:true,loggedIn:!s.scanRequired,coreReady:!s.scanRequired,accountMatches:!s.scanRequired,groupReady:!s.scanRequired,connected:!s.scanRequired,ready:!s.scanRequired,observation:'fresh',phase:s.scanRequired?'waiting_qrcode':'ready',qrAvailable:true,restartRequired:false,checkedAt:now,verifiedAt:now}});}
 else process.exit(11);
}
else if(a[0]==='compose'){
 const overlays=a.flatMap((v,i)=>v==='-f'?[a[i+1]]:[]),last=overlays.at(-1),image=last?.endsWith('/gateway.json')?JSON.parse(fs.readFileSync(last)).services.napcat.image:by(G).Image;
 if(a.at(-3)==='config'&&a.at(-2)==='--format')out({services:{napcat:{...s.model,image}},volumes:{login:{name:'synthetic_login'}},networks:{default:{name:'mooyu-qq'}}});
 else if(a.includes('up')&&a.at(-1)==='napcat'&&a.includes('--no-deps')&&a.includes('--no-build')&&a.includes('never')){if(s.failAt==='startGateway')process.exit(8);const c=by(G);c.Id=(image===base?'e':'f').repeat(64);c.Image=image;c.Config.Image=image;c.Config.Labels['com.docker.compose.project.config_files']=overlays.join(',');c.State.Running=true;c.State.StartedAt=new Date().toISOString();save();}
 else process.exit(12);
}else process.exit(13);
