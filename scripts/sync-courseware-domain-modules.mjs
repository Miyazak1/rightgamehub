import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const targets=['templates/courseware','plugins/gamehub/templates/courseware'];
const shared={
  measurement:{ source:'packages/courseware-domain-packs/src/instrument/measurement.mjs',id:'instrument.measurement',kind:'instrument',hotSwap:'live',capabilities:['instrument.measurement'],commands:['instrument.channel.set','measurement.record','comparison.select','measurement.clear'] },
  workbench:{ source:'packages/courseware-domain-packs/src/component/workbench.mjs',id:'component.workbench',kind:'component',hotSwap:'live',capabilities:['component.workbench'],commands:['experience.set','panel.set','locale.set','motion.set'] },
  journey:{ source:'packages/courseware-domain-packs/src/journey/progress.mjs',id:'journey.progress',kind:'journey',hotSwap:'paused',capabilities:['journey.progress'],commands:['scene.complete','checkpoint.complete','progress.reset'] },
  embed:{ source:'packages/courseware-domain-packs/src/embed/bridge.mjs',id:'embed.bridge',kind:'embed',hotSwap:'session',capabilities:['embed.bridge'],commands:['embed.ready','embed.command.received','embed.state.exported'] },
};
const lessons={
  'concept-explorer':{ source:'packages/courseware-domain-packs/src/math/quadratic.mjs',id:'math.quadratic',capability:'domain.function',commands:['coefficient.set','sample.set','reference.toggle','model.reset'],challenge:{source:'packages/courseware-domain-packs/src/challenge/quadratic-target.mjs',id:'challenge.quadratic-target'} },
  'causal-simulation':{ source:'packages/courseware-domain-packs/src/physics/newton-cart.mjs',id:'physics.newton-cart',capability:'domain.motion',commands:['force.set','mass.set','simulation.run','simulation.pause','simulation.reset','simulation.step','measurement.record'],challenge:{source:'packages/courseware-domain-packs/src/challenge/supply-cart.mjs',id:'challenge.supply-cart'} },
  'algorithm-stepper':{ source:'packages/courseware-domain-packs/src/chemistry/equilibrium.mjs',id:'chemistry.equilibrium',capability:'domain.equilibrium',commands:['volume.set','temperature.set','catalyst.toggle','feed.set','simulation.run','simulation.pause','simulation.step','simulation.reset'],challenge:{source:'packages/courseware-domain-packs/src/challenge/safe-no2-batch.mjs',id:'challenge.safe-no2-batch'} },
};
const digest=bytes=>`sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
const writeModule=async(base,name,definition,dependencies=[])=>{
  const directory=path.join(base,'modules',name); await fs.mkdir(directory,{recursive:true});
  const source=await fs.readFile(path.join(root,definition.source),'utf8');
  const bytes=Buffer.from(source.replace(/\r\n?/gu,'\n'),'utf8');
  await fs.writeFile(path.join(directory,'index.mjs'),bytes);
  const manifest={ format:'mooyu.courseware-module',schemaVersion:1,id:definition.id,version:'1.0.0',kind:definition.kind??'domain',apiVersion:1,entry:'./index.mjs',integrity:digest(bytes),hotSwap:definition.hotSwap??'paused',stateSchemaVersion:1,capabilities:definition.capabilities??[definition.capability],commands:definition.commands,dependencies };
  await fs.writeFile(path.join(directory,'module.json'),`${JSON.stringify(manifest,null,2)}\n`);
};

for(const target of targets)for(const [lesson,domain] of Object.entries(lessons)){
  const base=path.join(root,target,lesson);
  await writeModule(base,'domain',domain);
  await writeModule(base,'measurement',shared.measurement,[{ id:domain.id,apiVersion:1,capabilities:[domain.capability] }]);
  await writeModule(base,'workbench',shared.workbench);
  await writeModule(base,'challenge',{...domain.challenge,kind:'challenge',hotSwap:'paused',capabilities:['challenge.evaluate'],commands:['challenge.attempt','challenge.reset']},[{ id:domain.id,apiVersion:1,capabilities:[domain.capability] }]);
  await writeModule(base,'journey',shared.journey);
  await writeModule(base,'embed',shared.embed);
}
for(const lesson of Object.keys(lessons))await fs.copyFile(path.join(root,'templates/courseware',lesson,'dist/index.html'),path.join(root,'plugins/gamehub/templates/courseware',lesson,'dist/index.html'));
console.log('Synchronized structured courseware domain modules.');
