const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const{Pool}=require('../../apps/api/node_modules/pg');const enabled=process.env.QA_LEDGER_TEST_ISOLATED==='1'&&!!process.env.QA_LEDGER_TEST_URL;
test('native release acceptance excludes old requests, queue acknowledgements and unconfirmed replies',{skip:!enabled},async()=>{
 const url=new URL(process.env.QA_LEDGER_TEST_URL);assert.equal(url.hostname,'127.0.0.1');assert.match(url.pathname,/^\/qa_ledger_test_[a-f0-9]{32}$/);const admin=new Pool({connectionString:url.href}),database='qq_ws_acceptance_'+crypto.randomBytes(8).toString('hex');await admin.query('CREATE DATABASE '+database);url.pathname='/'+database;const pool=new Pool({connectionString:url.href});
 try{
  await pool.query('CREATE SCHEMA mooyu_qq;CREATE TABLE mooyu_qq.messages(channel_id text,message_id text,status text,remote_message_id text,reply text,created_at timestamptz,origin_group_id text,input_text text);CREATE TABLE mooyu_qq.agent_deliveries(channel_id text,message_id text,source_message_id text)');
  const{wsNewMessageSQL}=await import('../../scripts/qq-websocket-release-common.mjs'),since=new Date(Date.now()-10000).toISOString();
  const insert=(id,reply,status='delivered',created=new Date().toISOString(),input='QQ连接修复验收20261127R1')=>pool.query("INSERT INTO mooyu_qq.messages VALUES('3922489710:905757031',$1,$2,$3,$4,$5,'905757031',$6)",[id,status,status==='delivered'?'remote-'+id:null,reply,created,input]);
  const read=async()=>(await pool.query(wsNewMessageSQL(since))).rows[0].coalesce;
  await insert('old','QQ连接修复通过20261127','delivered',new Date(Date.now()-20000).toISOString());assert.equal((await read()).length,0);
  await insert('new','任务已保存');assert.equal((await read())[0].replyDelivered,false);
  await insert('child','QQ连接修复通过20261127','ready',new Date().toISOString(),'');await pool.query("INSERT INTO mooyu_qq.agent_deliveries VALUES('3922489710:905757031','child','new')");assert.equal((await read())[0].replyDelivered,false);
  await pool.query("UPDATE mooyu_qq.messages SET status='delivered',remote_message_id='remote-child' WHERE message_id='child'");assert.equal((await read())[0].replyDelivered,true);
  await insert('direct','QQ连接修复通过20261127');assert((await read()).some(m=>m.replyDelivered));
 }finally{await pool.end();await admin.query('DROP DATABASE '+database+' WITH (FORCE)');await admin.end();}
});
