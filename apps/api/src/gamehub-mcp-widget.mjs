export const GAMEHUB_MCP_UI_URI = 'ui://gamehub/library-v1.html';

export function renderGameHubMcpWidget(siteOrigin = 'https://mooyu.fun') {
  const origin = new URL(siteOrigin).origin;
  const encodedOrigin = JSON.stringify(origin).replace(/</gu, '\\u003c');
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>GameHub</title>
  <style>
    :root{color-scheme:light dark;font-family:Inter,system-ui,-apple-system,"Segoe UI","Microsoft YaHei UI",sans-serif}
    *{box-sizing:border-box}html,body,#gamehub-frame{width:100%;height:100%;min-height:520px;margin:0}
    body{overflow:hidden;background:#f6f4fa}#gamehub-frame{display:block;border:0;background:#f6f4fa}
    .fallback{position:fixed;inset:auto 16px 16px;display:none;padding:12px;border:1px solid #8b5cf6;background:#fff;color:#17131f}
    .fallback a{color:#7651f5;font-weight:700}
  </style>
</head>
<body>
  <iframe id="gamehub-frame" title="GameHub 游戏平台" allow="fullscreen" referrerpolicy="no-referrer"></iframe>
  <p class="fallback" id="fallback">当前宿主无法显示内置界面。<a id="external" target="_blank" rel="noreferrer">在 GameHub 打开</a></p>
  <script type="module">
    const SITE_ORIGIN=${encodedOrigin};
    const frame=document.getElementById('gamehub-frame');
    const fallback=document.getElementById('fallback');
    const external=document.getElementById('external');
    let rpcId=0;const pending=new Map();
    const viewUrl=path=>{const url=new URL('/mcp-app',SITE_ORIGIN);url.searchParams.set('gh_route',path||'/discover');url.searchParams.set('gh_host','mcp-app');return url.href;};
    const show=view=>{const url=view?.url||viewUrl(view?.path);frame.src=url;external.href=url;globalThis.openai?.setOpenInAppUrl?.({href:url});};
    const update=result=>{const view=result?.structuredContent?.view||result?.view;if(view)show(view);};
    const notify=(method,params)=>window.parent.postMessage({jsonrpc:'2.0',method,params},'*');
    const request=(method,params)=>new Promise((resolve,reject)=>{const id=++rpcId;pending.set(id,{resolve,reject});window.parent.postMessage({jsonrpc:'2.0',id,method,params},'*');});
    window.addEventListener('message',event=>{if(event.source!==window.parent)return;const message=event.data;if(!message||message.jsonrpc!=='2.0')return;if(message.id!=null){const item=pending.get(message.id);if(!item)return;pending.delete(message.id);message.error?item.reject(message.error):item.resolve(message.result);return;}if(message.method==='ui/notifications/tool-result')update(message.params);},{passive:true});
    frame.addEventListener('error',()=>{fallback.style.display='block';});
    show(globalThis.openai?.toolOutput?.view||{path:'/discover'});
    try{await request('ui/initialize',{appInfo:{name:'gamehub-library',version:'1.0.0'},appCapabilities:{},protocolVersion:'2026-01-26'});notify('ui/notifications/initialized',{});}catch(error){console.warn('MCP Apps bridge unavailable; using the hosted GameHub view.',error);}
  </script>
</body>
</html>`;
}
