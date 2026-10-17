export default {
  createState:() => ({ attempts:0,maxAttempts:5,solved:false,last:null }),
  reduce:({ state,command,context }) => {
    if(command.name==='challenge.reset')return{...state,attempts:0,solved:false,last:null};
    if(command.name!=='challenge.attempt')return state;
    if(state.solved||state.attempts>=state.maxAttempts)return state;
    const model=context.observe(context.dependencies[0].id,{ kind:'curve' }),attempts=state.attempts+1;
    const y=model.coefficient*4,success=Math.abs(model.coefficient+2)<.001;
    return{...state,attempts,solved:success,last:{success,metrics:{coefficient:model.coefficient,x:2,y}}};
  },
  observe:({ state }) => state,
};
