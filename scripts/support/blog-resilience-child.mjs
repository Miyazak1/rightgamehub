// Isolated acceptance worker. No production credentials or endpoints are read
// from disk. Its parent supplies a disposable DB and temporary test account.
import fs from 'node:fs/promises';
import http from 'node:http';
import {PostgresAgentRuntimeRepository} from '../../apps/api/src/agent-runtime-repository.mjs';
import {createAgentBlogPublicRuntime} from '../../apps/api/src/agent-blog-public-runtime.mjs';
if(process.env.QA_LEDGER_TEST_ISOLATED!=='1'
  ||!/^postgresql:\/\/[^@]+@127\.0\.0\.1:\d+\/qa_ledger_test_[a-f0-9]{32}$/.test(process.env.DATABASE_URL??''))throw Error('ISOLATED_DATABASE_REQUIRED');
const scenario=process.env.MOOYU_FAULT_SCENARIO;
let injected=false;
let server;
if(scenario==='network'){
  server=http.createServer((request)=>request.socket.destroy());
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const fetch=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
    if(!injected&&String(url).includes('api.deepseek.com')){
      injected=true;console.log(JSON.stringify({event:'fault',scenario}));
      return fetch(`http://127.0.0.1:${server.address().port}`,options);
    }
    return fetch(url,options);
  };
}
const original=PostgresAgentRuntimeRepository.prototype.completeStage;
PostgresAgentRuntimeRepository.prototype.completeStage=async function(input){
  const stage=(await this.pool.query('SELECT stage_key FROM agent_run_stages WHERE id=$1',[input.stageId])).rows[0];
  if(!injected&&stage?.stage_key==='persist-draft'&&['exit','database'].includes(scenario)){
    injected=true;console.log(JSON.stringify({event:'fault',scenario,stage:'persist-draft'}));
    if(scenario==='exit')process.exit(86);
    const client=await this.pool.connect();
    try{await client.query('SELECT pg_terminate_backend(pg_backend_pid())');}
    finally{client.release(true);}
  }
  return original.call(this,input);
};
const runtime=createAgentBlogPublicRuntime();
try{
  const result=await runtime.runner.run({requestId:process.env.MOOYU_TEST_REQUEST_ID});
  await fs.writeFile(process.env.MOOYU_TEST_RESULT,JSON.stringify({result,injected}));
  console.log(JSON.stringify({event:'complete',state:result.publication.publicationState}));
}catch(error){
  console.log(JSON.stringify({event:'interrupted',code:error.code??'UNKNOWN',details:error.details}));
  process.exitCode=87;
}finally{server?.close();await runtime.close();}
