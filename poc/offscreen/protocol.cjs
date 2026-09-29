'use strict';

const INPUT_CHANNEL = 'gamehub:offscreen-input-v1';
const REPORT_CHANNEL = 'gamehub:offscreen-report-v1';
const WIDTH = 640, HEIGHT = 360;
const KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !keys.includes(key))) throw new Error('Invalid command fields');
}

// This is an author-facing game API, not an OS keyboard/mouse injection API.
function validateCommand(value) {
  exact(value, ['type', 'seq', 'x', 'y', 'key', 'down', 'value']);
  if (value.type === 'ping' || value.type === 'stop') {
    exact(value, ['type']);
    return { type: value.type };
  }
  if (!Number.isSafeInteger(value.seq) || value.seq < 1) throw new Error('Invalid input sequence');
  switch (value.type) {
    case 'click':
      exact(value, ['type', 'seq', 'x', 'y']);
      if (![value.x, value.y].every(Number.isFinite) || value.x < 0 || value.x >= WIDTH ||
          value.y < 0 || value.y >= HEIGHT) throw new Error('Coordinates outside game');
      return { type: 'click', seq: value.seq, x: value.x, y: value.y };
    case 'key':
      exact(value, ['type', 'seq', 'key', 'down']);
      if (!KEYS.has(value.key) || typeof value.down !== 'boolean') throw new Error('Unsupported game key');
      return { type: 'key', seq: value.seq, key: value.key, down: value.down };
    case 'text':
      exact(value, ['type', 'seq', 'value']);
      if (typeof value.value !== 'string' || value.value.length > 40 || /[\u0000-\u001f\u007f]/u.test(value.value)) {
        throw new Error('Invalid game text');
      }
      return { type: 'text', seq: value.seq, value: value.value };
    case 'release':
    case 'reset':
      exact(value, ['type', 'seq']);
      return { type: value.type, seq: value.seq };
    default:
      throw new Error('Unsupported game command');
  }
}

module.exports = { INPUT_CHANNEL, REPORT_CHANNEL, WIDTH, HEIGHT, validateCommand };
