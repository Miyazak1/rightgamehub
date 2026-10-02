const STATES = new Set(['idle', 'loading', 'running', 'hidden', 'error', 'disposed']);

export function validateLaunchDescriptor(descriptor, { runtimeDomain = 'gamehubusercontent.example', allowLocalhost = true } = {}) {
  if (!descriptor || descriptor.apiVersion !== 1) throw new Error('不支持的启动描述。');
  const entry = new URL(descriptor.entryUrl);
  const runtime = new URL(descriptor.runtimeOrigin);
  const local = allowLocalhost && (runtime.hostname === 'localhost' || runtime.hostname === '127.0.0.1' || runtime.hostname.endsWith('.localhost'));
  if (entry.protocol !== 'https:' && !local) throw new Error('游戏必须从安全来源启动。');
  if (entry.origin !== runtime.origin) throw new Error('游戏入口与运行来源不一致。');
  const expectedHost = new RegExp(`^r-[a-f0-9]{32}\\.${runtimeDomain.replaceAll('.', '\\.').replaceAll('-', '\\-')}$`);
  if (!local && !expectedHost.test(runtime.hostname)) throw new Error('运行来源不是受信任的 release 主机。');
  return { entry, runtime };
}

export class PlayerCore {
  #state = 'idle'; #frame = null; #launchId = null; #listeners = new Set(); #bridge = null;
  constructor(options = {}) { this.options = options; }
  get state() { return this.#state; }
  get launchId() { return this.#launchId; }
  onStateChanged(listener) { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  #setState(value, details = {}) { if (!STATES.has(value)) throw new Error('Unknown player state'); this.#state = value; this.#listeners.forEach(fn => fn({ state: value, ...details })); }
  mount(container, descriptor) {
    if (this.#state === 'disposed') throw new Error('Player is disposed.');
    validateLaunchDescriptor(descriptor, this.options);
    this.stop();
    this.#launchId = globalThis.crypto?.randomUUID?.() ?? `launch-${Date.now()}`;
    const frame = container.ownerDocument.createElement('iframe');
    frame.title = 'Game player'; frame.src = descriptor.entryUrl;
    frame.setAttribute('sandbox', ['allow-scripts', descriptor.capabilities?.pointerLock && 'allow-pointer-lock'].filter(Boolean).join(' '));
    frame.setAttribute('allow', [descriptor.capabilities?.fullscreen && 'fullscreen', descriptor.capabilities?.pointerLock && 'pointer-lock'].filter(Boolean).join('; '));
    frame.referrerPolicy = 'no-referrer';
    frame.addEventListener('load', () => this.#frame === frame && this.#setState('running'), { once: true });
    frame.addEventListener('error', () => this.#frame === frame && this.#setState('error', { message: '游戏加载失败。' }), { once: true });
    container.replaceChildren(frame); this.#frame = frame;
    try {
      if (['multiplayer', 'cloudSave', 'competition'].some(key => descriptor.capabilities?.[key] === true) && this.options.createBridge) this.#bridge = this.options.createBridge({ frame,launchId: this.#launchId,descriptor });
    } catch (error) {
      frame.src = 'about:blank'; frame.remove(); this.#frame = null; this.#launchId = null;
      throw error;
    }
    this.#setState('loading'); return this.#launchId;
  }
  hide() { if (this.#state === 'running') { this.#frame.hidden = true; this.#setState('hidden'); } }
  resume() { if (this.#state === 'hidden') { this.#frame.hidden = false; this.#setState('running'); } }
  stop() { this.#bridge?.close?.(); this.#bridge = null; if (this.#frame) { this.#frame.src = 'about:blank'; this.#frame.remove(); this.#frame = null; } if (this.#state !== 'disposed') this.#setState('idle'); }
  dispose() { this.stop(); this.#setState('disposed'); this.#listeners.clear(); }
}
