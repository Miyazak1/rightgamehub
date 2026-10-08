const assert=require('node:assert/strict'),crypto=require('node:crypto');

// Image workers must never share a database while using different media roots.
exports.createCommunityTestDatabase=async function(url){
  const parsed=new URL(url);
  assert.ok(['127.0.0.1','localhost'].includes(parsed.hostname)&&parsed.pathname==='/community_test','Requires the dedicated local community_test fixture.');
  const {createDatabase}=await import('../apps/api/src/database.mjs');
  const control=createDatabase({databaseUrl:url}),name='community_case_'+crypto.randomUUID().replaceAll('-','');
  try{await control.pool.query('CREATE DATABASE '+name);}catch(error){await control.close();throw error;}
  parsed.pathname='/'+name;
  const database=createDatabase({databaseUrl:parsed.href});
  return {pool:database.pool,async close(){
    try{await database.close();await control.pool.query('DROP DATABASE '+name);}finally{await control.close();}
  }};
};
