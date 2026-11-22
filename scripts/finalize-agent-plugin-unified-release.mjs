// Add a schema-compatible rollback API without reverting or restoring the DB.
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..'),dir=path.resolve(process.argv[2]??''),file=path.join(dir,'release-manifest.json'),m=JSON.parse(fs.readFileSync(file,'utf8'));
if(m.schemaVersion!=='agent-unified-release-v1'||m.releaseRevision!=='r4')throw Error('UNIFIED_R4_REQUIRED');
const run=args=>{const r=spawnSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:600000,maxBuffer:4000000});if(r.status!==0)throw Error('ROLLBACK_ASSEMBLY_FAILED');return r.stdout.trim();};
const base=m.images.api.baseImageId,tag='mooyu-agent-unified-api-rollback:20261121-55b2f7e8-schema166-r3',context=path.join(dir,'rollback-context-r3');if(fs.existsSync(context))throw Error('NEW_ROLLBACK_CONTEXT_REQUIRED');fs.mkdirSync(context);
const current=m.files.filter(f=>f.path.startsWith('apps/api/migrations/')),original=new Map(JSON.parse(run(['run','--rm','--network','none','--read-only','--entrypoint','node',base,'--input-type=module','-e',"import {loadMigrations} from '/app/apps/api/src/migrations.mjs'; console.log(JSON.stringify(await loadMigrations('/app/apps/api/migrations')))"])).map(f=>['apps/api/migrations/'+f.name,f.checksum]));
for(const [file,sha]of original){const expected=current.find(f=>f.path===file);if(!expected||createHash('sha256').update(fs.readFileSync(path.join(dir,'context',file),'utf8').replace(/\r\n?/gu,'\n')).digest('hex')!==sha)throw Error('ORIGINAL_MIGRATION_CHECKSUM_CHANGED');}
const added=current.filter(f=>!original.has(f.path));for(const file of added)fs.copyFileSync(path.join(dir,'context',file.path),path.join(context,path.basename(file.path)));
fs.writeFileSync(path.join(context,'Dockerfile'),`FROM ${m.images.api.baseTag}\nLABEL org.mooyu.rollback="original-api-with-additive-schema166"\n${added.map(f=>`COPY ${path.basename(f.path)} /app/${f.path}\n`).join('')}`);
if(run(['image','inspect','--format','{{.Id}}',m.images.api.baseTag])!==base)throw Error('ORIGINAL_API_IMAGE_CHANGED');
run(['build','--network=none','--pull=false','-t',tag,context]);
m.rollbackImages={api:{tag,id:run(['image','inspect','--format','{{.Id}}',tag]),originalImageId:base,codeUnchanged:true,onlyAddedMigrationCatalogEntries:added.map(f=>path.basename(f.path))},worker:{tag:m.images.worker.baseTag,id:m.images.worker.baseImageId},web:{tag:m.images.web.baseTag,id:m.images.web.baseImageId}};
m.originalApiRetained={tag:m.images.api.baseTag,id:base};
fs.writeFileSync(file,JSON.stringify(m,null,2));
run(['image','save','--output',path.join(dir,'images.tar'),...Object.values(m.images).map(i=>i.tag),...Object.values(m.rollbackImages).map(i=>i.tag),m.originalApiRetained.tag]);
const hashFile=async p=>{const hash=createHash('sha256');for await(const bytes of fs.createReadStream(p))hash.update(bytes);return hash.digest('hex');};
const sums=[];for(const name of ['images.tar','release-manifest.json','source.patch'])sums.push(`${await hashFile(path.join(dir,name))}  ${name}`);fs.writeFileSync(path.join(dir,'SHA256SUMS'),sums.join('\n')+'\n');console.log(JSON.stringify({rollbackImages:m.rollbackImages,originalApiRetained:true,productionChanged:false,paperEnabled:false}));
