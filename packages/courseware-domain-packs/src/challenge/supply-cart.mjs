export default {
  createState:() => ({ attempts:0,maxAttempts:3,solved:false,last:null }),
  reduce:({ state,command,context }) => {
    if(command.name==='challenge.reset')return{...state,attempts:0,solved:false,last:null};
    if(command.name!=='challenge.attempt')return state;
    const model=context.observe(context.dependencies[0].id),time=2.5,position=.5*model.acceleration*time*time,enoughMass=model.mass>=4,inZone=position>=6.5&&position<=8.5,success=enoughMass&&inZone;
    const attempts=state.attempts>=state.maxAttempts&&!state.solved?1:state.attempts+1;
    return{...state,attempts,solved:success,last:{success,reason:!enoughMass?'payload':position<6.5?'short':position>8.5?'long':'success',metrics:{mass:model.mass,force:model.force,acceleration:model.acceleration,time,position}}};
  },
  observe:({ state }) => state,
};
