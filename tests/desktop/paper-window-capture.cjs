const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Screenshot recovery is separate from product/model work: only a transient
// compositor capture error may be retried, never a failed assertion or gate.
async function capturePaperWindow(window, label, { pause = delay, onAttempt = () => {} } = {}) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) throw Error(`PAPER_CAPTURE_WINDOW_CLOSED:${label}`);
    if (window.isMinimized()) window.restore();
    if (!window.isVisible()) window.show();
    const state = { label, attempt, visible: window.isVisible(), minimized: window.isMinimized(), bounds: window.getBounds() };
    onAttempt({ ...state, status: 'started' });
    try {
      await window.webContents.executeJavaScript(`Promise.race([
        new Promise(resolve => { requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))); }),
        new Promise((_, reject) => setTimeout(() => reject(Error('PAPER_CAPTURE_FRAME_TIMEOUT')), 5000))
      ])`);
      const image = await window.webContents.capturePage(undefined, { stayHidden: false, stayAwake: true });
      if (image.isEmpty()) throw Error('PAPER_CAPTURE_EMPTY_IMAGE');
      onAttempt({ ...state, status: 'succeeded' });
      return image.toPNG();
    } catch (cause) {
      const transient = cause?.message === 'UnknownVizError';
      onAttempt({ ...state, status: 'failed', error: cause?.message });
      if (!transient || attempt === 2) throw Object.assign(Error(`PAPER_CAPTURE_FAILED:${label}:${cause?.message}`), { cause });
      await pause(250);
    }
  }
}
module.exports = { capturePaperWindow };
