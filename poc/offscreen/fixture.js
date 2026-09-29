'use strict';
const canvas = document.querySelector('canvas');
const ctx = canvas.getContext('2d');
const game = globalThis.createOffscreenGame();
const acknowledgements = [];
let tick = 0;
window.gamehubOffscreen.onInput(command => {
  game.apply(command);
  acknowledgements.push(command.seq);
});
function draw() {
  const state = game.step();
  ctx.fillStyle = '#101827'; ctx.fillRect(0, 0, 640, 360);
  ctx.fillStyle = '#f7c96b'; ctx.beginPath();
  ctx.arc(320, 180, 24 + Math.sin(tick / 12) * 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#78c8ec'; ctx.beginPath(); ctx.arc(state.x, state.y, 12, 0, Math.PI * 2); ctx.fill();
  ctx.font = '18px sans-serif'; ctx.fillStyle = '#eef4ff';
  ctx.fillText('作者适配 · 离屏样本', 20, 32);
  ctx.fillText('得分 ' + state.score + '    名称 ' + state.label, 20, 65);
  ctx.fillText('动画帧 ' + (++tick), 20, 325);
  for (const seq of acknowledgements.splice(0)) {
    window.gamehubOffscreen.report({ type: 'applied', seq, state });
  }
  requestAnimationFrame(draw);
}
draw();
window.gamehubOffscreen.report({ type: 'ready' });
