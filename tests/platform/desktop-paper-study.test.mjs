import test from 'node:test';
import assert from 'node:assert/strict';
import {assertDesktopPaperDatabase,prepareDesktopPaperStudy,createDesktopPaperStudyService} from '../../apps/api/src/desktop-paper-study.mjs';

test('paper preparation refuses any non-test database identity before creating accounts',async()=>{
  for(const identity of [{db:'gamehub',username:'desktop_business_test'},{db:'desktop_business_test',username:'gamehub'}]){
    let queries=0;const pool={async query(sql){queries++;assert.match(sql,/SELECT current_database/);return{rows:[identity]};}};
    await assert.rejects(prepareDesktopPaperStudy(pool),/DESKTOP_PAPER_DATABASE_REJECTED/);assert.equal(queries,1);
  }
});
test('paper preparation requires seeded isolated fixtures before any mutation',async()=>{
  let queries=0;const pool={async query(sql){queries++;assert.match(sql,/^SELECT /);return{rows:queries===1?[{db:'desktop_business_test',username:'desktop_business_test'}]:[]};}};
  await assert.rejects(assertDesktopPaperDatabase(pool),/DESKTOP_PAPER_FIXTURE_REQUIRED/);assert.equal(queries,2);
});
test('optional paper service is lazy, fails readiness closed and releases failed initialization',async()=>{
  let queries=0;const pool={async query(){queries++;throw Error('not configured');}};
  const runtime=createDesktopPaperStudyService({pool,redisUrl:'redis://unused.invalid'});
  assert.equal(queries,0);assert.equal(await runtime.service.ready(),false);assert.equal(await runtime.service.ready(),false);assert.equal(queries,2);await runtime.close();
});
