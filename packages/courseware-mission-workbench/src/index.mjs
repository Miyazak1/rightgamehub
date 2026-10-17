const clone=value=>value===undefined?undefined:structuredClone(value);
const text=value=>String(value??'').replace(/[&<>"']/gu,character=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[character]);
const localize=(value,locale)=>typeof value==='string'?value:value?.[locale]??value?.['zh-CN']??value?.en??'';
const readPath=(value,path)=>String(path??'').split('.').reduce((current,key)=>current==null?undefined:current[key],value);
const clamp=(value,minimum,maximum)=>Math.max(minimum,Math.min(maximum,value));

export function deriveMissionViewModel({definition,state,assessment=null,locale='zh-CN'}={}){
  const nodes=definition?.nodes??[];
  const activeIndex=Math.max(0,nodes.findIndex(node=>node.id===state?.activeNodeId));
  const completedNodeIds=new Set(state?.completedNodeIds??[]);
  return {
    id:definition?.id??'',
    title:localize(definition?.title,locale),
    status:state?.status??'ready',
    outcomeId:state?.outcomeId??null,
    activeNodeId:state?.activeNodeId??definition?.initialNodeId??null,
    activeIndex,
    progress:nodes.length<=1?(completedNodeIds.size?1:0):clamp(completedNodeIds.size/(nodes.length-1),0,1),
    nodes:nodes.map(node=>({
      id:node.id,
      title:localize(node.title,locale),
      kind:node.kind,
      state:completedNodeIds.has(node.id)?'complete':node.id===state?.activeNodeId?'active':'pending',
    })),
    clocks:clone(state?.clocks??{}),
    resources:clone(state?.resources??{}),
    evidenceCount:state?.evidence?.length??0,
    mastered:Boolean(assessment?.mastered),
    lastAction:clone(state?.lastAction??null),
  };
}

export function missionActionButtonsMarkup(actions=[],locale='zh-CN',fallback=''){
  return actions.map(action=>`<button type="button" class="mission-primary" data-mission-action="${text(action.id)}">${text(localize(action.title,locale)||fallback)}</button>`).join('');
}

function fieldMarkup(field,reading,locale){
  const value=Number(readPath(reading,field.path));
  const shown=Number.isFinite(value)?value:Number(field.min??0);
  const unit=localize(field.unit,locale);
  return `<label class="mission-field"><span><b>${text(localize(field.label,locale))}</b><output data-field-output="${text(field.id)}">${text(shown.toFixed(field.precision??1))} ${text(unit)}</output></span><input type="range" data-mission-field="${text(field.id)}" min="${text(field.min)}" max="${text(field.max)}" step="${text(field.step)}" value="${text(shown)}" aria-label="${text(localize(field.label,locale))}"></label>`;
}

function metricMarkup(metric,value,locale){
  const numeric=Number(value);
  const shown=Number.isFinite(numeric)?numeric.toFixed(metric.precision??2):'—';
  return `<div class="mission-metric" data-mission-metric="${text(metric.id)}"><span>${text(localize(metric.label,locale))}</span><strong><span data-mission-metric-value>${text(shown)}</span> <small>${text(localize(metric.unit,locale))}</small></strong></div>`;
}

function statusCopy(status,locale){
  const copy={
    ready:{'zh-CN':'任务待命',en:'Mission ready'},
    running:{'zh-CN':'任务进行中',en:'Mission in progress'},
    succeeded:{'zh-CN':'任务完成',en:'Mission complete'},
    failed:{'zh-CN':'任务失败',en:'Mission failed'},
    partial:{'zh-CN':'部分完成',en:'Partially complete'},
  };
  return localize(copy[status]??copy.ready,locale);
}

export function createMissionWorkbench({root,runtime,missionModuleId,evidenceModel,evaluateEvidence,experience,locale='zh-CN',tickMilliseconds=1000}={}){
  if(!root||!runtime||!missionModuleId||!experience)throw new Error('Mission workbench requires root, runtime, missionModuleId and experience.');
  const definition=runtime.observe(missionModuleId,{kind:'definition'});
  let disposed=false,timer=null,feedback='';

  root.innerHTML=`<div class="mission-app" data-mission-status="ready">
    <header class="mission-topbar"><div class="mission-brand"><span class="mission-brand-mark">M</span><span>MOOYU MISSION LAB</span></div><div class="mission-title"><span>${text(localize(experience.subject,locale))}</span><strong>${text(localize(experience.title,locale)||localize(definition.title,locale))}</strong></div><div class="mission-actions"><button type="button" data-mission-reset>${text(locale==='zh-CN'?'新任务':'New mission')}</button></div></header>
    <section class="mission-hud"><div class="mission-route" data-mission-route></div><div class="mission-pressure"><div class="mission-pressure-copy"><span>${text(localize(experience.clockLabel,locale))}</span><strong data-clock-value>${text(experience.clockMaximum??120)} s</strong></div><div class="mission-pressure-track"><i data-clock-bar></i><span data-gate-marker></span></div></div><div class="mission-resource"><span>${text(localize(experience.resourceLabel,locale))}</span><strong data-resource-value>100%</strong></div></section>
    <main class="mission-main"><section class="mission-scene-panel"><div class="mission-scene-head"><div><span data-stage-kicker></span><h1 data-stage-title></h1><p data-stage-story></p></div><span class="mission-formula" data-stage-formula></span></div><div class="mission-world" data-mission-world><div class="mission-sky"><span class="star star-a"></span><span class="star star-b"></span><span class="star star-c"></span><span class="moon"></span></div><div class="mission-land land-a"></div><div class="mission-land land-b"></div><div class="mission-track"><i></i></div><div class="mission-checkpoint checkpoint-a"><span>01</span></div><div class="mission-checkpoint checkpoint-b"><span>02</span></div><div class="mission-gate"><i></i><i></i><b>${text(locale==='zh-CN'?'磁闸':'GATE')}</b></div><div class="mission-train" data-mission-train><span class="mission-core"></span><i class="wheel wheel-a"></i><i class="wheel wheel-b"></i></div><div class="mission-world-label" data-world-label></div></div><div class="mission-scene-note"><span data-feedback>${text(locale==='zh-CN'?'先阅读任务，再开始计时。':'Read the mission, then start the clock.')}</span><span data-evidence-count>证据 0</span></div></section>
      <aside class="mission-console"><div class="mission-console-head"><span>${text(locale==='zh-CN'?'计算工作台':'CALCULATION DESK')}</span><b data-console-step>01 / 04</b></div><div class="mission-brief"><small>${text(locale==='zh-CN'?'本阶段目标':'STAGE TARGET')}</small><p data-stage-target></p></div><div class="mission-fields" data-mission-fields></div><div class="mission-equation" data-stage-equation></div><div class="mission-metrics" data-mission-metrics></div><div class="mission-action-list" data-mission-actions></div><p class="mission-attempt-cost" data-attempt-cost></p></aside></main>
    <footer class="mission-footer"><div class="mission-help"><kbd>1</kbd><span>${text(locale==='zh-CN'?'读任务':'Read')}</span><i></i><kbd>2</kbd><span>${text(locale==='zh-CN'?'计算并调参':'Calculate')}</span><i></i><kbd>3</kbd><span>${text(locale==='zh-CN'?'提交方案':'Commit')}</span><i></i><kbd>4</kbd><span>${text(locale==='zh-CN'?'复盘证据':'Debrief')}</span></div><div class="mission-status"><span class="mission-status-dot"></span><strong data-mission-status-copy>${text(statusCopy('ready',locale))}</strong></div></footer>
    <div class="mission-overlay" data-mission-overlay hidden><section><span data-overlay-mark>✓</span><small data-overlay-kicker></small><h2 data-overlay-title></h2><p data-overlay-copy></p><div data-overlay-evidence></div><button type="button" data-mission-reset>${text(locale==='zh-CN'?'重新规划':'Plan again')}</button></section></div>
  </div>`;

  const app=root.querySelector('.mission-app');
  const query=selector=>root.querySelector(selector);
  const queryAll=selector=>[...root.querySelectorAll(selector)];
  const getState=()=>runtime.observe(missionModuleId);
  const getAssessment=state=>evaluateEvidence?evaluateEvidence(evidenceModel,state.evidence):null;
  const stageConfig=nodeId=>experience.stages[nodeId]??{};

  function setFeedback(message,tone='neutral'){
    feedback=message;
    const element=query('[data-feedback]');
    if(element){element.textContent=message;element.dataset.tone=tone;}
  }

  function renderPressure(state=getState()){
    const clockId=experience.clockId??Object.keys(state.clocks??{})[0],resourceId=experience.resourceId??Object.keys(state.resources??{})[0];
    const clock=Number(state.clocks?.[clockId]??0),clockMax=Number(experience.clockMaximum??120),resource=Number(state.resources?.[resourceId]??0),resourceMax=Number(experience.resourceMaximum??100);
    app.dataset.missionStatus=state.status??'ready';
    query('[data-clock-value]').textContent=`${Math.ceil(clock)} s`;
    query('[data-clock-bar]').style.width=`${clamp(clock/clockMax*100,0,100)}%`;
    query('[data-resource-value]').textContent=`${Math.round(clamp(resource/resourceMax*100,0,100))}%`;
    query('[data-mission-status-copy]').textContent=statusCopy(state.status,locale);
  }

  function renderStageTelemetry(stage,state=getState()){
    for(const metric of stage.metrics??[]){
      const numeric=Number(state.metrics?.[metric.id]),shown=Number.isFinite(numeric)?numeric.toFixed(metric.precision??2):'—';
      const value=query(`[data-mission-metric="${metric.id}"] [data-mission-metric-value]`);
      if(value)value.textContent=shown;
    }
  }

  function render(){
    if(disposed)return;
    const state=getState(),assessment=getAssessment(state),view=deriveMissionViewModel({definition,state,assessment,locale});
    const stage=stageConfig(view.activeNodeId);
    app.dataset.missionStatus=view.status;app.dataset.missionNode=view.activeNodeId??'';app.style.setProperty('--mission-progress',String(view.progress));
    query('[data-mission-route]').innerHTML=view.nodes.map((node,index)=>`<div class="mission-route-node" data-state="${node.state}"><span>${String(index+1).padStart(2,'0')}</span><b>${text(node.title)}</b></div>`).join('');
    renderPressure(state);
    query('[data-stage-kicker]').textContent=localize(stage.kicker,locale)||`${locale==='zh-CN'?'阶段':'Stage'} ${String(view.activeIndex+1).padStart(2,'0')}`;
    query('[data-stage-title]').textContent=localize(stage.title,locale)||view.nodes[view.activeIndex]?.title||'';
    query('[data-stage-story]').textContent=localize(stage.story,locale);
    query('[data-stage-formula]').textContent=localize(stage.formula,locale);
    query('[data-stage-target]').textContent=localize(stage.target,locale);
    query('[data-stage-equation]').innerHTML=localize(stage.equation,locale)||'';
    query('[data-world-label]').textContent=localize(stage.worldLabel,locale);
    query('[data-console-step]').textContent=`${String(view.activeIndex+1).padStart(2,'0')} / ${String(view.nodes.length).padStart(2,'0')}`;
    const readings=new Map();
    for(const field of stage.fields??[]){if(!readings.has(field.moduleId))readings.set(field.moduleId,runtime.observe(field.moduleId));}
    query('[data-mission-fields]').innerHTML=(stage.fields??[]).map(field=>fieldMarkup(field,readings.get(field.moduleId),locale)).join('');
    query('[data-mission-metrics]').innerHTML=(stage.metrics??[]).map(metric=>metricMarkup(metric,state.metrics?.[metric.id],locale)).join('');
    const actionList=query('[data-mission-actions]');
    if(view.status==='ready')actionList.innerHTML=`<button type="button" class="mission-primary" data-mission-primary>${text(localize(experience.startLabel,locale))}</button>`;
    else if(view.status==='running')actionList.innerHTML=missionActionButtonsMarkup(state.node?.actions??[],locale,localize(experience.commitLabel,locale));
    else actionList.innerHTML=`<button type="button" class="mission-primary" data-mission-primary>${text(localize(experience.restartLabel,locale))}</button>`;
    query('[data-attempt-cost]').textContent=view.status==='running'?localize(stage.cost,locale):localize(experience.readyHint,locale);
    query('[data-evidence-count]').textContent=`${locale==='zh-CN'?'证据':'Evidence'} ${view.evidenceCount}/${evidenceModel?.claims?.length??0}`;
    query('[data-mission-train]').style.left=`calc(8% + ${Math.round(view.progress*72)}%)`;
    if(feedback)setFeedback(feedback,query('[data-feedback]')?.dataset.tone??'neutral');
    if(['succeeded','failed','partial'].includes(view.status))showOverlay(view,assessment);
    else query('[data-mission-overlay]').hidden=true;
  }

  function showOverlay(view,assessment){
    const success=view.status==='succeeded',overlay=query('[data-mission-overlay]');overlay.hidden=false;
    query('[data-overlay-mark]').textContent=success?'✓':'!';query('[data-overlay-kicker]').textContent=success?(locale==='zh-CN'?'线路通行':'ROUTE CLEARED'):(locale==='zh-CN'?'任务中止':'MISSION STOPPED');
    query('[data-overlay-title]').textContent=success?localize(experience.successTitle,locale):localize(experience.failureTitle,locale);
    query('[data-overlay-copy]').textContent=success?localize(experience.successCopy,locale):localize(experience.failureCopy,locale);
    const objectives=assessment?.objectives??[];query('[data-overlay-evidence]').innerHTML=objectives.map(objective=>`<span data-mastered="${objective.mastered}">${objective.mastered?'✓':'○'} ${text(localize(experience.objectives?.[objective.id]??objective.id,locale))}</span>`).join('');
  }

  function reset(){runtime.dispatch(missionModuleId,'mission.reset');feedback=locale==='zh-CN'?'参数已复位，计时尚未开始。':'Parameters reset. The clock has not started.';render();}
  function primary(){
    const before=getState();
    if(before.status==='ready'){runtime.dispatch(missionModuleId,'mission.start');setFeedback(locale==='zh-CN'?'计时开始。每次提交都会消耗时间与能源。':'Clock started. Every submission costs time and energy.','warning');render();return;}
    if(['succeeded','failed','partial'].includes(before.status)){reset();return;}
  }
  function commitAction(actionId){
    const before=getState();if(before.status!=='running'||!before.node?.actions?.some(action=>action.id===actionId))return;
    runtime.dispatch(missionModuleId,'mission.act',{actionId});
    const after=getState(),passed=after.lastAction?.success;
    setFeedback(passed?(locale==='zh-CN'?'计算成立，列车进入下一段线路。':'Calculation accepted. The train advances.'):(locale==='zh-CN'?'方案未通过，代价已扣除；请根据读数重新计算。':'Plan rejected; cost applied. Recalculate from the readings.'),passed?'success':'danger');
    render();
  }

  function onInput(event){
    const input=event.target.closest?.('[data-mission-field]');if(!input)return;
    const state=getState(),stage=stageConfig(state.activeNodeId),field=(stage.fields??[]).find(item=>item.id===input.dataset.missionField);if(!field)return;
    runtime.dispatch(field.moduleId,field.command,{value:Number(input.value)});
    const output=query(`[data-field-output="${field.id}"]`);if(output)output.textContent=`${Number(input.value).toFixed(field.precision??1)} ${localize(field.unit,locale)}`;
    renderStageTelemetry(stage,getState());
  }
  function onClick(event){const action=event.target.closest?.('[data-mission-action]');if(action)commitAction(action.dataset.missionAction);else if(event.target.closest?.('[data-mission-primary]'))primary();else if(event.target.closest?.('[data-mission-reset]'))reset();}
  root.addEventListener('input',onInput);root.addEventListener('click',onClick);
  timer=setInterval(()=>{const before=getState();if(before.status==='running'&&globalThis.document?.visibilityState!=='hidden'){runtime.dispatch(missionModuleId,'mission.advance',{clockId:experience.clockId,amount:1});const after=getState();if(after.status!==before.status||after.activeNodeId!==before.activeNodeId)render();else renderPressure(after);}},Math.max(250,tickMilliseconds));
  render();
  return Object.freeze({render,reset,getViewModel:()=>{const state=getState();return deriveMissionViewModel({definition,state,assessment:getAssessment(state),locale});},destroy(){disposed=true;clearInterval(timer);root.removeEventListener('input',onInput);root.removeEventListener('click',onClick);}});
}
