'use strict';
const React = require('react');
const { createElement: h, useState, useRef, useEffect } = React;
const ID = '@gamehub/harness-plugin/local-lab';
const coordinator = { owner: null, release: null };
const buttonStyle = { padding: '8px 12px', cursor: 'pointer', borderRadius: 8, border: '1px solid #6b7280', background: '#182231', color: '#f3f4f6' };
const compact = { fontSize: 12, lineHeight: 1.7, overflowWrap: 'anywhere' };
const bytesLabel = value => value < 1024 ? `${value} bytes` : value < 1024 * 1024 ? `${(value / 1024).toFixed(2)} KiB` : `${(value / 1024 / 1024).toFixed(2)} MiB`;
const endpoint = (action, params = {}) => {
  const url = new URL(`api/gamehub/${action}`, document.baseURI);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.href;
};

function FileTransfers({ signal, onPlay, canPlay }) {
  const [file, setFile] = useState(null);
  const [files, setFiles] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [job, setJob] = useState(null);
  const [message, setMessage] = useState('选择 ZIP 或 EXE 后，点击下方“上传”。');
  const [checks, setChecks] = useState({});
  const xhrRef = useRef(null);
  const prepareController = useRef(null);
  const mounted = useRef(false);
  const refreshController = useRef(null);
  const verifyTarget = useRef(null);
  const verifyInput = useRef(null);
  const selectInput = useRef(null);

  async function refresh() {
    refreshController.current?.abort();
    const controller = new AbortController();
    refreshController.current = controller;
    try {
      const response = await fetch(endpoint('files'), { credentials: 'same-origin', signal: controller.signal, cache: 'no-store' });
      if (response.status === 401) throw new Error('Harness 登录已失效，请通过启动窗口中的链接重新进入。');
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || '无法读取已上传文件。');
      if (mounted.current) { setFiles(result.files); setLoaded(true); }
    } catch (error) {
      if (mounted.current && error.name !== 'AbortError') setMessage(`读取列表失败：${error.message}`);
    }
  }

  useEffect(() => {
    mounted.current = true;
    const cancel = () => { xhrRef.current?.abort(); refreshController.current?.abort(); prepareController.current?.abort(); };
    signal.addEventListener('abort', cancel, { once: true });
    void refresh();
    return () => {
      mounted.current = false;
      signal.removeEventListener('abort', cancel);
      cancel();
    };
  }, [signal]);

  const watchingDesktop = files.some(record => record.desktopLaunch?.state === 'started');
  useEffect(() => {
    if (!watchingDesktop || signal.aborted) return;
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 3000);
    return () => clearInterval(timer);
  }, [watchingDesktop, signal]);

  function send(picked, record = null) {
    if (!picked || xhrRef.current || prepareController.current || signal.aborted) return;
    if (picked.size < 4 || picked.size > 500 * 1024 * 1024) { setMessage('请选择 4 bytes 至 500 MiB 的文件。'); return; }
    if (!record && !/\.(zip|exe)$/i.test(picked.name)) { setMessage('目前支持上传 ZIP 或 EXE 文件。'); return; }
    const action = record ? '校验' : '上传';
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    if (record) setChecks(previous => ({ ...previous, [record.id]: '正在重新校验…' }));
    setJob({ action, progress: 0 });
    setMessage(`${action}中：${picked.name}`);
    const finish = text => {
      if (xhrRef.current !== xhr) return;
      xhrRef.current = null;
      if (mounted.current) {
        setJob(null); setMessage(text);
        if (record) setChecks(previous => ({ ...previous, [record.id]: text }));
      }
    };
    xhr.open('POST', endpoint(record ? 'verify' : 'upload', record ? { id: record.id } : { name: picked.name }));
    xhr.withCredentials = true;
    xhr.timeout = 30 * 60 * 1000;
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-GameHub-Client', '1');
    xhr.setRequestHeader('X-GameHub-Size', String(picked.size));
    xhr.upload.onprogress = event => {
      if (mounted.current && event.lengthComputable) setJob({ action, progress: Math.round(event.loaded / event.total * 100) });
    };
    xhr.onload = () => {
      let result;
      try { result = JSON.parse(xhr.responseText); } catch { finish(xhr.status === 401 ? 'Harness 登录已失效，请重新进入。' : `${action}失败，请重启 Harness 并刷新页面。`); return; }
      if (xhr.status < 200 || xhr.status >= 300 || !result.ok) { finish(`${action}失败：${result.error || `HTTP ${xhr.status}`}`); return; }
      if (record) {
        finish(result.matches ? '校验通过：文件大小与 SHA-256 均和上传记录一致。' : `校验失败：所选文件与上传记录不一致。实际 SHA-256：${result.actual.sha256}`);
      } else {
        finish(result.file.web?.offscreen ? `上传成功：${result.file.name}，已识别侧栏适配包；请在下方下载到运行缓存。` : result.file.web?.state === 'ready' ? `上传成功：${result.file.name}，网页检查通过，可在下方开始游戏。` : `上传成功：${result.file.name}，已保存到本机测试服务。`);
        if (mounted.current) { setFile(null); if (selectInput.current) selectInput.current.value = ''; void refresh(); }
      }
    };
    xhr.onerror = () => finish(`${action}连接中断；请刷新列表确认结果后重试。`);
    xhr.ontimeout = () => finish(`${action}超时；请刷新列表确认结果后重试。`);
    xhr.onabort = () => finish(`${action}已取消；可刷新列表确认是否已在取消前保存。`);
    try { xhr.send(picked); } catch (error) { finish(`${action}失败：${error.message}`); }
  }

  async function preparePackage(record) {
    if (xhrRef.current || prepareController.current || signal.aborted) return;
    const controller = new AbortController(); prepareController.current = controller;
    setJob({ action: '准备运行缓存', progress: null });
    setMessage(`正在下载并校验：${record.web.title}。完成后需手动开始。`);
    try {
      const response = await fetch(endpoint('offscreen-prepare', { id: record.id }), { method: 'POST',
        headers: { 'X-GameHub-Input': '1' }, credentials: 'same-origin', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(125000)]) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || '准备失败');
      if (mounted.current) setMessage('运行缓存已准备，文件大小与摘要校验通过。点击“在右栏开始”游玩。');
    } catch (error) {
      if (mounted.current) setMessage(error.name === 'AbortError' ? '准备已取消。游戏没有自动启动。' : `准备失败：${error.message}`);
    } finally {
      prepareController.current = null;
      if (mounted.current) { setJob(null); void refresh(); }
    }
  }

  async function desktopAction(record, launch = false) {
    if (xhrRef.current || prepareController.current || signal.aborted) return;
    const controller = new AbortController(); prepareController.current = controller;
    setJob({ action: launch ? '启动 EXE' : '下载 EXE', progress: null, cancellable: !launch });
    setMessage(launch ? `正在启动 ${record.name}，将在独立游戏窗口运行…` : `正在下载并校验 ${record.name}，完成后不会自动运行。`);
    try {
      const response = await fetch(endpoint(launch ? 'desktop-launch' : 'desktop-prepare', { id: record.id }), {
        method: 'POST', headers: { 'X-GameHub-Client': '1', ...(launch ? {
          'X-GameHub-Launch': 'independent-window-v1', 'X-GameHub-Request-Id': crypto.randomUUID(),
        } : {}) }, credentials: 'same-origin',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(launch ? 120000 : 30 * 60 * 1000)]),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || '操作未完成');
      if (mounted.current) setMessage(launch ? 'Windows 已创建启动进程。请在独立游戏窗口游玩；安装包会打开安装向导，平台不会自动安装。' : '下载与校验完成。点击“启动（独立窗口）”打开程序。');
    } catch (error) {
      if (mounted.current) setMessage(launch && ['AbortError', 'TimeoutError', 'TypeError'].includes(error.name)
        ? '启动结果未确认，程序可能已经打开；请先检查游戏窗口，平台不会自动重试。'
        : error.name === 'AbortError' ? '下载已取消，没有启动游戏。' : `操作失败：${error.message}`);
    } finally {
      prepareController.current = null;
      if (mounted.current) { setJob(null); void refresh(); }
    }
  }

  const control = (text, onClick, disabled = false) => h('button', {
    type: 'button', onClick, disabled, style: { ...buttonStyle, opacity: disabled ? 0.5 : 1, cursor: disabled ? 'default' : 'pointer' },
  }, text);
  return h('section', { 'aria-label': '本机文件上传与下载' },
    h('h3', null, '上传游戏 · 本机试运行'),
    h('p', { style: compact }, '网页游戏 ZIP 根目录需有 index.html，最多 100 MiB；资源请使用相对路径并打包在 ZIP 内。检查通过后可在右栏游玩。普通 ZIP/EXE 下载包最多 500 MiB。'),
    h('p', { style: compact }, '侧栏适配 ZIP 还需 gamehub.offscreen.json。上传后先下载到运行缓存，再手动开始；目前仅开放自有样本。'),
    h('input', {
      ref: selectInput, type: 'file', accept: '.zip,.exe', disabled: !!job, 'aria-label': '选择本机 ZIP 或 EXE',
      onChange: event => { const picked = event.target.files?.[0] || null; setFile(picked); setMessage(picked ? '文件已选择，请点击“上传”。' : '请选择文件。'); },
      style: { width: '100%', fontSize: 12 },
    }),
    file && h('p', { style: compact }, `${file.name} · ${bytesLabel(file.size)} · ${file.size.toLocaleString()} bytes`),
    h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 } },
      control('上传', () => send(file), !file || !!job),
      job && job.cancellable !== false && control('取消传输', () => { xhrRef.current?.abort(); prepareController.current?.abort(); }),
      control('刷新文件列表', () => void refresh(), !!job)),
    job && h('div', { style: { marginTop: 12 } },
      h('progress', { value: job.progress ?? undefined, max: 100, 'aria-label': `${job.action}进度`, style: { width: '100%' } }),
      h('span', { style: compact }, job.progress === null ? `${job.action}，请稍候…` : job.progress === 100 ? '文件已发送，正在保存或检查包，请稍候…' : `${job.action} ${job.progress}%`)),
    h('p', { role: 'status', 'aria-live': 'polite', style: compact }, message),
    h('h4', null, `我的游戏与文件${loaded ? `（${files.length}）` : ''}`),
    loaded && files.length === 0 && h('p', { style: compact }, '还没有上传的文件。'),
    h('input', { ref: verifyInput, type: 'file', style: { display: 'none' }, 'aria-label': '选择下载后的文件进行校验', onChange: event => {
      const picked = event.target.files?.[0];
      if (picked && verifyTarget.current) send(picked, verifyTarget.current);
      event.target.value = '';
    } }),
    ...files.map(record => h('article', { key: record.id, style: { padding: 14, margin: '10px 0', border: '1px solid #8893a544', borderRadius: 12 } },
      record.web?.state === 'ready' && h('div', { role: 'img', 'aria-label': `${record.web.title} 默认封面`, style: { height: 92, borderRadius: 8, marginBottom: 12, background: 'linear-gradient(125deg,#143c5c,#396942)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 22, letterSpacing: 4 } }, record.offscreenPackage ? 'SIDEBAR GAME' : 'WEB GAME'),
      h('strong', { style: { overflowWrap: 'anywhere' } }, record.web?.title || record.name),
      h('p', { style: compact }, `${bytesLabel(record.size)} · ${new Date(record.createdAt).toLocaleString()} · ${record.offscreenPackage ? '侧栏适配包 / 未公开发布' : record.web?.state === 'ready' ? '可本机试玩 / 未公开发布' : '下载文件 / 未发布'}`),
      record.web?.state === 'ready' && h('p', { style: compact }, `${record.web.fileCount} 个网页资源 · 展开后 ${bytesLabel(record.web.totalBytes)}`),
      record.web?.reason && h('p', { style: compact }, record.web.reason),
      record.offscreenPackage && h('p', { style: compact }, !record.offscreenPackage.approved ? '格式已识别；此包尚未获准运行，目前仅提供下载。' : !record.offscreenPackage.enabled ? '运行组件未启用，请使用离屏测试启动文件。' : record.offscreenPackage.prepared ? '运行缓存已准备，启动前会再次校验。' : '尚未下载到运行缓存。'),
      record.desktopLaunch && h('p', { style: compact }, '独立窗口游戏：在运行 Harness 的这台电脑打开。关闭右栏不会退出游戏。文件未经过安全扫描，请仅启动你信任的程序。'),
      record.desktopLaunch && h('p', { style: compact, role: 'status' }, record.desktopLaunch.state === 'started' ? '启动进程仍在运行，请查看游戏窗口。' : record.desktopLaunch.state === 'entry-exited' ? '入口进程已退出，游戏或安装程序可能仍在运行；再次启动前请先检查。' : record.desktopLaunch.prepared ? '已下载到本机，启动前会再次校验。' : '尚未下载到平台管理的本机目录。'),
      record.kind === 'zip' && !record.web && h('p', { style: compact }, '此 ZIP 上传于旧版本，请重新上传以检查网页游戏入口。'),
      h('details', { style: compact }, h('summary', null, '查看上传记录 SHA-256'), h('code', { style: { overflowWrap: 'anywhere' } }, record.sha256)),
      h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 } },
        record.web?.state === 'ready' && !record.offscreenPackage && control('开始游戏', () => onPlay(record), !canPlay),
        record.offscreenPackage?.approved && control(record.offscreenPackage.prepared ? '重新准备缓存' : '下载到运行缓存', () => void preparePackage(record), !!job || !record.offscreenPackage.enabled),
        record.offscreenPackage?.approved && control('在右栏开始', () => onPlay(record), !!job || !canPlay || !record.offscreenPackage.enabled || !record.offscreenPackage.prepared),
        record.desktopLaunch && control(record.desktopLaunch.prepared ? '重新校验 / 下载 EXE' : '下载到本机', () => void desktopAction(record), !!job || record.desktopLaunch.state === 'started'),
        record.desktopLaunch && control(record.desktopLaunch.state === 'entry-exited' ? '再次启动（独立窗口）' : '启动（独立窗口）', () => void desktopAction(record, true), !!job || !canPlay || !record.desktopLaunch.prepared || record.desktopLaunch.state === 'started'),
        record.nativeProbe && control('旧窗口实验（会弹窗）', () => onPlay(record), !canPlay),
        h('a', { href: endpoint('download', { id: record.id }), download: record.name, style: buttonStyle, onClick: () => setMessage('下载已交给浏览器保存。保存完成后，可选择下载文件校验；面板尚未确认下载完成。') }, '下载文件'),
        control('选择下载文件校验', () => { verifyTarget.current = record; verifyInput.current?.click(); }, !!job)),
      record.nativeProbe && h('p', { style: compact }, '历史实验会显示独立游戏窗口，不符合仅在右栏游玩的要求。离屏样本请使用上方的新入口。'),
      checks[record.id] && h('p', { style: compact, role: 'status' }, checks[record.id]))),
    h('p', { style: { ...compact, color: '#91a4be' } }, '结构检查不等于安全扫描。EXE 的独立窗口启动需通过本机启动配置启用。平台管理的下载与浏览器另存为的文件分开管理。'));
}

function GameHubBody({ useTabInfo }) {
  const { tab } = useTabInfo();
  const [game, setGame] = useState(null);
  const [notice, setNotice] = useState('选择样本，在此功能区内开始。');
  const [offscreen, setOffscreen] = useState(false);
  const owner = useRef(Symbol('gamehub-tab'));
  const alive = useRef(false);
  const player = useRef(null);
  const lease = useRef(null);
  const generation = useRef(0);
  const loadedFrame = useRef(null);
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState === 'visible');
  const canPlay = tab.visible && pageVisible && !tab.signal.aborted;

  function release(reason) {
    generation.current++;
    if (lease.current) { stopLease(lease.current); lease.current = null; }
    if (coordinator.owner === owner.current) {
      coordinator.owner = null;
      coordinator.release = null;
    }
    if (alive.current) {
      setGame(null);
      setNotice(reason);
    }
  }

  useEffect(() => {
    alive.current = true;
    const onVisibility = () => setPageVisible(document.visibilityState === 'visible');
    const onAbort = () => release('此功能区已关闭。');
    const onPageHide = () => release('页面已离开，样本已释放。');
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    tab.signal.addEventListener('abort', onAbort, { once: true });
    return () => {
      alive.current = false;
      release('功能区已关闭。');
      if (coordinator.owner === owner.current) {
        coordinator.owner = null;
        coordinator.release = null;
      }
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      tab.signal.removeEventListener('abort', onAbort);
    };
  }, [tab.signal]);

  useEffect(() => {
    if (!canPlay) release('面板隐藏或会话切换，样本已释放。重新显示后请再次开始。');
  }, [canPlay]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint('offscreen-status'), { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(result => { if (!controller.signal.aborted) setOffscreen(result?.enabled === true); })
      .catch(() => {});
    return () => controller.abort();
  }, [tab.signal]);

  function start(kind) {
    if (!canPlay || !Object.hasOwn(GAME_DOCUMENTS, kind)) return;
    coordinator.release?.('另一功能区开始了新样本，本局已释放。');
    coordinator.owner = owner.current;
    coordinator.release = release;
    setGame({ kind, id: crypto.randomUUID() });
    setNotice('样本已装入隔离容器；请在游戏区域操作并检查画面与声音。');
  }

  function stopLease(launchId) {
    void fetch(endpoint('stop', { launchId }), { method: 'POST', headers: { 'X-GameHub-Client': '1' }, credentials: 'same-origin', keepalive: true }).catch(() => {});
  }

  async function playUploaded(record) {
    if (!canPlay) return;
    const isOffscreen = !!(record.offscreenSample || record.offscreenPackage);
    coordinator.release?.('另一游戏已开始，本局已结束。');
    coordinator.owner = owner.current;
    coordinator.release = release;
    const current = ++generation.current;
    setGame(null);
    setNotice(`正在启动：${record.web?.title || record.name}`);
    try {
      const response = await fetch(endpoint(isOffscreen ? 'offscreen-launch' : record.nativeProbe ? 'native-launch' : 'launch', { id: record.id }), { method: 'POST', headers: { 'X-GameHub-Client': '1', ...(isOffscreen ? { 'X-GameHub-Input': '1' } : {}) }, credentials: 'same-origin', signal: AbortSignal.timeout(isOffscreen ? 25000 : 15000) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || '无法启动网页游戏。');
      if (!alive.current || generation.current !== current) { stopLease(result.launchId); return; }
      const trustedPlayer = isOffscreen ? 'offscreen-player' : record.nativeProbe ? 'native-player' : null;
      const playerUrl = trustedPlayer ? endpoint(trustedPlayer, { launchId: result.launchId }) : result.url;
      const url = new URL(playerUrl);
      const valid = trustedPlayer ? url.origin === location.origin && url.pathname.endsWith('/api/gamehub/' + trustedPlayer) : url.protocol === 'http:' && url.hostname === '127.0.0.2' && url.pathname.startsWith('/play/');
      if (!valid) { stopLease(result.launchId); throw new Error('游戏资源地址不符合本机运行策略。'); }
      lease.current = result.launchId;
      setGame({ kind: 'uploaded', id: result.launchId, url: playerUrl, record });
      setNotice(`正在载入：${record.web?.title || record.name}`);
    } catch (error) { if (alive.current && generation.current === current) release(`启动失败：${error.message}`); }
  }

  async function fullscreen() {
    try { if (document.fullscreenElement === player.current) await document.exitFullscreen(); else await player.current?.requestFullscreen(); }
    catch { setNotice('当前宿主未允许全屏，可使用 Harness 功能区的“全屏”按钮扩大画面。'); }
  }

  useEffect(() => {
    if (game) { player.current?.focus({ preventScroll: true }); player.current?.scrollIntoView({ block: 'start' }); }
  }, [game?.id]);

  useEffect(() => {
    if (game?.kind !== 'uploaded' || game.record?.offscreenSample || game.record?.offscreenPackage) return;
    const key = `${game.id}:${game.attempt || 0}`;
    const timer = setTimeout(() => {
      if (!alive.current || loadedFrame.current === key) return;
      if (!game.attempt) {
        setNotice('首次载入尚未完成，正在重试一次…');
        setGame(current => current?.id === game.id ? { ...current, attempt: 1 } : current);
      } else setNotice('游戏资源载入超时。可点击“重新开始”；若持续失败，请检查本机资源服务。');
    }, 12000);
    return () => clearTimeout(timer);
  }, [game?.id, game?.attempt]);

  const button = (text, onClick) => h('button', { type: 'button', onClick, style: buttonStyle }, text);
  return h('section', {
    'data-gamehub-m0': 'true',
    style: { boxSizing: 'border-box', width: '100%', height: '100%', minWidth: 0, overflow: 'auto', padding: 16, color: 'inherit', fontFamily: 'inherit' },
  },
  h('small', { style: { color: '#91a4be', letterSpacing: 2 } }, 'GAMEHUB LOCAL LAB · 0.0.51'),
  h('h2', { style: { margin: '8px 0' } }, '本机试验场'),
  h('p', null, '上传网页小游戏，在此功能区游玩。'),
  h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 } },
    button('开始 2D 样本', () => start('canvas')),
    button('开始 WebGL2 样本', () => start('webgl')),
    button('结束游戏', () => release('游戏已结束。'))),
  offscreen && h('div', { style: { marginBottom: 12 } },
    button('开始离屏运行样本', () => void playUploaded({ id: 'owned-offscreen-sample', name: '离屏运行样本', offscreenSample: true })),
    h('p', { style: compact }, '验证后台绘制与右栏操作的自有样本；暂无声音，普通 EXE 尚不支持此入口。')),
  h('p', { role: 'status', style: { fontSize: 12, lineHeight: 1.6 } }, notice),
  h('style', null, '.gamehub-player:fullscreen{width:100vw;height:100vh;padding:12px;box-sizing:border-box;background:#101827}.gamehub-player:fullscreen iframe{height:calc(100vh - 76px)!important}'),
  canPlay && game && h('div', { ref: player, className: 'gamehub-player', tabIndex: -1 },
    h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 } },
      button('重新开始', () => game.kind === 'uploaded' ? void playUploaded(game.record) : start(game.kind)),
      button('全屏 / 退出全屏', () => void fullscreen())),
    h('iframe', {
    key: `${game.id}:${game.attempt || 0}`,
    title: game.kind === 'uploaded' ? `GameHub 游戏：${game.record.web?.title || game.record.name}` : game.kind === 'canvas' ? 'GameHub 2D 样本' : 'GameHub WebGL2 样本',
    sandbox: game.record?.nativeProbe || game.record?.offscreenSample || game.record?.offscreenPackage ? 'allow-scripts allow-same-origin' : 'allow-scripts',
    allow: 'fullscreen',
    referrerPolicy: 'no-referrer',
    srcDoc: game.kind === 'uploaded' ? undefined : GAME_DOCUMENTS[game.kind],
    src: game.kind === 'uploaded' ? game.url : undefined,
    onLoad: () => { loadedFrame.current = `${game.id}:${game.attempt || 0}`; if (alive.current) setNotice('游戏页面已载入。可在下方操作，或使用重新开始与全屏。'); },
    style: { display: 'block', boxSizing: 'border-box', width: '100%', height: game.record?.offscreenSample || game.record?.offscreenPackage ? 560 : game.record?.nativeProbe ? 700 : 370, border: '1px solid #526074', borderRadius: 10, background: '#101827' },
  })),
  h('hr', { style: { opacity: 0.2, margin: '20px 0' } }),
  h(FileTransfers, { signal: tab.signal, onPlay: playUploaded, canPlay }),
  h('p', { style: { marginTop: 20, fontSize: 12, lineHeight: 1.7, color: '#91a4be' } }, '本机试运行：上传、网页试玩、下载与校验。离屏运行目前仅限自有适配样本。平台账号与云端发布尚未接入。'));
}

module.exports.inject = ['slots', 'sidebarRightTabs'];
module.exports.apply = function apply(ctx) {
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: ID, kind: 'gamehub', priority: 'extension', keepMounted: true,
    title: () => '本机试验场',
    guide: [{ id: 'gamehub-local-lab', order: 61, title: () => '本机试验场', description: () => '本机 ZIP / EXE 与隔离运行验证' }],
  }), 'gamehub: register tab');
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: ID }, GameHubBody,
  )), 'gamehub: register body');
  ctx.effect(() => () => {
    coordinator.release?.('插件已停用。');
    coordinator.owner = null;
    coordinator.release = null;
  }, 'gamehub: release game');
};
