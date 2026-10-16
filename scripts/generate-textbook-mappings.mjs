import fs from 'node:fs/promises';
import path from 'node:path';
import { loadKnowledgeMapDocument } from '../packages/creator-tools/src/knowledge-map.mjs';

const root=path.resolve('curricula/cn-upper-secondary/2017-2020');
const catalogPath=path.join(root,'catalog.json');
const checkOnly=process.argv.includes('--check');
const subjects=['mathematics','physics','chemistry'];
const eligible=node=>subjects.includes(node.subjectId)&&!['module','subject-root'].includes(node.type)&&node.curriculumLevels.some(level=>level==='required'||level==='selective-required');
const editions={
  'pep.math-a.required-1.2019':'数学A版必修第一册，第1版',
  'pep.math-a.required-2.2019':'数学A版必修第二册，第1版',
  'pep.math-a.selective-1.2019':'数学A版选择性必修第一册，第1版',
  'pep.math-a.selective-2.2019':'数学A版选择性必修第二册，第1版，ISBN 978-7-107-34597-5',
  'pep.math-a.selective-3.2019':'数学A版选择性必修第三册，第1版',
  'pep.physics.required-1.2019':'物理必修第一册，2019年6月第1版，ISBN 978-7-107-33576-1',
  'pep.physics.required-2.2019':'物理必修第二册，第1版',
  'pep.physics.required-3.2019':'物理必修第三册，第1版',
  'pep.physics.selective-1.2019':'物理选择性必修第一册，第1版',
  'pep.physics.selective-2.2019':'物理选择性必修第二册，第1版',
  'pep.physics.selective-3.2019':'物理选择性必修第三册，第1版',
  'pep.chemistry.required-1.2019':'化学必修第一册，第1版',
  'pep.chemistry.required-2.2019':'化学必修第二册，第1版',
  'pep.chemistry.selective-1.2020':'化学选择性必修1 化学反应原理，2020年5月第1版，ISBN 978-7-107-34604-0',
  'pep.chemistry.selective-2.2020':'化学选择性必修2 物质结构与性质，第1版',
  'pep.chemistry.selective-3.2020':'化学选择性必修3 有机化学基础，第1版'
};
const result=(editionId,locator,precision='chapter')=>({editionId,locator,precision});

function mathematics(node){
  const id=node.id;
  if(id.includes('.required.sets.')||id.endsWith('.required.preliminary.sets'))return result('pep.math-a.required-1.2019','第一章 集合与常用逻辑用语；集合相关小节','section');
  if(id.includes('.required.logic.')||id.endsWith('.required.preliminary.logic'))return result('pep.math-a.required-1.2019','第一章 集合与常用逻辑用语；常用逻辑用语相关小节','section');
  if(id.includes('.required.inequality.')||id.includes('.required.quadratic.')||id.endsWith('.required.preliminary.equality-inequality')||id.endsWith('.required.preliminary.quadratic-connections'))return result('pep.math-a.required-1.2019','第二章 一元二次函数、方程和不等式');
  if(id.includes('.required.trigonometry.')||id.endsWith('.required.functions.trigonometric'))return result('pep.math-a.required-1.2019','第五章 三角函数');
  if(id.includes('.required.functions.'))return /power|exponent|logarithm|exp-log|bisection|model-selection|growth-comparison|applications/.test(id)?result('pep.math-a.required-1.2019','第四章 指数函数与对数函数；函数应用'):result('pep.math-a.required-1.2019','第三章 函数的概念与性质');
  if(id.includes('.required.vectors.')||id.endsWith('.required.geometry-algebra.plane-vectors'))return result('pep.math-a.required-2.2019','第六章 平面向量及其应用');
  if(id.includes('.required.complex.')||id.endsWith('.required.geometry-algebra.complex'))return result('pep.math-a.required-2.2019','第七章 复数');
  if(id.includes('.required.solid.')||id.endsWith('.required.geometry-algebra.solid-geometry'))return result('pep.math-a.required-2.2019','第八章 立体几何初步');
  if(id.includes('.required.statistics.')||id.endsWith('.required.probability-statistics.statistics'))return result('pep.math-a.required-2.2019','第九章 统计');
  if(id.includes('.required.probability.')||id.endsWith('.required.probability-statistics.probability'))return result('pep.math-a.required-2.2019','第十章 概率');
  if(id.includes('.required.modeling')||id.includes('.required.inquiry')||id.includes('.required.research'))return result('pep.math-a.required-1.2019','必修教材中的数学建模、数学探究与课题研究活动','cross-volume');
  if(id.includes('.selective.spatial.')||id.endsWith('.selective.geometry-algebra.spatial-vectors'))return result('pep.math-a.selective-1.2019','第一章 空间向量与立体几何');
  if(id.includes('.selective.analytic.')||id.endsWith('.selective.geometry-algebra.analytic-geometry'))return result('pep.math-a.selective-1.2019',/lines|circles/.test(id)?'第二章 直线和圆的方程':'第三章 圆锥曲线的方程');
  if(id.includes('.selective.sequences.')||id.endsWith('.selective.functions.sequences'))return result('pep.math-a.selective-2.2019','第四章 数列');
  if(id.includes('.selective.derivative.')||id.endsWith('.selective.functions.derivative'))return result('pep.math-a.selective-2.2019','第五章 一元函数的导数及其应用');
  if(id.includes('.selective.counting.')||id.endsWith('.selective.probability-statistics.counting'))return result('pep.math-a.selective-3.2019','第六章 计数原理');
  if(id.includes('.selective.probability.')||id.endsWith('.selective.probability-statistics.probability'))return result('pep.math-a.selective-3.2019','第七章 随机变量及其分布');
  if(id.includes('.selective.statistics.')||id.endsWith('.selective.probability-statistics.statistics'))return result('pep.math-a.selective-3.2019','第八章 成对数据的统计分析');
  if(id.includes('.selective.research')||id.endsWith('.selective.modeling-inquiry'))return result('pep.math-a.selective-3.2019','选择性必修教材中的数学建模、数学探究与课题研究活动','cross-volume');
}

function physics(node){
  const id=node.id;
  if(id.includes('.required-1.')||/experiment\.(instantaneous-speed|spring-force-deformation|force-composition|acceleration-force-mass)/.test(id)){
    if(/particle-model|kinematics|instantaneous-speed|experimental-science/.test(id))return result('pep.physics.required-1.2019','第一章 运动的描述');
    if(/free-fall/.test(id))return result('pep.physics.required-1.2019','第二章 匀变速直线运动的研究');
    if(/forces-hooke-friction|spring-force-deformation|force-composition/.test(id))return result('pep.physics.required-1.2019','第三章 相互作用——力');
    return result('pep.physics.required-1.2019','第四章 运动和力的关系');
  }
  if(id.includes('.required-2.')||/experiment\.(mechanical-energy-conservation|projectile-motion|centripetal-force)/.test(id)){
    if(/curved-projectile|projectile-motion/.test(id))return result('pep.physics.required-2.2019','第五章 抛体运动');
    if(/circular-motion|centripetal-force/.test(id))return result('pep.physics.required-2.2019','第六章 圆周运动');
    if(/gravitation|newtonian-limits/.test(id))return result('pep.physics.required-2.2019','第七章 万有引力与宇宙航行');
    return result('pep.physics.required-2.2019','第八章 机械能守恒定律');
  }
  if(id.includes('.required-3.')||/experiment\.(capacitor-charge-discharge|length-measurement|resistivity|multimeter|source-emf-internal-resistance)/.test(id)){
    if(/charge-coulomb|electric-field|potential-particle/.test(id))return result('pep.physics.required-3.2019','第九章 静电场及其应用、第十章 静电场中的能量');
    if(/capacitor/.test(id))return result('pep.physics.required-3.2019','第十章 静电场中的能量；电容器相关小节','section');
    if(/resistance|series-parallel|closed-circuit|electric-energy|length-measurement|resistivity|multimeter|source-emf/.test(id))return result('pep.physics.required-3.2019','第十一章 电路及其应用、第十二章 电能 能量守恒定律');
    if(/magnetic-field|induction|em-waves/.test(id))return result('pep.physics.required-3.2019','第十三章 电磁感应与电磁波初步');
    return result('pep.physics.required-3.2019','第十四章 能源与可持续发展');
  }
  if(id.includes('.selective-required-1.')||/experiment\.(momentum-conservation|pendulum-gravity|glass-refractive-index|double-slit-wavelength)/.test(id)){
    if(/momentum|collision/.test(id))return result('pep.physics.selective-1.2019','第一章 动量守恒定律');
    if(/simple-harmonic|pendulum|forced-resonance/.test(id))return result('pep.physics.selective-1.2019','第二章 机械振动');
    if(/mechanical-waves|wave-phenomena|doppler/.test(id))return result('pep.physics.selective-1.2019','第三章 机械波');
    return result('pep.physics.selective-1.2019','第四章 光');
  }
  if(id.includes('.selective-required-2.')||/experiment\.(induced-current-direction|transformer-turns-voltage|sensor-control-device)/.test(id)){
    if(/ampere|lorentz|charged-particle/.test(id))return result('pep.physics.selective-2.2019','第一章 安培力与洛伦兹力');
    if(/lenz|faraday|self-induction|induced-current/.test(id))return result('pep.physics.selective-2.2019','第二章 电磁感应');
    if(/alternating|transformer|generators-motors/.test(id))return result('pep.physics.selective-2.2019','第三章 交变电流');
    if(/maxwell|em-oscillation|em-wave-spectrum/.test(id))return result('pep.physics.selective-2.2019','第四章 电磁振荡与电磁波');
    return result('pep.physics.selective-2.2019','第五章 传感器');
  }
  if(id.includes('.selective-required-3.')||/experiment\.(oil-film-molecule-size|isothermal-gas-pressure-volume)/.test(id)){
    if(/molecular-size|diffusion-brownian|oil-film/.test(id))return result('pep.physics.selective-3.2019','第一章 分子动理论');
    if(/material-structures|surface-tension|gas-laws|isothermal/.test(id))return result('pep.physics.selective-3.2019','第二章 气体、固体和液体');
    if(/first-law|energy-conservation|second-law/.test(id))return result('pep.physics.selective-3.2019','第三章 热力学定律');
    if(/atomic-model|photoelectric|matter-waves/.test(id))return result('pep.physics.selective-3.2019','第四章 原子结构和波粒二象性');
    return result('pep.physics.selective-3.2019','第五章 原子核');
  }
}

function selectiveChemistry(id){
  if(/selective-required\.energy|experiment\.(electroplating|fuel-cell)/.test(id))return result('pep.chemistry.selective-1.2020',/electrochemistry|electroplating|fuel-cell/.test(id)?'第四章 化学反应与电能':'第一章 化学反应的热效应');
  if(/selective-required\.equilibrium|experiment\.equilibrium-shift/.test(id))return result('pep.chemistry.selective-1.2020','第二章 化学反应速率与化学平衡');
  if(/selective-required\.aqueous|experiment\.(acid-base-titration|salt-hydrolysis)/.test(id))return result('pep.chemistry.selective-1.2020','第三章 水溶液中的离子反应与平衡');
  if(/selective-required\.structure|experiment\.coordination-compound/.test(id)){
    if(/electron-state|configuration-periodicity|exploration-scales/.test(id))return result('pep.chemistry.selective-2.2020','第一章 原子结构与性质');
    if(/particle-interactions|covalent-geometry|coordination/.test(id))return result('pep.chemistry.selective-2.2020','第二章 分子结构与性质');
    return result('pep.chemistry.selective-2.2020','第三章 晶体结构与性质；结构测定与设计相关内容');
  }
  if(/selective-required\.organic|experiment\.(ethyl-acetate|functional-group-tests|carbohydrate-properties)/.test(id)){
    if(/structure-analysis|functional-groups|bonds-reactivity/.test(id))return result('pep.chemistry.selective-3.2020','第一章 有机化合物的结构特点与研究方法');
    if(/hydrocarbons/.test(id))return result('pep.chemistry.selective-3.2020','第二章 烃');
    if(/derivatives|synthesis|safe-use|ethyl-acetate|functional-group-tests/.test(id))return result('pep.chemistry.selective-3.2020','第三章 烃的衍生物；有机合成');
    if(/biomolecules|carbohydrate-properties/.test(id))return result('pep.chemistry.selective-3.2020','第四章 生物大分子');
    return result('pep.chemistry.selective-3.2020','第五章 合成高分子');
  }
}

function chemistry(node){
  const id=node.id;
  if(/experiment\.(electroplating|fuel-cell|equilibrium-shift|acid-base-titration|salt-hydrolysis|coordination-compound|ethyl-acetate|functional-group-tests|carbohydrate-properties)/.test(id)||id.includes('.selective-required.'))return selectiveChemistry(id);
  if(/science-inquiry|inorganic\.(classification|redox|ionic-reactions)|experiment\.(solution-concentration|crude-salt-purification)/.test(id))return result('pep.chemistry.required-1.2019','第一章 物质及其变化；教材实验活动');
  if(/amount-of-substance|inorganic\.metals|experiment\.iron-compounds/.test(id))return result('pep.chemistry.required-1.2019','第二章 海水中的重要元素——钠和氯、第三章 铁 金属材料');
  if(/atomic-periodic|bonds|experiment\.periodic-trends/.test(id))return result('pep.chemistry.required-1.2019','第四章 物质结构 元素周期律');
  if(/inorganic\.nonmetals|experiment\.sulfur-transformations/.test(id))return result('pep.chemistry.required-2.2019','第五章 化工生产中的重要非金属元素');
  if(/rate-equilibrium|energy-cells|experiment\.(reaction-rate-factors|chemical-to-electrical-energy)/.test(id))return result('pep.chemistry.required-2.2019','第六章 化学反应与能量');
  if(/required\.organic|experiment\.(organic-ball-stick|ethanol-acetic-acid)/.test(id))return result('pep.chemistry.required-2.2019','第七章 有机化合物');
  if(/required\.society/.test(id))return result('pep.chemistry.required-2.2019','第八章 化学与可持续发展');
}

const resolver={mathematics,physics,chemistry};
const loaded=await loadKnowledgeMapDocument(catalogPath);
if(loaded.error)throw new Error(loaded.error.message);
const baseline=JSON.parse(await fs.readFile(path.join(root,'textbook-baseline.json'),'utf8'));
const baselineEditionIds=new Set(baseline.editions.map(item=>item.id));
for(const editionId of Object.keys(editions))if(!baselineEditionIds.has(editionId))throw new Error(`教材基线缺少生成规则引用的版本：${editionId}`);
const existingNodeIds=new Set(loaded.document.textbookMappings.filter(item=>!item.baselineEditionId).map(item=>item.nodeId));
const targets=loaded.document.nodes.filter(eligible),unresolved=[];
const bySubject=new Map(subjects.map(subject=>[subject,[]]));
for(const node of targets){
  if(existingNodeIds.has(node.id))continue;
  const mapping=resolver[node.subjectId](node);
  if(!mapping){unresolved.push(node.id);continue;}
  const edition=editions[mapping.editionId];
  if(!edition)throw new Error(`未知教材版本 ${mapping.editionId}`);
  const mappingId=`pep.map.${node.id.replace(/^cn-hs\./,'')}`;
  if(mappingId.length>127)throw new Error(`教材映射 ID 过长：${mappingId}`);
  bySubject.get(node.subjectId).push({id:mappingId,nodeId:node.id,publisher:'人民教育出版社',edition,baselineEditionId:mapping.editionId,precision:mapping.precision,locator:mapping.locator,review:{status:'source-checked',sourceChecked:true,subjectChecked:false,note:'按教育部目录、人教社第11套教材体系和官方章节目次建立首套章节级映射；待具名学科教师复核。'}});
}
if(unresolved.length)throw new Error(`存在 ${unresolved.length} 个未覆盖节点：\n${unresolved.join('\n')}`);
for(const subject of subjects){
  const document={format:'mooyu.curriculum-knowledge-map-fragment',schemaVersion:1,id:`cn-hs.${subject}.textbook-mappings.pep.2026`,subjectId:subject,nodes:[],relations:[],clusters:[],textbookMappings:bySubject.get(subject),review:{status:'source-checked',sourceChecked:true,subjectChecked:false,note:'平台首套人教版教材章节映射；只覆盖必修、选择性必修的原子知识节点，结构节点与学校自主选修不计入教材映射分母。'}};
  const target=path.join(root,'subjects',`${subject}-textbook-mappings.json`),serialized=`${JSON.stringify(document,null,2)}\n`;
  if(checkOnly){const current=await fs.readFile(target,'utf8').catch(()=>null);if(current!==serialized)throw new Error(`教材映射生成物不是最新：${target}`);}else await fs.writeFile(target,serialized,'utf8');
}
const manual=targets.filter(node=>existingNodeIds.has(node.id)).length,generated=[...bySubject.values()].reduce((sum,items)=>sum+items.length,0);
process.stdout.write(`${JSON.stringify({mode:checkOnly?'check':'write',targetNodes:targets.length,manualMappings:manual,generatedMappings:generated,totalCovered:manual+generated},null,2)}\n`);
