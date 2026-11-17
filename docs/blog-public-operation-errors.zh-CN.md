# 公开计划暂停时的管理员错误响应

生产只读检查显示，公开计划 `enabled=false`、`next_fire_at` 为空，暂停原因是历史连续运行失败 `AGENT_BLOG_PUBLIC_RUNTIME_STAGE_INCOMPLETE`。公开运行按钮调用的是 `POST /v1/admin/agents/:agentUserId/public-runs`，不是运行列表接口。

运行容器的镜像名称仍包含旧 rollback 标签，但 API 和调度器中的三个关键文件与 `2dae9632` 的 SHA-256 均匹配：选题/写作处理器、公开运行执行器、数学目录适配器。因此不能仅凭可复用的镜像标签认定关键修复未生效；这次只读核对证明的是上述六项文件内容一致，不是所有容器的完整来源证明。

## 缺陷与修复

立即运行依然要求计划已启用、心跳有效且没有运行中的公开 fire。此前这些拒绝由 `AgentBlogPublicScheduleError` 抛出，HTTP 错误处理器未将其识别为预期业务拒绝，最终显示通用 500。

在管理员公开操作服务边界，只转换明确的四种调度错误：

| 条件 | HTTP | API code |
| --- | --- | --- |
| 计划未启用或暂停 | 409 | AGENT_PUBLIC_SCHEDULE_NOT_ENABLED |
| 心跳过期或执行器未就绪 | 503 | AGENT_PUBLIC_SCHEDULER_UNAVAILABLE |
| 已有运行中任务 | 409 | AGENT_PUBLIC_RUN_ACTIVE |
| 缺少 Foundation 发布归属 | 409 | AGENT_PUBLIC_PUBLISHER_REQUIRED |

返回相应中文操作提示。不自动恢复计划、不自动创建第二次任务、不放宽预检、发布权、预算或心跳门禁。只接受真正的调度错误类型；同名数据库错误和未知内部错误继续返回脱敏 500，认证失败继续为 401，正常接受继续为 202。论文继续关闭，数据、配置、迁移及运行历史均不改动。

计划恢复使用已有的 `bash deploy/resume-blog-public.sh`，它检查论文开关、心跳、模型、预算与发布权，仅恢复未来的每天北京时间 10 点计划，不重放历史任务。恢复实际成功与否以生产返回的 `enabled`、`blocked` 为准。

## 验证

针对性 HTTP 及调度回归 9 项通过，覆盖四种业务拒绝、未知错误脱敏、未认证请求不进入运行逻辑、正常 202 和没有隐式恢复动作。日志为 `.runtime/blog-public-operation-errors-verified.tap`。完整回归另行记录于 `.runtime/blog-public-operation-errors/full/`。

完整串行回归：367 个文件、1702 项测试，1620 项通过、0 失败、0 超时取消、82 项条件跳过，约 6 分 50 秒。报告为上述目录的 `result.json`、`results.tap`。测试不调用生产模型、不创建线上任务，也不修改线上计划；这份报告不代表生产调度已经恢复。
