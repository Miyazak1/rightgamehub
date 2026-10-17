const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {pathToFileURL}=require('node:url');

const root=path.resolve(__dirname,'../..');
const canonical=path.join(root,'packages/courseware-ui-kit/src/index.mjs');
const releaseCopy=path.join(root,'templates/courseware/kinematics-motion/modules/ui-kit/index.mjs');

test('the motion courseware consumes the canonical hot-swappable UI shell',async()=>{
  const [canonicalBytes,releaseBytes,html,manifest,moduleManifest,journeys]=await Promise.all([
    fs.readFile(canonical),
    fs.readFile(releaseCopy),
    fs.readFile(path.join(root,'templates/courseware/kinematics-motion/dist/index.html'),'utf8'),
    fs.readFile(path.join(root,'templates/courseware/kinematics-motion/mooyu-courseware.json'),'utf8').then(JSON.parse),
    fs.readFile(path.join(root,'templates/courseware/kinematics-motion/modules/ui-kit/module.json'),'utf8').then(JSON.parse),
    fs.readFile(path.join(root,'templates/courseware/kinematics-motion/tests/journeys.json'),'utf8').then(JSON.parse),
  ]);
  assert.deepEqual(releaseBytes,canonicalBytes,'the release copy must stay byte-identical to the canonical UI Kit');
  assert.equal(manifest.runtime.modules[0],'modules/ui-kit/module.json');
  assert.equal(manifest.runtime.rootModules[0],'component.courseware-ui');
  assert.equal(moduleManifest.id,'component.courseware-ui');
  assert.equal(moduleManifest.hotSwap,'live');
  assert.match(html,/\.\/_mooyu\/bootstrap\.mjs/u);
  assert.doesNotMatch(html,/id="locale"|language-action|data-locale-switch/u);
  assert.match(html,/function applyLocale\(next\)/u);
  assert.match(html,/if\(name==='locale\.set'\)applyLocale\(value\?\.locale\)/u);
  assert.match(html,/document\.documentElement\.lang=locale/u);
  assert.match(html,/MOOYU LEARNING LAB/u);
  assert.match(html,/data-copy="textbook"/u);
  assert.match(html,/function exportState\(requestId\)/u);
  assert.match(html,/objects:records\.map/u);
  assert.match(html,/function restoreState\(value\)/u);
  assert.match(html,/challenge\.restore/u);
  assert.match(html,/id="sandboxTrialCount"/u);
  assert.match(html,/id="analysisChallengeMessage"/u);
  const matrix=['textbook','sandbox','signal'].flatMap(mode=>['explore','model','analyse'].map(view=>`${mode}-${view}`));
  assert.deepEqual(matrix.filter(id=>journeys.journeys.some(journey=>journey.id===id)),matrix);
  assert.ok(journeys.journeys.some(journey=>journey.locale==='en'&&journey.expectsCompletion));
  const host=await fs.readFile(path.join(root,'samples/courseware-embed/kinematics-motion.html'),'utf8');
  assert.match(host,/data-state-action="export"/u);
  assert.match(host,/data-state-action="restore"/u);
});

test('the UI Kit courseware passes Doctor with a seven-module locked release',async()=>{
  const {inspectCoursewareProject,describeCoursewareProject}=await import(pathToFileURL(path.join(root,'packages/creator-tools/src/index.mjs')).href);
  const templateRoot=path.join(root,'templates/courseware/kinematics-motion');
  const report=await inspectCoursewareProject(templateRoot);
  assert.equal(report.ok,true,JSON.stringify(report.findings,null,2));
  const summary=await describeCoursewareProject(templateRoot);
  assert.equal(summary.counts.modules,7);
  assert.ok(report.findings.some(finding=>finding.code==='COURSEWARE_MODULE_GRAPH_READY'&&finding.message.startsWith('7 个模块')));
  const manifest=JSON.parse(await fs.readFile(path.join(templateRoot,'mooyu-courseware.json'),'utf8'));
  assert.equal(manifest.runtime.rootModules[0],'component.courseware-ui');
});

test('mathematics, physics, and chemistry share the gold-standard shell and 3 by 3 release gate',async()=>{
  const packages=['concept-explorer','derivative-optimization','kinematics-motion','algorithm-stepper'];
  const expectedModes=['textbook','sandbox','signal'];
  const expectedViews=['explore','model','analyse'];
  const expectedJourneys=expectedModes.flatMap(mode=>expectedViews.map(view=>`${mode}-${view}`));
  const canonicalBytes=await fs.readFile(canonical);
  for(const name of packages){
    const templateRoot=path.join(root,'templates/courseware',name);
    const [manifest,experience,journeys,html,releaseBytes]=await Promise.all([
      fs.readFile(path.join(templateRoot,'mooyu-courseware.json'),'utf8').then(JSON.parse),
      fs.readFile(path.join(templateRoot,'courseware/experience.json'),'utf8').then(JSON.parse),
      fs.readFile(path.join(templateRoot,'tests/journeys.json'),'utf8').then(JSON.parse),
      fs.readFile(path.join(templateRoot,'dist/index.html'),'utf8'),
      fs.readFile(path.join(templateRoot,'modules/ui-kit/index.mjs')),
    ]);
    assert.deepEqual(releaseBytes,canonicalBytes,`${name} must carry the canonical UI Kit bytes`);
    assert.equal(manifest.runtime.rootModules[0],'component.courseware-ui');
    assert.deepEqual(experience.modes.map(mode=>mode.id),expectedModes);
    assert.deepEqual(experience.views.map(view=>view.id),expectedViews);
    assert.ok(expectedJourneys.every(id=>journeys.journeys.some(journey=>journey.id===id)),`${name} must cover every matrix cell`);
    assert.ok(journeys.journeys.some(journey=>journey.locale==='en'&&journey.expectsCompletion));
    assert.doesNotMatch(html,/id="locale"|id="lang"|class="[^"]*language-action/u);
    if(['concept-explorer','derivative-optimization'].includes(name))assert.match(html,/data-toolbar-rows="2"/u,'the two-row mathematics tool shelf must opt into the shared row-aware toolbar contract');
    else assert.doesNotMatch(html,/data-toolbar-rows="2"/u,`${name} must retain the single-row toolbar contract`);
    if(name==='derivative-optimization'){
      assert.match(html,/runtime\.dispatch\('challenge\.optimization-target','challenge\.reset'\)/u);
      assert.match(html,/challengeAttempts=0/u);
    }
  }
});

test('the reusable starter exposes the shell roles without domain-specific logic',async()=>{
  const [profile,starter]=await Promise.all([
    fs.readFile(path.join(root,'packages/courseware-ui-kit/starter/profile.json'),'utf8').then(JSON.parse),
    fs.readFile(path.join(root,'packages/courseware-ui-kit/starter/index.html'),'utf8'),
  ]);
  assert.equal(profile.requiredJourneyIds.length,9);
  assert.deepEqual(profile.experienceModes,['textbook','sandbox','signal']);
  assert.deepEqual(profile.viewModes,['explore','model','analyse']);
  assert.match(starter,/class="cw-shell"/u);
  assert.match(starter,/class="cw-toolbar"/u);
  assert.match(starter,/class="cw-workspace"/u);
  assert.match(starter,/class="cw-transport"/u);
  assert.doesNotMatch(starter,/physics|chemistry|quadratic/iu);
});

test('the UI Kit installs once and audits the gold-standard 3 by 3 contract without a browser',async()=>{
  const kit=await import(`${pathToFileURL(canonical).href}?test=${Date.now()}`);
  const rootElement={dataset:{},querySelector:selector=>selector.includes('#locale')?null:{},querySelectorAll:selector=>selector==='[data-experience-mode]'?['textbook','sandbox','signal'].map(experienceMode=>({dataset:{experienceMode}})):selector==='[data-mode]'?['explore','model','analyse'].map(mode=>({dataset:{mode}})):[]};
  const nodes=new Map();
  const document={
    head:{append:node=>nodes.set(node.id,node)},
    createElement:()=>({id:'',dataset:{},textContent:''}),
    getElementById:id=>nodes.get(id)??null,
    querySelector:selector=>selector==='[data-mooyu-scene]'?rootElement:null,
  };
  const first=kit.installCoursewareUiKit({document});
  const second=kit.installCoursewareUiKit({document});
  assert.equal(first.installed,true);
  assert.equal(second.installed,true);
  assert.equal(nodes.size,1,'reinstalling must not duplicate the stylesheet');
  assert.equal(rootElement.dataset.coursewareShell,'v1');
  assert.equal(rootElement.dataset.coursewareDensity,'compact');
  assert.equal(kit.auditCoursewareShell(rootElement).ok,true);
  assert.deepEqual(kit.GOLD_STANDARD_EXPERIENCE_MODES,['textbook','sandbox','signal']);
  assert.deepEqual(kit.GOLD_STANDARD_VIEW_MODES,['explore','model','analyse']);
  assert.equal(Object.keys(kit.GOLD_STANDARD_MATRIX).length,9);
  assert.equal(kit.auditGoldStandardCourseware(rootElement).matrixSize,9);
  assert.equal(kit.auditGoldStandardCourseware(rootElement).ok,true);
  assert.match(kit.coursewareShellCss,/--cw-control-height:54px/u);
  assert.match(kit.coursewareShellCss,/data-toolbar-rows="2"/u);
  assert.match(kit.coursewareShellCss,/--cw-toolbar-height:100px;--cw-control-height:40px/u);
  assert.match(kit.coursewareShellCss,/--cw-toolbar-height:92px;--cw-control-height:36px/u);
  assert.match(kit.coursewareShellCss,/focus-visible/u);
});

test('the UI Kit layout audit rejects toolbar collisions and accepts bounded shell geometry',async()=>{
  const kit=await import(`${pathToFileURL(canonical).href}?layout=${Date.now()}`);
  const rect=(left,top,right,bottom)=>({left,top,right,bottom,width:right-left,height:bottom-top});
  const node=box=>({getBoundingClientRect:()=>box});
  const createRoot=({secondRowTop=101,scrollWidth=1000}={})=>{
    const header=node(rect(0,0,1000,50));
    const rows=[node(rect(12,57,988,97)),node(rect(12,secondRowTop,988,secondRowTop+40))];
    const controls=[node(rect(130,57,320,97)),node(rect(130,secondRowTop,320,secondRowTop+40))];
    const toolbar={...node(rect(0,50,1000,150)),querySelectorAll:selector=>selector.startsWith('.tool-row')?rows:controls};
    const lesson=node(rect(0,150,1000,740));
    const transport=node(rect(0,740,1000,800));
    const regions=new Map([
      ['.top,.cw-shell__header,.workbench-nav',header],
      ['.tools,.cw-toolbar,.tool-shelf',toolbar],
      ['.lesson,.cw-lesson,.lesson-panel,.workspace',lesson],
      ['.transport,.cw-transport',transport],
    ]);
    return {clientWidth:1000,scrollWidth,getBoundingClientRect:()=>rect(0,0,1000,800),querySelector:selector=>regions.get(selector)??null,ownerDocument:{defaultView:{getComputedStyle:()=>({display:'block',visibility:'visible'})}}};
  };
  const valid=kit.auditCoursewareLayout(createRoot());
  assert.equal(valid.ok,true,JSON.stringify(valid.issues));
  assert.deepEqual(valid.metrics,{regions:4,toolbarRows:2,toolbarControls:2});
  const invalid=kit.auditCoursewareLayout(createRoot({secondRowTop:92,scrollWidth:1015}));
  assert.equal(invalid.ok,false);
  assert.ok(invalid.issues.some(issue=>issue.code==='toolbar-row-overlap'));
  assert.ok(invalid.issues.some(issue=>issue.code==='root-horizontal-overflow'));
});
