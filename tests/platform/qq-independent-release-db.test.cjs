const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path');
const {Pool}=require('../../apps/api/node_modules/pg'),enabled=process.env.QA_LEDGER_TEST_ISOLATED==='1'&&!!process.env.QA_LEDGER_TEST_URL;
test('post-update QQ acceptance requires a delivered expected reply, not just an acknowledgement or an older successful task',{skip:!enabled},async()=>{
 const url=new URL(process.env.QA_LEDGER_TEST_URL);assert.equal(url.hostname,'127.0.0.1');assert.match(url.pathname,/^\/qa_ledger_test_[a-f0-9]{32}$/);const control=new Pool({connectionString:url.href}),name='mooyu_qq_local_accept_'+crypto.randomBytes(10).toString('hex');await control.query('CREATE DATABASE '+name);url.pathname='/'+name;const pool=new Pool({connectionString:url.href});
 try{
  await pool.query('CREATE SCHEMA mooyu_qq;CREATE TABLE mooyu_qq.messages(channel_id text,message_id text,status text,remote_message_id text,reply text,error_code text,created_at timestamptz,origin_group_id text,input_text text);CREATE TABLE mooyu_qq.agent_deliveries(channel_id text,message_id text,source_message_id text)');
  const {qqAcceptanceSQL}=await import('../../scripts/deploy-qq-independent-plugin.mjs'),since=new Date(Date.now()-10000).toISOString();
  const insert=(id,reply,status='delivered',created=new Date().toISOString(),input='QQ独立插件验收20261124R1')=>pool.query("INSERT INTO mooyu_qq.messages VALUES('c',$1,$2,$3,$4,NULL,$5,'905757031',$6)",[id,status,status==='delivered'?'remote-'+id:null,reply,created,input]);
  await insert('old','QQ通道验收成功','delivered',new Date(Date.now()-20000).toISOString());await insert('new','任务已保存，完成后回复');
  const read=async()=>(await pool.query(qqAcceptanceSQL(since))).rows[0].coalesce;
  let rows=await read();assert.equal(rows.length,1);assert.equal(rows[0].expectedReplyDelivered,false);
  await pool.query("UPDATE mooyu_qq.messages SET reply='QQ通道验收成功' WHERE message_id='new'");assert.equal((await read())[0].expectedReplyDelivered,true);
  await pool.query("UPDATE mooyu_qq.messages SET reply='任务已保存' WHERE message_id='new'");await insert('child','QQ通道验收成功','ready',new Date().toISOString(),'');await pool.query("INSERT INTO mooyu_qq.agent_deliveries VALUES('c','child','new')");assert.equal((await read())[0].expectedReplyDelivered,false);
  await pool.query("UPDATE mooyu_qq.messages SET status='delivered',remote_message_id='remote-child' WHERE message_id='child'");assert.equal((await read())[0].expectedReplyDelivered,true);
 }finally{await pool.end();await control.query('DROP DATABASE '+name+' WITH (FORCE)');await control.end();}
});
