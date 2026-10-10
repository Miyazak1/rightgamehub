(() => {
  const canvas = document.getElementById('gameCanvas');
  const game = window.game;
  if (!canvas || !game) return;

  document.documentElement.lang = 'zh-CN';
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', '轨道秩序游戏区域。移动鼠标或手指，引导电子进入同色轨道。');

  const updatePointer = event => {
    const point = event.touches?.[0] ?? event;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height || !Number.isFinite(point.clientX) || !Number.isFinite(point.clientY)) return;
    game.input.mouse.x = (point.clientX - rect.left) * canvas.width / rect.width;
    game.input.mouse.y = (point.clientY - rect.top) * canvas.height / rect.height;
  };
  canvas.addEventListener('mousemove', updatePointer);
  canvas.addEventListener('pointermove', updatePointer);
  canvas.addEventListener('pointerdown', event => {
    updatePointer(event);
    canvas.focus({ preventScroll: true });
  });

  const controls = document.createElement('div');
  controls.className = 'gamehub-touch-controls';
  controls.setAttribute('aria-label', '游戏控制');
  for (const [label, key] of [['规则', 'Escape'], ['元素', 'l'], ['静音', 'm']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', event => {
      event.preventDefault();
      document.dispatchEvent(new KeyboardEvent('keydown', { key }));
    });
    controls.append(button);
  }
  document.getElementById('gameContainer')?.append(controls);

  const setAudioVisibility = visible => {
    const audio = game.audio;
    if (!audio?.g) return;
    audio.g.gain.value = visible && !audio.muted ? 0.3 : 0;
  };
  document.addEventListener('visibilitychange', () => setAudioVisibility(!document.hidden));
  window.addEventListener('blur', () => setAudioVisibility(false));
  window.addEventListener('focus', () => setAudioVisibility(true));
})();
