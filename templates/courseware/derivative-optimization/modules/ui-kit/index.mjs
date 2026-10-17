export const COURSEWARE_UI_KIT_VERSION='1.4.2';
export const GOLD_STANDARD_EXPERIENCE_MODES=Object.freeze(['textbook','sandbox','signal']);
export const GOLD_STANDARD_VIEW_MODES=Object.freeze(['explore','model','analyse']);
export const GOLD_STANDARD_MATRIX=Object.freeze(Object.fromEntries(
  GOLD_STANDARD_EXPERIENCE_MODES.flatMap(experience=>GOLD_STANDARD_VIEW_MODES.map(view=>[
    `${experience}-${view}`,Object.freeze({experience,view}),
  ])),
));

const STYLE_ID='mooyu-courseware-ui-kit';
const ROOT_SELECTOR='[data-mooyu-scene]';

export const coursewareShellCss=`
[data-courseware-shell="v1"]{
  --cw-paper:#fbfaf5;--cw-ink:#172523;--cw-muted:#68726e;--cw-line:#d9d5ca;
  --cw-accent:#7255df;--cw-accent-soft:#eeeafd;--cw-ready:#53a285;
  --cw-header-height:54px;--cw-toolbar-height:70px;--cw-transport-height:58px;
  --cw-control-height:54px;--cw-radius:9px;--cw-gap:8px;
  --cw-font-caption:10px;--cw-font-control:12px;--cw-font-body:12px;--cw-font-title:24px;
  color:var(--cw-ink);background:var(--cw-paper);
}
[data-courseware-shell="v1"][data-toolbar-rows="2"]{
  --cw-toolbar-height:100px;--cw-control-height:40px;--cw-gap:4px;
}
[data-courseware-shell="v1"].book,[data-courseware-shell="v1"].cw-shell{
  height:100dvh;min-height:0;overflow:hidden;
  grid-template-rows:var(--cw-header-height) var(--cw-toolbar-height) minmax(0,1fr) var(--cw-transport-height);
}
[data-courseware-shell="v1"] .top,[data-courseware-shell="v1"] .cw-shell__header,[data-courseware-shell="v1"] .workbench-nav{
  min-width:0;min-height:0;border-bottom:1px solid var(--cw-line);
}
[data-courseware-shell="v1"] .segments,[data-courseware-shell="v1"] .cw-experiences,[data-courseware-shell="v1"] .experience-switch{
  flex:0 0 auto;border:1px solid #dbd7cc;border-radius:var(--cw-radius);
}
[data-courseware-shell="v1"] .views,[data-courseware-shell="v1"] .cw-views,[data-courseware-shell="v1"] .mode-tabs{min-width:0}
[data-courseware-shell="v1"] .top-actions,[data-courseware-shell="v1"] .cw-shell__status{min-width:0}
[data-courseware-shell="v1"] .tools,[data-courseware-shell="v1"] .cw-toolbar,[data-courseware-shell="v1"] .tool-shelf{
  align-items:center;min-width:0;min-height:0;overflow:hidden;gap:var(--cw-gap);padding:7px 16px;
  border-bottom:1px solid var(--cw-line);
}
[data-courseware-shell="v1"] .tool-label,[data-courseware-shell="v1"] .cw-toolbar__label{
  height:var(--cw-control-height);min-height:0;overflow:hidden;
}
[data-courseware-shell="v1"] .tool,[data-courseware-shell="v1"] .cw-tool{
  height:var(--cw-control-height);min-width:0;min-height:0;overflow:hidden;
  grid-template-rows:16px 16px;align-content:center;gap:3px 12px;padding:6px 12px;
  border:1px solid #ddd9cf;border-radius:var(--cw-radius);background:#fff;
}
[data-courseware-shell="v1"] .tool label,[data-courseware-shell="v1"] .cw-tool__label,
[data-courseware-shell="v1"] .tool output,[data-courseware-shell="v1"] .cw-tool__value{line-height:16px}
[data-courseware-shell="v1"] .tool input[type="range"],[data-courseware-shell="v1"] .cw-tool input[type="range"]{
  width:100%;height:16px;margin:0;touch-action:none;
}
[data-courseware-shell="v1"] .tool-buttons,[data-courseware-shell="v1"] .cw-toolbar__actions{
  height:var(--cw-control-height);min-width:0;min-height:0;align-self:center;
}
[data-courseware-shell="v1"] .tool-buttons button,[data-courseware-shell="v1"] .cw-toolbar__actions button{
  height:var(--cw-control-height);min-height:0;
}
[data-courseware-shell="v1"][data-toolbar-rows="2"] .tool-shelf,
[data-courseware-shell="v1"][data-toolbar-rows="2"] .cw-toolbar{
  grid-template-rows:repeat(2,minmax(0,1fr));align-items:stretch;
}
[data-courseware-shell="v1"][data-toolbar-rows="2"] .tool-row{
  height:var(--cw-control-height);min-height:0;
}
[data-courseware-shell="v1"] .lesson,[data-courseware-shell="v1"] .cw-lesson,[data-courseware-shell="v1"] .lesson-panel,
[data-courseware-shell="v1"] .workspace,[data-courseware-shell="v1"] .cw-workspace{
  min-width:0;min-height:0;
}
[data-courseware-shell="v1"] .transport,[data-courseware-shell="v1"] .cw-transport{
  min-width:0;min-height:0;border-top:1px solid var(--cw-line);
}
[data-courseware-shell="v1"] button:focus-visible,[data-courseware-shell="v1"] input:focus-visible,
[data-courseware-shell="v1"] [tabindex="0"]:focus-visible{outline:3px solid #9b86ef;outline-offset:2px}
@media(max-height:720px) and (min-width:781px){
  [data-courseware-shell="v1"].book,[data-courseware-shell="v1"].cw-shell{
    --cw-header-height:48px;--cw-toolbar-height:62px;--cw-transport-height:52px;
  }
  [data-courseware-shell="v1"][data-toolbar-rows="2"]{
    --cw-toolbar-height:92px;--cw-control-height:36px;--cw-gap:4px;
  }
}
@media(max-width:780px){
  [data-courseware-shell="v1"].book,[data-courseware-shell="v1"].cw-shell{
    height:auto;min-height:100dvh;overflow:visible;grid-template-rows:auto auto auto auto;
  }
  [data-courseware-shell="v1"] .tools,[data-courseware-shell="v1"] .cw-toolbar,[data-courseware-shell="v1"] .tool-shelf{overflow:visible}
  [data-courseware-shell="v1"] .tool-buttons,[data-courseware-shell="v1"] .cw-toolbar__actions{
    height:auto;align-self:stretch;
  }
}
@media(prefers-reduced-motion:reduce){
  [data-courseware-shell="v1"] *,[data-courseware-shell="v1"] *::before,[data-courseware-shell="v1"] *::after{
    scroll-behavior:auto!important;animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;
  }
}`;

export function installCoursewareUiKit({document:targetDocument=globalThis.document,density='compact'}={}){
  if(!targetDocument?.head)return Object.freeze({installed:false,version:COURSEWARE_UI_KIT_VERSION,root:null});
  let style=targetDocument.getElementById(STYLE_ID);
  if(!style){style=targetDocument.createElement('style');style.id=STYLE_ID;style.dataset.coursewareUiKit=COURSEWARE_UI_KIT_VERSION;style.textContent=coursewareShellCss;targetDocument.head.append(style)}
  const root=targetDocument.querySelector(ROOT_SELECTOR);
  if(root){root.dataset.coursewareShell='v1';root.dataset.coursewareDensity=density}
  return Object.freeze({installed:true,version:COURSEWARE_UI_KIT_VERSION,root});
}

export function auditCoursewareShell(root){
  const roles={header:'.top,.cw-shell__header,.workbench-nav',experiences:'.segments,.cw-experiences,.experience-switch',views:'.views,.cw-views,.mode-tabs',toolbar:'.tools,.cw-toolbar,.tool-shelf',lesson:'.lesson,.cw-lesson,.lesson-panel,.workspace',transport:'.transport,.cw-transport'};
  const missing=Object.entries(roles).filter(([,selector])=>!root?.querySelector?.(selector)).map(([role])=>role);
  const internalLocaleSwitch=Boolean(root?.querySelector?.('[data-locale-switch],#locale,.language-action'));
  return Object.freeze({ok:missing.length===0&&!internalLocaleSwitch,missing:Object.freeze(missing),internalLocaleSwitch});
}

export function auditCoursewareLayout(root,{tolerance=1}={}){
  const issues=[];
  const view=root?.ownerDocument?.defaultView;
  const rectOf=node=>node?.getBoundingClientRect?.()??null;
  const visible=node=>{
    const rect=rectOf(node);
    if(!rect||rect.width<=0||rect.height<=0)return false;
    const style=view?.getComputedStyle?.(node);
    return !style||style.display!=='none'&&style.visibility!=='hidden';
  };
  const add=(code,detail={})=>issues.push(Object.freeze({code,...detail}));
  const rootRect=rectOf(root);
  if(!rootRect)return Object.freeze({ok:false,issues:Object.freeze([Object.freeze({code:'layout-root-missing'})]),metrics:Object.freeze({})});
  if(Number(root?.scrollWidth)>Number(root?.clientWidth)+tolerance)add('root-horizontal-overflow',{overflow:Number(root.scrollWidth)-Number(root.clientWidth)});
  const roleSelectors={header:'.top,.cw-shell__header,.workbench-nav',toolbar:'.tools,.cw-toolbar,.tool-shelf',lesson:'.lesson,.cw-lesson,.lesson-panel,.workspace',transport:'.transport,.cw-transport'};
  const regions=Object.entries(roleSelectors).map(([role,selector])=>[role,root.querySelector?.(selector)]).filter(([,node])=>visible(node));
  for(const [role,node] of regions){
    const rect=rectOf(node);
    if(rect.left<rootRect.left-tolerance||rect.right>rootRect.right+tolerance)add('region-horizontal-overflow',{role,left:rect.left-rootRect.left,right:rect.right-rootRect.right});
  }
  for(let index=0;index<regions.length-1;index++){
    const [role,node]=regions[index], [nextRole,nextNode]=regions[index+1];
    if(node.contains?.(nextNode)||nextNode.contains?.(node))continue;
    const rect=rectOf(node),nextRect=rectOf(nextNode);
    if(rect.bottom>nextRect.top+tolerance)add('shell-region-overlap',{roles:Object.freeze([role,nextRole]),overlap:rect.bottom-nextRect.top});
  }
  const toolbar=regions.find(([role])=>role==='toolbar')?.[1];
  const toolbarRect=rectOf(toolbar);
  const rows=[...(toolbar?.querySelectorAll?.('.tool-row,.cw-toolbar__row')??[])].filter(visible).sort((a,b)=>rectOf(a).top-rectOf(b).top);
  for(let index=0;index<rows.length-1;index++){
    const rect=rectOf(rows[index]),nextRect=rectOf(rows[index+1]);
    if(rect.bottom>nextRect.top+tolerance)add('toolbar-row-overlap',{rows:Object.freeze([index,index+1]),overlap:rect.bottom-nextRect.top});
  }
  const controls=[...(toolbar?.querySelectorAll?.('.tool-button,.cw-tool,.tool-buttons button,.cw-toolbar__actions button')??[])].filter(visible);
  if(toolbarRect)for(const [index,control] of controls.entries()){
    const rect=rectOf(control);
    if(rect.top<toolbarRect.top-tolerance||rect.bottom>toolbarRect.bottom+tolerance)add('toolbar-control-overflow',{index,top:rect.top-toolbarRect.top,bottom:rect.bottom-toolbarRect.bottom});
  }
  return Object.freeze({ok:issues.length===0,issues:Object.freeze(issues),metrics:Object.freeze({regions:regions.length,toolbarRows:rows.length,toolbarControls:controls.length})});
}

export function auditGoldStandardCourseware(root){
  const shell=auditCoursewareShell(root);
  const modes=[...(root?.querySelectorAll?.('[data-experience-mode]')??[])].map(node=>node.dataset.experienceMode);
  const views=[...(root?.querySelectorAll?.('[data-mode]')??[])].map(node=>node.dataset.mode);
  const missingModes=GOLD_STANDARD_EXPERIENCE_MODES.filter(mode=>!modes.includes(mode));
  const missingViews=GOLD_STANDARD_VIEW_MODES.filter(view=>!views.includes(view));
  const missing=[];
  if(!root?.querySelector?.('[data-panel="explore"]'))missing.push('explore-panel');
  if(!root?.querySelector?.('[data-panel="model"]'))missing.push('model-panel');
  if(!root?.querySelector?.('[data-panel="analyse"]'))missing.push('analyse-panel');
  if(!root?.querySelector?.('[aria-live]'))missing.push('live-feedback');
  if(!root?.querySelector?.('[data-copy]'))missing.push('localized-copy');
  const matrixSize=(GOLD_STANDARD_EXPERIENCE_MODES.length-missingModes.length)*(GOLD_STANDARD_VIEW_MODES.length-missingViews.length);
  return Object.freeze({ok:shell.ok&&!missingModes.length&&!missingViews.length&&!missing.length,matrixSize,missingModes:Object.freeze(missingModes),missingViews:Object.freeze(missingViews),missing:Object.freeze(missing),shell});
}

const implementation={
  createState:()=>({version:COURSEWARE_UI_KIT_VERSION,density:'compact'}),
  activate:({state})=>{installCoursewareUiKit({density:state.density});return state},
  observe:({state})=>state,
};

export default implementation;
