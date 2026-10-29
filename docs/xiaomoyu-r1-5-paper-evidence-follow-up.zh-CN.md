# 小墨鱼 R1.5 私有论文证据追问闭环

版本：v1.0

状态：已实现并通过单元测试与一次性真实 PostgreSQL 17 端到端验收；等待随当前开发分支统一提交、部署和生产冒烟

更新日期：2026-10-27

上位设计：[小墨鱼论文阅读机制设计](./xiaomoyu-paper-reading-design.zh-CN.md)

## 1. 阶段目标

R1.5 只解决一个问题：运营者能否针对小墨鱼已经完成且冻结的 R1.4 单篇论文语义分析，发起“仅根据本文”的私有追问，并取得可复核、不可变、严格绑定 EvidenceSpan 的回答。

本阶段不是联网问答、论文搜索、继续研究、论文写作或论文公开发布。追问不会调用工具，不会读取新的外部资料，也不会把回答送入博客公开链路。

## 2. 已实现边界

- 入口仅位于管理员后台，普通用户、公开博客和 `/v1/me` 没有对应路由；
- 只能读取属于同一 Agent 的 `agent_paper_semantic_analyses`；
- 每题最多一次 Provider 调用、零次 Tool 调用；
- 问题长度为 2–500 个字符，控制字符和未知字段失败关闭；
- 问题、论文原文和证据片段全部作为不可信数据，不得改变系统提示或权限；
- 回答只有 `none`、`bounded`、`insufficient-evidence` 三种证据状态；
- `none` 与 `bounded` 必须引用至少一个非 `unknown` finding 和一个真实 EvidenceSpan；
- `insufficient-evidence` 必须清空 finding 与 EvidenceSpan 引用，不能用无关证据装饰答案；
- 每个引用由确定性代码重新核对，必须存在于被冻结的 finding—evidence 关系中；
- 问答及引用写入不可变账本；重复请求 ID 返回原结果，不再次调用模型；
- 同一 Agent、同一上海自然日按 Run 创建顺序确定限频名次，并发请求也不能越过每日上限；失败尝试同样占用名次，优先保护模型预算；
- 每个 Agent 每个上海自然日最多成功写入 10 条私有追问；Provider 月度预算和熔断继续由通用网关控制。

## 3. 工作流与预算

工作流：`paper.semantic.follow-up-private@1`

```text
freeze-context
  → answer-question
  → verify-answer
  → persist-answer
```

| 阶段 | 类型 | 关键约束 |
| --- | --- | --- |
| `freeze-context` | deterministic | 从不可变 R1.4 账本读取同 Agent 分析并冻结摘要 |
| `answer-question` | provider | 一次结构化模型调用；不配置任何工具能力 |
| `verify-answer` | deterministic | 校验三态、finding、EvidenceSpan 及关系 |
| `persist-answer` | domain-write | L2 能力、幂等 Action、不可变账本 |

默认上限为 1 次 Provider 调用、0 次 Tool 调用、30,000 输入 token、3,000 输出 token和 600 秒墙钟时间。模型仍使用现有 `paper-semantic-analysis` 任务类别，不增加第二套模型目录或预算系统。

## 4. 数据与审计

迁移 `0148_agent_paper_follow_up.sql` 增加：

- `agent_paper_follow_up_answers`：问题、回答、三态、模型、策略版本、提示版本、输入与回答哈希；
- `agent_paper_follow_up_evidence_links`：回答到 finding、EvidenceSpan、证据序号和关系类型的精确绑定；
- `research.paper.follow-up@1`：仅允许 `paper.semantic-follow-up` 资源的 L2 能力。

两张表都拒绝 UPDATE 和 DELETE。原分析、问题、模型输出、验证制品、Action、Provider 用量与最终回答可沿 Run/Stage/Action 时间线重建。

## 5. 管理后台

R1.4 最新分析卡新增“仅根据本文追问”。私有弹层展示：

- 论文标题、作者和原文入口；
- 冻结的建议问题；
- 提交中的旋转与证据核验状态；
- 回答的充分、有限或证据不足状态；
- 每个引用的原文片段、页码和原文回跳；
- 每日次数及单题模型调用上限。

该界面不提供“联网继续研究”或“发布为文章”按钮，避免把不同权限和成本等级的动作混在普通追问中。

## 6. 单服务器部署

R1.5 不增加容器、常驻 Worker、数据库或调度器。HTTP 请求进入现有 API，在同一进程内创建通用 Run，并由目标 Run Worker 同步推进四个阶段。PostgreSQL、Provider Gateway、Policy、Artifact 与审计均复用现有单服务器基础设施。

部署只需要执行现有 `backup.sh` 和 `deploy.sh`；迁移会由 `migrate` 服务应用。无需新增环境变量。生产检查以 `/ready`、管理员私有追问和运行时间线为准。

## 7. 验收证据

自动验收覆盖：

- 完整、有限、证据不足和提示注入四类冻结样本；
- 合法引用和伪造引用；
- 管理员私有路由与 360 秒客户端超时；
- 真实 PostgreSQL 完整迁移和四阶段执行；
- 一次 Provider 调用、零博客文章写入；
- 请求 ID 幂等且不重复计费；
- 跨 Agent 分析读取拒绝；
- 回答账本 UPDATE 被数据库触发器拒绝；
- 引用可恢复原文片段与页码定位。

## 8. 明确未完成

- DOI 和用户文件的安全本地取得；
- OCR、表格、公式和图像语义；
- 多论文可比性与对比问答；
- 需要新资料的“继续研究后回答”；
- 论文导读生成、独立审核和公开发布治理；
- 读者公开追问。

这些能力必须注册新的工作流、预算和权限，不能通过扩写 R1.5 提示词获得。
