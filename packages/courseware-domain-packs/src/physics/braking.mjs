const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function reading(state) {
  const stoppingTime = state.deceleration > 0 ? state.speed / state.deceleration : Number.MAX_SAFE_INTEGER;
  const stoppingDistance = state.deceleration > 0 ? state.speed ** 2 / (2 * state.deceleration) : Number.MAX_SAFE_INTEGER;
  return { ...state, stoppingTime, stoppingDistance, margin:state.runway - stoppingDistance, safe:stoppingDistance <= state.runway };
}

export default {
  createState:() => ({ speed:4,deceleration:2,runway:5 }),
  reduce:({ state,command }) => {
    if (command.name === 'model.reset') return { speed:4,deceleration:2,runway:5 };
    const setters = {
      'speed.set':['speed',0,100],
      'deceleration.set':['deceleration',.1,30],
      'runway.set':['runway',.1,1000],
    };
    const target = setters[command.name];
    if (!target) return state;
    return { ...state, [target[0]]:clamp(finite(command.payload.value,state[target[0]]),target[1],target[2]) };
  },
  observe:({ state }) => reading(state),
};
