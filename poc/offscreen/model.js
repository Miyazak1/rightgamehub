'use strict';
// Pure game logic shared by the fixture and Node tests. Not a generic DOM adapter.
(function (root) {
  function createGame() {
    let score = 0, x = 160, y = 180, label = 'GameHub';
    const held = new Set();
    const snapshot = () => ({ score, x, y, label });
    return {
      snapshot,
      apply(command) {
        if (command.type === 'click' && Math.hypot(command.x - 320, command.y - 180) <= 30) score++;
        if (command.type === 'key') command.down ? held.add(command.key) : held.delete(command.key);
        if (command.type === 'text') label = command.value;
        if (command.type === 'release' || command.type === 'reset') held.clear();
        if (command.type === 'reset') { score = 0; x = 160; y = 180; label = 'GameHub'; }
        return snapshot();
      },
      step() {
        x = Math.max(12, Math.min(628, x + (held.has('ArrowRight') ? 3 : 0) - (held.has('ArrowLeft') ? 3 : 0)));
        y = Math.max(12, Math.min(348, y + (held.has('ArrowDown') ? 3 : 0) - (held.has('ArrowUp') ? 3 : 0)));
        return snapshot();
      },
    };
  }
  if (typeof module === 'object') module.exports = { createGame };
  else root.createOffscreenGame = createGame;
})(globalThis);
