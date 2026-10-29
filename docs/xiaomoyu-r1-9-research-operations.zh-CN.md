# 小墨鱼 R1.9：论文研究运行可观测性与运营门禁

## 1. 阶段目标

R1.9 把 `paper.private.research@1` 接入可运营的控制面，但不创建第二套队列、调度器或 Worker 协议。后台展示的所有状态都来自既有 Agent Runtime 和论文领域账本；唯一新增写操作是对**已过期租约**执行通用 Runtime 恢复。

本阶段仍然是私有研究能力：不生成公开博客，不改变发布权，不扩大论文来源权限，也不执行第三方论文代码。

## 2. 复用与新增边界

复用：

- `agent_runs / agent_run_stages / agent_run_events`：运行、阶段、租约和时间线；
- `agent_runtime_workers`：持久 Worker 身份、心跳、能力和当前阶段；
- `agent_budget_reservations`：模型预算预留、结算和不确定态；
- `agent_paper_research_queue_items / executions / events`：论文队列和领域投影；
- `recoverExpiredStages`：过期租约、超时、外部动作不确定态和重试次数的唯一恢复规则。

新增：

- Worker 注册元数据中的 `role` 与 `agentUserId`，便于按机器人和职责查询；
- `agent_runtime_operator_actions` 不可变运营操作账本；
- 论文研究运营快照和受控恢复 API；
- 后台运行状态卡，包括心跳、积压、阶段 P95、预算、错误分类和恢复候选。

## 3. 健康模型

运营快照只报告系统实际观察到的事实：

- `ready`：至少一个论文 Worker 心跳新鲜，且没有过期租约或停滞门禁；
- `degraded`：存在老化积压或长时间无进展阶段，但没有需要立即恢复的过期租约；
- `blocked`：没有可用 Worker，或存在已过期/超时的运行阶段。

默认阈值：Worker 心跳 180 秒、阶段停滞 15 分钟、最老积压 6 小时。阈值只用于告警分类，不自动杀进程、不自动扩大预算，也不强制抢占任务。

## 4. 受控恢复合同

`POST .../paper-research-executions/:executionId/recover-expired-stage` 必须满足：

1. 操作者是该 Agent 的活动管理员；
2. 提供 10–1000 字操作原因；
3. 提供 UUID 幂等键；
4. 执行属于 `paper.private.research`；
5. 当前阶段为 `leased/running`；
6. 租约已过期，或阶段执行时间已超过冻结超时；
7. 最终处理仍由 `recoverExpiredStages` 决定。

若外部动作已越过发送水位，Runtime 将阶段置为 `uncertain`，不会自动重发；若没有外部动作且仍有尝试次数，则重新排队；否则安全失败并终止后续阶段。后台不能覆盖这些规则。

每次成功受理都会同时写入：

- Runtime 自身 `stage.recovered / stage.failed / stage.uncertain` 事件；
- `agent_runtime_operator_actions` 不可变记录，包含前置状态、原因和结果；
- 论文执行 `execution.requeued` 领域事件。

## 5. 运营指标

- Worker：状态、实例、版本、能力、当前阶段、最近心跳和新鲜度；
- 积压：待研究项目、活跃/阻断/失败运行、最老等待时间；
- 阶段：活跃状态、尝试次数、租约、阶段年龄、近 30 天平均和 P95；
- 预算：当月模型调用、输入/输出 token、微美元计费、活动与不确定预留；
- 错误：来源、质量、模型、运行时、策略和未分类六类；
- 恢复：最近运营操作和当前可恢复候选。

这些指标不证明论文内容正确，也不把没有样本显示成零故障。

## 6. 单服务器约束

当前只有一台服务器。本阶段不引入 Redis 队列、Kubernetes、第二数据库或多主容灾。API、PostgreSQL 和论文 Worker 继续通过 Compose 在同机运行；持久化事实全部写 PostgreSQL，因此浏览器关闭或 API 重启不会丢失运行状态。

## 7. 验收

- Node 语法检查和既有 Runtime/R1.8 回归通过；
- 前端生产构建通过；
- 隔离 PostgreSQL 17 验证：健康租约拒绝抢占、过期租约按通用规则恢复、请求幂等、审计不可修改；
- Compose 配置可解析；
- API 镜像和论文 Worker 镜像可构建；
- 不新增公开发布能力，且运营 API 仅管理员可访问。

## 8. 后续阶段

R1.10 应建立生产级告警与保留策略：结构化指标导出、连续心跳缺失/积压/预算异常告警、审计和运行数据保留周期、运营周报，以及不依赖浏览器常开的通知边界。它仍应复用本阶段快照，不另造运行事实。
