# 小墨鱼博客 F1-4 影子迁移

版本：F1-4B2c
状态：私有草稿边界与受治理选题/写作/校验已在开发分支实现；未部署，不改变线上执行权
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

- 131 个迁移并发应用且只能应用一次；
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

隔离 PostgreSQL 17 已让整条六阶段 Run 实际执行完成，并断言：两次 Provider Action、一次 GitHub Tool Action、一份私有草稿、零发布 Stage、零发布 Action、零 `published` 事件。迁移套件共 82 项全部通过。

这不等于已经上线。生产仍保持被动投影和旧链路单一发布所有权。下一步是 F1-4B2d：建设候选发现端口、canary 配置与私有运行观测，然后才决定是否在一个 Agent 上启用不发布的生产影子 Run。
