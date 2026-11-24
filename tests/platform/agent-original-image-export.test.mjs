import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync,execFileSync} from 'node:child_process';

function fixture(t,{wrongImage=false,corrupt=false,lowDisk=false}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'image-export-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const bin=path.join(dir,'bin'),backup=path.join(dir,'backups'),seed=path.join(dir,'seed');for(const d of [bin,backup,path.join(seed,'blobs/sha256')])fs.mkdirSync(d,{recursive:true});
 const metadata=JSON.stringify({schemaVersion:2,mediaType:'application/vnd.oci.image.index.v1+json',manifests:[]}),digest=crypto.createHash('sha256').update(metadata).digest('hex');
 fs.writeFileSync(path.join(seed,'blobs/sha256',digest),corrupt?'wrong bytes':metadata);
 const sourceTar=path.join(dir,'seed.tar');execFileSync('tar',['-cf',sourceTar,'-C',seed,'blobs']);
 fs.writeFileSync(path.join(bin,'docker'),`#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$TEST_DOCKER_LOG"
if [[ "$1" = inspect ]]; then printf '%s\\n' "$TEST_CURRENT_IMAGE";
elif [[ "$1 $2" = 'image inspect' ]]; then printf '16384\\n';
elif [[ "$1 $2" = 'image save' ]]; then cp -- "$TEST_TAR" "$4";
else echo UNEXPECTED_DOCKER_MUTATION >&2; exit 9; fi
`,{mode:0o700});
 if(lowDisk)fs.writeFileSync(path.join(bin,'df'),"#!/bin/sh\nprintf 'Filesystem 1024-blocks Used Available Capacity Mounted\\nmock 10 9 1 90%% /\\n'\n",{mode:0o700});
 const quote=v=>"'"+v.replaceAll("'","'\\''")+"'";
 const source=fs.readFileSync('deploy/agent-plugins/export-original-scheduler-image.sh','utf8');
 const script=source.replace('expected_image=sha256:ee818f213525cb81a984c4c7dba8c4b4096a85e7d22da3c98df06dcb1bce2843','expected_image=sha256:'+digest).replace('backup_root=/www/backup/gamehub','backup_root='+quote(backup));
 const file=path.join(dir,'export.sh'),log=path.join(dir,'docker.log');fs.writeFileSync(file,script);
 const result=spawnSync('bash',[file],{encoding:'utf8',env:{...process.env,PATH:bin+path.delimiter+process.env.PATH,TEST_DOCKER_LOG:log,TEST_CURRENT_IMAGE:wrongImage?'sha256:'+'0'.repeat(64):'sha256:'+digest,TEST_TAR:sourceTar}});
 return {result,backup,log:fs.existsSync(log)?fs.readFileSync(log,'utf8'):''};
}

test('export creates only a new private artifact and checksum; Docker mutations are forbidden',t=>{
 const f=fixture(t);assert.equal(f.result.status,0,f.result.stderr);const dirs=fs.readdirSync(f.backup);assert.equal(dirs.length,1);const folder=path.join(f.backup,dirs[0]);assert.equal(fs.statSync(folder).mode&0o777,0o700);const archive=path.join(folder,'original-scheduler-ee818f213525.tar');assert.equal(fs.statSync(archive).mode&0o777,0o600);const sum=crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');assert(fs.readFileSync(archive+'.sha256','utf8').startsWith(sum+'  '));assert(!/\b(stop|start|restart|update|up|load|pull|push|down|restore)\b/.test(f.log));
});
test('changed source image is rejected before creating a directory',t=>{const f=fixture(t,{wrongImage:true});assert.notEqual(f.result.status,0);assert(f.result.stderr.includes('ORIGINAL_IMAGE_CHANGED'));assert.deepEqual(fs.readdirSync(f.backup),[]);assert(!f.log.includes('image save'));});
test('insufficient disk space is rejected before writing artifacts',t=>{const f=fixture(t,{lowDisk:true});assert.notEqual(f.result.status,0);assert(f.result.stderr.includes('EXPORT_DISK_SPACE_LOW'));assert.deepEqual(fs.readdirSync(f.backup),[]);assert(!f.log.includes('image save'));});
test('a corrupt or shared metadata blob never becomes a completed original-image export',t=>{const f=fixture(t,{corrupt:true});assert.notEqual(f.result.status,0);assert(f.result.stderr.includes('ORIGINAL_OCI_ROOT_NOT_RETAINED'));const folder=path.join(f.backup,fs.readdirSync(f.backup)[0]);assert(fs.readdirSync(folder).some(f=>f.endsWith('.partial')));assert(!fs.readdirSync(folder).some(f=>f.endsWith('.sha256')));});
