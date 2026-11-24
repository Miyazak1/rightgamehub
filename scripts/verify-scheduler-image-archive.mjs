// Read-only OCI/Docker tar inspection. Does not extract files or load images.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
const [archive,checksum]=process.argv.slice(2);
const expectedImage='sha256:ee818f213525cb81a984c4c7dba8c4b4096a85e7d22da3c98df06dcb1bce2843';
const assert=(v,code)=>{if(!v)throw Error(code);};
assert(archive&&checksum,'ARCHIVE_AND_CHECKSUM_REQUIRED');
const line=fs.readFileSync(checksum,'utf8').trim();
const sidecar=/^([a-f0-9]{64})\s+\*?([^\r\n]+)$/i.exec(line);
assert(sidecar&&sidecar[2]===path.basename(archive),'CHECKSUM_REFERENCE_INVALID');
const size=fs.statSync(archive).size;assert(size===234950144,'EXPORTED_SIZE_MISMATCH');
const fd=fs.openSync(archive,'r'),buffer=Buffer.alloc(1048576);
const hashRange=(offset,length)=>{const h=crypto.createHash('sha256');while(length>0){const n=fs.readSync(fd,buffer,0,Math.min(length,buffer.length),offset);assert(n>0,'TRUNCATED_ARCHIVE');h.update(buffer.subarray(0,n));offset+=n;length-=n;}return h.digest('hex');};
const text=(b,a,n)=>b.subarray(a,a+n).toString('utf8').split('\0')[0];
const number=(b,a,n)=>{const s=text(b,a,n).trim();assert(!s||/^[0-7]+$/.test(s),'UNSUPPORTED_TAR_NUMERIC_FIELD');return s?parseInt(s,8):0;};
try{
 const archiveSha256=hashRange(0,size);assert(archiveSha256===sidecar[1].toLowerCase(),'CHECKSUM_MISMATCH');
 assert(archiveSha256==='84ebc76206235a1e6d05a74e9ba9f06c9522af183fe0d90d169852aa12b764f6','SERVER_EXPORT_RECEIPT_MISMATCH');
 const entries=new Map();let offset=0,pax={};
 while(offset+512<=size){const header=Buffer.alloc(512);assert(fs.readSync(fd,header,0,512,offset)===512,'TRUNCATED_TAR_HEADER');if(header.every(v=>v===0))break;const check=number(header,148,8);let sum=0;for(let i=0;i<512;i++)sum+=i>=148&&i<156?32:header[i];assert(check===sum,'TAR_HEADER_CHECKSUM_INVALID');const type=String.fromCharCode(header[156]||48),bytes=number(header,124,12),start=offset+512;assert(start+bytes<=size,'TAR_ENTRY_OUTSIDE_ARCHIVE');let name=text(header,0,100),prefix=text(header,345,155);if(prefix)name=prefix+'/'+name;
  if(type==='x'||type==='g'){assert(bytes<=2097152,'PAX_TOO_LARGE');const b=Buffer.alloc(bytes);fs.readSync(fd,b,0,bytes,start);let i=0;while(i<b.length){const space=b.indexOf(32,i);assert(space>i,'PAX_INVALID');const len=Number(b.subarray(i,space).toString());assert(Number.isSafeInteger(len)&&len>space-i&&i+len<=b.length,'PAX_LENGTH_INVALID');const record=b.subarray(space+1,i+len-1).toString('utf8'),eq=record.indexOf('=');if(eq>0)pax[record.slice(0,eq)]=record.slice(eq+1);i+=len;}offset=start+Math.ceil(bytes/512)*512;continue;}
  name=(pax.path??name).replace(/^\.\//,'');assert(!pax.size||Number(pax.size)===bytes,'PAX_SIZE_REQUIRES_REVIEW');pax={};assert(!name.startsWith('/')&&!name.split('/').includes('..'),'UNSAFE_TAR_PATH');assert(['0','5'].includes(type),'TAR_LINK_OR_SPECIAL_ENTRY_REQUIRES_REVIEW');if(type==='0'){assert(!entries.has(name),'DUPLICATE_TAR_MEMBER');entries.set(name,{start,bytes});}offset=start+Math.ceil(bytes/512)*512;
 }
 const json=name=>{const e=entries.get(name);assert(e&&e.bytes<=2097152,'METADATA_MISSING_OR_TOO_LARGE');const b=Buffer.alloc(e.bytes);assert(fs.readSync(fd,b,0,e.bytes,e.start)===e.bytes,'METADATA_TRUNCATED');return JSON.parse(b.toString('utf8'));};
 let blobCount=0;for(const [name,e]of entries)if(/^blobs\/sha256\/[a-f0-9]{64}$/.test(name)){assert(hashRange(e.start,e.bytes)===name.split('/').at(-1),'OCI_BLOB_CHECKSUM_INVALID');blobCount++;}
 const rootIndex=json('index.json');assert(Array.isArray(rootIndex.manifests),'OCI_EXPORT_INDEX_REQUIRED');const roots=[...new Set(rootIndex.manifests.map(d=>d.digest))];assert(roots.length===1&&roots[0]===expectedImage,'UNEXPECTED_EXPORT_IMAGE_ROOTS');
 const seen=new Set(),runnable=[],queue=[{digest:expectedImage,kind:'manifest'}];
 while(queue.length){const d=queue.pop();assert(/^sha256:[a-f0-9]{64}$/.test(d.digest),'DESCRIPTOR_DIGEST_INVALID');if(seen.has(d.digest))continue;seen.add(d.digest);const name='blobs/sha256/'+d.digest.slice(7),e=entries.get(name);assert(e,'OCI_REFERENCE_MISSING');if(d.size!=null)assert(e.bytes===d.size,'OCI_DESCRIPTOR_SIZE_MISMATCH');if(d.kind!=='manifest')continue;const m=json(name);assert(m.schemaVersion===2,'OCI_SCHEMA_INVALID');if(m.manifests){assert(Array.isArray(m.manifests),'OCI_MANIFESTS_INVALID');for(const child of m.manifests)queue.push({...child,kind:'manifest'});}else{assert(m.config&&Array.isArray(m.layers),'OCI_MANIFEST_INVALID');queue.push({...m.config,kind:'config'},...m.layers.map(v=>({...v,kind:'layer'})));if(d.platform?.os==='linux'&&d.platform?.architecture==='amd64'){const c=json('blobs/sha256/'+m.config.digest.slice(7)),layers=c.rootfs?.diff_ids;assert(Array.isArray(layers),'RUNTIME_ROOTFS_REQUIRED');runnable.push({manifest:d.digest,config:m.config.digest,layerCount:layers.length,layerChainSha256:crypto.createHash('sha256').update(JSON.stringify(layers)).digest('hex')});}}}
 assert(runnable.length===1&&runnable[0].layerCount===28,'EXPECTED_LINUX_RUNTIME_MISSING');
 const legacy=entries.has('manifest.json')?json('manifest.json'):[];
 const tags=new Set(Array.isArray(legacy)?legacy.flatMap(v=>v.RepoTags??[]):[]);
 for(const d of rootIndex.manifests){const ref=d.annotations?.['io.containerd.image.name'];if(ref&&!/^sha256:/.test(ref))tags.add(ref);}
 console.log(JSON.stringify({result:'PASSED',archive:path.resolve(archive),bytes:size,archiveSha256,imageId:expectedImage,ociBlobCount:blobCount,verifiedReferencedBlobs:seen.size,runnable,tags:[...tags],extracted:false,loaded:false,productionChanged:false},null,2));
}finally{fs.closeSync(fd);}
