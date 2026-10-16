const clamp = (value, minimum, maximum, fallback) => Number.isFinite(Number(value)) ? Math.max(minimum, Math.min(maximum, Number(value))) : fallback;
const readings = state => {
  const acceleration=state.force/state.mass,velocity=acceleration*state.time,position=.5*acceleration*state.time**2;
  return { force:state.force,mass:state.mass,time:state.time,acceleration,velocity,position,running:state.running,trials:state.trials };
};

export default {
  createState:() => ({ force:6,mass:2,time:0,running:false,trials:[] }),
  reduce:({ state,command }) => {
    if (command.name === 'force.set') return { ...state,force:clamp(command.payload.value,1,10,state.force),time:0,running:false };
    if (command.name === 'mass.set') return { ...state,mass:Math.round(clamp(command.payload.value,1,6,state.mass)),time:0,running:false };
    if (command.name === 'simulation.run') return { ...state,running:true };
    if (command.name === 'simulation.pause') return { ...state,running:false };
    if (command.name === 'simulation.reset') return { ...state,time:0,running:false };
    if (command.name === 'simulation.step') return { ...state,time:clamp(state.time+clamp(command.payload.seconds,0,.25,0),0,6,state.time) };
    if (command.name === 'measurement.record') { const reading=readings(state); return { ...state,trials:[...state.trials,{ id:state.trials.length+1,force:reading.force,mass:reading.mass,acceleration:reading.acceleration,time:reading.time,position:reading.position }].slice(-20) }; }
    return state;
  },
  observe:({ state }) => readings(state),
};
