export class RulesTransitionError extends Error {
  constructor(code, message) { super(message); this.name = 'RulesTransitionError'; this.code = code; }
}

const objectValue = (value, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RulesTransitionError('ADAPTER_OUTPUT_INVALID', `规则适配器返回了无效的${label}。`);
  return value;
};
const resultValues = new Set(['win','loss','draw','none']);
const terminationReasons = new Set(['normal','resignation','timeout','disconnect','admin_abort','adapter_error']);

export async function normalizeRulesTransition({ adapter, context, actorUserId = null, command, kind, now }) {
  const restored = adapter.deserializeState(context.state);
  if (kind === 'command') {
    const validation = await adapter.validateCommand({ state: restored,command,actorUserId,players: context.players,now });
    if (validation === false || validation?.valid === false) throw new RulesTransitionError(validation?.code ?? 'COMMAND_INVALID', validation?.message ?? '该操作不符合当前规则。');
  }
  const method = kind === 'resign' ? adapter.handleResign : kind === 'timeout' ? adapter.handleTimeout : adapter.applyCommand;
  const transition = objectValue(await method({ state: restored,command,actorUserId,players: context.players,turnUserId: context.turnUserId,now }), '状态转换');
  const serialized = objectValue(adapter.serializeState(objectValue(transition.state, '规则状态')), '序列化状态');
  const verified = adapter.deserializeState(serialized);
  const stateHash = adapter.hashState(verified);
  if (!/^[a-f0-9]{64}$/u.test(stateHash)) throw new RulesTransitionError('ADAPTER_OUTPUT_INVALID', '规则适配器返回了无效的状态哈希。');
  const publicState = objectValue(adapter.getSpectatorView(verified), '公开状态');
  const completed = Boolean(transition.completed);
  let turnUserId = null; let turnDeadlineAt = null;
  if (!completed) {
    const turn = adapter.getTurn(verified);
    if (!turn || !context.players.some(player => player.userId === turn.userId)) throw new RulesTransitionError('ADAPTER_OUTPUT_INVALID', '规则适配器返回了无效的行动玩家。');
    const seconds = Number(turn.seconds);
    if (!Number.isInteger(seconds) || seconds < 10 || seconds > 3600) throw new RulesTransitionError('ADAPTER_OUTPUT_INVALID', '规则适配器返回了无效的回合时间。');
    turnUserId = turn.userId; turnDeadlineAt = new Date(now.getTime() + seconds * 1_000);
  }
  const eventPayload = objectValue(transition.event ?? {}, '公开事件');
  const eventType = transition.eventType ?? (kind === 'resign' ? 'match.resigned' : kind === 'timeout' ? 'match.timed_out' : 'match.command.applied');
  if (!/^[a-z][a-z0-9_.-]{1,79}$/u.test(eventType)) throw new RulesTransitionError('ADAPTER_OUTPUT_INVALID', '规则适配器返回了无效的事件类型。');
  let result = null; let terminationReason = null; let playerResults = [];
  if (completed) {
    result = objectValue(transition.result, '对局结果');
    terminationReason = transition.terminationReason ?? (kind === 'resign' ? 'resignation' : kind === 'timeout' ? 'timeout' : 'normal');
    if (!terminationReasons.has(terminationReason)) throw new RulesTransitionError('ADAPTER_OUTPUT_INVALID', '规则适配器返回了无效的结束原因。');
    playerResults = transition.playerResults ?? [];
    if (!Array.isArray(playerResults) || playerResults.some(item => !context.players.some(player => player.userId === item?.userId) || !resultValues.has(item?.result))) {
      throw new RulesTransitionError('ADAPTER_OUTPUT_INVALID', '规则适配器返回了无效的玩家结果。');
    }
  }
  return { state: serialized,publicState,stateHash,eventType,eventPayload,completed,result,terminationReason,playerResults,turnUserId,turnDeadlineAt };
}
