# 墨鱼工坊完整桌面客户端方案

日期：2026-11-01。范围：当前开发工作区的网页版功能、共享前端与 Windows 执行内核。状态：盘点和技术方案已形成，正式桌面客户端尚未实现。

墨鱼工坊桌面版承载现有平台的主要用户功能，沿用网页版的页面、导航、视觉与权限，并增加本机文件、执行节点、后台任务和更新管理。论文阅读、研究和写稿是平台中的一组功能。完整客户端不等于所有业务均离线运行，也不改变服务器授权或已暂停功能的状态。

技术基线确定为 Electron 桌面外壳、同一套 React 客户端、独立的 Windows 执行内核。停止扩展 WinForms 产品界面；保留其现有验证代码和记录作为诊断工具，不删除已有未提交工作。先完成跨模块兼容实验，再按整个平台的功能清单逐项验收。

## 功能盘点的范围

当前候选提交的共享客户端有 43 个条件路由分支，另有发现页默认分支；这不是 43 个独立页面或功能。静态扫描覆盖 98 个 JSX、MJS 和 CSS 模块，识别 346 个按名称调用的 API 方法，以及 API 客户端中的 392 个方法候选。旧 D1 专用且未纳入本轮提交的 API 增补不计入此清单。动态调用与一个页面中的多个操作仍需结合源码审阅，不能以扫描数量作为功能完成率。

可复查的分支条件、组件、源码行号、模块依赖和 SHA-256 位于 [网页版功能源清单](./mooyu-desktop-web-inventory.json)。清单在 `scripts/desktop-auth-scope.json` 导出的候选源码树中生成并校验，文本摘要统一 LF 换行；根工作区保留的暂缓改动不计入清单。不代表生产环境开启状态或桌面端测试结果。

### 平台与用户功能

| 功能域 | 当前网页版功能与入口 | 桌面承载方式与边界 |
| --- | --- | --- |
| 发现与目录 | `/discover`，作品浏览、搜索筛选、类别、推荐内容、专题 `/discover/c/:slug` | 直接复用 DiscoverPage、DiscoveryCampaignPage、作品卡片和 API；服务端内容仍需联网 |
| 作品详情 | `/works/:id`、公开分享别名 `/w/:id`，作品介绍、作者、平台目标、版本、启动与下载入口 | 同一详情页；Windows 下载和启动经受控宿主适配，不能从网页直接执行任意 EXE |
| 网页游戏与课件运行 | `/play/:id` 及版本、房间、挑战和分享变体；重启、暂停、停止、全屏、错误状态 | 复用 PlayerCore、Web SDK 和运行描述校验；第三方作品仍在隔离 iframe，不获桌面桥 |
| 多人与榜单 | 房间会话、比赛记录、作品榜单 `/works/:id/leaderboard/...`、WebSocket、挑战 | 复用协议和界面；验证实时连接、重连、窗口后台、账号切换与清理 |
| 作品分享 | `/s/:code`、游戏分享、来源归因、系统分享或复制 | 分享仍生成公开 Web URL，不把桌面内部协议地址发给他人 |
| 官方猜百科 | 游戏本体、每日内容、挑战、榜单与 `/games/guess-baike/community` | 保留现有游戏详情及榜单入口；路径名称含 community 不等于启用整个社区模块 |
| 学习 | `/learn`，模拟课件、练习等学习目录及启动 | 复用 LearningPage 与生成目录；打包时保留学习资源生成步骤 |
| 作品库 | `/library`，账号作品库及访问入口 | 复用 LibraryPage；账号数据仍来自现有 API |
| 游戏存档 | 播放器本地存档、IndexedDB、按身份隔离、管理及导入导出 | 复用存档协议和 UI；桌面 origin 与浏览器不同，不能宣称浏览器存档自动迁移 |
| 账号 | `/account`，邮箱验证码、GitHub Web/Device 登录、资料、头像、设备列表、撤销会话、退出其他或全部设备 | 同一账号页面；将持久会话与刷新移至受信任进程，OAuth 在系统浏览器完成 |
| 个人主页 | `/u/:handle`，公开资料、作品与现有个人设置入口 | 直接复用，保持现有可见性和权限 |
| 主题与语言 | 中英切换、深色、浅色、高对比及宿主主题能力 | 使用相同 I18n、themeToTokens、styles.css，不重新设计另一套品牌色和布局 |
| Agent 安装与宿主入口 | `/install`，现有宿主安装说明和下载 | 保留现有入口，新增当前桌面安装/版本信息；不能把旧 Agent 安装页冒充桌面安装管理器 |

### 工具与持续研究

| 功能域 | 当前网页版功能与入口 | 桌面承载方式与边界 |
| --- | --- | --- |
| 知识图 | `/tools/knowledge-map`，知识节点、关系、布局及导出 | 复用组件、数据和导出流程 |
| PDF 阅读 | `/tools/pdf-reader`，本地 PDF、文本与 OCR、阅读工作区和缓存 | 复用 PdfReaderTool、PDF.js、Tesseract、语言包和 IndexedDB；单独验证 Worker、WASM 与大文件内存 |
| 隐私脱敏 | `/tools/privacy-redactor`，本地内容处理与导出 | 复用组件与处理规则；本地内容不因桌面宿主而自动上传 |
| 文档对比 | `/tools/document-compare`，已有文件读取、差异展示与导出 | 复用 DocumentCompareTool 与 document-reader；文件选择和保存适配宿主 |
| 表格审计 | `/tools/spreadsheet-audit`，表格读取、审计与结果导出 | 复用 SpreadsheetAuditTool 和现有解析逻辑 |
| 变化雷达监控 | `/apps/change-radar`，监控创建、设置、检查、事件、快照与已读状态 | 保留独立应用的页面语义；旧 `/tools/change-radar` 继续重定向，不塞回五工具目录 |
| 持续研究与执行 | 同一变化雷达页面中的研究主题、来源、运行、研究者任务、本地节点与执行历史 | 复用 ResearchTopics 等组件与既有服务；页面后台不等于在 Electron 中复制一套研究调度器 |
| 证据与结构化知识 | 来源检查、证据、主张审核、事实时间线、实体与状态历史、来源关系及权威审核 | 完整保留已有工作流、人工审核状态和权限 |
| 指标分析 | 指标趋势、对照、矩阵、派生指标、指标视图、方法模板与报告归因 | 复用现有组件；不把仅显示数据的页面宣称为已在本机执行计算任务 |
| 研究质量与运营 | 候选发现审核、候选评测与数据集、质量样本、外部基准、修正信号、运营摘要、存储评估和账单核对 | 复用现有条件入口；沿用服务端能力、权限与预算门禁，不在桌面自动启用或触发付费任务 |

五个工具模块来自共享 `official-tools.mjs`。变化雷达在共享注册表中保留能力，但已有独立应用路由。没有为桌面另建工具事实来源。

### 创作者与运营功能

| 功能域 | 当前网页版功能与入口 | 桌面承载方式与边界 |
| --- | --- | --- |
| 创作者工作区 | `/creator` 与 `/creator/works`，申请、作品列表、草稿、反馈、认领和分析 | 复用 CreatorWorkspace、CreatorPage 和权限提示 |
| 新建与编辑作品 | `/creator/works/new`、`manual/new`、`/creator/works/:id/edit`，元数据、目标及已有提交操作 | 复用 NewWorkPage、WorkEditPage、WorkMetadataFields 和版本冲突处理 |
| 上传与验证 | `/creator/:kind/:id/upload`，上传包、进度、验证状态和已有版本流程 | 保留浏览器已有流程，增加有界流传输、取消与重试适配；不能把大文件放入小型 JSON RPC |
| GitHub 来源与构建 | `/creator/import...`、`/creator/:kind/:id/builds`，安装授权、仓库、预览、导入草稿、构建及发布 | 复用页面与 API；OAuth 回调、上传和下载需桌面专项验证 |
| 草稿与开发日志 | `/creator/drafts/:id`、`/creator/works/:id/development` | 保留草稿审核、编辑和日志流程；不自动批准或发布 |
| 作者本地工具 | `/creator/tools`，现有创作工具说明和入口 | 复用现有入口，与新增本地能力中心衔接 |
| 多人及榜单开发 | `/creator/multiplayer`、`/creator/leaderboards`、作品 AI 任务、规则提交、开发文档 | 复用 CreatorAiTaskPage、规则契约与任务状态；创建任务仍遵循现有确认和预算规则 |
| 平台运营 | `/admin?panel=...`，概览、作品与来源、举报治理、创作者权限、猜百科题库与自动供给 | 仅按原有管理员权限显示；普通账号不会因桌面而取得运营权限 |
| 官方文章 | 管理后台 blog 栏目与公开 `/blog`、`/blog/:slug`，草稿、正文区块、引用、追问、编辑、发布和撤回 | 复用 BlogPages，公开阅读与私有运营分离；本轮不执行任何发布 |
| 机器人与论文 | 管理后台 agents 栏目：身份、行为、模型 Key、运行时间线、论文资料入口、发现队列、研究、分析与草稿、追问、恢复、告警、保留策略和发布计划 | 复用 AgentAdmin 及后端质量门禁；当前未实现的“通用证据审阅 UI”列为增强，不称为已有 Web 全功能 |
| 增长运营 | 管理后台 growth 栏目、专题管理和作者联络队列 | 复用 GrowthContentStudio、DiscoveryCampaignAdmin、AuthorOutreachQueue；不得因进入桌面自动发送消息或发布内容 |

### 暂停和退役状态

| 源码状态 | 桌面保持方式 |
| --- | --- |
| `COMMUNITY_ENABLED = false` | 社区、动态、项目协作、活动、组队、个人参与、贡献任务代码保留在盘点与共用路由中；当前继续暂停，相关路由沿用发现页回退，不自行开放 |
| `/saves`、`/creator/save-health`、`/admin/saves` 显示本地存档提示 | 不把残留 CloudSaveLibrary、SaveOperationsPage 或 API 客户端中的方法当成当前已开放的云存档产品；服务端另有 cloudSaveEnabled 门禁 |
| `/creator/studio/:id` 进入 RetiredStudioPage | 保留退役提示，不以桌面版名义复活旧工作室 |
| `demo` 查询参数 | 只可用于明确标识的演示或本地界面测试；不得用演示成功证明实际账号、任务或执行已成功 |

## 前端复用条件

共享入口是 [App.jsx](../packages/platform-client/src/App.jsx)，[Web 启动入口](../apps/web/src/main.jsx) 只挂载 React 并选择宿主。App 已接受 `hostAdapter`、`apiClient` 和 `routing`，页面主要在 `packages/platform-client`，不应拷贝到桌面目录后独立维护。

| 现有部分 | 可复用条件 | 需要补的适配 |
| --- | --- | --- |
| 页面与导航 | Header、PlayerNavigation、CreatorWorkspace、工具与业务组件共用 | 添加 desktop-app 身份；新增能力中心、任务、下载和版本入口使用同一 Web 组件与样式 |
| 视觉 | styles.css、独立工具 CSS、像素品牌资源、themeToTokens、I18n | 保留现有主题；Windows 标题栏、DPI、窗口尺寸和无障碍专项验证 |
| 路由 | 已有 history、hash、memory、embedded 逻辑及 `/w` 别名 | 本地受信任 origin 下的 SPA fallback、刷新、返回、深链和登录回调；内部地址不取代公开分享 URL |
| API | 共享平台 API 客户端含刷新、超时、幂等和版本条件 | 在受信任进程执行认证 API，渲染端按命名操作调用，保留服务器错误、请求 ID、取消与刷新语义 |
| 会话 | AccountPage、account-bootstrap 和 PlayerPage 目前读取 token 对象 | 增加不返回原始 token 的 session 状态/身份契约；改造 finishLogin、bootstrap、存档 owner 与 grant 身份、logout 事件；浏览器和编辑器保留兼容路径 |
| 文件 | 文件输入、FormData/XHR、Blob URL、下载和导出接口 | 有界二进制或流式通道、文件授权、保存对话框、进度及取消；路径不交给第三方作品 |
| 本地数据 | IndexedDB、工具文档、阅读工作区和存档缓存 | 使用稳定桌面 origin，按账号隔离，验证升级兼容；跨浏览器迁移采用显式导入导出 |
| PDF 与 OCR | 资源已通过 Vite 导入，Worker 和语言包可构建 | 自定义协议资源 MIME、同源 Worker、WASM CSP、缓存与内存限制；构建成功不能代替实际 OCR 成功 |
| 游戏运行 | PlayerCore 已校验 release 主机并建立 sandbox iframe | 保留 frame 来源、launchId 和 SDK 消息校验；作品 iframe 不获 preload 桌面 API |
| 实时与外链 | 现有房间/会话协议、系统分享和 OAuth 流程 | 受信任 WebSocket 目标、断网恢复、系统浏览器、回调 state/PKCE 按对应服务支持验证；不把 OAuth 页面载入特权主窗口 |

不能简单使用 `createBrowserHostAdapter({host:'desktop-app'})` 宣称完成：它仍是浏览器内存会话，并不接通 DPAPI 或本地执行。现有 64 KiB 工作台 JSON 桥适合诊断，不能原样承载全部 API、PDF 上传或流式下载。

## 桌面方案选择

| 方案 | 与项目的关系 | 决定 |
| --- | --- | --- |
| Electron 加共享 React 前端 | 与现有 JS、React、Vite 和 Node 服务结构一致；主进程管理窗口和受控桥；代价是安装体积及 Chromium/Node 更新责任 | 作为完整客户端技术基线 |
| C# 加 WebView2 加共享 React 前端 | 同样能保持 Web 界面；可沿用 Windows 壳语言，但需要新增 WebView2 SDK、消息桥、Runtime 分发与兼容验证 | 保留备选；当前未验证其能减少本项目总适配成本 |
| WinForms 单独重做界面 | 形成另一套导航、组件和视觉，需持续追赶几十个业务流程 | 不作为正式产品界面继续扩展 |
| 只嵌入线上网站 | 页面可在线访问，但不能独立证明可信桥、本地文件、后台节点、离线外壳及更新闭环 | 不作为完整桌面交付方案 |

Electron 采用隔离的主进程、preload 和渲染进程，禁止页面直接取得 Node 能力；特权消息必须逐项约束来源和参数。这符合 [Electron 安全说明](https://www.electronjs.org/docs/latest/tutorial/security) 与 [上下文隔离说明](https://www.electronjs.org/docs/latest/tutorial/context-isolation)。打包资源通过受控本地协议提供，并在实际使用的 session 注册协议，参见 [Electron protocol](https://www.electronjs.org/docs/latest/api/protocol)。

WebView2 并非不可用：它支持本地 Web 内容和虚拟主机映射，消息同样需验证来源；Evergreen 与固定 Runtime 各有更新职责。选型没有把该方案描述为只能显示网页。参见 [本地内容](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/working-with-local-content)、[安全边界](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/security) 和 [Runtime 分发](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)。Electron 选择是基于本仓库维护结构的工程判断，不是已完成的兼容或性能比较结论。

## 目标结构与权限边界

```text
同一 packages/platform-client React 页面和 CSS
  ├─ apps/web 浏览器入口
  └─ apps/desktop 共享界面入口
       → 受限 preload 命名操作
       → Electron 窗口与权限控制
       → 可信桌面服务与既有平台 API 客户端
            ├─ 既有服务端 API 与授权
            ├─ Windows CurrentUser DPAPI 会话
            └─ 认证命名管道
                 → 既有 Windows 节点与文件授权
                 → 包签名校验与原生沙箱执行
                 → 安装 更新 健康检查与回滚
```

建议后续在 `apps/desktop` 按 `main`、`preload`、`renderer` 分层，新增共享 `createDesktopHostAdapter` 与会话契约。现有 WinForms native 和本地启动脚本先标记为验证用途，不覆盖或删除。桌面 renderer 导入共享 App 与 styles.css，不另建一份发现、创作者或管理后台。

本地 UI 使用固定受信任 origin，例如 `mooyu-app://client`。开启上下文隔离和沙箱，关闭 Node 集成；主窗口只加载打包的可信资源。协议解析限制到资源根，拒绝路径穿越，不通过 `webSecurity:false`、CORS 通配符或 CSP 全面放开来修复兼容问题。

preload 和主进程分别校验请求；只接受已登记主窗口、顶层 frame、可信 origin、命名操作和有界参数。禁止通用 shell、任意文件路径、任意 URL 请求代理或原始 ipcRenderer。即便全部 Web 功能都在桌面中，也不代表全部窗口都拥有本机权限。

认证请求使用受信任服务中的共享 API 实现。原始 access/refresh token 不回传渲染端、不写 localStorage、不出现在深链、日志和游戏消息里。会话公开状态只包含身份与必要授权标识；账号切换必须清理旧任务、缓存 scope 和订阅。API 操作按既有业务名登记，校验对应参数；不能把 API 客户端所有方法无审查地自动透传到桥上。

主界面、第三方游戏、OAuth 页面、外部链接和下载内容分别处理。第三方作品继续使用现有沙箱和 release 来源约束；OAuth/普通外链进入系统浏览器，不能继承 preload。深链只能表达受支持的导航意图，不携带令牌、文件路径或任意命令。

默认离线能力限于已打包外壳和可用的本地工具/数据。目录、账号、社区、服务器研究、发布与实时联机仍按现有网络依赖工作；断网显示实际状态，不使用演示数据假装同步完成。

## Windows 执行内核复用

| 现有模块 | 复用职责 | 正式桌面需要增加的衔接 |
| --- | --- | --- |
| credential-vault.mjs | CurrentUser DPAPI | 统一账号与服务器 origin 分区，多个窗口共享会话生命周期 |
| desktop-shell-ipc.mjs | 认证命名管道与控制命令 | 由受信任桌面服务调用；新增命令单独定义契约，不暴露整条管道给页面 |
| desktop-file-grants.mjs、windows-file-identity.mjs | 系统选取、文件身份与租约授权 | 图形授权中心、取消/过期/账号切换；不能以“完整客户端”为由授予整个磁盘 |
| desktop-node-supervisor.mjs、desktop-node-state.mjs | 节点状态、恢复、退避与后台生命周期 | 共享任务和节点界面；关窗口不静默取消已授权后台任务，完全退出提供明确行为 |
| package-store.mjs、windows-native-runner.mjs、windows-sandbox-host.mjs | 能力包校验与受控执行 | 图形安装和运行表单；未验证原生游戏不能冒充可嵌入作品 |
| desktop-capability-artifact-host.mjs | 可信产物验证和打开 | 复用校验结果进入共享预览或系统保存，保留取消语义 |
| desktop-product-manager.mjs、desktop-release-store.mjs、windows-desktop-updater.mjs | 安装事务、健康检查、签名更新与回滚 | 将完整 UI 资源、preload 和运行时纳入同一版本单元及健康验收 |
| windows-desktop-product-host.mjs 与原生托盘 | 现有 shell、节点和托盘组合 | 一个产品、一个后台 supervisor、一个托盘；新增打开/恢复主窗口入口，避免两套托盘争用生命周期 |

当前 `windows-desktop-release-v1` 严格固定 nodeRuntime、shell、tray、sandboxHost 四个入口，文件清单上限为 512。加入 Electron 外壳不能伪装成现有包已兼容：必须设计显式的新清单版本或兼容扩展，覆盖 UI 运行时、资源、签名、撤销、防回滚、安装中断与健康回滚测试。Electron 自带 Node 与现有执行节点的 Node 也不能混用原生模块 ABI；执行内核继续由已校验的独立运行时承载。

不并行启用 Electron 自动更新器和既有产品更新器去更新同一安装目录。当前签名目录和事务内核保留为唯一更新控制面；操作系统签名、安装器、可信下载渠道和发布运营另行验收，不能由“已有更新代码”推导为完成。

## 实施次序与验收

| 阶段 | 交付内容 | 通过标准 |
| --- | --- | --- |
| A 共享界面兼容实验 | Electron 最小可信外壳、共享 App/CSS、静态资源协议、桌面宿主身份 | 发现、学习、五工具、变化雷达和账号页能在同一外壳打开；与 Web 同主题同组件；实际游戏 iframe、PDF/OCR、IndexedDB 验证通过 |
| B 账号与全站页面 | 会话契约改造、受信任 API 适配、系统浏览器 OAuth、路由/刷新/深链、普通/创作者/管理员权限 | 测试服务器完整登录退出与刷新；所有当前有效路由逐项验收；暂停/退役状态一致；错误权限不泄漏旧账号数据 |
| C 文件与执行闭环 | 大文件上传下载、工具导出、本地文件授权、能力目录、安装、任务创建/取消/进度与产物 | 至少一个非论文能力、一个本地文件能力和论文流程真实跑通；没有模型/生产调用的本地验证可先行，外部模型验证另按授权执行 |
| D 角色业务与回归 | 作品上传/构建、创作者任务、文章、运营和持续研究业务 | 按功能表核对权限、确认、幂等、取消、失败恢复；用模拟环境验证写操作，不为验收擅自发布或发送消息 |
| E 安装与更新 | 产品清单扩展、普通用户安装、单实例/托盘、签名更新、修复、卸载与数据保留 | 干净 Windows 用户环境中安装并运行；断网/断电/坏包/旧包/撤销/健康失败回滚；启动不依赖源码目录或开发机 PATH |

这些阶段是交付顺序，不是把完整客户端永久缩减成论文工具。A 或 B 完成只能称为开发预览；达到全功能矩阵、C/D 业务闭环和 E 发行要求后，才称为完整 Windows 客户端。

视觉验收使用同一数据、路由、语言、主题与窗口尺寸对照 Web/桌面截图，覆盖深色/浅色/高对比及常见 DPI。桌面特有窗口边框和系统对话框允许原生差异，平台导航、组件、字体层级、交互和错误提示保持一致。

生成质量验收继续使用现有门禁，同时建立多篇论文和非论文任务的固定样本集；不靠单篇论文新增同义词来证明通用能力。论文失败不能阻断其他工具、游戏、创作者和研究功能的独立验收。

## 本轮验证记录

- 运行 `node scripts/audit-desktop-web-reuse.mjs` 并用 `--check` 对照源码哈希，可重建或核对源清单。
- 直接使用当前安装的 Vite 和现有生成资源构建 `apps/web` 成功，共转换 1670 个模块；产物位于 `.runtime/desktop-web-audit/web-dist`。这是前端可打包验证，不是干净环境完整发布构建或 Electron 兼容验收。
- 构建包含 PDF Worker、OCR Worker、OCR 核心与中英文语言资源；仍有大于 500 kB 的 JS chunk 警告，后续按应用分包并测启动时间、内存和安装体积，不在此处给出未经测量的性能承诺。
- 账号恢复、浏览器账号、工具契约、宿主能力协议及播放器来源配置的相关本地回归为 28/28 通过。没有新增镜像实现的测试，也没有运行真实登录、发送邮件或调用模型。
- 本轮只新增盘点脚本、源清单与方案，并给既有开发版说明标注产品定位；未更改业务功能、权限开关或数据库。未提交、推送或部署。

共享界面、游戏/PDF/OCR 和隔离账号已完成本地验证；下一阶段进行隔离公网 OAuth 与业务功能联调，再接入 Windows 执行能力。旧 WinForms/D1 诊断保持独立，不纳入本轮 Electron 登录与网关提交范围，也不作为产品 UI 基础。
