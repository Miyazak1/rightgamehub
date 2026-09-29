# 侧栏适配包 v1：上传、下载缓存与启动

日期：2026-09-24 · 插件：0.0.11 · 状态：实现与自动测试完成，真实界面待另行验收 · [目录](./README.md)

## 本轮范围与形式

此前 [0.0.10 实测](./24-harness-offscreen-integration.zh-CN.md) 的入口只能运行项目内固定样本。0.0.11 增加真正从上传 ZIP 派生的游戏卡片、下载缓存、逐文件校验，以及把缓存中的入口交给离屏运行组件的链路。

第一种作者适配目标定义为 `electron-offscreen-v1`：作者额外导出一份 HTML/JS 渲染包，由平台提供 Electron 主进程、预加载桥与隐藏窗口。原有 EXE 可以继续作为普通下载文件；**此渲染包不是把普通 EXE 自动改成离屏程序，也不是已经支持任意引擎原生 EXE。**当前允许上传识别此格式，但可运行清单仅含本项目审阅过的自有样本。

生成的 [自有示例 ZIP](../artifacts/gamehub-owned-sidebar-1.0.0.zip) 为 2,855 bytes，SHA-256：`e15998e76c53ee32d7d39e50e2db1d4aeac507816158920fffafd567c3134dfe`。

## 玩家操作

1. 在 Harness 右栏游戏大厅选择 ZIP，点击“上传”。上传和结构检查均不会启动游戏。
2. 卡片显示“侧栏适配包”。点击“下载到运行缓存”，等待完成字节数、ZIP 摘要、结构与资源摘要检查。
3. 完成后手动点击“在右栏开始”。后台再次验证缓存，运行组件和 Electron 入口也会重复核验；渲染源为下载缓存中的入口。
4. 使用右栏画布和输入控件；“重新开始”保留已验证下载，但创建新的运行会话；结束或关闭 tab 走已有退出链路。
5. 若缓存被改动，启动拒绝，并要求重新准备。明确点击“重新准备缓存”会重新下载并替换该自有包的缓存，不删除上传文件。

这是**同机原型**：Harness 服务和本机运行组件都在玩家电脑上。“下载到运行缓存”通过与下载 API 相同的文件流读取已上传包，在服务目录创建独立副本；当前没有跨网络远端平台下载。原“下载文件”仍交给浏览器另存为，与运行缓存是两个入口，不把浏览器保存事件当作缓存准备完成。

重启服务后不自动运行或自动标记准备完成。再次点击准备会重新验证已有副本，符合条件则复用。准备可以取消；临时目录会清理。若取消到达时原子提交已经完成，已验证缓存可能保留，但没有启动游戏。

本机使用 [start-gamehub-package-test.bat](../start-gamehub-package-test.bat)，需要完整项目、构建好的 Harness 和已核验 Electron 44.4.5。新入口使用 **3084 / `gamehub-package-check`**，存储在 `.runtime/m0/gamehub-package-check-storage`，与此前 3083 验收服务分开；不自动打开页面或启动游戏。0.0.11 本轮仅打包，未替换正在运行的服务。

## ZIP 与 SDK 契约

```text
gamehub.offscreen.json
index.html
assets/
  sdk.js
  game.js
  model.js
  style.css
```

根清单必须为以下结构，不接受未声明字段、外部路径或作者自带 main/preload：

```json
{
  "schemaVersion": 1,
  "id": "gamehub.owned-sidebar-sample",
  "version": "1.0.0",
  "title": "下载适配包 · 侧栏样本",
  "runtime": "electron-offscreen-v1",
  "entry": "index.html",
  "viewport": { "width": 640, "height": 360 },
  "input": "gamehub-input-v1",
  "permissions": { "network": false, "audio": false }
}
```

清单上限 4 KiB，标题最多 80 个 UTF-16 代码单元，id 为小写字母开头的 3—80 字符标识；版本为三个以点分隔、每段 1—4 位的十进制整数。资源继承现有 ZIP 检查：100 MiB 压缩包、300 MiB 展开上限、5000 条目、禁止路径穿越、链接、重名、安装脚本和嵌套归档。失败时原文件仍可私有下载，不能从普通网页启动路由绕过适配包检查。

[示例源码与 SDK 用法](../poc/offscreen-package/README.md)提供 `GameHub.onInput(callback)`、`GameHub.ready()` 和 `GameHub.applied(seq)`。SDK 只暴露游戏输入，不把 Electron IPC 对象、文件访问或命令执行暴露给作者。输入沿用白名单：click、四方向 key、text、release、reset；每条输入由平台生成递增序号，作者应用后回执。新包无需返回固定样本的 score/x/y/label；原自有样本保留可选状态回报，兼容 0.0.10。

构建：`npm run build:offscreen-package`。构建器只生成 ZIP 与审批参考 JSON，不自动修改允许运行的摘要。示例资源统一 LF，并使用确定性的条目顺序与 ZIP 元数据；以相同 Node/zlib 版本可重建当前摘要。

## 实现和边界

### 识别与批准分开

ZIP 检查子进程识别 `gamehub.offscreen.json`，验证协议并返回类型。格式正确不代表获准运行。当前插件中的 [固定允许清单](../extensions/harness/src/offscreen-approved.json)绑定压缩包大小、SHA-256、作品 id/版本以及每个资源的大小与 SHA-256；修改同名清单、资源或安装收据不能取得运行权限。

发布仍为 `published:false`，没有平台账号、扫描、作品签名、公开投稿审批或云端服务。固定摘要用于这次自有样本验证，不是今后平台的作者准入方案。

### 下载缓存

新接口：`POST /api/gamehub/offscreen-prepare?id=<已上传文件 UUID>`，要求 Harness 认证及 `X-GameHub-Input: 1`。成功返回 `prepared`、`sha256`、`reused`；不返回磁盘路径或管道令牌，不启动程序。`POST offscreen-launch?id=…` 只接受已准备、仍符合批准摘要的包。原固定样本入口继续可用。

缓存位置为 `<GAMEHUB_STORAGE_DIR>/offscreen-cache/<包 SHA-256>/`，内含下载的 `package.zip`、`install.json` 以及从该副本重新检查解出的 `web/<原始文件 UUID>/…`。按 UUID 与受约束路径清理临时目录；拒绝链接与多余渲染文件。准备/启动串行，已有游戏运行时不能重建缓存。

上传配额继续计入原始包和第一次检查展开的资源；运行缓存单独占用磁盘，本轮只有一个批准的 2,855-byte 包和 3,922-byte 渲染资源，额外占用约 7 KiB 加文件系统开销。没有把它计入已有 2 GiB 上传配额。开放更多作者前必须加入统一磁盘额度、缓存淘汰、并发锁和崩溃残留回收。

### 执行

主进程与 preload 始终来自平台，上传包没有选择 EXE、入口主进程或传递命令行的接口。运行组件验证包后仅将缓存目录传入受控环境变量；Electron 入口再次核验并加载该目录的 HTML。固定运行时 EXE 摘要检查仍在，但整套运行时分发与签名方案尚未完成。

每个游戏使用独立、非持久 Session。包模式为 Session 注册 `webRequest.onBeforeRequest`，只允许清单内本地文件的 GET，拒绝其他网络/文件路径、子 frame 和 object；结束时撤销。该 API 的请求取消机制依据 [Electron 官方 WebRequest 文档](https://www.electronjs.org/docs/latest/api/web-request)。目前仅在替身与纯函数测试中验证新过滤规则，实际 Electron 加载需要本轮 GUI 验收后再确认。固定自有包的 CSP、禁用 Node、隔离上下文、沙箱 preload、导航与窗口拦截继续生效。

这不是陌生本地代码的完整 OS 沙箱；也没有覆盖同一用户权限的本机进程在校验后恶意改写缓存的情况。本轮固定字节批准和受控渲染输入仅用于闭环验证。

## 验收状态

本轮未打开或操作浏览器，没有启动新的 Electron 游戏。自动测试使用真实文件、ZIP 解析子进程、下载响应流与磁盘缓存；运行组件用替身记录启动参数，所以**包的真实渲染和输入仍待验收**。0.0.10 的画面证据不能直接算作 0.0.11 下载包验收。

`npm test` **61/61 通过**，0 失败、0 跳过。本轮新增 12 项测试，覆盖：上传识别与完整下载、准备不执行、实际缓存字节、入口参数来源、重启后复用、损坏资源拒绝与修复、损坏下载不提交、未经批准的包及 EXE 拒绝运行、非法清单不回退、取消流清理、安装收据无法批准额外资源、SDK 回执、Session 资源过滤。一项测试可含多个相关断言。

`npm run build:offscreen-package` 与 `npm run pack:harness` 均通过。插件包包含 19 个文件、43,966 bytes，SHA-256：`4d35c0f2c7dde9c82ff4abd7a11420a884be5ae75f72c79d64920e6a7bd53b31`。记录：[完整自动测试输出](./evidence/offscreen-package-20260924/automated-tests.txt)、[构建与测试摘要](./evidence/offscreen-package-20260924/build-report.json)。未将任何模型或登录凭据放入这些文件。

下一次界面验收限于独立 Harness 页面：上传上述自有 ZIP → 准备缓存 → 手动启动 → 确认游戏画面显示“下载适配包 · 侧栏样本” → 点击、文字和方向键 → 重启与结束 → 检查进程清理。须遵守用户要求，在启动游戏和界面操作前另行取得该范围的同意。

音频、独立全程无弹窗观察、真实作者投稿、任意 EXE、其他引擎、VS Code/Cursor 与跨电脑平台闭环继续未完成。
