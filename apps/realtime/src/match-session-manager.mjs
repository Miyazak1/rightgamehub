import { createServerMessage } from '@gamehub/multiplayer-protocol';
import { normalizeRulesTransition, RulesTransitionError } from './rules-transition.mjs';

class MatchCommandError extends RulesTransitionError {}

export function createMatchSessionManager({ repository, coordinator, rulesRegistry, logger = console, clock = () => new Date() } = {}) {
  if (!repository || !coordinator || !rulesRegistry) throw new TypeError('Match repository, coordinator and rules registry are required.');
  const localMatches = new Map();
  let stopEvents = () => {};
  const send = (socket, message) => socket.readyState === 1 && socket.send(JSON.stringify(message));
  const reject = (socket, message, code, detail, extra = {}) => send(socket, createServerMessage(
    'command.rejected', { code,message: detail,...extra }, { causedBy: message.id,matchId: message.matchId },
  ));
  const adapterFor = context => rulesRegistry.get(context);
  const addLocal = (socket, matchId) => {
    socket.matchIds ??= new Set(); socket.matchIds.add(matchId);
    const sockets = localMatches.get(matchId) ?? new Set(); sockets.add(socket); localMatches.set(matchId, sockets);
  };
  const removeLocal = (socket, matchId) => {
    socket.matchIds?.delete(matchId); const sockets = localMatches.get(matchId); sockets?.delete(socket);
    if (sockets?.size === 0) localMatches.delete(matchId);
  };
  const snapshotMessage = (context, adapter, userId, causedBy) => {
    const restored = adapter.deserializeState(context.state);
    const state = adapter.getPlayerView(restored, userId);
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new RulesTransitionError('ADAPTER_OUTPUT_INVALID', '规则适配器返回了无效的玩家视图。');
    return createServerMessage('match.snapshot', {
      match: {
        id: context.matchId, roomId: context.roomId, modeId: context.modeId, rulesetVersion: context.rulesetVersion,
        status: context.status, revision: context.revision, nextEventSeq: context.nextEventSeq,
        turnUserId: context.turnUserId, turnDeadlineAt: context.turnDeadlineAt?.toISOString?.() ?? null,
        result: context.result, players: context.players,
      },
      state, publicState: context.publicState, stateHash: context.stateHash,
    }, { matchId: context.matchId,revision: Number(context.revision),...(causedBy ? { causedBy } : {}) });
  };
  const sendSync = async (socket, matchId, { afterSeq = 0, causedBy } = {}) => {
    const result = await repository.getSyncState({ matchId,userId: socket.session.userId,afterSeq,limit: 500 });
    if (result.error) throw new MatchCommandError('MATCH_NOT_MEMBER', '对局不存在或你不是参与者。');
    const adapter = adapterFor(result.context);
    if (!adapter) throw new MatchCommandError('RULESET_NOT_AVAILABLE', '服务器没有安装该对局使用的规则版本。');
    addLocal(socket, matchId);
    for (const event of result.events) send(socket, createServerMessage('match.event', { event }, { matchId,revision: Number(result.context.revision) }));
    send(socket, snapshotMessage(result.context, adapter, socket.session.userId, causedBy));
    return result;
  };
  const broadcastChange = async (matchId, signal) => {
    const sockets = [...(localMatches.get(matchId) ?? [])];
    await Promise.all(sockets.map(async socket => {
      try {
        const result = await repository.getSyncState({ matchId,userId: socket.session.userId,afterSeq: Number(signal.event.seq) - 1,limit: 1 });
        if (result.error) { removeLocal(socket, matchId); return; }
        const adapter = adapterFor(result.context);
        if (!adapter) return;
        send(socket, createServerMessage('match.event', { event: signal.event }, { matchId,revision: Number(result.context.revision),causedBy: signal.causedBy }));
        send(socket, snapshotMessage(result.context, adapter, socket.session.userId, signal.causedBy));
        if (result.context.status === 'completed') send(socket, createServerMessage('match.completed', { result: result.context.result }, { matchId,revision: Number(result.context.revision),causedBy: signal.causedBy }));
      } catch (error) { logger?.error?.({ error,matchId,userId: socket.session?.userId }, 'Realtime match broadcast failed'); }
    }));
  };
  const act = async (socket, message, kind) => {
    if (!socket.matchIds?.has(message.matchId)) return reject(socket, message, 'MATCH_NOT_SUBSCRIBED', '请先同步该对局。');
    const now = clock();
    const result = await repository.applyAction({
      matchId: message.matchId,userId: socket.session.userId,commandId: message.id,expectedRevision: message.expectedRevision,now,
      transition: context => {
        const adapter = adapterFor(context);
        if (!adapter) throw new MatchCommandError('RULESET_NOT_AVAILABLE', '服务器没有安装该对局使用的规则版本。');
        return normalizeRulesTransition({ adapter,context,actorUserId: socket.session.userId,command: message.payload.command,kind,now });
      },
    });
    if (result.error === 'revision_conflict') return reject(socket, message, 'REVISION_CONFLICT', '对局状态已经变化，请先同步。', { revision: result.context.revision });
    if (result.error === 'not_member') return reject(socket, message, 'MATCH_NOT_MEMBER', '对局不存在或你不是参与者。');
    if (result.error === 'not_active') return reject(socket, message, 'MATCH_NOT_ACTIVE', '该对局已经结束或暂不可操作。');
    if (result.error) return reject(socket, message, 'COMMAND_CONFLICT', '该命令编号已经被其他操作使用。');
    if (result.replay) {
      await sendSync(socket, message.matchId, { afterSeq: Number(result.event.seq) - 1,causedBy: message.id });
    } else {
      try { await coordinator.publish(message.matchId, { kind: 'match.changed',event: result.event,causedBy: message.id }); }
      catch (error) { logger?.error?.({ error,matchId: message.matchId }, 'Realtime match publish failed'); await broadcastChange(message.matchId, { event: result.event,causedBy: message.id }); }
    }
    return send(socket, createServerMessage('command.ack', { commandType: message.type,revision: result.context.revision,eventSeq: result.event.seq }, { causedBy: message.id,matchId: message.matchId,revision: Number(result.context.revision) }));
  };

  return Object.freeze({
    supports: message => message.type.startsWith('match.'),
    async start() {
      stopEvents = await coordinator.start((matchId, signal) => {
        if (signal?.kind === 'match.changed') broadcastChange(matchId, signal).catch(error => logger?.error?.({ error,matchId }, 'Realtime match signal failed'));
      });
    },
    async ping() { return (await coordinator.ping()) && (await repository.ping()); },
    async handle(socket, message) {
      try {
        if (message.type === 'match.sync.request') {
          const result = await sendSync(socket, message.matchId, { afterSeq: message.payload.afterSeq ?? 0,causedBy: message.id });
          return send(socket, createServerMessage('command.ack', { commandType: message.type,revision: result.context.revision }, { causedBy: message.id,matchId: message.matchId,revision: Number(result.context.revision) }));
        }
        if (message.type === 'match.command') return act(socket, message, 'command');
        if (message.type === 'match.resign') return act(socket, message, 'resign');
        return reject(socket, message, 'NOT_IMPLEMENTED', '该对局命令尚未实现。');
      } catch (error) {
        if (error instanceof RulesTransitionError) return reject(socket, message, error.code, error.message);
        throw error;
      }
    },
    async disconnect(socket) { for (const matchId of [...(socket.matchIds ?? [])]) removeLocal(socket, matchId); },
    close() { stopEvents(); localMatches.clear(); },
  });
}
