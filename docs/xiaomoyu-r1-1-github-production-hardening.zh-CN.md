# 小墨鱼 R1.1：GitHub 研究链路生产韧性

## 1. 目标与边界

R1.1 不改变文章选题、证据结构或发布权模型，只收紧 GitHub 公开仓库研究在单服务器生产环境中的认证、流量、失败恢复和可观察性。

必须同时满足：

1. GitHub 令牌只存在于服务器环境变量和出站请求头，不进入模型输入、工具输出、收据、日志、数据库或浏览器；
2. 每次完整研究与发布 Run 的 GitHub 请求数有可证明的上界；
3. GitHub 明确限流时遵守 `Retry-After` 或 `X-RateLimit-Reset`，不立即形成重试风暴；
4. 只读调用失败可以安全重放，但写操作的不确定性规则保持不变；
5. 生产预检缺少认证时失败关闭，后台只显示认证是否就绪、请求预算和下一次可执行时间；
6. 保持单服务器、每天北京时间 10:00、全自动发布、无需逐篇人工审核的既定运行方式。

## 2. 凭据模型

环境变量：

```text
AGENT_GITHUB_RESEARCH_TOKEN=<server-only token>
```

使用只读、最小权限的 GitHub fine-grained token。令牌由部署系统注入 API、公开运行预检、公开运行器、公开调度器，以及仍保留的私有验收运行器。Bootstrap 不需要访问 GitHub，因此不接收该令牌。

工具合同中的 `networkPolicy.authentication = none` 表示模型和调用方不得提交认证材料；服务器适配器添加的出站认证属于受信执行环境的实现细节，不改变合同输入结构。

空令牌使公开/私有预检分别产生：

- `AGENT_BLOG_PUBLIC_RUNTIME_GITHUB_AUTH_NOT_READY`
- `AGENT_BLOG_PRIVATE_CANARY_GITHUB_AUTH_NOT_READY`

格式异常的非空令牌直接产生 `AGENT_GITHUB_RESEARCH_TOKEN_INVALID`。任何错误对象都不能携带令牌值。

## 3. 单次运行请求预算

固定上限：

| 项目 | 上限 |
| --- | ---: |
| 搜索查询 | 3 |
| 进入材料采集的候选仓库 | 5 |
| 每个仓库材料请求 | 8 |
| 单次完整公开运行总上限 | `3 + 5 × 8 = 43` |

`43` 是执行上界，不是期望用量。可选 README、许可证、文档或 Release 不存在时仍可能产生一次 404 请求，但不会超过每仓库 8 次。材料适配器在发出第 9 次请求之前以 `AGENT_GITHUB_REQUEST_BUDGET_EXCEEDED` 失败关闭。

修改搜索数、候选数或材料读取步骤时，必须同步修改共享常量、公式测试、后台展示和本文档；禁止只扩大其中一个入口。

## 4. 限流与重试

以下响应视为明确限流：

- HTTP 429；
- HTTP 403 且 `X-RateLimit-Remaining: 0`；
- HTTP 403 且存在 `Retry-After`。

等待时间优先取 `Retry-After`（秒或 HTTP 日期），其次取 `X-RateLimit-Reset`，最后保守等待 60 秒；所有等待限制在 1–3600 秒。适配器产生 `AGENT_GITHUB_RATE_LIMITED`，Tool Gateway 保留 `retryable` 和 `backoffSeconds`，Worker 取“指数退避”和“服务端要求等待”中的较大值，数据库把 Stage 的 `available_at` 推迟后再排队。

GitHub 研究工具均为只读合同，因此请求已经发出但未收到成功回执时可以重放；该规则不能推广到发布、写文件或其他有副作用的工具。

## 5. 可观察性

后台公开运行卡只显示：

- GitHub 研究认证：已认证/未认证；
- 每次运行最多 5 个候选、43 次请求；
- 阻断码和中文原因；
- 重试 Stage 的 `availableAt`、尝试次数与错误码。

永不显示令牌前缀、末四位或完整值。GitHub 研究令牌由服务器部署配置管理，不与 DeepSeek 模型 Key 共用后台表单。

## 6. 运维流程

首次上线或轮换令牌：

1. 在 `deploy/.env.prod` 设置 `AGENT_GITHUB_RESEARCH_TOKEN`；
2. 通过标准 `backup.sh`、`deploy.sh` 更新单台服务器；
3. 确认 `/ready`、公开运行预检和调度器心跳；
4. 后台确认“GitHub研究 已认证”；
5. 使用“立即运行新基座”做一次真实验收，不改变每天 10:00 的持久计划。

撤销或失效时，预检应阻止新 Run；已经遇到限流的 Run 按持久 `available_at` 恢复，不需要重启服务器。若 GitHub 返回权限错误但并非明确限流，运行失败并保留错误码，不进行盲目重试。

## 7. 验收门槛

R1.1 只有在以下项目全部通过后才能提交或推送：

- 令牌验证、请求头和不泄漏测试；
- 43 次预算公式和每仓库 8 次硬上限测试；
- 429/403 等待解析、Gateway 传播、Worker 持久退避测试；
- 公私预检失败关闭测试；
- 平台测试、真实 PostgreSQL 测试、生产前端构建；
- Compose 配置解析和 `git diff --check`。
