# Harness 插件与网页播放器技术规范

版本：TD-1.1 · 状态：待实现；宿主接口已读源码核查 · [技术总纲](./13-technical-design.zh-CN.md)

2026-09-24 实施进度：M0 插件已独立打包、安装并完成部分 UI 实测，见 [20](./20-execution-status.zh-CN.md)。下文仍为完整目标规范，不代表整套播放器/平台已完成。

本文负责 Harness 接口与共用网页播放器；完整的插件内账号、上传、作品管理、下载和 VS Code/Cursor 适配见 [18](./18-multi-host-client-spec.zh-CN.md)，Windows 包见 [19](./19-windows-package-spec.zh-CN.md)。客户端已扩展为完整平台入口。

## 1. 宿主基线与真实接口

第一适配目标为官方 Harness 源码版 Web 界面：`0.1.7-alpha.1`，提交 `c36a83ff6bb95e3f82cf79f9be7c724270a8aa61`。本机已完成宿主构建启动及 20 的基础插件实验；下述完整业务与 SDK 仍待实现，桌面发行版和其他提交需要独立测试。

| 宿主现有接口 | 插件使用方式 | 源码依据 |
| --- | --- | --- |
| `ctx.sidebarRightTabs.register` | 注册独有类型和 guide 入口 | [tab-registry.ts](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-sidebar-right/src/client/tab-registry.ts) |
| `sidebar.right.pane.tab` | 用同一 provider id 挂载 GameHubBody | [slots.ts](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-sidebar-right/src/client/contract/slots.ts) |
| `ctx.sidebarRight.openTab(kind)` | 有活动右栏绑定时打开大厅 | [service.ts](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-sidebar-right/src/client/service.ts) |
| 组件注入的 `useTabInfo()` | 读取 `tab.visible`、`tab.signal`、tab id 与 actions | [tab-info.ts](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-sidebar-right/src/client/tab-info.ts) |
| `keepMounted: true` | 保留已访问的组件外壳 | 同上类型注册文件；默认值为 false |
| `ctx.effect` 与 slot disposer | 关闭插件时解除注册和订阅 | [官方文件树插件实例](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/packages/client/ui-sidebar-files/src/client/index.ts) |

`useTabInfo` 是宿主组件注入的 hook，不是我们拟增加的服务。`tab.signal` 只在该 tab 消失或插件卸载时中止，收起/切换会话不会因此 abort。可见性要读取正文席位的 `tab.visible`，不能从标题组件可见性或 DOM 是否仍存在来推断。

没有活动会话时不调用 `openTab`：显示“进入一个会话后打开游戏大厅”。如增加全局快捷入口，应订阅宿主 `mounted` 状态后再打开；首版可以直接使用现有右栏 guide 入口。

## 2. 包结构和发布物

暂定开发包名 `@gamehub/harness-plugin`，只是占位，不代表已注册 npm scope。

```text
extensions/harness/
  package.json
  cordis.patch.yml
  src/index.ts                # 受限账号/文件/传输服务，不执行作者游戏
  src/client/index.ts         # 注册类型、组件、本地化和清理
  src/client/adapter.ts       # 宿主接口到内部播放器事件的转换
  src/client/GameHubBody.tsx
  src/client/locales.ts
  lib/index.js                # 发布构建产物
  lib/client.js
```

manifest 结构片段如下，依赖和构建配置实施时补齐并验收，不能把此片段当作完整可安装包：

```json
{
  "name": "@gamehub/harness-plugin",
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js",
    "./cordis.patch.yml": "./cordis.patch.yml"
  },
  "files": ["lib", "cordis.patch.yml"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-ui-sidebar-right",
        "@deepseek-ai/dsh-client-ui-slots",
        "@deepseek-ai/dsh-client-locale"
      ]
    }
  }
}
```

```yaml
- insert:
    - id: gamehub
      name: '@gamehub/harness-plugin'
```

包内 patch 只增加自己的行。界面注册使用 slots/locale/sidebarRightTabs，主动打开时依赖 sidebarRight。完整客户端另注册 18 的受限平台 Host 服务并通过认证 Remote 调用；实现时补齐依赖。文件选择和传输只处理用户指定句柄，不照搬工作区通读或终端能力。上面的 manifest 仍是界面结构片段，不能当作完整客户端成品。

类型 `id` 使用包名，`kind='gamehub'`，`priority='extension'`，`keepMounted=true`，不设 `multiple=true`。这只让每 pane 中的页类型去重，不保证整个窗口唯一；全窗口运行约束由下节 PlayerCoordinator 负责。

共享宿主实例的依赖按官方规则声明 peerDependencies 和构建期 devDependencies；React/Cordis/宿主服务不得捆绑出第二个实例。内部 contracts/player-core 可编译进包，第三方纯工具依赖应可独立解析。构建后检查无 `workspace:`、无源码绝对路径和缺失 CSS/资源。[官方打包和依赖解析约定](https://github.com/deepseek-ai/deepseek-harness/blob/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61/docs/user/develop/basic/publish.zh.md)

客户端产物必须符合该版本的 `window.__ModuleLoader__.load({id,factory})` 格式，factory 返回插件 exports，React 等外部依赖由宿主模块表提供；仅生成普通 ESM 不够。当前 M0 构建已实现，源码依据为官方 `packages/client/tsdown.client.ts` 和 `packages/client/modules/src/client/manifest.ts`。

测试分发为预构建 `.tgz`，生产再采用带明确版本的 npm 包。干净、包含 Web 应用的受管 profile 必须从发布包安装成功，不以 monorepo 内 overlay 启动替代验收。停用、启用、卸载、升级均测试；用户通过宿主提示重启，不假定任意环境都热更新。

## 3. 前端模块与状态归属

| 模块 | 状态与责任 |
| --- | --- |
| HarnessAdapter | 提供 sessionId/tabId/visible/lifetimeSignal；解除宿主订阅 |
| GameHubStore | 每 tab 的目录页、分页游标、详情选择、界面错误；最多缓存 100 个摘要 |
| CatalogClient | Schema 检查、超时、取消、匿名 GET、错误映射；没有账号 token |
| PlayerCoordinator | 每个客户端窗口一个实例，分配唯一 iframe 所有权；新游戏开始前释放旧实例 |
| PlayerCore | 启动状态机、frame 引用、握手、命令超时、暂停和清理 |
| Game SDK | 作者侧可选适配，只处理当前作品的生命周期消息 |
| PlatformClient / HostBroker | 插件内账号、上传、我的作品与下载任务，见 18；与 Game SDK 消息分离 |

目录 GET 超时 10 秒，最多自动重试 2 次，退避 1/3 秒加抖动；4xx 不重试，429 遵从 Retry-After。切换详情或销毁组件中止旧请求；采用 request generation 防止迟到结果覆盖新选择。旧目录可以暂留显示，但点击开始必须拿新的启动描述。

入口、页码、最近作品 ID 可以存储，最多 20 项；不存完整启动 URL、作者凭据或游戏内存。默认不上传最近游玩记录。宿主重启后恢复大厅位置，不自动启动或播放声音。

## 4. 游戏启动和尺寸处理

1. 玩家点击开始；协调器停止旧实例，生成新的本地 UUID `launchId`。
2. 获取 14 定义的启动描述，校验协议有交集、必要 WebGL2/WASM 能力。
3. 用 URL 解析器检查 entryUrl：生产仅 HTTPS、无用户名密码、无非标准端口；origin 等于 runtimeOrigin，host 必须精确等于由 releaseId 构造的运行 host；入口路径来自合法描述，不接收任意外部 URL。
4. 设置 sandbox/allow/referrerPolicy 后再挂载 iframe；策略见 16。开发模式的本地测试 origin 使用单独编译配置，不能让生产 URL 参数开启。
5. 进入 frame 加载状态；加载慢 15 秒显示提示，60 秒显示“仍未确认完成”，允许继续等待、重试或返回。不能用 iframe 的 error/load 事件准确区分所有跨源 HTTP/CSP 故障。
6. `load` 后尝试 SDK 握手 8 秒；未接入 SDK 时保持基础模式，不因缺少 SDK 拒绝可玩的页面。加载事件标记为 `loaded_unconfirmed`，不要宣称已验证逻辑可运行。

播放器 CSS 使用 `min-width:0`、容器宽高约束和作品声明的 aspectRatio；调整尺寸用 ResizeObserver，合并为每秒最多 10 次通知。未适配窄栏的作品提示展开，不强制缩放整个宿主。宿主的展开模式和浏览器 Fullscreen API 分开处理；后者必须由用户操作触发且父层授权。

游戏的键盘监听只在 frame 内；不在宿主全局拦截键盘。离开 frame 后释放指针锁；Esc、宿主快捷键和拖动停靠栏列入真机测试。声音必须有玩家在游戏区域的有效交互，不承诺父界面的点击能跨源解锁全部浏览器音频。

## 5. 生命周期状态机

```text
idle → resolving → loading → active_basic / active_sdk
active_sdk → pausing → paused → resuming → active_sdk
active_basic → released（隐藏/切换）
任一状态 → released（关闭/停用/新游戏抢占）
运行错误 → failed → resolving（明确重试）
```

实际运行可见性取 `tab.visible && document.visibilityState === 'visible'`；另监听页面 pagehide/卸载。点击输入区造成 blur 不作为隐藏，不误暂停仍显示的游戏。document 事件只是补充，宿主切换必须读 tab.visible；CSS 隐藏 iframe 不会自动更新其中页面的可见性状态。[MDN Page Visibility](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)

| 事件 | 基础模式 | 通过侧栏暂停验证的 SDK 模式 |
| --- | --- | --- |
| 收起/切会话/切到其他全局面板 | 立即移除 iframe，保留重开提示 | 发 PAUSE，1 秒未确认即释放；确认后最长保留 5 分钟 |
| 再次显示 | 显示“重新打开”，用户点击后重载 | 超期则重新打开；仍保留时用户点击继续，再发 RESUME，1 秒未确认即释放并提示 |
| 新作品开始 | 释放旧 frame 后开始新实例 | 同样释放旧实例，不同时保留多个暂停游戏 |
| 关闭 tab/插件卸载/tab.signal 中止 | 立即释放 | 立即释放，不为存档等待任意游戏代码 |
| 页面退出/宿主退出 | 尽力清理，本地游戏自己负责已写入存档 | 同左；不依赖 unload 中的异步存档保证 |

`keepMounted` 只保留大厅和播放器组件外壳，iframe 是否仍存在由 PlayerCore 控制。侧栏优化资格要求后台返回 `sdkPauseVerified=true` 且本次 READY 声明 pause/resume 支持；普通作者声明不能绕过限制。ACK 仍只是合作信号，不能证明恶意游戏没有后台活动；5 分钟为上限，性能不合格版本取消资格。

释放操作必须可重复：中止网络请求、取消计时器、断开 ResizeObserver、移除消息监听、清空所有权、移除 iframe、使旧 launchId 失效。宿主 signal 已中止时不再创建 frame。该操作不能关闭其他插件或宿主自身服务。

## 6. SDK v1 消息协议

以下是本平台拟定协议，不是 Harness 官方 API。INIT 通过 window.postMessage 发送严格 JSON 字符串并转移一个专属 MessagePort；之后消息通过该端口传递。除握手的一个端口外，不接收任意 structured-clone 对象、函数、二进制或额外端口。这一 TD-1.1 调整用于兼容桌面 Webview 来源，见 18。

```json
{
  "channel": "gamehub.player",
  "version": 1,
  "launchId": "0f5b71cf-a144-4d8b-88c8-5fb6a9967543",
  "id": "pause-1",
  "type": "PAUSE",
  "payload": { "reason": "hidden" }
}
```

字段：channel 固定；version=1；launchId 为本次实例 UUID；id 为 1—64 ASCII 字符；payload 必须匹配类型的精确 Schema。单条最大 16 KiB，每 frame 每秒最多 30 条；超限丢弃并计数，持续 3 秒超限释放。不要无限保存消息历史或完整 payload 日志。

| 方向/type | payload | 语义 |
| --- | --- | --- |
| parent → `INIT` | `{protocol:1,locale,viewport:{width,height,dpr}}` | 初始化；无用户信息和凭据 |
| game → `READY` | `{protocol:1,capabilities:{pause:boolean,resume:boolean}}` | 游戏已完成自身初始化，声明能力 |
| parent → `RESIZE` | `{width,height,dpr}` | 正数、有上限；布局信息 |
| parent → `PAUSE` | `{reason:"hidden"或"user"}` | 停止游戏循环、音频和输入后确认 |
| parent → `RESUME` | `{reason:"user"}` | 恢复；音频仍受浏览器用户操作限制 |
| game → `ACK` | `{replyTo,status:"ok"或"unsupported"}` | 对应当前未完成命令，只处理一次 |
| game → `ERROR` | `{code,message}` | message 最多 500 字符，纯文本展示；不接受 HTML 或堆栈 |

握手与校验：

1. 父层在 frame.load 后创建 MessageChannel，以准确 runtimeOrigin 发送 INIT 和 port2，保留 port1。8 秒内每 500 毫秒可重试，重试前关闭旧端口对，复用当前 launchId。
2. SDK 仅接受 event.source 为 window.parent、协议/长度/launchId 正确且恰有一个端口的 INIT。只允许当前父窗口为同一 launchId 更新握手，不能接受其他窗口改绑。
3. 父层只处理自己交给当前 iframe 的端口对上的消息，并逐条检查 launchId、方向与 Schema；不接收任意 window 消息中的 READY/ACK 作为运行指令。
4. SDK 回包通过专属 port，不需要向来源为 null 的父页面使用 targetOrigin='*'。旧 port、旧实例、未知类型和没有请求的 ACK 均忽略；释放时关闭端口。
5. launchId 与端口用于关联和限定通道，不授予作者/宿主权限。所有游戏类型都没有文件、shell、发布或模型能力；可信平台 UI 的 HostBroker 使用另一通道。

基础游戏无需导入 SDK。SDK 未就绪时不出现“已暂停/已保存”提示。首版没有 save/loadSave、账户信息和 Agent 工具桥；未来协议以能力协商增加，不能复用 ERROR 等现有类型偷偷携带命令。

## 7. manifest 与能力映射

网页 ZIP 可选根目录 `platform.json`：

```json
{
  "schemaVersion": 1,
  "entry": "index.html",
  "kind": "game",
  "runtime": "web",
  "renderers": ["webgl2"],
  "wasm": { "required": false, "threads": false },
  "display": { "minWidth": 360, "preferredAspectRatio": "16:9", "orientation": "any" },
  "input": ["keyboard", "pointer"],
  "permissions": {
    "audio": true,
    "fullscreen": true,
    "pointerLock": false,
    "camera": false,
    "microphone": false,
    "externalNetworkOrigins": []
  },
  "sdk": { "version": "1", "pauseResume": true }
}
```

上面是本免费版的有效示例。04 的历史示例含 cloudSave，不适用于当前协议。缺省 manifest 采用 index.html、基础模式、无额外网络/设备权限；作品是否使用 WebGL 不能由声明缺失证明，发布兼容标签须来自样本或测试。

首版入口固定 index.html；`kind` 与作品元数据一致，否则报告冲突。SDK pauseResume 是请求，经过兼容验证才映射为 sdkPauseVerified；摄像头、麦克风、线程和外部网络请求转为不支持/复核，不由 manifest 自动开启。manifest 最大 16 KiB，无密钥、任意 HTML 或响应头覆盖字段。

## 8. 兼容错误与回退

插件包安装失败与游戏启动失败分别处理。包加载时缺少宿主服务显示兼容性说明，不替换官方模块。启动描述协议不兼容时显示升级插件提示；缺少 WebGL2 时停止该作品并允许选其他作品。

游戏容器失败提供重试和网站体验链接。打开网站由用户点击、经宿主已验证的导航方式进行；不能自动开多个页面或调用未证实的宿主 browser API。如果宿主没有可用导航接口，展示可复制的 HTTPS 分享链接。回退前清理原 frame，避免双实例。

网站直达播放器复用 PlayerCore、安全策略和 SDK 协议。网站与 Harness 的浏览器存储上下文可能不同，分享链接不承诺继承游戏进度。重试同一版本优先保持 releaseId；该版已撤销时再提示切换当前可用版本。

## 9. 发布前检查

制品中无 token、作者游戏包、开发机路径、测试服务地址或安装脚本依赖；公共 API 域和运行域为构建时受控配置。记录插件版本、Harness 提交、构建 Node、操作系统、Web/桌面形态、制品 SHA-256。

必须在另一台干净环境使用同一 `.tgz` 验证安装、游玩、隐藏、再开、禁用、卸载，并验证用户原有会话和插件配置未被改写。更新失败保留旧插件包和兼容说明；不把“宿主有接口”当作此验收已通过。
