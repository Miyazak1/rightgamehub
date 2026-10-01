# AI 小游戏与创意项目平台：完整方案

版本：v2.1，更新日期：2026-09-24。已确认：**中国大陆公司经营、海外首发、首版免费；宿主内上传、发布、下载与网页游玩；普通 EXE 可由平台按钮打开独立窗口，侧栏适配路线继续保留**。

**最新设计入口：[27 完整平台设计与任务交接](./27-platform-design-and-handoff.zh-CN.md)**；接手后的可实施定稿为 **[28 D0 实施蓝图](./28-platform-d0-implementation-blueprint.zh-CN.md)**，包含组件树、编号迁移、接口矩阵、状态机、工作包和停止条件。文档仍是设计，不表示完整平台已实现。

**开发已启动，M0 进行中**：[20 开发启动判断与实测记录](./20-execution-status.zh-CN.md)记录 Harness 测试包安装、真实右栏、2D/WebGL2 样本和隐藏释放结果；完整平台业务尚未实现。

**最新体验确认**：普通 EXE 接受从平台按钮启动独立窗口，见 [26](./26-desktop-exe-launch.zh-CN.md)。标注“侧栏游玩”的能力仍须全程在功能区呈现；历史捕获探针不满足这一要求，不能将它算作侧栏验证通过，详见 [22](./22-native-exe-local-test.zh-CN.md)。

**当前最新：Harness 0.0.12 普通 EXE 的平台下载和独立窗口启动已实现，73 项自动测试通过；用户随后确认选对版本后启动成功。**下载不执行，启动前校验副本、重复请求去重、关闭右栏不杀游戏，见 [26](./26-desktop-exe-launch.zh-CN.md)。这是用户反馈，历史自动测试仍使用替身，不改写为助手 GUI 实测。0.0.11 适配包链路见 [25](./25-offscreen-package-contract.zh-CN.md)，仍待新包真实渲染验收；0.0.10 固定样本右栏已有 [24 的实测证据](./24-harness-offscreen-integration.zh-CN.md)。网页 ZIP 既有证据见 [21](./21-local-web-games.zh-CN.md)。

平台首版承载作者上传的浏览器小游戏、网页 3D、互动创意项目和 Windows 发布包。作者与玩家都使用宿主内的平台客户端；网站仅为可选分享入口。定价、交易和创作者结算后置，支付沙箱也不列入首版。专用功能区为主要入口，内置浏览器作为受限宿主的回退。

当前实施以 [多宿主完整客户端规范](./18-multi-host-client-spec.zh-CN.md)、[Windows 发布包规范](./19-windows-package-spec.zh-CN.md)及 TD-1.1 技术文档为准：合格包自动发布，异常包复核；玩家无需登录即可体验或下载。[S 档配置](./06-server-sizing.zh-CN.md)约 **30—40 USD/月** 仅为原网页低用量规划预算，不包含新增邮件、Windows 包扫描和大文件分发成本。

**Windows 下载分发是首版要求，侧栏运行是独立待验证能力。**首版包括便携 ZIP、单文件 EXE 和 EXE 安装包的插件内上传、检查、发布、下载与文件管理。按 [EXE 侧栏游玩验证计划](./09-exe-sidebar-validation.zh-CN.md)核验原生容器和串流；下载成功或打开独立窗口不能算作侧栏运行成功，尚不承诺任意 EXE 可在功能区游玩。

**首个 EXE 样本已实测**：[桌猫测试结果](./10-deskcat-test.zh-CN.md)。它是 Electron 封装的网页游戏；提取的原始 HTML 在 Codex 内置浏览器中可玩、可保存并刷新恢复，不依赖独立 EXE 继续运行。该结果适用于本样本的网页路线，未证明任意原生 EXE 可嵌入或串流。

**接入边界**：用户继续使用现有编程软件及其更新渠道。我们维护统一平台、共享客户端和宿主适配：Harness bundle、VS Code/Cursor 编辑器 VSIX。[DeepSeek Harness 核查](./11-deepseek-harness-feasibility.zh-CN.md)已确认右侧 tab 与自定义界面注册路径，本机已完成宿主构建和 Web 界面启动。三宿主完整平台客户端均尚未实现和安装验收；VS Code 右侧位置需用户首次移动，Cursor Agents Window 另验，见 18。

## 阅读顺序

先读 [27 完整设计与交接](./27-platform-design-and-handoff.zh-CN.md)和 [28 D0 实施蓝图](./28-platform-d0-implementation-blueprint.zh-CN.md)，再读 [18 多宿主完整客户端](./18-multi-host-client-spec.zh-CN.md)、[19 Windows 发布包](./19-windows-package-spec.zh-CN.md)及 [13 技术设计总纲](./13-technical-design.zh-CN.md)。01—06 为长期参考；阶段性证据见 20—26，最新用户决定与状态汇总以 27/28 为准。

| 文档 | 内容 |
| --- | --- |
| [64 联网规则包提交与审核队列](./64-multiplayer-rule-review-intake.zh-CN.md) | **源码 ZIP 隔离收件、Doctor 证据、一次性上传授权、仅追加审核记录与受控构建边界** |
| [65 联网规则受控构建与发布实施契约](./65-multiplayer-rule-build-release.zh-CN.md) | **审核后原子排队、无网络 Rule Builder、确定性 bundle、离线签名与双服务发布边界** |
| [63 G2 受控静态站 Builder](./63-g2-controlled-static-builder.zh-CN.md) | **固定方案、无脚本静态构建、构建队列、来源证明、隔离部署与上线验收** |
| [56 作者 GitHub 导入指南](./56-github-import-author-guide.zh-CN.md) | **作者连接只读 GitHub App、预览来源、受控静态构建/手动上传、权限与许可证说明** |
| [55 G1 GitHub 只读来源导入](./55-g1-github-source-import.zh-CN.md) | **独立 GitHub App、固定 Commit、README 清洗、许可证证据、Webhook 去重、部署与验收** |
| [62 联网游戏本地测试与排障](./62-multiplayer-local-test.zh-CN.md) | **Creator Doctor、双账号命令/重连/终局验收与常见错误处置** |
| [61 联网游戏发布检查清单](./61-multiplayer-release-checklist.zh-CN.md) | **客户端、规则、隐私、审核签名、模式注册与发布验收门槛** |
| [60 私密信息设计与安全禁区](./60-private-information-security.zh-CN.md) | **玩家视图裁剪、公开事件、token 边界与离线签名禁区** |
| [59 服务端权威规则适配器教程](./59-rules-adapter-tutorial.zh-CN.md) | **确定性接口、identity、终局、版本与受控发布** |
| [58 联网 SDK、事件与错误参考](./58-multiplayer-api-reference.zh-CN.md) | **真实 SDK 方法、事件、常见错误与消息上限** |
| [57 联网游戏 15 分钟快速开始](./57-multiplayer-quickstart.zh-CN.md) | **官方模板、Doctor、双账号路径与规则审核交付** |
| [54 受信规则适配器发布与回滚](./54-trusted-rules-adapter-release.zh-CN.md) | **离线 Ed25519 签名、bundle 摘要、只读部署、双服务一致加载、版本保留与回滚流程** |
| [53 联机游戏作者接入指南](./53-multiplayer-game-author-guide.zh-CN.md) | **面向游戏设计者的包格式、SDK 流程、权威命令、隐藏信息、重连与规则交付清单** |
| [52 Web 游戏多人安全桥](./52-web-game-multiplayer-bridge.zh-CN.md) | **版本化 MessageChannel SDK、作品作用域、最小身份、房间/对局方法与安全边界** |
| [多人平台基础设施设计](./multiplayer-platform-infrastructure-design.md) | **通用房间、realtime、权威规则、持久化、治理、扩容与分阶段完成定义** |
| [51 G0 存储容量门禁](./51-g0-storage-capacity-guard.zh-CN.md) | **70/85 容量阈值、活动上传预留、同盘合并、管理员可见性、残留清理、部署与故障处置** |
| [50 G0 Web ZIP 隔离校验器](./50-g0-isolated-web-validator.zh-CN.md) | **独立无网络容器、原子信箱、生产 fail-closed、残留清理、状态指标、部署与验收** |
| [49 GitHub 开源作品导入与共建路线](./49-github-open-source-import-roadmap.zh-CN.md) | **作者授权、GitHub App、来源证明、隔离 Builder、许可证治理、G0—G4 实施顺序与验收门槛** |
| [45 P0.8 猜百科全自动供给](./45-p08-automated-baike-supply.zh-CN.md) | **自动发现、完整导言筛选、修订追溯、故障回退与未来 14 天无人值守排期** |
| [44 P0.7 官方题库供给](./44-p07-content-pipeline.zh-CN.md) | **数据库题库、完整导言质量门槛、每日确定性选题、管理员启停与人工排期** |
| [43 P0.6 轻量留存层](./43-p06-retention-layer.zh-CN.md) | **连续参与、自动像素徽章、通知偏好，以及完全由真实游戏行为推导的留存状态** |
| [42 P0.5-C 挑战完成闭环](./42-p05c-challenge-completion.zh-CN.md) | **挑战接收、自动结算、胜负通知、挑战历史、频率限制与幂等保护** |
| [41 P0.5-B 结构化社交回流](./41-p05b-structured-social-loop.zh-CN.md) | **成绩卡、当日挑战链接、固定像素反应、通知中心，以及完整的隐私与屏蔽约束** |
| [40 P0.5-A 轻社交基础闭环](./40-p05-social-foundation.zh-CN.md) | **玩家卡片、关注与屏蔽、隐私、猜百科全站榜/关注榜，以及不做私信的安全边界** |
| [39 P0.4 VS Code / Cursor 真实宿主适配](./39-p04-editor-hosts.zh-CN.md) | **共享客户端 WebviewView、SecretStorage、主题跟随、开发 CORS、VSIX 产物与 Codex 能力边界** |
| [37 M1.9 真实 API 端到端联调](./37-m1-real-api-e2e.zh-CN.md) | **PostgreSQL、邮箱登录、作者创建、Web ZIP 上传校验发布、匿名目录与 Harness 右栏游玩的真实闭环** |
| [36 M1.8 Harness Adapter](./36-m1-harness-adapter.zh-CN.md) | **共享平台正式接入 Harness、主题/Agent 色、会话凭据、上传恢复、内存路由与真实侧栏验收** |
| [35 M1.7 共享前端客户端](./35-m1-shared-platform-client.zh-CN.md) | **共享 React UI、主题 token、游戏平台式信息架构、响应式布局与受限 Web Player** |
| [34 M1.6 匿名目录与 Runtime Edge](./34-m1-runtime-edge-catalog.zh-CN.md) | **公开目录、固定 Release 启动描述、GET/HEAD/Range、CSP 与撤下 fail-closed 的真实数据库证据** |
| [33 M1.5 Web ZIP 校验与不可变发布](./33-m1-web-validator-publication.zh-CN.md) | **租约恢复、受限 ZIP 校验、不可变 attempt、Release 与 generation 条件发布的真实数据库证据** |
| [32 M1.4 多目标上传任务](./32-m1-upload-tasks.zh-CN.md) | **WorkTarget、事务配额、一次性 grant、流式 quarantine、摘要校验与并发 complete 的真实数据库证据** |
| [31 M1.3 认证与作品写入](./31-m1-auth-and-works.zh-CN.md) | **refresh 重放撤族、Bearer/logout、作品幂等创建与 Work ETag 的真实数据库证据** |
| [30 M1.2 API 与数据库基础](./30-m1-api-database-foundation.zh-CN.md) | **Fastify、health/ready、真实 PostgreSQL migration、验证码与设备授权事务证据** |
| [29 M1 执行状态](./29-m1-execution-status.zh-CN.md) | **首个实施增量：workspace、contracts/OpenAPI、0001—0008 migration 与验证边界** |
| [28 D0 实施蓝图](./28-platform-d0-implementation-blueprint.zh-CN.md) | **可直接开工的前端组件、迁移序列、接口与状态、部署、工作包、风险和完成定义** |
| [27 完整平台设计与任务交接](./27-platform-design-and-handoff.zh-CN.md) | **共享前端、后端、数据库、API、上传发布下载游玩、多宿主、部署、实施阶段及当前证据** |
| [26 普通 EXE 平台启动](./26-desktop-exe-launch.zh-CN.md) | **0.0.12 下载到本机、点击后打开独立窗口、73 项自动测试及新版产品形式** |
| [25 侧栏适配包契约与实施](./25-offscreen-package-contract.zh-CN.md) | **0.0.11 上传识别、下载缓存、固定摘要批准、SDK、61 项自动测试；新包 GUI 待验收** |
| [24 Harness 右栏离屏样本接入](./24-harness-offscreen-integration.zh-CN.md) | **0.0.10 右栏真实交互、重启和退出实测；49 项自动测试、启动方法与证据** |
| [23 仅在右栏呈现：离屏路线](./23-offscreen-sidebar-runtime.zh-CN.md) | **自有样本短测通过、实际画面与协议修正、38 项自动测试；未证明原始 EXE 或完整侧栏可玩** |
| [22 原生 EXE 本机实测](./22-native-exe-local-test.zh-CN.md) | **可见窗口捕获的实际证据与失败项，不符合只在右栏的要求** |
| [21 本机网页 ZIP 上传与游玩](./21-local-web-games.zh-CN.md) | **当前实现、ZIP 格式、独立资源服务、能力边界、可上传样本与实测结果** |
| [20 开发启动与 M0 实测](./20-execution-status.zh-CN.md) | **方案就绪判断、实际测试包、Harness 功能区证据、启动方法与后续工作** |
| [18 多宿主完整客户端](./18-multi-host-client-spec.zh-CN.md) | **插件内登录、上传发布、下载管理、共享 UI、HostAdapter 与三宿主验收** |
| [19 Windows 发布包](./19-windows-package-spec.zh-CN.md) | **EXE 安装包/便携包、独立目标版本、扫描、下载续传与原生侧栏验证门槛** |
| [13 技术设计总纲](./13-technical-design.zh-CN.md) | **技术选型、模块与信任边界、代码组织、核心时序和文档优先级** |
| [14 数据模型与 HTTP API](./14-data-api-spec.zh-CN.md) | **作者认证、表与约束、状态、并发发布、幂等、请求响应和错误码** |
| [15 Harness 插件与播放器](./15-harness-player-spec.zh-CN.md) | **组合包结构、真实宿主 hook、播放器状态机、SDK 消息与兼容回退** |
| [16 上传发布与运行隔离](./16-publishing-runtime-spec.zh-CN.md) | **配额、流式接收、受限解包、发布事务、运行网关、缓存与安全头** |
| [17 部署运维与验收](./17-deployment-acceptance.zh-CN.md) | **最小部署、配置、密钥、备份恢复、监控、测试矩阵和交付物** |
| [07 免费首版实施基线](./07-free-mvp.zh-CN.md) | 当前业务范围、最短流程和验收标准 |
| [12 Harness 游戏平台产品与实施方案](./12-harness-game-platform-plan.zh-CN.md) | **当前宿主路线：插件形式、玩家流程、平台分工、分发、更新与实测门槛** |
| [11 DeepSeek Harness 侧栏接入核查](./11-deepseek-harness-feasibility.zh-CN.md) | **官方插件接口、分发与更新边界、尚待完成的实测** |
| [10 桌猫 EXE 实测](./10-deskcat-test.zh-CN.md) | **实际游戏、浏览器交互与存档结果、截图及兼容性边界** |
| [09 EXE 在右侧栏内游玩：验证计划](./09-exe-sidebar-validation.zh-CN.md) | **当前 Windows 体验问题的验证步骤、通过门槛与停止条件** |
| [08 Windows EXE 与网页双版本分发](./08-native-distribution.zh-CN.md) | 分发原则和成本说明；具体契约以 19 为准 |
| [01 总体方案](./01-platform-plan.zh-CN.md) | 产品定位、用户流程、功能范围、双入口和运营方式 |
| [02 技术架构与作品运行](./02-architecture.zh-CN.md) | 网页 3D、上传托管、安全隔离、鉴权、云存档和海外部署 |
| [03 交易、结算与海外上线](./03-commerce-and-launch.zh-CN.md) | 后续商业化参考；收费开发和渠道准入不阻塞当前免费首版 |
| [04 数据模型与接口](./04-data-and-api.zh-CN.md) | 核心实体、状态机、作品包格式、REST、SDK 和 agent 工具 |
| [05 完整平台路线与验收参考](./05-roadmap-and-acceptance.zh-CN.md) | 长期扩展路线，当前免费版执行 07 的范围与验收 |
| [06 服务器配置与扩容](./06-server-sizing.zh-CN.md) | 各阶段 CPU/内存/存储、部署拓扑、公开价格、预算与扩容条件 |

本方案是产品与工程设计基线，不表示文中功能已经实现。价格、配额、人数、排期和性能指标中标明“建议”或“假设”的数字用于估算，尚未成为商业承诺。

## 当前证据边界

- **已有实测**：本地轻量 Canvas 游戏在 Codex 内置浏览器中展示、操作和保存后刷新恢复；入口选择逻辑的六项测试通过。
- **已有原型、尚未实机验收**：VS Code 功能区扩展、功能区失败后请求浏览器的适配流程。
- **Harness M0 插件已初步实测**：独立包安装、右栏入口、2D 点击计分、WebGL2 绘制/暂停、隐藏释放已检查，见 20；完整业务和宿主兼容矩阵仍未通过。
- **未证实**：第三方插件注册 Codex 常驻原生右侧功能区的公开接口。右侧浏览器面板与原生功能区是不同能力。
- **本机文件传输已实现**：Harness 右栏支持 ZIP/EXE 上传、文件列表、浏览器下载及手动完整性校验；61 MB EXE 经界面上传、HTTP 下载并校验一致，详见 [20 实施状态](./20-execution-status.zh-CN.md)。
- **本机网页 ZIP 闭环已实测**：上传真实多文件 ZIP 后自动检查，2D / WebGL2 游戏均可在右栏运行；模块、JSON、图片和最小 WASM 编译已验证，见 [21](./21-local-web-games.zh-CN.md)。这不等于所有引擎导出或远程部署通过。
- **自有离屏样本右栏已实测**：Harness 0.0.10 中游戏画面、点击、文字、方向键与正常退出通过，见 [24](./24-harness-offscreen-integration.zh-CN.md)。固定样本接入不等于任意上传 EXE 可以运行。
- **适配包链路实现与自动测试通过**：0.0.11 已增加真实上传 ZIP、下载缓存及运行交接；样本包真实画面尚未测试。作者需额外导出渲染包，尚不支持任意 EXE 自动转换，见 [25](./25-offscreen-package-contract.zh-CN.md)。
- **普通 EXE 平台启动代码、自动测试与用户反馈**：0.0.12 可启用独立窗口入口；原自动测试使用实际下载文件和替身进程，用户随后自行确认启动成功。本次没有新增助手 GUI 测试，此形式不要求侧栏适配，见 [26](./26-desktop-exe-launch.zh-CN.md)。
- **首版规划、尚未实现**：三宿主内的账号、云端上传发布、原生下载管理、Windows 扫描分发、完整 WebGL/网页 3D 验收与线上托管。
- **独立实验未完成**：原生 EXE 在功能区运行；云存档与收费功能仍为后续范围。

原始记录见 [技术可行性报告](../FEASIBILITY.zh-CN.md) 和 [双入口原型说明](../DUAL-MODE.zh-CN.md)。原型展示了入口可能性，正式平台需要按本方案重新建立用户作品的隔离和发布链路。

## 建议采用的基线

1. 我们托管平台 API 和作品资产；Harness、VS Code、Cursor 编辑器通过各自扩展接入同一完整客户端，作者与玩家的业务流程均在宿主内。
2. 首版支持网页构建产物及 Windows ZIP/EXE 安装包上传分发，并纳入 WebGL2 网页 3D；原生侧栏运行单独实测。
3. 作者上传后自动检查并发布；异常权限和风险信号转复核，保留作品隔离、举报与禁用。
4. 采用海外部署、英文优先界面；经营主体按中国大陆公司设计。当前不设置计价币种、不开发收付模块。
5. 三宿主均须完成真实“作者上传 → 平台托管 → 另一位用户游玩或下载”的闭环；其他 Agent 按实际扩展能力另行适配。

各文档内的外部链接为本次核查的资料或官方接口说明。正式上线前应按目标版本、主体、内容类别及接入合同复核。
