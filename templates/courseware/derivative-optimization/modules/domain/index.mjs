const clamp=(value,minimum,maximum,fallback)=>Number.isFinite(Number(value))?Math.max(minimum,Math.min(maximum,Number(value))):fallback;

const functions={
  cubic:{label:'f(x)=x³−3x',value:x=>x**3-3*x,derivative:x=>3*x*x-3,criticalPoints:[-1,1],domain:[-3.2,3.2]},
  quadratic:{label:'f(x)=x²−2x',value:x=>x*x-2*x,derivative:x=>2*x-2,criticalPoints:[1],domain:[-2.5,4.5]},
};

const modelOf=state=>{
  const definition=functions[state.functionFamily]??functions.cubic;
  const nextX=state.probeX+state.delta;
  const y=definition.value(state.probeX),nextY=definition.value(nextX);
  const side=state.sheetSide,cut=state.cut,optimumCut=side/6;
  const volume=cut*Math.max(0,side-2*cut)**2,optimumVolume=optimumCut*(side-2*optimumCut)**2;
  return{
    functionFamily:state.functionFamily,functionLabel:definition.label,domain:definition.domain,
    probe:{x:state.probeX,y,nextX,nextY},delta:state.delta,secantSlope:(nextY-y)/state.delta,tangentSlope:definition.derivative(state.probeX),
    derivativeVisible:state.derivativeVisible,criticalPoints:definition.criticalPoints,
    monotonicity:state.functionFamily==='cubic'?[{from:'−∞',to:'−1',sign:'+',trend:'increase'},{from:'−1',to:'1',sign:'−',trend:'decrease'},{from:'1',to:'+∞',sign:'+',trend:'increase'}]:[{from:'−∞',to:'1',sign:'−',trend:'decrease'},{from:'1',to:'+∞',sign:'+',trend:'increase'}],
    optimization:{side,cut,volume,volumeDerivative:(side-2*cut)*(side-6*cut),optimumCut,optimumVolume,feasible:[0,side/2]},
  };
};

export default{
  createState:()=>({functionFamily:'cubic',probeX:1.4,delta:2,derivativeVisible:true,sheetSide:20,cut:2.5}),
  reduce:({state,command})=>{
    if(command.name==='function.set')return{...state,functionFamily:functions[command.payload.value]?command.payload.value:state.functionFamily};
    if(command.name==='probe.set')return{...state,probeX:clamp(command.payload.x,-3,4,state.probeX)};
    if(command.name==='delta.set')return{...state,delta:clamp(command.payload.value,.05,3,state.delta)};
    if(command.name==='derivative.toggle')return{...state,derivativeVisible:command.payload.visible===undefined?!state.derivativeVisible:Boolean(command.payload.visible)};
    if(command.name==='optimization.side.set'){const sheetSide=clamp(command.payload.value,12,30,state.sheetSide);return{...state,sheetSide,cut:Math.min(state.cut,sheetSide/2-.05)};}
    if(command.name==='optimization.cut.set')return{...state,cut:clamp(command.payload.value,.05,state.sheetSide/2-.05,state.cut)};
    if(command.name==='model.reset')return{functionFamily:'cubic',probeX:1.4,delta:2,derivativeVisible:true,sheetSide:20,cut:2.5};
    return state;
  },
  observe:({state,query})=>{
    const model=modelOf(state),definition=functions[state.functionFamily]??functions.cubic;
    if(query?.kind!=='curve')return model;
    const [minimum,maximum]=definition.domain,steps=160;
    const functionPoints=Array.from({length:steps+1},(_,index)=>{const x=minimum+(maximum-minimum)*index/steps;return{x,y:definition.value(x)};});
    const derivativePoints=functionPoints.map(({x})=>({x,y:definition.derivative(x)}));
    const maxCut=state.sheetSide/2,optimizationPoints=Array.from({length:121},(_,index)=>{const x=maxCut*index/120;return{x,y:x*(state.sheetSide-2*x)**2};});
    return{...model,functionPoints,derivativePoints,optimizationPoints};
  },
};
