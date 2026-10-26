# 小墨鱼博客 F1-4 影子迁移

版本：F1-4B2d3d
状态：私有草稿影子 Run、自动查询规划、跨 Run 候选交接、私有汇总观测、只读上线预检、一次性受监督 canary 与不可变验收证明已在开发分支实现；未部署，不改变线上执行权
日期：2026-10-26

## 1. 当前增量的目的

F1-4A 不是第二套博客执行器，而是切换前的被动旁路记录。旧 `agent_blog_runs` 仍负责排队、模型调用、自动检查和文章发布；新基座只观察其输入、状态与结果，证明这些事实能够无损映射到 Foundation 的 Run/Stage 语义。

这一步解决三个风险：

1. 在没有双重费用和双重发布的前提下验证迁移模型；
2. 发现历史数据或旧状态机中无法映射的异常；
3. 为 F1-4B 的真实影子 Run 提供可比较的基线。

## 2. 权威边界

| 能力 | F1-4A 权威方 | 影子侧行为 |
| --- | --- | --- |
| 任务创建 | 旧博客 | 观察并补投影 |
| Provider 调用 | 旧博客 | 禁止调用 |
| 预算和费用 | 旧博客现有用量 | 只保存来源快照，不写 Foundation 预算账本 |
| 自动检查 | 旧博客 | 映射结果，不重复检查 |
| 文章发布和撤回 | 旧博客 | 禁止写文章，仅记录输出引用 |
| 恢复 | 旧博客继续执行 | 影子投影可幂等重建 |

数据库约束固定：`passive` 模式下 `runtime_run_id` 必须为空，`provider_owner` 与 `publish_owner` 必须都是 `legacy`。因此即使应用层接线错误，F1-4A 也不能伪装成真实 Foundation Run。

## 3. 状态映射

| 旧博客状态 | 目标 Run 语义 | 目标 Stage 语义 |
| --- | --- | --- |
| `queued` | `queued` | `queued` |
| `generating` | `running` | `running` |
| `checking` | `running` | `running` |
| `published` | `succeeded` | `succeeded` |
| `rejected` | `rejected` | `failed` |
| `failed` | `failed` | `failed` |

撤回不是第二个 Run 终态，而是已成功文章输出上的领域状态。投影保留 `withdrawnAt` 与操作者，但 Run 映射仍为 `succeeded`。

每次投影同时验证：终态是否有 `finishedAt`、生成/检查是否有 `startedAt`、发布是否具备文章 ID 和标题、撤回是否有操作者、人格版本是否存在。无法满足时记录 `invalid` 与明确的 `mismatchCodes`，不得静默补造事实。

## 4. 持久化与恢复

- `agent_blog_runtime_shadow_projections` 保存每个旧任务的最新可重建投影；
- `agent_blog_runtime_shadow_events` 保存按来源哈希去重的只追加观察历史；
- `source_sha256` 由规范化来源快照计算，相同事实重复回放只更新验证时间，不增加事件；
- 自动写作每个关键状态转换后尝试投影；投影失败只告警，不阻塞线上博客；
- 每次轮询先扫描缺失或过期的投影，恢复进程中断留下的缺口；
- 管理员可通过 `GET /v1/admin/agents/:agentUserId/blog-shadow-projections` 读取最近投影。

## 5. 已验证的安全断言

隔离 PostgreSQL 17 回归覆盖：

- 135 个迁移并发应用且只能应用一次；
- 同一旧任务重复投影不重复写事件；
- `queued → generating → rejected` 可按顺序重建；
- 观察事件不能更新或删除；
- 被动投影没有创建 `agent_runs`；
- 被动投影没有创建 `agent_provider_calls`；
- 旧博客原有自动写作测试保持通过。

## 6. 进入 F1-4B 前的门槛

不能因为 F1-4A 已落库就直接切换执行权。至少满足以下条件后，才进入真实影子 Run：

1. 线上连续观察一个完整计划周期，所有新旧任务投影覆盖率为 100%；
2. `parity_status=invalid` 为 0，或每一条都有确定的数据修复结论；
3. 单项目 Manifest、冻结候选集、证据输入和输出 Schema 完成契约测试；
4. 影子工作流预算与发布能力固定为零，运行处理器没有发布路由；
5. 影子输出只对管理员可见并明确标记，不进入公开文章列表；
6. 差异报告能比较选题、引用、结构、成本估算与耗时；
7. 回滚仅停止未来影子创建，不删除投影和历史事件。

F1-4B 通过后仍不能直接全面切换。下一步是单 Agent canary，并且同一逻辑触发时间只能有一个发布所有者。

## 7. F1-4B1：零成本 Foundation 重放

F1-4B1 在 F1-4A 之上增加一条真实 Runtime 执行路径，但仍不做第二次研究、生成或发布：

- 配置默认是 `AGENT_BLOG_FOUNDATION_MODE=passive`；只有显式改为 `shadow` 才创建重放 Run；
- 只处理已经终结、且旧链路明确记录为 `single` 的任务；对比文章留给独立的对比 Manifest；
- 工作流 `blog.project.single.shadow-replay@1` 只有 `verify-legacy-run` 一个确定性 Stage；
- Run 预算固定为 Provider 0 次、Tool 0 次、输入/输出 Token 0；
- Manifest 没有 Provider、Tool、草稿写入或发布 Stage，也不声明任何能力；
- Worker 校验来源哈希、终态、人格版本、单项目选择与映射完整性，随后写入不可变的 `agent_blog_shadow_replay_artifacts`；
- 私有产物通过管理员影子投影接口回读，不进入公开博客或文章列表；
- 重放创建和产物写入都按旧 Run ID 幂等，Worker 崩溃后由通用租约恢复，不会产生外部副作用。

同时冻结了未来 canary 的 `blog.project.single@1` 目标 Manifest。它把 `research.github.read`、`provider.text.generate`、`blog.article.draft` 和 `blog.article.publish` 分成独立能力，迁移为现有博客 Agent 建立最小授权，但该 Manifest **不会自动注册或执行**。这样做是为了先固定长期边界，不把旧博客的大函数直接搬进新 Worker。

进入 F1-4B2b 前，还必须实现并验证：经 Provider Gateway 的选题/写作 Action、私有草稿适配器、确定性校验，以及“影子工作流没有发布路由”的部署级断言。F1-4B2b 才会产生可比较的新草稿；F1-4B1 只证明新基座可以安全接住旧任务事实。

## 8. F1-4B2a：通用 Tool Gateway 与 GitHub 只读研究

F1-4B2a 先建设博客与论文都需要的研究端口，不把旧博客抓取逻辑复制进新工作流：

- `agent_tool_contracts` 固定工具版本、能力、风险、执行类别、读写副作用、输入输出 Schema、网络/文件策略、超时和输出上限；
- `agent_tool_calls` 与 Action 同步记录 `reserved → sending → acknowledged → terminal`，写工具在发送结果未知时进入 `uncertain`；只读工具明确允许安全失败和后续重试；
- Run、Agent 月度和平台月度三级 `toolCalls` 预算在数据库事务和 advisory lock 下竞争，不能被并发 Worker 超额领取；
- 工具输出先校验 Schema 和字节上限，再写入不可变 `agent_tool_artifacts`；公开文章不会直接读取工具标准输出；
- Runtime 管理时间线只返回工具调用和产物摘要，不默认返回产物正文；
- GitHub 首个适配器只接受 `owner/repository` 或 `https://github.com/owner/repository`，固定访问 `https://api.github.com`、禁止跳转、固定版本 SHA、限制 README 和响应大小；
- Provider 账本与 Tool 账本合并更新 Run 用量，互不覆盖。

本阶段没有把工具注册到生产 Worker，也没有自动创建研究 Run，因此线上行为仍为零变化。`blog.project.single.draft-shadow@1` 的执行合同已经冻结：只声明研究、生成和私有草稿三类能力，终点是 `persist-draft`，不存在发布能力或 `publish` Stage。F1-4B2b 完成各适配器后才会注册该工作流，并把固定候选集依次交给 Tool Gateway、Provider Gateway、确定性检查和私有草稿适配器。

## 9. F1-4B2b1：证据绑定的私有草稿输出

私有草稿适配器已经从旧博客大函数中拆出，并固定以下边界：

- 唯一动作是 `blog.article.draft@1`，风险级别 L2，策略资源固定为 `blog.private-draft`；
- 每份草稿必须引用 1 至 32 个同一 Run 生成的不可变 `agent_tool_artifacts`，不能拿其他运行的资料拼接；
- 结构化文章先经过现有博客 Schema 规范化，再用内容摘要参与动作幂等；
- 文章、工作修订、审计事件、Foundation 映射和 Action 终态在同一个数据库事务完成；
- 写入结果只能是 `blog_articles.publication_state=draft` 与 `blog_article_revisions.revision_state=working`，公开修订、首次/最近发布时间和撤回时间都必须为空；
- 适配器没有 publish 方法，影子 Manifest 没有 publish capability/Stage，测试同时断言没有 `published` 事件；
- `agent_blog_foundation_drafts` 是不可变映射，重放同一动作只返回原草稿，变更内容或证据则产生幂等冲突；
- 管理时间线只返回文章 ID、修订 ID、证据产物 ID 和摘要，不返回正文。

这一小步仍不会注册 `blog.project.single.draft-shadow@1`，也不会在生产调用 Provider。下一步是把冻结候选、GitHub 研究调度、下述选题/写作处理器和私有草稿适配器装配成完整影子 Run；这些完成前不得打开生产 Worker。

## 10. F1-4B2b2：受治理选题、写作与确定性校验

本阶段没有把旧 `generate()` 大函数搬入 Worker，而是把模型工作拆成两个可单独计量、恢复和审计的 Provider Action：

1. `select-subject` 只读取同一 Run 的 GitHub 工具产物，从冻结候选中返回 `single` 或 `comparison` 决策；
2. `compose` 只读取选中的固定仓库版本和选题产物，返回带逐块引用序号的结构化文章；
3. `verify` 不调用模型，只执行博客 Schema、标题字母、事实块引用、来源使用率、仓库集合和模式基数等确定性检查。

恢复与证据链固定为：

- Provider 结构化响应在预算结算和 Action 成功的同一事务中写入不可变 `agent_provider_output_artifacts`；Worker 在响应成功后崩溃，重试会读取原响应，不会再次调用或计费；
- 业务规范化结果写入不可变 `agent_runtime_stage_artifacts`，阶段 `outputRef` 只保存 ID、Schema、大小和哈希；
- 每个阶段产物分别记录来源工具产物与上游阶段产物，且只允许读取同一 Run 中已经成功的来源；
- Runtime 管理时间线只返回 Provider 输出和阶段产物的摘要，不返回选题理由、文章正文或来源正文；
- `single` 模式在确定性代码中拒绝历史已用仓库；只有 `comparison` 可以复用旧仓库，并仍需满足 2 至 3 个项目和至少两个比较维度；
- 小墨鱼的人格兴趣信号可以影响模型选择，但模型返回的信号必须来自冻结人格版本，不能借人格提升权限或绕过来源规则。

## 11. F1-4B2c：端到端私有草稿影子 Run

完整装配已经在开发分支形成，但只通过显式 `enabled: true` 的 canary 工厂注册和创建 Run；生产 Worker CLI 没有导入这些处理器，现有计划任务也不会进入该工作流。

执行链固定为：

1. `freeze-input` 严格校验 Run 输入、候选数量、候选唯一性、人格版本与输入哈希；
2. `collect-evidence` 只能遍历创建 Run 时已经冻结的 1 至 12 个 GitHub 仓库，每个仓库独立创建受策略和预算约束的 Tool Action；
3. `select-subject`、`compose` 和 `verify` 复用 F1-4B2b2 的结构化生成与确定性校验；
4. `persist-draft` 从验证产物反向读取写作产物和工具证据，不接收调用方临时替换的正文；
5. 草稿事务把 `verification_artifact_id` 与 `composition_artifact_id` 一并写入不可变映射，正文哈希、来源集合或产物链任一不一致均拒绝落库；
6. Run 输出只能是 `blog.private-draft`，Manifest 没有 `blog.article.publish` 能力和 `publish` Stage。

隔离 PostgreSQL 17 已让整条六阶段 Run 实际执行完成，并断言：两次 Provider Action、一次 GitHub Tool Action、一份私有草稿、零发布 Stage、零发布 Action、零 `published` 事件。加入候选发现真实事务验收后，迁移套件共 83 项全部通过。

这不等于已经上线。生产仍保持被动投影和旧链路单一发布所有权。

## 12. F1-4B2d1：候选发现与文章研究分层

候选发现已经成为独立的 `blog.project.discovery-shadow@1` 工作流，而不是塞进文章写作提示词：

1. 新的 `research.github.discover@1` 权限只允许访问 `github.repository-search`，不能读取文章证据、调用模型、写草稿或发布；
2. 搜索工具只接受普通关键词，不接收 GitHub 搜索限定符、URL 或控制字符；固定访问 `api.github.com`，拒绝重定向，单次最多返回二十项；
3. 一个发现 Run 最多冻结五条查询，最终候选集最多十二项；多查询结果会按仓库身份去重，并显式标记是否曾发布；
4. 搜索结果只有仓库卡片，没有 README 和提交版本，因此永远不能被写作模块当成已验证来源；
5. 真正进入写作前，另一个私有草稿 Run 仍须逐仓库执行 `research.github.repository.read@1`，取得固定提交和 README 证据；
6. 发现工作流默认关闭，Manifest 的 Provider 预算为零，不存在草稿或发布 Stage。

## 13. F1-4B2d2a：模型规划搜索词，不直接搜索

`blog.project.discovery-shadow@3` 在发现工具之前增加了一个独立 Provider Stage：

- 模型只接收冻结的中文选题范围、人格版本、兴趣信号和最大查询数；
- 返回值必须是结构化 `queries/rationale/interestSignals`，兴趣信号必须来自冻结人格；查询必须由二至六个 GitHub 仓库元数据中常见的英文技术关键词组成；
- 确定性代码再次拒绝中文、纯宣传词、URL、斜杠、冒号、搜索限定符、重复词和超额查询；提示词符合要求不等于放行，运行时契约才是最终边界；
- 若全部计划查询都得到零候选，系统只从已验证的计划词确定性删减通用词并最多追加两次放宽查询；不会再次调用模型，也不会临时改成模型自由搜索；
- 一个 Run 最多调用模型一次、搜索工具五次，模型没有网络、草稿或发布能力；
- 查询计划作为不可变 Stage Artifact 保存，以同 Run 中成功的 Provider Action 为血缘起点；
- 最终候选集同时记录计划查询、实际查询、回退查询及每条回退的来源，并引用查询计划产物和全部搜索工具产物，不能在搜索后悄悄替换计划。

这一步完成了自然语言选题范围到受治理搜索的自动化，但尚未自动把发现 Run 交接给草稿 Run。

## 14. F1-4B2d2b：跨 Run 候选交接与私有汇总观测

发现与写作现在通过不可变交接事实连接，而不是由调度器复制一组 URL 后丢失来源：

1. `agent_run_handoffs` 同时保存来源 Run、候选工件、来源输出类型、工件键、内容哈希、目标 Run 与目标输入哈希；记录不可更新、不可删除；
2. Runtime 创建目标 Run 时在同一事务中验证来源 Run 已成功、候选工件正是其正式输出、Agent 身份一致，并同时写入交接记录；事务提交前目标 Stage 不会被 Worker 看见；
3. 一个候选集按当前单项目私有 canary 规则只能交接一次；同一幂等请求可安全重放，去掉或替换交接信息会产生冲突；
4. 交接适配器只从 `blog-candidate-set-v1` 提取规范化 GitHub 地址，再构造既有私有草稿输入；搜索摘要仍不是文章证据，草稿 Run 必须重新读取固定仓库版本；
5. 管理时间线只暴露入站/出站交接 ID、类型与哈希，不返回候选内容；私有汇总服务只返回发现、待交接、草稿状态和 Provider/Tool 用量；
6. 隔离 PostgreSQL 17 已验证迁移、原子交接、不可变约束、幂等冲突和聚合观测；完整数据库套件全部通过。

所有工厂仍默认 `enabled: false`，生产 Worker 与计划任务没有注册这些处理器。

## 15. F1-4B2d3a：单 Agent 私有 canary 只读上线预检

上线准备先落只读门禁，不直接装配真实执行器：

- `AGENT_BLOG_PRIVATE_CANARY_ENABLED` 默认 false，并且必须同时指定唯一 Agent UUID；
- `AGENT_BLOG_PRIVATE_CANARY_PUBLISH_ENABLED` 只要为 true 就拒绝启动，不存在“误配后继续”的兼容路径；
- 预检要求目标 Agent 与用户均活跃、人格和策略已分配，四项最小权限完整，两条指定版本工作流已激活；
- DeepSeek 密钥、结构化模型目录和 Provider 熔断状态必须正常；
- 任何活跃 Run、不确定 Run、成功但未交接的候选集都会阻止新 canary；
- 每日发现 Run、月度 Provider 调用、月度费用和连续失败分别设硬上限，达到上限即 fail closed；
- 独立 `agent-blog-canary-preflight` Compose profile 只读数据库、一次运行后退出，不创建 Run、不调用 Provider、不注册 Worker；
- 真实 PostgreSQL 套件验证预检能准确识别未交接积压，83 项全部通过。

这仍不是上线开关。其结果只作为下节一次性人工执行的前置门禁。

### 15.1 控制面 bootstrap

工作流 Manifest 与模型准入目录是版本化控制面事实，不能依赖首个业务 Run 临时补写，也不能要求运营者手工执行 SQL。独立 `agent-blog-canary-bootstrap` profile 因此在 preflight 之前执行一次幂等登记：

- 只登记 `blog.project.discovery-shadow@3` 和 `blog.project.single.draft-shadow@1`，以及它们所需的 GitHub 搜索、仓库读取两份只读工具合同，不登记公开发布工作流；
- 只登记经过代码评审的 `deepseek/deepseek-flash@1` 结构化生成准入包；价格字段是预算预留的保守上限，不冒充供应商实时账单；
- 目标 Agent、其运营管理员、工作流哈希和模型目录版本不匹配时立即失败；已有同版本完全一致记录时幂等返回；
- bootstrap 不创建 Run、不读取 Key、不访问 GitHub、不调用 Provider、不创建文章，也没有发布能力；
- bootstrap 完成后在同一进程运行只读 preflight；preflight 必须同时看到两份指定版本的有效工具合同，并把登记收据和最终门禁结果合并输出。

固定运维顺序调整为 `bootstrap → preflight → supervised private canary`。bootstrap 是受控写入，不应混入只读 preflight，也不能在每次 Worker 启动时隐式执行。

## 16. F1-4B2d3b：一次性人工私有 canary

人工执行链已完成代码装配，但没有在本地或生产实际运行：

1. 独立命令每次只接受一个目标 Agent；先执行 d3a 的只读预检，任何门禁不通过都不会创建 Run；
2. 输入快照一次冻结当前选题范围、模型、人格 ID/版本与完整配置、最近标题和历史 GitHub 仓库，旧文章中的非 GitHub 引用不会污染去重集合；
3. 先创建 `blog.project.discovery-shadow@3`，四个 Stage 全成功并正式输出候选工件后，才通过 `agent_run_handoffs` 原子创建一次私有草稿 Run；
4. 草稿 Run 只执行六个既有 Stage，终点必须是 `blog.private-draft`；Manifest、处理器和 Compose 服务均不存在发布 Stage、发布适配器或定时循环；
5. 一次性 Worker 用 `targetRunId` 精确领取本次 Run，并跳过全局过期恢复和 Outbox 派发，不会误领、恢复或派发其他任务；
6. 任一 Stage 返回空闲、重试、失败、不确定或租约丢失，本次链路立即停止且不进入下一 Run；重跑必须由运营者使用明确 UUID 决定是否复用同一幂等请求；
7. `agent-blog-canary-run` Compose profile 默认关闭、`restart: no`，并继续硬拒绝 `AGENT_BLOG_PRIVATE_CANARY_PUBLISH_ENABLED=true`。

代码验收只证明执行边界，不代表上线批准。首次真实运行前必须先单独执行只读 preflight，并由运营者核对目标 Agent、模型目录、工具合同和预算；真实运行会访问 GitHub 与 DeepSeek、产生模型费用并创建一篇不可公开访问的草稿。真实连续人工样本仍属于下一阶段，未达标前不接每天 10 点影子调度，更不切换发布所有权。

## 17. F1-4B2d3c：不可变验收证明与停止边界

真实 canary 的结论不由模型或人工印象决定。`agent-blog-canary-acceptance-policy-v1` 对一个完整发现—交接—草稿运行图做确定性验收：

1. 发现必须是 `blog.project.discovery-shadow@3`，草稿必须是 `blog.project.single.draft-shadow@1`，两者触发引用一致且由唯一原子交接记录连接；
2. 四个发现 Stage 与六个草稿 Stage 必须全部成功，不接受重试、失败、不确定或残留 Action；
3. 全图必须恰好有三次成功 Provider 调用，Tool 调用在二至十三次之间，总耗时不超过一小时，单样本费用不超过一美元；上限增加的两次只允许来自发现阶段的确定性零结果回退；
4. 任意发布 Stage、`blog.article.publish` Action 或 `published` 事件都会直接判失败；文章必须保持 `draft`、修订必须保持 `working`，且 `published_revision_id` 为空；
5. 候选工件哈希、目标输入哈希、写作产物、验证产物和来源工件必须形成完整血缘；报告只保存 ID、状态、计数、用量和哈希，不保存正文、提示词、原始模型响应或密钥；
6. 报告写入 `agent_blog_canary_acceptance_reports` 后不可更新或删除；同一草稿 Run 在同一策略版本下只能有一份报告，幂等重放必须得到完全相同的报告哈希；
7. 失败报告同样保留并返回稳定原因码。未终态 Run 不得生成报告，以免把进行中任务误记为失败样本；
8. 最近三份报告连续通过时只返回 `readyForShadowScheduleReview=true`，并固定返回 `automaticScheduleChange=false`。这不授权系统自行启动每天 10 点调度。

运维顺序固定为：先单独运行只读 preflight，再显式运行一次 `agent-blog-canary-run`。受监督执行器会在私有草稿成功后立即写入不可变报告并返回同一份内容为空的操作收据，不再要求运营者手工复制 `draft.runId`。`agent-blog-canary-report` profile 只用于“草稿已成功、但主进程在写报告前崩溃”的恢复场景。报告失败或执行被中断时立即停止，保持 canary 与发布开关关闭，并从管理员时间线检查最后一个 Stage、Action 发送水位和不确定状态。不得直接重跑一个仍活跃或不确定的 Run；已经发送但结果未知的 Provider/Tool Action 必须先按原请求 ID 对账，不能猜测重发。

`docker compose stop agent-blog-canary-run` 只停止一次性进程，不会伪造数据库终态、删除 Run 或释放不确定费用。被中断的 Run 会继续阻止下一次 preflight，这是刻意的 fail-closed 行为。当前阶段不提供“强制清空”按钮；恢复必须依据时间线和外部回执选择原结果对账、安全取消未发送工作，或保留不确定状态等待人工处置。

本阶段仍未进行任何真实 canary。下一阶段只有在运营者明确批准实际模型费用后，才执行首个样本并生成第一份报告；未取得三次连续通过前，不评审影子调度，更不切换发布所有权。

## 18. F1-4B2d3d：受监督单次执行收据

`agent-blog-private-canary-supervisor.mjs` 只组合既有 runner 与验收服务，不增加新的 Provider、工具或发布权限：

1. runner 内部再次执行 preflight，通过后才创建发现 Run；
2. 发现、交接和私有草稿全部成功后，监督器用返回的 Agent ID 与草稿 Run ID 立即生成验收报告；
3. 输出只包含 Run、Artifact、Article、报告 ID、状态、计数、用量、哈希和 readiness，不包含正文、提示词、原始模型响应或密钥；
4. 报告失败时命令返回非零状态，但不会删除私有草稿，也不会启动重试、发布或调度；
5. 监督器拒绝任何声称 `automaticScheduleChange=true` 的验收实现，并固定返回 `scheduleDecision=unchanged`；
6. 若 runner 在草稿成功前失败，不伪造验收报告；若草稿已成功而报告写入前进程崩溃，运营者只能使用独立报告 profile 按原草稿 Run ID 幂等补写。

这使真实 canary 的正常路径只需一次显式写操作，同时保留一个数据库只读取证、只追加报告的恢复入口。当前开发机没有生产 `.env.prod`、数据库连接或目标 Agent UUID，因此本阶段仍未执行真实 Provider 调用。
