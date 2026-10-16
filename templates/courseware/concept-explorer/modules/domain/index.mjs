const bounded = (value, minimum, maximum, fallback) => Number.isFinite(Number(value)) ? Math.max(minimum, Math.min(maximum, Number(value))) : fallback;
const derived = state => ({
  coefficient:state.coefficient,
  opening:state.coefficient < 0 ? 'down' : 'up',
  width:Math.abs(state.coefficient) < .75 ? 'wide' : Math.abs(state.coefficient) > 1.5 ? 'narrow' : 'standard',
  vertex:{ x:0,y:0 },
  sample:{ x:state.sampleX,y:state.coefficient * state.sampleX ** 2 },
  referenceVisible:state.referenceVisible,
});

export default {
  createState:() => ({ coefficient:1,sampleX:1,referenceVisible:true }),
  reduce:({ state,command }) => {
    if (command.name === 'coefficient.set') return { ...state,coefficient:bounded(command.payload.value,-3,3,state.coefficient) };
    if (command.name === 'sample.set') return { ...state,sampleX:bounded(command.payload.x,-5,5,state.sampleX) };
    if (command.name === 'reference.toggle') return { ...state,referenceVisible:command.payload.visible === undefined ? !state.referenceVisible : Boolean(command.payload.visible) };
    if (command.name === 'model.reset') return { coefficient:1,sampleX:1,referenceVisible:true };
    return state;
  },
  observe:({ state,query }) => query?.kind === 'curve'
    ? { ...derived(state),points:Array.from({ length:81 },(_,index) => { const x=-5+index/8; return { x,y:state.coefficient*x*x }; }) }
    : derived(state),
};
