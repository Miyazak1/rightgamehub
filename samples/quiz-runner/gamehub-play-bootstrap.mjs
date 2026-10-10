import { createQuizRuntime } from './gamehub-runtime.mjs';

const status = document.createElement('div');
status.className = 'gamehub-load-state';
status.textContent = '正在读取本机比赛进度…';
document.body.appendChild(status);

try {
  const runtime = await createQuizRuntime();
  const showSaveError = error => {
    status.hidden = false;
    status.className = 'gamehub-load-state is-error';
    status.textContent = `本机保存失败：${error?.message || '请导出快照后重试'}`;
  };
  globalThis.gamehubQuizRuntime = runtime;
  globalThis.gamehubSafeStorage = await runtime.createStorage(showSaveError);
  const sample = new URLSearchParams(location.search).get('sample') === '1';
  if (!sample) {
    const active = await runtime.readActiveQuiz();
    if (active) document.getElementById('quiz-data').textContent = JSON.stringify(active).replace(/<\//g, '<\\/');
    else status.textContent = '尚未创建自定义题库，已为你打开示例比赛。';
  }
  globalThis.addEventListener('pagehide', () => globalThis.gamehubSafeStorage.flush(), { once: true });
  const runner = document.createElement('script');
  runner.src = 'quiz-runner.js';
  runner.onload = () => { setTimeout(() => { status.hidden = true; }, 900); };
  runner.onerror = () => { throw new Error('比赛程序没有加载成功。'); };
  document.body.appendChild(runner);
} catch (error) {
  status.className = 'gamehub-load-state is-error';
  status.textContent = `比赛没有启动：${error?.message || error}`;
}
