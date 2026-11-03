// Test-only process that exits after a durable checkpoint, before stage completion.
import { createRequire } from 'node:module';
import { createPaperStudyDurableRuntime } from '../../apps/api/src/paper-study-durable-runtime.mjs';
const require=createRequire(new URL('../../apps/api/package.json',import.meta.url));
const {Pool}=require('pg');
const url=new URL(process.env.QA_LEDGER_TEST_URL);
if(process.env.QA_LEDGER_TEST_ISOLATED!=='1'||url.hostname!=='127.0.0.1'||!/^\/qa_ledger_test_[a-f0-9]{32}$/.test(url.pathname))throw Error('PAPER_TEST_ISOLATION_REQUIRED');
const pool=new Pool({connectionString:url.href});
const runtime=createPaperStudyDurableRuntime({pool,redisUrl:process.env.PAPER_STUDY_TEST_REDIS_URL,executionAgentUserId:process.env.PAPER_STUDY_TEST_AGENT,
  workerId:'paper-study-worker',afterCheckpoint:async()=>process.exit(73)});
await runtime.runOnce();throw Error('PAPER_TEST_CRASH_CHECKPOINT_NOT_REACHED');
