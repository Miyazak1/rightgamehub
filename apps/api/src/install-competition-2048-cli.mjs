import fs from 'node:fs/promises';
import {createRuntime} from './runtime.mjs';
import {installCompetitionPackage} from './install-competition-package.mjs';
const runtime=createRuntime({loadTrustedRules:false});
try{
  if(!(await runtime.migrations.status()).ready)throw new Error('Apply database migrations before installing the game.');
  const bytes=await fs.readFile(new URL('../bundled/2048-competition-v1.zip',import.meta.url));
  const provenance=JSON.parse(await fs.readFile(new URL('../bundled/2048-competition-v1.json',import.meta.url),'utf8'));
  console.log(JSON.stringify(await installCompetitionPackage({runtime,workId:'7359a350-cc0a-4a09-875d-cec9b5b8f93f',bytes,provenance})));
}finally{await runtime.app.close();}
