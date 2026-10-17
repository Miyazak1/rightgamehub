const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function reading(state) {
  const kineticIn = 0.5 * state.mass * state.entrySpeed ** 2;
  const potential = state.mass * state.gravity * state.height;
  const frictionLoss = state.friction * state.mass * state.gravity * state.pathLength;
  const kineticOut = Math.max(0, kineticIn - potential - frictionLoss);
  const exitSpeed = Math.sqrt(2 * kineticOut / state.mass);
  return { ...state, kineticIn, potential, frictionLoss, kineticOut, exitSpeed, stalled:kineticOut === 0 };
}

export default {
  createState:() => ({ mass:2,entrySpeed:8,height:1.5,friction:.2,pathLength:5,gravity:9.8 }),
  reduce:({ state,command }) => {
    if (command.name === 'model.reset') return { mass:2,entrySpeed:8,height:1.5,friction:.2,pathLength:5,gravity:9.8 };
    const setters = {
      'mass.set':['mass',.1,100],
      'speed.set':['entrySpeed',0,100],
      'height.set':['height',0,100],
      'friction.set':['friction',0,2],
      'path-length.set':['pathLength',.1,1000],
    };
    const target = setters[command.name];
    if (!target) return state;
    return { ...state, [target[0]]:clamp(finite(command.payload.value,state[target[0]]),target[1],target[2]) };
  },
  observe:({ state }) => reading(state),
};
