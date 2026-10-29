# 小墨鱼 R1.8：私有论文研究执行器

状态：实现完成，待生产迁移与单服务器 worker 启用
日期：2026-10-28

## 阶段目标

R1.8 把 R1.7 的“论文发现与身份队列”接到通用 Agent Runtime，使小墨鱼可以在页面关闭、API 重启或 worker 短暂中断后继续完成一篇论文的私有研究。它不是新的博客自动发布器，也不是第二套任务系统。

成功定义：每次研究都有稳定的执行、运行、阶段、动作、尝试和事件身份；worker 通过租约领取阶段并可恢复；只自动处理可验证的开放全文；用户 PDF 在没有独立外部处理同意合同前不得发给模型；结果只写入私有论文分析与证据账本；后台可启动、查看、重试和安全取消；单台生产服务器只增加一个受 Compose profile 管理的持久 worker。

## 执行链

`paper.private.research@1` 固定为八个阶段：

1. `resolve-source`：冻结队列项和来源，判断是否已有开放全文；
2. `acquire-source`：仅对 arXiv 开放来源调用 `research.paper.arxiv.read@2`；
3. `verify-eligibility`：检查访问级别、解析质量和外部处理类别；
4. `reconstruct-sections`：按不可变 EvidenceSpan 重建页窗；
5. `extract-semantics`：一次结构化模型调用提取主张、结果、方法和局限；
6. `verify-semantics`：确定性校验引用、页码和结论关系；
7. `persist-analysis`：写入私有不可变语义账本；
8. `finalize-queue`：完成研究队列项，不触发博客发布。

默认单次预算为 1 次工具调用、1 次模型调用、60000 输入 Token、7000 输出 Token 和 1800 秒墙钟时间。预算由通用 Runtime、Policy Service 与 Provider Gateway 共同执行，而不是只靠提示词约束。

## 来源与权利边界

| 来源 | R1.8 行为 | 原因 |
| --- | --- | --- |
| arXiv 开放全文 | 可自动获取并研究 | 来源、版本和正文均可冻结与引用 |
| 已归档开放全文 | 可直接研究 | 已有不可变来源版本与解析质量记录 |
| DOI 元数据 | 阻断，等待合法全文 | 书目信息不能替代正文 |
| 标题/作者搜索结果 | 身份确定后仍需开放全文 | 不能根据摘要猜测论文结论 |
| 用户上传 PDF | 本地收件与解析可用，但默认禁止外发模型 | 文件使用权不自动等于第三方模型处理授权 |
| 付费墙或受限全文 | 阻断 | 不绕过访问控制，不抓取非授权副本 |

R1.8 没有“勾选同意即可外发”的临时实现。用户 PDF 的外部处理必须在后续版本建立独立、可撤回、可审计、与具体 Provider 绑定的同意合同后才可开放。

## 数据与恢复

- `agent_paper_research_executions` 是论文域投影，记录队列、尝试、Run、版本、结果和错误；
- `agent_paper_research_execution_events` 是不可变审计事件；
- `agent_runs`、`agent_run_stages`、`agent_actions` 与 outbox 仍是执行事实源；
- 同一队列项最多一个 `queued/running` 执行；失败或阻断后重试会创建新尝试，不覆盖旧证据；
- 取消只在没有已租用/运行阶段时生效，不删除论文、分析和审计；
- worker 重启后通用 Runtime 会回收过期租约并继续执行。

## 管理接口

- `GET /v1/admin/agents/:agentUserId/paper-research-executions`
- `POST /v1/admin/agents/:agentUserId/paper-research-queue/:queueItemId/executions`
- `POST /v1/admin/agents/:agentUserId/paper-research-executions/:executionId/retry`
- `POST /v1/admin/agents/:agentUserId/paper-research-executions/:executionId/cancel`

所有写接口需要管理员身份和幂等键；后台只显示本 Agent 的记录。

## 单服务器部署

生产环境启用：

```dotenv
AGENT_BLOG_PRIVATE_CANARY_ENABLED=true
AGENT_BLOG_PRIVATE_CANARY_PUBLISH_ENABLED=false
AGENT_PAPER_RESEARCH_WORKER_ENABLED=true
AGENT_ARXIV_CONTACT_EMAIL=ops@example.com
COMPOSE_PROFILES=agent-blog-public-scheduler,agent-paper-research-worker
```

部署后检查：

```bash
cd /www/gamehub/deploy
docker compose --env-file .env.prod -f compose.prod.yml \
  --profile agent-paper-research-worker ps agent-paper-research-worker
docker compose --env-file .env.prod -f compose.prod.yml \
  --profile agent-paper-research-worker logs --tail 100 agent-paper-research-worker
```

日志出现 `event:"ready"` 和 `workflowKey:"paper.private.research"` 才表示 worker 已接管队列。不要在同一服务器启动多个同名 worker 容器；水平扩展留给后续基于配额与分区的设计。

## 非目标与后续

R1.8 不做论文推荐排名、定时自动选论文、用户 PDF 外部模型授权、跨论文综合、论文公开写作或多服务器调度。下一阶段应优先做 R1.9：研究执行可观测性与运营门禁，包括 worker 心跳、积压、阶段耗时、错误分类、预算占用、运行详情和受控重驱动；其后再进入跨论文研究与论文写作。
