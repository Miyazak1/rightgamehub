# 作者侧栏渲染包示例（v1）

该目录是渲染端示例，需要 GameHub 本机 Electron 离屏运行组件；不是 Windows EXE、安装器或通用 EXE 包装器。

在项目根目录执行 `npm run build:offscreen-package`，得到 `artifacts/gamehub-owned-sidebar-1.0.0.zip`。构建只打包声明的资源，统一文本换行并生成固定 ZIP，不运行游戏，也不会自动把新摘要加入可运行清单。

上传 ZIP 后，在 Harness 0.0.11 游戏卡片点击“下载到运行缓存”，完成后再点“在右栏开始”。运行组件默认关闭，需要通过根目录 `start-gamehub-package-test.bat` 启用（独立端口 3084）。当前只开放原样的自有示例 ZIP；改动过的包可以检查、上传及下载，尚不开放运行。

`index.html` 引入 `assets/sdk.js` 后，作者接口为：

```js
GameHub.onInput(command => {
  // command.type: click / key / text / release / reset
  // 将操作送入自己的游戏逻辑；完成应用后，再发送该 seq 的回执。
  applyGameCommand(command);
  GameHub.applied(command.seq);
});
GameHub.ready(); // 完成资源加载、绘制与输入订阅后调用
```

当前输入范围：点击坐标在 640×360 内；key 仅四个方向键及 down 布尔值；text 最多 40 个 UTF-16 代码单元；release 应释放全部方向键；reset 重置本局。回执需要在 2.5 秒内返回。样例在实际绘制后确认输入；回执不是显示延迟测量。SDK 不提供文件、执行命令、网络、宿主账户或系统键鼠能力。

平台持有 Electron main、preload 和窗口生命周期，作者只提交渲染资源。此 v1 暂无音频、自由分辨率、存档、多指触控和任意键盘接口。详细清单、信任边界和验收状态见 [文档 25](../../docs/25-offscreen-package-contract.zh-CN.md)。
