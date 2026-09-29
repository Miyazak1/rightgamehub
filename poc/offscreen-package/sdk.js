'use strict';
// Renderer-only SDK. The platform owns the preload and never ships it in a game.
(() => {
  const bridge = window.gamehubOffscreen;
  if (!bridge) throw new Error('此适配包需要 GameHub 离屏运行组件。');
  window.GameHub = Object.freeze({
    onInput: callback => bridge.onInput(callback),
    ready: () => bridge.report({ type: 'ready' }),
    applied: seq => {
      if (!Number.isSafeInteger(seq) || seq <= 0) throw new TypeError('Invalid input sequence');
      bridge.report({ type: 'applied', seq });
    },
  });
})();
