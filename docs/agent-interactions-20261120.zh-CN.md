# 小墨鱼共享交互入口：GitHub 阶段

状态：独立分支 `codex/qq-github-tools`，默认关闭，仅完成本地实现及隔离验收。没有执行线上迁移、镜像切换或新功能部署。先前 QQ 兼容网关的服务器 `PLAN_READY` 记录不能视为部署成功回执。

## 身份与执行路径

网站 Chat、QQ → 持久交互请求 → 小墨鱼原有 Agent → 原有 Provider/Tool Gateway → 原有 GitHub 检索、固定版本材料、核验、写作、草稿/发布工作流 → 原渠道回执。

- Agent 的用户 ID、人格版本、加密模型 Key、能力授权、预算、运行和文章存储全部复用。
- 发起者另行记录。网站使用已认证的人类账号；QQ 使用真实 QQ、机器人和群组合，不冒充网站管理员。
- 普通对话及公开项目查询仍受入口白名单、速率和 Agent 预算限制。研究写作另需操作者授权；网站实际操作者默认可发起。后台「小墨鱼任务发起权限」管理入口授权，修改采用版本检查并追加审计记录。
- QQ 不读取网站用户私有学习记录。网站学习工具继续使用真实登录用户的所有权检查。已发表文章可查询；私有草稿正文不会传给群成员。
- 共享人格与工作事实；会话历史按 Agent、入口、提问者、会话隔离，不把不同群友的记忆混合。

## GitHub 行为

`github_search_projects` 查找候选；指定仓库时读取固定版本材料。`github_write_article` 执行既有研究写作；`get_agent_work` 查询已发表文章或当前会话的本人任务。每次请求冻结自己的选题，不改全局选题和每日计划。

后续 `codex/github-research-qa` 新增 `github_answer_question`，支持针对项目源码、亮点和总结的问答及同一提问者追问，不创建文章。需要新增迁移和工作流 bootstrap，详见 [项目问答实现与验收](agent-github-question-20261120.zh-CN.md)。

草稿要求被服务端保留，草稿工作流不装配发布 Gateway。其他写作继承小墨鱼既有自动发布策略和发布权门禁；公开额度仍由原规则限制。未通过选题或核验时诚实返回未完成/跳过，不伪造文章。

对话与长任务分别领取。提交后先回任务编号，网页显示进度并可继续聊天；标签页刷新重新读取服务端状态，不重复生成。QQ 完成后引用原消息回到原群。当前仅支持原有单群及明确提问者白名单。

## 数据与恢复

网站迁移 `0164_agent_interactions.sql` 只新增交互、入口授权及审计表。QQ 启用共享模式后新增 `mooyu_qq.agent_links`、`agent_deliveries`，沿用原 `messages/events` 发送记录。登录目录、会话卷、旧历史和线上配置不迁移、不清空。

原事件身份和规范化输入散列去重；同事件不同输入冲突。交互及运行有租约，已验证回复和真实运行回执可恢复。GitHub 请求继续使用原发布请求租约及网络预算。QQ 写入发送意图后才发消息；发送是否成功不确定时进入原待核对机制，不自动重发。权限在受理、阶段执行、心跳和结果回传时重新检查。

中途收回任务发起授权后停止后续执行；收回群或提问者入口白名单后停止回传。外部调用结果不确定时保留记录，不能把人工重试解释为重新发布许可。关闭聊天只是关闭显示，不取消后台任务。聊天页面保存于当前标签页；服务端任务记录继续保留。旧 QQ 消息原样留存，新模型上下文来自本入口的新交互记录，不自动导入旧提示词或其他群友记忆。

## 未来部署顺序（本次没有执行）

1. 先核对实际服务器镜像、全部 Compose 叠加文件、未提交修改、备份和登录卷；保留原服务器兼容网关、资料卷与历史。此功能不需要重新打包或替换 QQ 网关。
2. API/网页/QQ worker/公开调度器必须使用本分支同一版本。先升级原公开调度器并确认新鲜心跳含 `interactionProtocolVersion: 1`。原每日计划采用现有保留方式，不重建、不移动下一次运行时间。新交互任务有来源标记，调度器不得将其当作每日发布任务领取。执行器会拒绝旧版或停止的调度器。
3. 在网站数据库应用迁移，再以原环境和原 Agent 执行 `node apps/api/src/agent-interaction-bootstrap-cli.mjs`。它只注册/激活对话、只读仓库和交互草稿工作流 `blog.project.single.draft-shadow@3`，不改密钥、能力授权、发布权或计划，不调用模型。v3 保留原私有阶段并支持一次有账本的格式/内容纠正；原 v2 记录与合同保留，严格文章校验和发布门禁不变。
4. API 和独立交互 worker 增加 `AGENT_INTERACTIONS_ENABLED=true`；`AGENT_INTERACTIONS_AGENT_USER_ID` 必须与 `AGENT_BLOG_PUBLIC_RUNTIME_AGENT_USER_ID`、已启用 QQ 管理的 `QQ_ADMIN_AGENT_USER_ID` 一致。原 `AGENT_BLOG_PUBLIC_RUNTIME_ENABLED=true` 及其受限预算、模型和 GitHub 令牌配置沿用。论文相关开关继续关闭。
5. 独立 worker 使用 API 镜像，命令 `node apps/api/src/agent-interaction-worker-cli.mjs`。复用 API 所需环境、网站数据库、内部网络、共享控制密钥只读挂载及必要的数据路径；不要复制 API 的对外端口，不启动 HTTP 服务。运行两个独立领取循环，不需要新模型 Key。
6. QQ worker 增加 `QQ_AGENT_INTERACTIONS_ENABLED=true`、`QQ_AGENT_API_URL=http://api:3090`，复用原 `QQ_ADMIN_SECRET_FILE` 及 Agent ID；内部控制网络必须可解析 API。共享模式不读取 QQ 的 `DEEPSEEK_API_KEY`；旧配置保留。打包 worker 时需包含完整 QQ 源码、新 SQL，以及 API 的 `agent-channel-protocol.mjs`、`qq-admin-protocol.mjs` 和原依赖；不要复用缺少这些文件的旧离线包。
7. 在后台给独立测试 QQ 授予任务发起权限，再验证查项目、明确只写草稿、重启后查询、后台权限收回。确认预算及真实回执后才扩大入口。所有当前凭据不写入文档、日志或镜像。

新功能关闭方式：停止交互 worker，关闭 API 和 QQ 共享模式开关；不删除新表或历史。若存在交互来源的运行/发布请求，不得直接降级到会误领它们的旧调度器；先完成或核对并隔离这些请求，保持新版调度器的来源过滤。原有每日计划保持不变。

## 本地验收及边界

- 单元/HTTP：身份、授权、签名用途隔离、真实 QQ client/API 对接、输出合同、长任务与对话分离；原助手、Provider Gateway、公开调度和 Runtime 回归。
- 一次性 PostgreSQL 17：真实 Gateway、模型预算、权限版本审计、并发去重、不可改写输入、跨用户隔离、搜索/指定仓库/草稿/发布、真实文章与证据、回执重放、QQ 独立发送账本。模型和 GitHub 都用离线替身，未调用真实外部服务。
- Edge：异步任务、继续聊天、刷新恢复、不重复提交；原聊天跨路由、练习上下文、重试和宿主 Chat 回归。验收截图输出到 `E:\CodexData\build\Right\qq-github-tools`。
- 真实模型/独立 QQ 联合验收已完成：未授权拒绝、授权后真实 GitHub 研究与草稿、最终回执经 worker 重启后只送一次，原生 Chat/QQ 请求重放不增加调用或文章。详细失败及修复、真实与离线验证边界见 [联合验收记录](agent-interactions-live-20261120.zh-CN.md)。
- 尚未做：生产镜像交付及上线。本地联合验收不等于生产部署完成。
- 下一阶段：将更多墨鱼工坊公共工具/目录接入共享 Agent；本阶段没有扩大 QQ 的任意工具权限或开放执行系统命令。

复验命令：

```powershell
node --test tests/platform/agent-interaction.test.mjs tests/platform/platform-assistant.test.cjs tests/platform/agent-blog-public-runtime.test.cjs tests/platform/agent-blog-public-schedule.test.cjs tests/platform/agent-provider-gateway.test.cjs tests/platform/agent-runtime-foundation.test.cjs
node scripts/test-researcher-qa-db.mjs tests/platform/agent-interaction-db.test.cjs tests/platform/agent-interaction-github-db.test.cjs tests/platform/agent-blog-public-pipeline-db.test.cjs tests/platform/agent-qq-admin-db.test.cjs tests/platform/agent-qq-channel-db.test.cjs
# 设置本机 Playwright 路径，GAMEHUB_BROWSER_CHANNEL=msedge，CODEX_BUILD_ROOT=独立 E 盘输出目录后：
node --test tests/client/agent-interaction-browser.test.cjs tests/client/platform-assistant-browser.test.cjs
```
