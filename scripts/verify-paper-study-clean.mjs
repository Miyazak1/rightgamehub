import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {sealPaperStudyBuild} from './support/paper-study-build.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const seeds=['packages/platform-client/src/PaperStudyTool.jsx','packages/platform-client/src/paper-study-contract.mjs','packages/platform-client/src/official-tools.mjs','packages/platform-client/src/i18n.mjs',
  'apps/desktop/src/account-session.mjs','apps/api/src/gamehub-mcp-server.mjs','apps/api/src/paper-study-service.mjs','apps/api/src/paper-study-routes.mjs','apps/api/src/paper-study-model-processor.mjs',
  'tests/desktop/paper-study-api-fixture.mjs','tests/desktop/paper-study-replay.mjs','tests/desktop/electron-paper-study-acceptance.cjs','tests/platform/paper-study.test.mjs','tests/platform/agent-capabilities-registry.test.cjs',
  'tests/platform/agent-paper-topic-plan.test.cjs','tests/platform/agent-paper-article-sections.test.cjs',
  'scripts/verify-paper-study-saved.mjs','tests/platform/paper-study-window.test.cjs',
  'scripts/start-paper-study.mjs','scripts/verify-paper-study.mjs','scripts/verify-paper-study-clean.mjs','scripts/verify-desktop-clean.mjs'];
const legacyTests = [
  'tests/platform/agent-blog-private-canary-bootstrap.test.cjs',
  'tests/platform/agent-paper-text-draft.test.cjs',
  'tests/platform/agent-paper-research-execution.test.cjs',
  'tests/platform/agent-paper-research-execution-db.test.cjs',
  'tests/platform/agent-paper-semantic-db.test.cjs',
  'tests/platform/agent-paper-article-workflow.test.cjs',
  'tests/platform/agent-paper-article-generation.test.cjs',
  'tests/platform/agent-paper-isolated-paragraphs.test.cjs',
  'tests/platform/agent-paper-paragraph-plan.test.cjs',
  'tests/platform/agent-paper-expanded-prose.test.cjs',
  'tests/platform/paper-study-build.test.mjs',
];
seeds.push('apps/api/src/agent-paper-research-execution.mjs', ...legacyTests, 'tests/platform/support/paper-text-draft-db.cjs', 'scripts/verify-paper-study-live.mjs');
const files=new Set();
seeds.push('apps/api/src/runtime.mjs','apps/api/src/paper-study-worker-cli.mjs',
  'apps/api/migrations/0159_paper_study_private_workspace.sql',
  'scripts/verify-paper-study-persistence.mjs','tests/desktop/paper-study-crash-worker.mjs',
  'tests/platform/paper-study-persistence.test.mjs','tests/platform/paper-study-persistence-db.test.cjs');
legacyTests.push('tests/platform/paper-study-persistence.test.mjs','tests/platform/paper-study-persistence-db.test.cjs','tests/platform/paper-study-worker-loop.test.mjs');
seeds.push('tests/platform/paper-study-worker-loop.test.mjs');
seeds.push('apps/api/src/desktop-business-test-server.mjs','apps/api/src/desktop-paper-study-worker.mjs',
  'deploy/compose.desktop-business-test.yml','deploy/compose.desktop-business-remote.yml','deploy/compose.desktop-paper-study-test.yml',
  'scripts/verify-desktop-business-instance.mjs','scripts/verify-desktop-business-remote.mjs','tests/platform/desktop-business-test-instance.test.mjs','tests/platform/desktop-business-remote.test.mjs');
seeds.push('scripts/verify-desktop-business-database.mjs','tests/desktop/electron-business-database.cjs');
seeds.push('tests/platform/desktop-paper-study.test.mjs');legacyTests.push('tests/platform/desktop-paper-study.test.mjs');
seeds.push('tests/platform/desktop-business-proxy.test.mjs');legacyTests.push('tests/platform/desktop-business-proxy.test.mjs');
legacyTests.push('tests/platform/desktop-business-test-instance.test.mjs','tests/platform/desktop-business-remote.test.mjs');
async function visit(relative){
  relative=relative.replaceAll('\\','/');if(files.has(relative))return;
  if(relative.startsWith('../')||path.isAbsolute(relative)||relative.includes('node_modules')||relative.startsWith('.runtime/')||/MooyuWorkbench|desktop\/src\/(?:workbench-service|paper-review)/.test(relative))throw Error('PAPER_STUDY_CLEAN_SCOPE_DENIED');
  await fs.access(path.join(root,relative));files.add(relative);
  if(relative.startsWith('tests/platform/fixtures/') && relative.endsWith('.json')) {
    const fixture=JSON.parse(await fs.readFile(path.join(root,relative),'utf8'));
    if(typeof fixture.sourceFixture==='string') {
      if(!/^paper-[\w.-]+\.json$/.test(fixture.sourceFixture))throw Error('PAPER_STUDY_FIXTURE_REFERENCE_DENIED');
      await visit('tests/platform/fixtures/'+fixture.sourceFixture);
    }
  }
  if(!/\.(?:mjs|cjs|jsx|js)$/.test(relative))return;
  const text=await fs.readFile(path.join(root,relative),'utf8');
  if (relative.startsWith('tests/platform/')) for (const match of text.matchAll(/['"](?:fixtures\/)?(paper-[\w.-]+\.json)['"]/g))
    await visit('tests/platform/fixtures/' + match[1]);
  for(const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s*)['"](\.[^'"]+)['"]/g)){
    // Compose verification embeds node -e imports rooted at the container's
    // /app cwd, rather than at the host verification script directory.
    const dependency=relative.startsWith('scripts/verify-desktop-business-')&&match[1].startsWith('./apps/')
      ? match[1].slice(2) : path.normalize(path.join(path.dirname(relative),match[1].split('?')[0]));
    await visit(dependency);
  }
}
for(const seed of seeds)await visit(seed);
await visit('packages/agent-capabilities/src/manifests/official-tools.mjs');await visit('packages/agent-capabilities/src/schema.mjs');
await visit('tests/platform/fixtures/paper-metadata-split-live-addition-success-v1.json');
const directory=path.join(root,'.runtime/paper-study');await fs.mkdir(directory,{recursive:true});
const scope=path.join(directory,'clean-scope.json');
const excludedAdminLine="getAdminCapabilityExecutionSnapshot: options => request('/v1/admin/capability-execution', { ...options, auth: true }),";
await fs.writeFile(scope,JSON.stringify({files:[...files],regenerateInventory:true,offlinePaperTests:true,deferred:['apps/desktop/native/MooyuWorkbench.cs','apps/desktop/src/workbench-service.mjs','apps/desktop/src/paper-review.mjs'],excludeLines:[{file:'packages/platform-api-client/src/index.mjs',lines:[excludedAdminLine]}],tests:[...legacyTests,'tests/platform/paper-study-window.test.cjs','tests/platform/paper-study.test.mjs','tests/platform/agent-paper-topic-plan.test.cjs','tests/platform/agent-paper-article-sections.test.cjs','tests/platform/agent-capabilities-registry.test.cjs','tests/platform/desktop-business-api.test.mjs','tests/platform/desktop-account-session.test.mjs']},null,2));
await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['scripts/verify-desktop-clean.mjs','--scope',scope],{cwd:root,windowsHide:true,stdio:'inherit'});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('PAPER_STUDY_CLEAN_CHECK_FAILED')));});
const report=JSON.parse(await fs.readFile(path.join(root,'.runtime/desktop-auth-clean/latest.json')));
if (!report.passed || !report.buildPassed) throw Error('PAPER_STUDY_CLEAN_CHECK_FAILED');
await sealPaperStudyBuild(report.directory, JSON.parse(await fs.readFile(scope)));
await fs.writeFile(path.join(directory,'clean-latest.json'),JSON.stringify({...report,oldD1Excluded:true,credentialsCopied:false,scope},null,2));
