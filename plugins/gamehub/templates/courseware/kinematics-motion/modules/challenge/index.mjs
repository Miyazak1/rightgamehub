export default {
  createState:()=>({attempts:0,maxAttempts:4,solved:false,last:null}),
  reduce:({state,command,context})=>{
    if(command.name==='challenge.reset')return{...state,attempts:0,solved:false,last:null};
    if(command.name==='challenge.restore'){
      const attempts=Math.max(0,Math.min(state.maxAttempts,Number.isInteger(command.payload.attempts)?command.payload.attempts:0));
      const solved=Boolean(command.payload.solved),reason=typeof command.payload.reason==='string'&&command.payload.reason?command.payload.reason:null;
      return{...state,attempts,solved,last:reason?{success:solved,reason,metrics:null}:null};
    }
    if(command.name!=='challenge.attempt')return state;
    if(state.solved||state.attempts>=state.maxAttempts)return state;
    const model=context.observe(context.dependencies[0].id),time=4;
    const position=model.initialVelocity*time+.5*model.acceleration*time*time,velocity=model.initialVelocity+model.acceleration*time;
    const positionOk=position>=29&&position<=31,velocityOk=velocity>=8.5&&velocity<=9.5,success=positionOk&&velocityOk;
    const attempts=state.attempts+1;
    const reason=success?'success':!positionOk?(position<29?'position-low':'position-high'):(velocity<8.5?'velocity-low':'velocity-high');
    return{...state,attempts,solved:success,last:{success,reason,metrics:{initialVelocity:model.initialVelocity,acceleration:model.acceleration,time,position,velocity}}};
  },
  observe:({state})=>state,
};
