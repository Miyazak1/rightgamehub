const clamp=(value,minimum,maximum,fallback)=>Number.isFinite(Number(value))?Math.max(minimum,Math.min(maximum,Number(value))):fallback;
const readings=state=>{
  const velocity=state.initialVelocity+state.acceleration*state.time;
  const position=state.initialVelocity*state.time+.5*state.acceleration*state.time**2;
  return {initialVelocity:state.initialVelocity,acceleration:state.acceleration,time:state.time,position,velocity,running:state.running,trials:state.trials};
};

export default {
  createState:()=>({initialVelocity:4,acceleration:1,time:0,running:false,trials:[]}),
  reduce:({state,command})=>{
    if(command.name==='velocity.set')return{...state,initialVelocity:clamp(command.payload.value,0,12,state.initialVelocity),time:0,running:false};
    if(command.name==='acceleration.set')return{...state,acceleration:clamp(command.payload.value,-3,3,state.acceleration),time:0,running:false};
    if(command.name==='simulation.run')return{...state,running:true};
    if(command.name==='simulation.pause')return{...state,running:false};
    if(command.name==='simulation.reset')return{...state,time:0,running:false};
    if(command.name==='simulation.step')return{...state,time:clamp(state.time+clamp(command.payload.seconds,0,.1,0),0,5,state.time)};
    if(command.name==='measurement.record'){const reading=readings(state);return{...state,trials:[...state.trials,{id:state.trials.length+1,initialVelocity:reading.initialVelocity,acceleration:reading.acceleration,time:reading.time,position:reading.position,velocity:reading.velocity}].slice(-20)}}
    return state;
  },
  observe:({state})=>readings(state),
};
