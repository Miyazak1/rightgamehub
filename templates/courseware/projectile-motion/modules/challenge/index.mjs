export default {
  createState:()=>({ attempts:0,maxAttempts:5,solved:false,last:null }),
  reduce:({state,command,context})=>{
    if(command.name==='challenge.reset')return {...state,attempts:0,solved:false,last:null};
    if(command.name==='challenge.restore'){
      const attempts=Math.max(0,Math.min(state.maxAttempts,Number.isInteger(command.payload.attempts)?command.payload.attempts:0)),solved=Boolean(command.payload.solved),reason=typeof command.payload.reason==='string'&&command.payload.reason?command.payload.reason:null,source=command.payload.metrics;
      const metrics=source&&[source.range,source.targetX,source.clearance,source.speed,source.angle].every(Number.isFinite)?{range:source.range,targetX:source.targetX,clearance:source.clearance,speed:source.speed,angle:source.angle}:null;
      return {...state,attempts,solved,last:reason?{success:solved,reason,metrics}:null};
    }
    if(command.name!=='challenge.attempt')return state;
    if(state.solved||state.attempts>=state.maxAttempts)return state;
    const model=context.observe(context.dependencies[0].id),onTarget=Math.abs(model.range-model.targetX)<=2,clears=model.clearance>=0,success=onTarget&&clears;
    const attempts=state.attempts+1;
    const reason=!clears?'obstacle':model.range<model.targetX-2?'short':model.range>model.targetX+2?'long':'success';
    return {...state,attempts,solved:success,last:{success,reason,metrics:{range:model.range,targetX:model.targetX,clearance:model.clearance,speed:model.speed,angle:model.angle}}};
  },
  observe:({state})=>state,
};
