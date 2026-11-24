// Staging only: verifies local files, loads images, never starts containers.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const fail=message=>{throw Error(message);};
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
export function expectedImages(release){
 const entries=[...Object.values(release.images),...Object.values(release.rollbackImages),release.originalApiRetained];
 if(entries.length!==7||release.paperEnabled!==false)fail('RELEASE_SCOPE_INVALID');
 const out=new Map();for(const e of entries){if(!/^sha256:[a-f0-9]{64}$/.test(e.id)||!/^mooyu-[a-z0-9-]+:[a-zA-Z0-9_.-]+$/.test(e.tag)||out.has(e.tag))fail('IMAGE_DECLARATION_INVALID');out.set(e.tag,e.id);}return out;
}
export function checkArchiveTags(index,legacy,expected){
 const actual=new Map();for(const d of index.manifests??[]){const name=d.annotations?.['io.containerd.image.name'];if(!name?.startsWith('docker.io/library/'))fail('ARCHIVE_IMAGE_NAME_INVALID');const tag=name.slice('docker.io/library/'.length);if(actual.has(tag)||expected.get(tag)!==d.digest)fail('ARCHIVE_TAG_OR_DIGEST_MISMATCH');actual.set(tag,d.digest);}
 const tags=legacy.flatMap(e=>e.RepoTags??[]);if(actual.size!==expected.size||tags.length!==expected.size||new Set(tags).size!==expected.size||tags.some(t=>!expected.has(t)))fail('ARCHIVE_IMAGE_SET_MISMATCH');
}
export function snapshot(containers){return containers.map(c=>({name:c.Name,id:c.Id,image:c.Image,running:c.State.Running,startedAt:c.State.StartedAt,restartCount:c.RestartCount,
 configurationSha256:sha(JSON.stringify([c.Config,c.HostConfig,c.Mounts,Object.entries(c.NetworkSettings.Networks??{}).map(([n,v])=>[n,v.Aliases]).sort()]))})).sort((a,b)=>a.id.localeCompare(b.id));}
export function assertUnchanged(before,after){if(JSON.stringify(before)!==JSON.stringify(after))fail('EXISTING_CONTAINER_CHANGED_REVIEW_REQUIRED');}
function run(command,args){const r=spawnSync(command,args,{encoding:'utf8',maxBuffer:16*1024*1024});if(r.error||r.status!==0)fail('COMMAND_FAILED_'+command);return r.stdout.trim();}
async function fileSha(file){const h=crypto.createHash('sha256');for await(const b of fs.createReadStream(file))h.update(b);return h.digest('hex');}
function writeNew(file,value){fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});}
export async function stage(root){
 root=fs.realpathSync(root);if(!root.startsWith('/www/backup/gamehub/agent-plugins-stage-'))fail('PRIVATE_STAGING_PATH_REQUIRED');
 if(fs.existsSync(path.join(root,'staging-result.json'))||fs.existsSync(path.join(root,'staging-before.json')))fail('NEW_STAGING_ATTEMPT_REQUIRED');
 const artifacts=JSON.parse(fs.readFileSync(path.join(root,'staging-artifacts.json'),'utf8'));
 for(const f of artifacts.files){if(!/^[A-Za-z0-9_.-]+$/.test(f.name)||!f.sha256?.match(/^[a-f0-9]{64}$/)||await fileSha(path.join(root,f.name))!==f.sha256)fail('ARTIFACT_CHECKSUM_FAILED');}
 const release=JSON.parse(fs.readFileSync(path.join(root,'release-manifest.json'),'utf8')),expected=expectedImages(release);
 const archive=path.join(root,'images.tar');
 checkArchiveTags(JSON.parse(run('tar',['-xOf',archive,'index.json'])),JSON.parse(run('tar',['-xOf',archive,'manifest.json'])),expected);
 const proof=JSON.parse(fs.readFileSync(path.join(root,'scheduler-original-image.acceptance.json'),'utf8'));
 if(proof.result!=='PASSED'||proof.scope!=='original-image'||proof.testedSchema!==166||!proof.productionImageEligible||!proof.schedulerRestartPreservedPlans||!proof.noApplicationSourceMounts)fail('ORIGINAL_SCHEDULER_PROOF_INVALID');
 const beforeIds=run('docker',['ps','-aq']).split(/\s+/).filter(Boolean);if(!beforeIds.length)fail('EXISTING_CONTAINERS_REQUIRED');
 const inspect=ids=>JSON.parse(run('docker',['inspect',...ids]));const containers=inspect(beforeIds);
 const scheduler=containers.find(c=>c.Name==='/gamehub-production-agent-blog-public-scheduler-1');if(scheduler?.Image!==proof.imageId)fail('ORIGINAL_SCHEDULER_CHANGED');
 // Inspect all existing image tags first; never move an existing conflicting tag.
 const imageIds=[...new Set(run('docker',['image','ls','-aq','--no-trunc']).split(/\s+/).filter(Boolean))];
 const cached=imageIds.length?JSON.parse(run('docker',['image','inspect',...imageIds])):[];
 for(const c of cached)for(const tag of c.RepoTags??[])if(expected.has(tag)&&expected.get(tag)!==c.Id)fail('EXISTING_IMAGE_TAG_CONFLICT');
 const dockerRoot=run('docker',['info','--format','{{.DockerRootDir}}']);
 for(const dir of [root,dockerRoot]){const s=fs.statfsSync(dir);if(s.bavail*s.bsize<3*1024**3)fail('INSUFFICIENT_DISK_SPACE');}
 const before=snapshot(containers);writeNew(path.join(root,'staging-before.json'),{at:new Date().toISOString(),containers:before});
 run('docker',['image','load','--input',archive]);
 for(const [tag,id]of expected){if(run('docker',['image','inspect','--format','{{.Id}}',tag])!==id||run('docker',['image','inspect','--format','{{.Id}}',id])!==id)fail('LOADED_IMAGE_MISMATCH');}
 const afterIds=run('docker',['ps','-aq']).split(/\s+/).filter(Boolean);assertUnchanged(before,snapshot(inspect(afterIds)));
 const result={result:'STAGED_ONLY',at:new Date().toISOString(),imagesVerified:expected.size,containersUnchanged:true,servicesRestarted:false,databaseMigrated:false,paperClosureExecuted:false,cutoverPrepared:false,remainingReviewRequired:true};
 writeNew(path.join(root,'staging-result.json'),result);console.log(JSON.stringify(result,null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)stage(process.argv[2]??'.').catch(e=>{console.error(e.message);process.exitCode=1;});
