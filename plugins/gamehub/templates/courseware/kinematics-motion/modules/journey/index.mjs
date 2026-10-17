export default {
  createState:() => ({ scenes:[],checkpoints:[] }),
  reduce:({ state,command }) => {
    if(command.name==='progress.reset')return{scenes:[],checkpoints:[]};
    if(command.name==='scene.complete'){const id=String(command.payload.id??'');return id&&!state.scenes.includes(id)?{...state,scenes:[...state.scenes,id]}:state;}
    if(command.name==='checkpoint.complete'){const id=String(command.payload.id??'');return id&&!state.checkpoints.includes(id)?{...state,checkpoints:[...state.checkpoints,id]}:state;}
    return state;
  },
  observe:({ state }) => ({ ...state,completed:state.scenes.length>0&&state.checkpoints.length>0 }),
};
