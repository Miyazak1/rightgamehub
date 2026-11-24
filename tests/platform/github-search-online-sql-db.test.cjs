const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url'),h=require('./support/researcher-qa-db.cjs');
test('online update SELECT contracts execute on real schema 166, including composite participant identity',{skip:!h.enabled},async t=>{
 const {admin}=await h.setup();t.after(()=>admin.end());const {ONLINE_SQL}=await import(pathToFileURL(path.resolve(__dirname,'../../scripts/update-github-search-online.mjs')));
 const c=await admin.connect();try{await c.query('BEGIN READ ONLY');for(const sql of Object.values(ONLINE_SQL)){assert.match(sql,/^SELECT /);assert.equal((await c.query(sql)).rows.length,1);}assert.equal((await c.query("SELECT current_setting('transaction_read_only') AS value")).rows[0].value,'on');await c.query('ROLLBACK');}finally{c.release();}
});
