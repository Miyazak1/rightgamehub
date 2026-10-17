export default {
  createState:()=>({ attempts:0,maxAttempts:5,solved:false,last:null }),
  reduce:({state,command,context})=>{
    if(command.name==='challenge.reset')return {...state,attempts:0,solved:false,last:null};
    if(command.name!=='challenge.attempt')return state;
    if(state.solved||state.attempts>=state.maxAttempts)return state;
    const model=context.observe(context.dependencies[0].id),onTarget=Math.abs(model.range-model.targetX)<=2,clears=model.clearance>=0,success=onTarget&&clears;
    const attempts=state.attempts+1;
    const reason=!clears?'obstacle':model.range<model.targetX-2?'short':model.range>model.targetX+2?'long':'success';
    return {...state,attempts,solved:success,last:{success,reason,metrics:{range:model.range,targetX:model.targetX,clearance:model.clearance,speed:model.speed,angle:model.angle}}};
  },
  observe:({state})=>state,
};
