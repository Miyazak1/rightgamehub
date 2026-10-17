const number=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;
const clamp=(value,min,max,fallback)=>Math.max(min,Math.min(max,number(value,fallback)));
const sequenceOf=state=>Math.max(Number.isInteger(state.trialSequence)&&state.trialSequence>=0?state.trialSequence:0,...(state.trials??[]).map(trial=>Number.isInteger(trial?.id)&&trial.id>0?trial.id:0),0);
const sample=(state,time=state.time)=>{
  const radians=state.angle*Math.PI/180,vx=state.speed*Math.cos(radians),vy0=state.speed*Math.sin(radians);
  const flightTime=2*vy0/state.gravity,t=clamp(time,0,flightTime,0),x=vx*t,y=Math.max(0,vy0*t-.5*state.gravity*t*t),vy=vy0-state.gravity*t;
  const range=vx*flightTime,maxHeight=vy0*vy0/(2*state.gravity),obstacleTime=state.obstacleX/vx;
  const obstacleY=obstacleTime<=flightTime?Math.max(0,vy0*obstacleTime-.5*state.gravity*obstacleTime**2):0;
  return { speed:state.speed,angle:state.angle,gravity:state.gravity,time:t,running:state.running,vx,vy0,vy,x,y,flightTime,range,maxHeight,velocity:Math.hypot(vx,vy),targetX:state.targetX,obstacleX:state.obstacleX,obstacleHeight:state.obstacleHeight,clearance:obstacleY-state.obstacleHeight,trials:state.trials,trialSequence:sequenceOf(state) };
};

export default {
  createState:()=>({ speed:17,angle:40,gravity:9.8,time:0,running:false,targetX:29,obstacleX:14,obstacleHeight:5.5,trials:[],trialSequence:0 }),
  reduce:({state,command})=>{
    const reset=patch=>({...state,...patch,time:0,running:false});
    if(command.name==='model.restore'){
      const targetX=clamp(command.payload.targetX,18,45,state.targetX),trials=(Array.isArray(command.payload.trials)?command.payload.trials:[]).map((trial,index)=>({id:Number.isInteger(Number(trial?.id))&&Number(trial.id)>0?Number(trial.id):index+1,speed:number(trial?.speed,NaN),angle:number(trial?.angle,NaN),range:number(trial?.range,NaN),maxHeight:number(trial?.maxHeight,NaN),clearance:number(trial?.clearance,NaN)})).filter(trial=>[trial.speed,trial.angle,trial.range,trial.maxHeight,trial.clearance].every(Number.isFinite)).slice(-12),restored={
        ...state,
        speed:clamp(command.payload.speed,6,30,state.speed),angle:clamp(command.payload.angle,10,80,state.angle),gravity:clamp(command.payload.gravity,1.6,12,state.gravity),
        targetX,obstacleX:clamp(command.payload.obstacleX,6,targetX-4,state.obstacleX),obstacleHeight:clamp(command.payload.obstacleHeight,1,12,state.obstacleHeight),running:false,
        trials,trialSequence:Math.max(Number.isInteger(Number(command.payload.trialSequence))&&Number(command.payload.trialSequence)>=0?Number(command.payload.trialSequence):0,...trials.map(trial=>trial.id),0),
      };
      return {...restored,time:clamp(command.payload.time,0,sample(restored).flightTime,0)};
    }
    if(command.name==='speed.set')return reset({speed:clamp(command.payload.value,6,30,state.speed)});
    if(command.name==='angle.set')return reset({angle:clamp(command.payload.value,10,80,state.angle)});
    if(command.name==='gravity.set')return reset({gravity:clamp(command.payload.value,1.6,12,state.gravity)});
    if(command.name==='target.set'){const targetX=clamp(command.payload.value,18,45,state.targetX);return reset({targetX,obstacleX:Math.min(state.obstacleX,targetX-4)});}
    if(command.name==='obstacle.set')return reset({obstacleX:clamp(command.payload.x,6,state.targetX-4,state.obstacleX),obstacleHeight:clamp(command.payload.height,1,12,state.obstacleHeight)});
    if(command.name==='simulation.run')return {...state,running:true};
    if(command.name==='simulation.pause')return {...state,running:false};
    if(command.name==='simulation.reset')return {...state,time:0,running:false};
    if(command.name==='simulation.step'){const flight=sample(state).flightTime,time=clamp(state.time+clamp(command.payload.seconds,0,.08,0),0,flight,state.time);return {...state,time,running:time<flight&&state.running};}
    if(command.name==='measurement.record'){const reading=sample(state),trialSequence=sequenceOf(state)+1;return {...state,trialSequence,trials:[...state.trials,{id:trialSequence,speed:reading.speed,angle:reading.angle,range:reading.range,maxHeight:reading.maxHeight,clearance:reading.clearance}].slice(-12)};}
    return state;
  },
  observe:({state})=>sample(state),
};
