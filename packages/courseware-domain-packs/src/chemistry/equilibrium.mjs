const clamp = (value, minimum, maximum, fallback) => Number.isFinite(Number(value)) ? Math.max(minimum, Math.min(maximum, Number(value))) : fallback;
function composition(totalUnits,volume,constant) {
  let lower=0,upper=totalUnits/2;
  for(let index=0;index<80;index+=1){const n2o4=(lower+upper)/2,no2=totalUnits-2*n2o4,q=(no2/volume)**2/Math.max(n2o4/volume,1e-9);if(q>constant)lower=n2o4;else upper=n2o4;}
  const n2o4=(lower+upper)/2; return { n2o4,no2:totalUnits-2*n2o4 };
}
const readings = state => {
  const settled=composition(state.totalUnits,state.volume,state.constant),q=(settled.no2/state.volume)**2/Math.max(settled.n2o4/state.volume,1e-9);
  return { ...state,composition:settled,concentrations:{ n2o4:settled.n2o4/state.volume,no2:settled.no2/state.volume },quotient:q,direction:Math.abs(q-state.constant)<1e-6?'equilibrium':q<state.constant?'forward':'reverse' };
};

export default {
  createState:() => ({ volume:1,temperature:298,constant:.36,totalUnits:2.2,catalyst:false,progress:1,running:false }),
  reduce:({ state,command }) => {
    if(command.name==='volume.set')return{...state,volume:clamp(command.payload.value,.45,1.8,state.volume),progress:0,running:false};
    if(command.name==='temperature.set'){const temperature=clamp(command.payload.value,273,360,state.temperature);return{...state,temperature,constant:.36*Math.exp((temperature-298)/90),progress:0,running:false};}
    if(command.name==='catalyst.toggle')return{...state,catalyst:command.payload.active===undefined?!state.catalyst:Boolean(command.payload.active),progress:0,running:false};
    if(command.name==='feed.set')return{...state,totalUnits:clamp(command.payload.value,1.2,3.4,state.totalUnits),progress:0,running:false};
    if(command.name==='simulation.run')return{...state,running:true};
    if(command.name==='simulation.pause')return{...state,running:false};
    if(command.name==='simulation.step')return{...state,progress:clamp(state.progress+clamp(command.payload.fraction,0,1,0),0,1,state.progress)};
    if(command.name==='simulation.reset')return{volume:1,temperature:298,constant:.36,totalUnits:2.2,catalyst:false,progress:1,running:false};
    return state;
  },
  observe:({ state }) => readings(state),
};
