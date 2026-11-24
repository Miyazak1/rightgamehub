import test from 'node:test';
import assert from 'node:assert/strict';
import {expectedImages,checkArchiveTags,snapshot,assertUnchanged} from '../../scripts/stage-agent-release.mjs';
const entries=Array.from({length:7},(_,i)=>({tag:`mooyu-test-${i}:r4`,id:'sha256:'+String(i).repeat(64)}));
const release={paperEnabled:false,images:Object.fromEntries(entries.slice(0,3).map((e,i)=>[i,e])),rollbackImages:Object.fromEntries(entries.slice(3,6).map((e,i)=>[i,e])),originalApiRetained:entries[6]};
test('exact seven-image archive accepted; unexpected tag or digest refused',()=>{
 const expected=expectedImages(release),index={manifests:entries.map(e=>({digest:e.id,annotations:{'io.containerd.image.name':'docker.io/library/'+e.tag}}))},legacy=entries.map(e=>({RepoTags:[e.tag]}));
 checkArchiveTags(index,legacy,expected);const changed=structuredClone(index);changed.manifests[0].digest=entries[1].id;assert.throws(()=>checkArchiveTags(changed,legacy,expected));
 assert.throws(()=>checkArchiveTags(index,[...legacy,{RepoTags:['unexpected:tag']}],expected));
});
test('container snapshot ignores health changes and refuses restart, config or membership drift',()=>{
 const c={Name:'/test',Id:'abc',Image:entries[0].id,State:{Running:true,StartedAt:'original',Health:{Status:'healthy'}},RestartCount:0,Config:{Env:['PRIVATE=never-output']},HostConfig:{RestartPolicy:{Name:'unless-stopped'}},Mounts:[],NetworkSettings:{Networks:{}}};
 const before=snapshot([c]),health=structuredClone(c);health.State.Health.Status='starting';assertUnchanged(before,snapshot([health]));assert.ok(!JSON.stringify(before).includes('PRIVATE'));
 for(const change of [x=>x.State.StartedAt='new',x=>x.Config.Env=[],x=>x.RestartCount++]){const next=structuredClone(c);change(next);assert.throws(()=>assertUnchanged(before,snapshot([next])));}assert.throws(()=>assertUnchanged(before,[]));
});
