import {createLocalSaveHandlers} from './web-game-local-save-handlers.mjs';
import { bridgeEnvelope, isBridgeConnectMessage, parseBridgeRequest, bridgeMethodCapability, WEB_GAME_BRIDGE_MAX_BYTES } from '@gamehub/web-game-sdk/protocol';
import { createGameSessionManager } from './game-session-manager.mjs';
import { createGameTransfer } from '@gamehub/web-game-sdk/transfer';
import { createCloudSaveHandlers } from './web-game-cloud-save-handlers.mjs';
import { saveConflictDetails } from '@gamehub/web-game-sdk/cloud-save-protocol';
import { createMultiplayerHandlers } from './web-game-multiplayer-handlers.mjs';

const publicProfile = profile => ({ id: profile.id, displayName: profile.displayName, avatar: profile.avatar ?? null });
const byteLength = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;

/** Factories are trusted host code; the iframe can never register handlers. */
export function createWebGameHost({
  windowImpl = globalThis.window, frame, launchId, descriptor, apiClient,
  initialRoomId = null, sessionFactory, MessageChannelImpl = globalThis.MessageChannel,
  logger = console, modules = {}, signal, getAccountIdentity, onCloudSaveStatus, saveCache, getSaveOwner, saveOrigin, onLocalSaveController,
} = {}) {
  if (!windowImpl?.addEventListener || !frame?.contentWindow || !descriptor?.workId || !apiClient || !MessageChannelImpl) {
    throw new TypeError('A window, mounted frame, launch descriptor, API client and MessageChannel are required.');
  }
  const factories = { cloudSave: createCloudSaveHandlers, multiplayer: createMultiplayerHandlers, ...modules };
  let closed = false;
  let connection = null;
  let identityTimer = null;
  const initialIdentity = getAccountIdentity ? Promise.resolve().then(getAccountIdentity) : Promise.resolve(null);
  // A changed login grant ends this launch even when it belongs to the same user.
  const checkIdentity = async () => {
    if (!getAccountIdentity || closed) return;
    const [before, current] = await Promise.all([initialIdentity, getAccountIdentity()]);
    if (before !== current) {
      if (descriptor.capabilities?.cloudSave || descriptor.capabilities?.localSave) onCloudSaveStatus?.({state:'blocked',code:'BRIDGE_ACCOUNT_CHANGED'});
      connection?.notifyClosed('account_changed');
      close();
      throw Object.assign(new Error('Game account changed.'), { code: 'BRIDGE_ACCOUNT_CHANGED' });
    }
  };
  initialIdentity.catch(() => close());
  const disconnect = () => { connection?.close(); connection = null; };
  const onConnect = event => {
    if (closed || signal?.aborted || event.source !== frame.contentWindow || !isBridgeConnectMessage(event.data)) return;
    connection?.notifyClosed('reconnected'); disconnect();
    const { port1: port, port2 } = new MessageChannelImpl();
    const controller = new AbortController();
    const gameSession = createGameSessionManager({ apiClient, descriptor, signal: controller.signal, checkIdentity });
    const transfer = createGameTransfer({ maxBytes: 2 * 1024 * 1024 });
    const cleanups = [() => gameSession.close(), () => transfer.close()];
    let alive = true;
    let outstanding = 0;
    const post = (message, bounded = true) => {
      if (!alive) return;
      if (bounded && byteLength(message) > WEB_GAME_BRIDGE_MAX_BYTES) throw Object.assign(new Error('Bridge response is too large; use chunked transfer.'), { code: 'BRIDGE_RESPONSE_TOO_LARGE' });
      port.postMessage(message);
    };
    const sendEvent = (name, payload) => {
      try { post(bridgeEnvelope({ type: 'event', event: name, payload }), !name.startsWith('multiplayer.')); }
      catch { logger?.warn?.('Dropped oversized bridge event'); }
    };
    const handlers = new Map([['player.get', async () => publicProfile((await apiClient.getProfile()).data)]]);
    const capabilities = ['identity'];
    const close = () => {
      if (!alive) return;
      alive = false; controller.abort();
      // The peer port belongs to the iframe after handoff; closing it here
      // can discard the final bridge.closed notification before delivery.
      port.close?.();
      for (const cleanup of cleanups) cleanup();
    };
    try {
      if (descriptor.capabilities?.localSave === true && descriptor.capabilities?.cloudSave !== true && saveCache && getSaveOwner) {
        const local = createLocalSaveHandlers({apiClient,descriptor,localOnly:true,transfer,signal:controller.signal,checkIdentity,saveCache,getSaveOwner,saveOrigin,sendEvent,onCloudSaveStatus,onLocalSaveController});
        cleanups.push(() => local.close());
        for (const [method, handler] of Object.entries(local.handlers)) {
          if (bridgeMethodCapability(method) !== 'cloudSave' || !method.startsWith('cloudSave.local.') || typeof handler !== 'function') throw new TypeError('Invalid local save method.');
          handlers.set(method, handler);
        }
        capabilities.push('localSave');
      }
      for (const capability of ['cloudSave', 'competition', 'multiplayer']) {
        if (descriptor.capabilities?.[capability] !== true || !factories[capability]) continue;
        const module = factories[capability]({
          apiClient, workId: descriptor.workId, descriptor, initialRoomId, sessionFactory,
          sendEvent, logger, signal: controller.signal, transfer, checkIdentity, onCloudSaveStatus, getGameSession: capability => gameSession.get(capability),
        });
        if(capability==='cloudSave'&&saveCache&&getSaveOwner){
          const local=createLocalSaveHandlers({apiClient,descriptor,getGameSession:capability=>gameSession.get(capability),transfer,signal:controller.signal,checkIdentity,saveCache,getSaveOwner,saveOrigin,sendEvent,onCloudSaveStatus,onLocalSaveController,onAuthorizationRevoked:()=>{sendEvent('bridge.closed',{reason:'authorization_revoked'});close();}});
          Object.assign(module.handlers,local.handlers);cleanups.push(()=>local.close());
        }
        if (module.close) cleanups.push(() => module.close());
        for (const [method, handler] of Object.entries(module.handlers)) {
          if (bridgeMethodCapability(method) !== capability || typeof handler !== 'function' || handlers.has(method)) {
            throw new TypeError('A bridge module may only register known methods in its own capability.');
          }
          handlers.set(method, handler);
        }
        capabilities.push(capability);
      }
      const reject = (id, error) => post(bridgeEnvelope({
        type: 'response', id, ok: false,
        error: {
          code: typeof error.code === 'string' ? error.code.slice(0, 80) : 'BRIDGE_REQUEST_FAILED',
          message: error.code ? String(error.message ?? 'Bridge request failed.').slice(0, 500) : 'Bridge request failed.',
          retryable: Boolean(error.retryable),
          ...(Number.isInteger(error.status) ? { status: error.status } : {}),
          ...(saveConflictDetails(error) ? { details: saveConflictDetails(error) } : {}),
        },
      }));
      const onMessage = async event => {
        if (!alive) return;
        let request;
        try {
          request = parseBridgeRequest(event.data);
          await checkIdentity();
          if (!alive) return;
          if (!handlers.has(request.method)) throw Object.assign(new Error('This capability is not granted.'), { code: 'BRIDGE_CAPABILITY_NOT_GRANTED' });
          if (outstanding >= 32) throw Object.assign(new Error('Too many bridge requests.'), { code: 'BRIDGE_BUSY', retryable: true });
        } catch (error) {
          // Never echo arbitrary attacker-controlled IDs in rejection envelopes.
          const id = typeof event.data?.id === 'string' && event.data.id.length <= 36 ? event.data.id : null;
          reject(id, error); return;
        }
        outstanding += 1;
        try {
          const capability = bridgeMethodCapability(request.method);
          if (capability === 'cloudSave' && !request.method.startsWith('cloudSave.local.') || capability === 'competition') await gameSession.get(capability);
          if (!alive) return;
          const result = await handlers.get(request.method)(request.params ?? {});
          await checkIdentity();
          // Legacy multiplayer bounds its state in its own protocol; preserve its existing responses.
          post(bridgeEnvelope({ type: 'response', id: request.id, ok: true, result }), capability !== 'multiplayer');
        } catch (error) {
          reject(request.id, error);
          if (['GAME_SESSION_INVALID','GAME_SESSION_RELEASE_NOT_ALLOWED','AUTH_REQUIRED'].includes(error.code)) {
            if (bridgeMethodCapability(request.method) === 'cloudSave') onCloudSaveStatus?.({state:'blocked',code:error.code});
            sendEvent('bridge.closed', {reason:'authorization_revoked'}); close();
          }
        }
        finally { outstanding -= 1; }
      };
      port.addEventListener?.('message', onMessage);
      if (!port.addEventListener) port.onmessage = onMessage;
      port.start?.();
      connection = { close, notifyClosed: reason => sendEvent('bridge.closed', { reason }) };
      frame.contentWindow.postMessage(bridgeEnvelope({
        type: 'gamehub.bridge.ready', clientNonce: event.data.clientNonce, launchId, capabilities,
      }), '*', [port2]);
    } catch (error) {
      close(); logger?.warn?.('Could not initialize game bridge');
    }
  };
  const close = () => {
    if (closed) return;
    closed = true; clearInterval(identityTimer); windowImpl.removeEventListener('message', onConnect);
    signal?.removeEventListener('abort', close); disconnect();
  };
  if (signal?.aborted) close();
  else { windowImpl.addEventListener('message', onConnect); signal?.addEventListener('abort', close, { once: true }); }
  if (getAccountIdentity && !closed) {
    identityTimer = setInterval(() => { checkIdentity().catch(() => close()); }, 1000);
    identityTimer.unref?.();
  }
  return Object.freeze({ close });
}
