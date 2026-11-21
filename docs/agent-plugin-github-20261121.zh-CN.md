# 小墨鱼最小插件协议与 GitHub 插件

后续真实 QQ 本地验收见 [真实群验收记录](agent-plugin-qq-live-20261121.zh-CN.md)，其中明确区分普通追问复用历史与重新调用插件补读。

日期：2026-11-21。工作分支：`codex/agent-plugin-github`，基线：`488e4eda`。

本次仅修改独立工作树并执行本地测试，未推送、部署、迁移线上数据库或更改线上配置。原 QQ 验收实例继续使用原工作树，登录、历史和现有任务记录保留。论文继续关闭。

## 本次交付

共享小墨鱼采用「宿主运行内核 → 插件注册与装配 → 能力执行」结构。网站 Chat 和 QQ 继续共享同一 Agent 身份、模型密钥、权限、预算、工作流与结果记录；QQ 仍只是沟通渠道。

- `agent-plugin-contract.mjs`：严格的 `agent-plugin-v1` manifest 与精确版本绑定。
- `agent-plugin-host.mjs`：注册、依赖校验、冲突检测、启停、准入、版本固定、按需创建运行实例与关闭。
- `agent-plugin-catalog.mjs`：经过代码审查的内置插件目录。
- `agent-runtime-services.mjs`：共享数据库、策略、工具网关、模型网关、密钥库和产物仓库，不依赖 GitHub 或论文装配。
- `agent-plugins/github/`：GitHub 的工具描述、参数准入、底层适配器、响应验证器、工作流与任务执行。
- 迁移 `0166_agent_plugin_tasks.sql`：允许符合协议命名规则的插件任务类型；具体任务仍由可信注册器认领。

GitHub 插件 `mooyu.github@1.0.0` 提供 `github_search_projects`、`github_answer_question`、`github_write_article`。原查找、摘要、源码问答、追问继承与自动补读、草稿与文章流程继续复用已有执行器。共享运行时不再借用整套文章／论文运行时。

## 协议边界

Manifest 必填字段为：`schemaVersion`、`id`、`version`、`hostApiVersion`、`kind`、`displayName`、`defaultEnabled`、`dependencies`、`capabilities`、`tools`、`backendTools`、`taskKinds`、`workflows`、`publicCapabilities`、`legacyTaskKinds`。未知字段、重复定义、循环或缺失依赖、跨插件工具／工作流冲突、保留的 `message` 与 `get_agent_work` 均会拒绝。

`version` 与依赖采用精确 `x.y.z`，不接受 `latest` 或版本范围。`kind` 预留 `capability`、`channel`、`agent`、`presentation`，当前实际交付只有 GitHub 能力插件；QQ、论文与小墨鱼本身尚未迁移成独立插件。

插件定义导出 manifest、工具描述、底层工具合约、工作流，以及 `admit` 与 `executeTask`。可选钩子为 `toolConfiguration`、`responseSchemas`、`validateConfiguration`、同步 `createRuntime`；实例可导出异步 `close`。执行上下文提供宿主服务与 `assertAvailable`，GitHub 在阶段授权时重新检查启用状态。

插件声明能力不会授予权限。原群／用户范围、参与者写作权限、Agent 能力授权、发布策略、模型预算和网关记账继续执行。工具配置只能提供适配器及输入／输出校验器，不能覆盖宿主的权限服务或仓库。

这是仓库内可信代码的装配协议。没有远程安装、任意模块路径、插件市场或不可信代码沙箱；插件代码可以访问其 Node.js 进程权限，因此新增插件仍需要代码审查。

## 启停与版本兼容

默认启用 GitHub，保持现有安装行为。配置 `AGENT_PLUGINS_DISABLED=mooyu.github` 后，API、bootstrap 和 worker 应使用相同配置并重新装配运行时：不暴露 GitHub 工具、不装配其适配器、不要求其文章运行配置，普通聊天与任务查询仍可使用。

注册器的 `setEnabled` 用于进程内已装配插件的暂停／恢复与测试；不提供跨进程管理 API，也不持久化到数据库。从启动禁用状态启用插件需要重建运行时，以装配适配器和验证器。不同进程的配置必须一致。

新任务在不可变 `input_json.plugin` 中记录 `{id, version}`。旧的三种 GitHub 任务无此字段时，明确映射到 `mooyu.github@1.0.0`，不重写输入或旧记录。已有 Run 的工作流版本继续由原执行器恢复。

插件停用或所需版本缺失时，未完成任务进入 `waiting`，保留任务 ID、输入、历史、Run 与预算记录；不回退到新版本或自动重建任务。恢复版本和启用状态后，在下次到期轮询时继续。已经完成的回执仍可查询。任务边界及阶段授权会再次检查启用状态；已经发出的外部请求不能靠停用撤回，仍沿用原有不确定结果核对机制。

未来保留多个插件版本时，应保留旧实现，并为不兼容的工具／响应 schema／工作流升级各自的合约版本。当前仅交付 GitHub 1.0.0；没有自动升级器或无重启热替换。

原公开文章定时／手动运行时通过兼容导出继续使用原入口和返回结构，GitHub 工具从插件装配。原私有 GitHub 运行入口也检查插件启用状态。论文旧入口保留在兼容层，本次未运行论文任务，未启用任何论文开关。

## 本地验证

测试采用离线 GitHub／模型适配器和真实权限、工具、模型及任务账本。数据库由专用 runner 创建 PostgreSQL 17 临时内存容器，明确清空继承的业务数据库 URL，结束后删除自身容器，不连接既有登录数据库。

单元与兼容测试覆盖 manifest、依赖循环、冲突、版本固定、停用后恢复、异步准入撤权、公共／私有运行时装配、宿主仓库不可覆盖，以及既有会话、问答与定时流程。

隔离数据库测试覆盖实际插件装配到共享内核、源码问答引用、已租赁任务回执重放、无绑定旧任务兼容、停用任务保留与恢复、禁用 GitHub 后普通聊天、注册新任务类型无需修改 worker、版本缺失等待，以及原 Chat/QQ 权限、投递账本、GitHub 查找／草稿／文章与自动补读回归。测试中的文章发布仅发生在一次性测试数据库。

运行命令：

```powershell
node --test tests/platform/agent-plugin-host.test.mjs tests/platform/agent-plugin-runtime.test.mjs tests/platform/agent-interaction.test.mjs tests/platform/agent-github-question.test.mjs tests/platform/agent-blog-public-runtime.test.cjs tests/platform/agent-blog-private-schedule.test.cjs tests/platform/agent-blog-public-schedule.test.cjs
node scripts/test-researcher-qa-db.mjs tests/platform/agent-plugin-db.test.cjs tests/platform/agent-interaction-db.test.cjs tests/platform/agent-interaction-github-db.test.cjs tests/platform/agent-github-question-db.test.cjs
```

最终结果：单元／兼容测试 **41/41 通过**，隔离数据库测试 **16/16 通过**，无跳过。结果日志位于 `E:\CodexData\build\Right\agent-plugin-github\unit-tests.log` 与 `database-tests.log`。一次性数据库容器已由 runner 删除。此轮不更换真实 QQ 验收实例，因此没有要求重新扫码，也没有消耗真实研究调用额度。

结束前只读检查原 QQ 验收实例：`loggedIn/coreReady/accountMatches/groupReady/connected` 均为 `true`，历史投递仍为 10 条，`review=[]`，`paperEnabled=false`。这项检查只证明原现场保持可用；新插件装配验证来自上述离线适配器与真实账本测试，尚未进行新分支的真实 QQ 登录／外部模型验收。

## 后续接入顺序

本轮只完成协议与 GitHub。下一阶段可先按相同契约拆分 QQ 渠道，再拆分小墨鱼角色／编排与论文能力。论文插件需独立验收和明确启用；本次保持关闭。后台插件管理、持久化启停、安装／升级和权限配置界面应分别设计，不随最小协议默认开放。

未来部署需单独审核迁移 0166、bootstrap 和 API／worker 配置一致性。本轮没有执行这些线上操作，也没有切换运行版本。
