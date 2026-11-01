const fs = require('node:fs');
const path = require('node:path');
const palettes = Object.freeze({
  // The shared header is 64px tall, including its 2px bottom separator.
  // Leave that strip outside the opaque native controls overlay.
  dark: { color: '#0c0b11', symbolColor: '#f7f4ff', height: 62 },
  light: { color: '#f4f4f7', symbolColor: '#17151f', height: 62 },
  'high-contrast': { color: '#000000', symbolColor: '#ffffff', height: 62 },
});
const actions = new Set(['back', 'forward', 'reload', 'toggle-fullscreen', 'quit']);
function validateAction(value) { if (typeof value !== 'string' || !actions.has(value)) throw Error('DESKTOP_WINDOW_ACTION_INVALID'); return value; }
function titleBarPalette(mode) { if (typeof mode !== 'string' || !Object.hasOwn(palettes, mode)) throw Error('DESKTOP_WINDOW_THEME_INVALID'); return { ...palettes[mode] }; }
function restoredWindowState(saved, areas) {
  const fallback = areas[0];
  if (!fallback) throw Error('DESKTOP_DISPLAY_REQUIRED');
  const b = saved?.bounds;
  const valid = b && ['x', 'y', 'width', 'height'].every(k => Number.isSafeInteger(b[k])) && b.width >= 400 && b.height >= 300;
  const area = valid && areas.find(a => b.x + b.width > a.x && b.x < a.x + a.width && b.y + b.height > a.y && b.y < a.y + a.height) || fallback;
  const width = Math.min(Math.max(valid ? b.width : 1320, 960), area.width);
  const height = Math.min(Math.max(valid ? b.height : 900, 640), area.height);
  return { bounds: { width, height,
    x: Math.min(Math.max(valid ? b.x : area.x + Math.round((area.width - width) / 2), area.x), area.x + area.width - width),
    y: Math.min(Math.max(valid ? b.y : area.y + Math.round((area.height - height) / 2), area.y), area.y + area.height - height) },
    maximized: valid && saved.maximized === true,
    minWidth: Math.min(960, area.width), minHeight: Math.min(640, area.height) };
}
function createWindowStateStore(directory) {
  const file = path.join(directory, 'window-state.json');
  return {
    read() { try { if (fs.statSync(file).size > 4096) return null; return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } },
    write(value) { try { const temporary = file + '.tmp'; fs.writeFileSync(temporary, JSON.stringify(value)); fs.renameSync(temporary, file); return true; } catch { return false; } },
  };
}
function windowShortcut(input) {
  if (input.type !== 'keyDown' || input.isAutoRepeat) return null;
  const key = String(input.key).toLowerCase();
  if (input.alt && !input.control && !input.shift && ['arrowleft', 'left'].includes(key)) return 'back';
  if (input.alt && !input.control && !input.shift && ['arrowright', 'right'].includes(key)) return 'forward';
  if (input.control && !input.alt && !input.shift && key === 'r') return 'reload';
  if (input.control && !input.alt && !input.shift && key === 'q') return 'quit';
  if (!input.alt && !input.control && !input.shift && key === 'f11') return 'toggle-fullscreen';
  return null;
}
module.exports = { restoredWindowState, createWindowStateStore, titleBarPalette, validateAction, windowShortcut };
