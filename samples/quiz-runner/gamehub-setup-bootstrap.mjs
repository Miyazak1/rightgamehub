import { createQuizRuntime } from './gamehub-runtime.mjs';

let runtimePromise = createQuizRuntime();

globalThis.gamehubStartQuiz = async quiz => {
  const runtime = await runtimePromise;
  await runtime.writeActiveQuiz(quiz);
  location.href = 'play.html';
};

globalThis.gamehubShowText = (title, text) => {
  document.querySelector('.gamehub-text-dialog')?.remove();
  const dialog = document.createElement('dialog');
  dialog.className = 'gamehub-text-dialog';
  const heading = document.createElement('h2'); heading.textContent = title;
  const note = document.createElement('p'); note.textContent = '平台隔离模式不会直接下载 CSV。请复制下面的内容，保存为 .csv 文件。';
  const area = document.createElement('textarea'); area.value = text; area.rows = 14; area.readOnly = true;
  const actions = document.createElement('div');
  const select = document.createElement('button'); select.textContent = '全选内容'; select.onclick = () => { area.focus(); area.select(); };
  const close = document.createElement('button'); close.textContent = '关闭'; close.onclick = () => dialog.close();
  actions.append(select, close); dialog.append(heading, note, area, actions); document.body.appendChild(dialog);
  dialog.addEventListener('close', () => dialog.remove(), { once: true }); dialog.showModal(); area.focus(); area.select();
};
