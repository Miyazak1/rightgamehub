# QQ 渠道插件：最小实现与本地验收

日期：2026-11-21。分支 `codex/qq-channel-plugin`，工作树 `E:\CODE\Right\.codex-work\agent-plugin-release`，基线为发布准备提交 `c97f185e`。当前真实 QQ 实例仍使用原工作树，不切换、不重启、不改线上，论文继续关闭。

## 分层与归属

- Agent/API 进程装配 `mooyu.github@1.0.0`：查找、源码问答与写作，继续管理 Agent 身份、授权、预算、密钥、Run 和历史。
- QQ worker 进程装配 `mooyu.qq@1.0.0`（`kind=channel`）：连接、接收、控制接口、持久投递及生命周期，调用原签名 Agent API。
- 图片内容仍由共享 API 从固定文章 revision 渲染，QQ 插件沿用逐页账本与 OneBot 图片传输。定时文章不通过 QQ 插件，不改其计划或发布策略。

QQ manifest 没有 GitHub 依赖、模型工具、能力授权或研究工作流。停用 QQ 不会停用 GitHub／网站／定时研究；停用 GitHub 不会移除 QQ 普通聊天通道。全局 GitHub 停用仍影响其所有能力调用者。

## 代码与生命周期

`apps/qq-channel/src/plugins/qq/manifest.mjs` 定义精确插件版本；`runtime.mjs` 从原 CLI 提取装配逻辑；`plugin-catalog.mjs` 只加载 QQ 插件，不把 GitHub 实现或模型运行时塞进渠道宿主。

通用插件宿主新增 `bindChannel(binding, context)`。渠道定义必须提供 `createChannelRuntime`，且不混入工具或任务路由；返回 `start/run/receive/tick/stop/close`。绑定、开始、收消息和轮询都会检查启用状态。异步构造期间撤权或返回无效钩子会清理运行实例；`stop/close` 在禁用后仍允许执行。

创建运行实例没有数据库／端口副作用；`start` 才按原逻辑检查数据库、幂等初始化控制／Agent bridge schema 并打开监听。并发或重复 start 不重复开监听。部分启动失败会关闭已开的控制接口和 socket。停止会唤醒轮询退避，close 幂等，不结束宿主注入的数据库池，不接触 QQ 登录文件或网关容器。

`cli.mjs` 保留原命令、配置校验、server-only 管理约束与退出码。`--init/--status/--resolve` 仍沿用原仓库与人工核对流程；`--run` 改为通过宿主装配 QQ 插件。原独立文字模型模式仅在共享 Agent 模式明确关闭时保留，兼容旧部署；共享模式不创建渠道模型提供者。

## 启停配置与兼容

`AGENT_PLUGINS_DISABLED=mooyu.qq` 传入 QQ worker 后，启动不连数据库、不执行 schema、不打开监听。启用时仍遵守原 QQ enabled、群／用户允许列表及参与者权限，不自动放开任何权限。

API 与 worker 共享合法插件 ID 配置解析，各自只装配所属插件。QQ 的开关必须传给 QQ worker；只设置 API 的 `mooyu.qq` 禁用项不会代替实际渠道进程启停。GitHub 开关应传给 API／研究执行器。配置变更按原服务重启流程生效，进程内 `setEnabled` 用于暂停／恢复测试，不是持久化跨进程后台管理。

没有新增数据迁移、channel ID、消息 ID、签名格式或权限字段。原文字、研究、图片页及不确定发送账本继续复用；不删除或重写历史，不回填旧任务，不改预算。共享任务仍固定原 GitHub 插件版本，渠道插件不接管任务所有权。

打包时需要同时包含 `apps/qq-channel/src` 新插件文件和 API 侧 `agent-plugin-host.mjs`、`agent-plugin-contract.mjs`、`agent-plugin-config.mjs`。不能只替换 CLI，或将新 CLI 与旧宿主混装。

## 本地验证

66 项单元／兼容测试通过，17 项隔离数据库测试通过，无跳过。最后的清理及启动中撤权边界另复验 11 项渠道测试通过。日志：`E:\CodexData\build\Right\qq-channel-plugin\unit-tests.log`、`database-tests.log`、`channel-final-tests.log`。

覆盖渠道与 GitHub 独立启停、禁用不打开资源、异步撤权、并发启动防重、故障关闭、停止唤醒、旧文字模式、CLI 无数据库禁用退出、真实 localhost WebSocket 接收，以及原插件／问答／权限／定时回归。

图片数据库测试已改为通过 QQ 插件的 start/tick/close 生命周期，实际使用任务仓库、签名 API、图片渲染与逐页账本，验证重建运行实例后续发、未知前页阻塞、写作权限撤销后禁止发图。模型、GitHub 与外部 QQ 发送为离线夹具，测试库为专用临时内存容器，结束后删除自身容器；不访问原登录数据库。

Linux 冒烟复用已验证依赖镜像，以只读源码挂载构造新 QQ 插件：`constructed=true`、`started=false`、`executionMode=agent`，不连数据库或网关。没有安装新依赖，也没有更改当前正在运行实例的代码目录。

## 发布边界

发布与回退方案及已构建候选见 [冻结候选与回退方案](agent-plugin-release-20261121.zh-CN.md)。候选 API／worker 的业务源码固定在 `1553c613`，**不包含本次 QQ 渠道插件拆分**。它们与新插件源码是两个明确阶段，不能将旧候选当成新插件已经打包或已部署。

本次没有切换真实测试群到 QQ 插件版，之前已完成的图片真实群验收仍是图片基线的证据。若继续真实验收，应另行保存现场、构建新插件同批 API／worker，再在保留网关和数据卷的前提下切换本地测试执行器。后台安装／升级、插件市场、跨进程启停与论文插件均未在本轮实现，论文保持关闭。
