const uniqueModes = values => [...new Set((Array.isArray(values) ? values : []).filter(value => typeof value === 'string' && value.length > 0))];

export function discoverWorkbenchCapabilities(root) {
  if (!root?.querySelectorAll) throw new TypeError('A workbench root element is required.');
  return Object.freeze({
    experienceModes:Object.freeze(uniqueModes([...root.querySelectorAll('[data-experience-mode]')].map(node => node.dataset.experienceMode))),
    viewModes:Object.freeze(uniqueModes([...root.querySelectorAll('[data-mode]')].map(node => node.dataset.mode))),
  });
}

export function createWorkbenchController({ root,sceneId,getRuntime=()=>null,emit=()=>{},onExperienceChange=()=>{},onViewChange=()=>{} }={}) {
  const capabilities=discoverWorkbenchCapabilities(root);
  if (!capabilities.experienceModes.length || !capabilities.viewModes.length) throw new TypeError('Workbench controls must declare experience and view modes.');
  let experienceMode=capabilities.experienceModes.includes(root.dataset.experience) ? root.dataset.experience : capabilities.experienceModes[0];
  let viewMode=capabilities.viewModes.includes(root.dataset.mode) ? root.dataset.mode : capabilities.viewModes[0];
  let bound=false; const disposers=[];
  const sync=()=>{root.dataset.experience=experienceMode;root.dataset.mode=viewMode;root.querySelectorAll('[data-experience-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.experienceMode===experienceMode)));root.querySelectorAll('[data-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===viewMode)));};
  const dispatch=(name,payload)=>{const runtime=getRuntime();if(runtime?.activeModules?.some(module=>module.id==='component.workbench'))runtime.dispatch('component.workbench',name,payload);};
  const setExperience=(next,{announce=true,force=false}={})=>{if(!capabilities.experienceModes.includes(next))return false;const previous=experienceMode;if(!force&&next===previous){sync();return true;}experienceMode=next;sync();dispatch('experience.set',{mode:next});onExperienceChange({mode:next,previous,capabilities});if(announce)emit('experience.mode.changed',{mode:next,previous,sceneId});return true;};
  const setView=(next,{announce=true,force=false}={})=>{if(!capabilities.viewModes.includes(next))return false;const previous=viewMode;if(!force&&next===previous){sync();return true;}viewMode=next;sync();dispatch('panel.set',{panel:next});onViewChange({mode:next,previous,capabilities});if(announce)emit('view.mode.changed',{mode:next,previous,sceneId});return true;};
  const connectRuntime=()=>{dispatch('capabilities.configure',capabilities);dispatch('experience.set',{mode:experienceMode});dispatch('panel.set',{panel:viewMode});};
  const bind=()=>{if(bound)return;bound=true;root.querySelectorAll('[data-experience-mode]').forEach(button=>{const listener=()=>setExperience(button.dataset.experienceMode);button.addEventListener('click',listener);disposers.push(()=>button.removeEventListener('click',listener));});root.querySelectorAll('[data-mode]').forEach(button=>{const listener=()=>setView(button.dataset.mode);button.addEventListener('click',listener);disposers.push(()=>button.removeEventListener('click',listener));});sync();};
  const destroy=()=>{for(const dispose of disposers.splice(0))dispose();bound=false;};
  const snapshot=()=>Object.freeze({experienceMode,viewMode});
  const restore=(state,{announce=false}={})=>{setExperience(state?.experienceMode??experienceMode,{announce,force:true});setView(state?.viewMode??viewMode,{announce,force:true});};
  return Object.freeze({ capabilities,bind,destroy,connectRuntime,setExperience,setView,snapshot,restore,get experienceMode(){return experienceMode;},get viewMode(){return viewMode;} });
}

const implementation={
  createState:() => ({ experience:'textbook',panel:'explore',locale:'zh-CN',motion:'system',capabilities:{experienceModes:[],viewModes:[]} }),
  migrateState:({state}) => ({ ...state,capabilities:{experienceModes:[],viewModes:[]} }),
  reduce:({ state,command }) => {
    if(command.name==='capabilities.configure')return{...state,capabilities:{experienceModes:uniqueModes(command.payload.experienceModes),viewModes:uniqueModes(command.payload.viewModes)}};
    if(command.name==='experience.set')return{...state,experience:String(command.payload.mode??state.experience)};
    if(command.name==='panel.set')return{...state,panel:String(command.payload.panel??state.panel)};
    if(command.name==='locale.set')return{...state,locale:String(command.payload.locale??state.locale)};
    if(command.name==='motion.set')return{...state,motion:String(command.payload.motion??state.motion)};
    return state;
  },
  observe:({ state }) => state,
};

export default implementation;
