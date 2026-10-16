export default {
  createState:() => ({ experience:'textbook',panel:'explore',locale:'zh-CN',motion:'system' }),
  reduce:({ state,command }) => {
    if(command.name==='experience.set')return{...state,experience:String(command.payload.mode??state.experience)};
    if(command.name==='panel.set')return{...state,panel:String(command.payload.panel??state.panel)};
    if(command.name==='locale.set')return{...state,locale:String(command.payload.locale??state.locale)};
    if(command.name==='motion.set')return{...state,motion:String(command.payload.motion??state.motion)};
    return state;
  },
  observe:({ state }) => state,
};
