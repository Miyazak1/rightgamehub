import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {expectedImages,checkArchiveTags} from './stage-agent-release.mjs';
const [delivery,proofDir,out]=process.argv.slice(2).map(v=>path.resolve(v));
const hashFile=async f=>{const h=crypto.createHash('sha256');for await(const b of fs.createReadStream(f))h.update(b);return h.digest('hex');};
function command(exe,args){const r=spawnSync(exe,args,{encoding:'utf8',maxBuffer:8*1024*1024});if(r.status!==0)throw Error('COMMAND_FAILED_'+exe);return r.stdout;}
// Validate every existing delivery entry without copying the 556 MB archive.
let checked=0;for(const line of fs.readFileSync(path.join(delivery,'SHA256SUMS'),'utf8').trim().split(/\r?\n/)){
 const m=line.match(/^([a-f0-9]{64})  ([A-Za-z0-9_./-]+)$/);if(!m||m[2].split('/').includes('..')||await hashFile(path.join(delivery,m[2]))!==m[1])throw Error('DELIVERY_CHECKSUM_FAILED');checked++;
}
const images=path.join(delivery,'images.tar'),release=JSON.parse(fs.readFileSync(path.join(delivery,'release-manifest.json'),'utf8'));
checkArchiveTags(JSON.parse(command('tar',['-xOf',images,'index.json'])),JSON.parse(command('tar',['-xOf',images,'manifest.json'])),expectedImages(release));
const proof=path.join(proofDir,'scheduler-original-image.acceptance.json');
if(await hashFile(proof)!=='3899c04f1ab05e3e839924ae50b7d9165447100792e9a115c7030b41ba69abdb')throw Error('PROOF_CHANGED');
fs.mkdirSync(out);const content=path.join(out,'content');fs.mkdirSync(content);
const copy=(source,name=path.basename(source))=>fs.copyFileSync(source,path.join(content,name),fs.constants.COPYFILE_EXCL);
for(const f of ['stage-agent-release.mjs','agent-server-cutover.mjs'])copy(path.resolve('scripts',f));
copy(path.join(delivery,'release-manifest.json'));copy(proof);
copy(path.resolve('deploy/agent-plugins/server-cutover-spec.example.json'),'server-cutover-spec.draft.json');
copy(path.resolve('docs/agent-server-remaining-blockers-20261122.zh-CN.md'),'remaining-blockers.zh-CN.md');
copy(path.resolve('docs/agent-server-cutover-tools-20261122.zh-CN.md'),'cutover-tools.zh-CN.md');
const spec=JSON.parse(fs.readFileSync(path.join(content,'server-cutover-spec.draft.json'),'utf8'));
const scheduler=spec.roles.find(r=>r.role==='scheduler');scheduler.schema166Compatible=true;scheduler.schema166CompatibilityEvidence='/www/backup/gamehub/agent-plugins-stage-20261122-r3/scheduler-original-image.acceptance.json';
fs.writeFileSync(path.join(content,'server-cutover-spec.draft.json'),JSON.stringify(spec,null,2)+'\n');
fs.writeFileSync(path.join(content,'STAGING-ONLY.zh-CN.txt'),'仅准备发布文件与镜像，不是切换授权。\n先校验工具归档，再校验 images.tar 与清单，再检查标签冲突及磁盘，最后只执行 docker image load。\n不运行 cutover prepare/backup/close-paper/upgrade/rollback，不执行 Compose，不迁移数据库，不改旧文件或登录卷。\n所有执行入口完整审核及旧QQ参与者采用审核仍关闭，不允许直接修改开关跳过门禁。\n原调度镜像本体166验收已通过，证明仅用于镜像兼容性。\n生产论文worker与另一测试项目论文worker仍需按归属准备持久关闭；本步不会关闭它们。\n现有定时备份、计划、权限、预算、登录数据和历史保持原样。\n');
const files=[];for(const name of fs.readdirSync(content).sort())files.push({name,sha256:await hashFile(path.join(content,name))});
files.push({name:'images.tar',sha256:await hashFile(images)});
fs.writeFileSync(path.join(content,'staging-artifacts.json'),JSON.stringify({scope:'staging-only',files},null,2)+'\n');
const archive=path.join(out,'agent-staging-tools-r3.tar');command('tar',['-cf',archive,'-C',content,...fs.readdirSync(content).sort()]);
const digest=await hashFile(archive);fs.writeFileSync(archive+'.sha256',digest+'  '+path.basename(archive)+'\n');
const server='/www/backup/gamehub/agent-plugins-stage-20261122-r3';
const shell=`#!/usr/bin/env bash\n# Run only AFTER uploading images.tar and agent-staging-tools-r3.tar.\n(\nset -euo pipefail\numask 077\ncd '${server}'\nprintf '%s  %s\\n' '${digest}' 'agent-staging-tools-r3.tar' | sha256sum --check -\ntest ! -e node\ntest ! -e stage-agent-release.mjs\ntar --no-same-owner --no-same-permissions -xf agent-staging-tools-r3.tar\nchmod 600 -- *.json *.mjs *.md *.txt\ndocker cp gamehub-production-api-1:/usr/local/bin/node ./node\nchmod 700 ./node\ncase \"$(./node --version)\" in v22.*) ;; *) echo NODE22_REQUIRED; exit 2 ;; esac\nnice -n 10 ./node stage-agent-release.mjs '${server}'\n)\n`;
fs.writeFileSync(path.join(out,'server-stage-command.txt'),shell);
fs.writeFileSync(path.join(out,'local-validation.json'),JSON.stringify({deliveryFilesVerified:checked,archiveImageDeclarations:7,toolsArchiveSha256:digest,imagesArchiveSha256:files.at(-1).sha256,proofSha256:await hashFile(proof),productionChanged:false},null,2)+'\n');
console.log(JSON.stringify({out,deliveryFilesVerified:checked,toolsArchiveSha256:digest,toolsArchiveBytes:fs.statSync(archive).size},null,2));
