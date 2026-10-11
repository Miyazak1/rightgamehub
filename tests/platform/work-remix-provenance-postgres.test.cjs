const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');

const url=process.env.GAMEHUB_COMMUNITY_DATABASE_URL;

test('remix provenance validates licenses, blocks cycles, locks published declarations and keeps append-only history',{skip:!url,timeout:120000},async t=>{
  const f=await require('../work-edit-fixture.cjs').createWorkEditFixture(url);t.after(()=>f.close());
  const {service,actors,pool,workId,draftId}=f;
  const mine=await service.list(actors.owner),draft=mine.find(work=>work.id===draftId);
  const declared=(await service.update(actors.owner,draftId,{remixSourceWorkId:workId,remixNote:'保留纸飞机玩法，并重做关卡、画面和操作反馈。'},crypto.randomUUID(),`"work-${draftId}-${draft.revision}"`)).work;
  assert.equal(declared.remixSource.workId,workId);assert.equal(declared.remixSource.licenseSpdx,'MIT');
  assert.equal((await pool.query('SELECT action FROM work_remix_events WHERE work_id=$1',[draftId])).rows[0].action,'declared');
  await assert.rejects(pool.query("UPDATE work_remix_events SET action='updated' WHERE work_id=$1",[draftId]),/append-only/);

  await pool.query("UPDATE works SET state='published',visibility='public',first_published_at=now() WHERE id=$1",[draftId]);
  await assert.rejects(service.update(actors.owner,draftId,{remixSourceWorkId:workId,remixNote:'尝试替换已经公开的来源关系和说明。'},crypto.randomUUID(),`"work-${draftId}-${declared.revision}"`),error=>error.code==='REMIX_SOURCE_LOCKED');
  await assert.rejects(service.update(actors.owner,workId,{remixSourceWorkId:draftId,remixNote:'这个声明会形成循环，因此必须被拒绝。'},crypto.randomUUID(),`"work-${workId}-0"`),error=>error.code==='REMIX_SOURCE_CYCLE');

  await pool.query("UPDATE works SET license_spdx='GPL-3.0-only' WHERE id=$1",[workId]);
  const another=(await service.create(actors.owner,{title:'另一个草稿',description:'测试许可门禁',kind:'game'},crypto.randomUUID())).work;
  await assert.rejects(service.update(actors.owner,another.id,{remixSourceWorkId:workId,remixNote:'尝试使用未列入可二创清单的来源作品。'},crypto.randomUUID(),`"work-${another.id}-${another.revision}"`),error=>error.code==='REMIX_SOURCE_NOT_ALLOWED');
});
