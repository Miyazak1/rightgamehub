# 小墨鱼 Agent 基座架构设计

版本：F0-D2\
状态：目标架构与兼容迁移设计；尚未全部实现，不得将本文目标描述为线上现状\
更新日期：2026-10-24\
关联文档：

- [小墨鱼能力升级路线](./xiaomoyu-capability-roadmap.zh-CN.md)
- [小墨鱼 Agent 基座 F0 实施蓝图](./xiaomoyu-agent-foundation-f0-blueprint.zh-CN.md)
- [小墨鱼论文阅读机制设计](./xiaomoyu-paper-reading-design.zh-CN.md)
- [Agent 账号基础](./agent-account-foundation.md)
- [Agent 自动写作与发布](./agent-blog-automation.md)
- [Agent 能力层完整实施设计](./80-agent-capability-layer-implementation.zh-CN.md)
- [墨鱼变更雷达自主长期研究系统](./change-radar-autonomous-research-design.zh-CN.md)

## 1. 结论

小墨鱼不应继续以“自动博客功能”作为架构中心。当前自动选题、写作、审核、发布和追问闭环，应重新定义为验证产品价值的第一个纵向切片；长期基座必须能够同时承载：

- GitHub 项目研究；
- 论文阅读与多论文比较；
- 网页和长期专题研究；
- 游戏、工具和课件的发现与使用；
- 受控项目运行；
- 文章、报告、问答和社区内容；
- 未来其他人格化 Agent。

目标不是构建一个允许模型任意循环、任意调用内部 API 的“万能 Agent”。目标是建立一套**身份明确、能力注册、任务持久、证据可追溯、工具受控、预算有界、输出可审核**的 Agent Runtime。

小墨鱼只是运行在基座上的第一个 Agent 配置：

```text
小墨鱼 = Agent 身份
       + 人格版本
       + 能力授权
       + 工作流配置
       + 预算和策略
       + 长期研究与编辑记忆
```

博客、论文、游戏和工具都不是身份本身，而是可独立演进的能力与工作流。

## 2. 当前系统判断

### 2.1 已有可复用资产

| 现有资产 | 当前职责 | 基座定位 |
| --- | --- | --- |
| `users.account_type=agent`、`agent_accounts` | Agent 身份、运营方、状态和能力数组 | 身份与治理基线，保留并扩展 |
| `agent_execution_principals` | QA 执行主体和轮换凭据 | 非交互执行主体基线，保留专用边界 |
| `agent_behavior_profiles` | 通用人格与编辑模块版本 | Agent 配置版本基线，扩展为多能力模块 |
| `agent_provider_secrets` | 每 Agent 的 DeepSeek 加密 Key | Provider 凭据基线，通过网关封装并逐步版本化 |
| `agent_blog_runs` | 博客排队、生成、检查与发布状态 | 纵向切片运行表，后续迁移到通用工作流运行时 |
| `tool_research_*` | 专题、来源版本、证据、结论、缺口、预算、租约 | 统一研究证据和长期研究的重要基线 |
| `research_qa_*` | 委托、预算预留、回执与防重放 | 高约束委托执行模式参考，不并入普通聊天 |
| `@gamehub/agent-capabilities` | 对外 MCP 能力注册与安全投影 | 对外能力目录，不能直接充当内部执行权限 |
| 博客、公开主页和追问 | 产品输出与用户交互 | 输出适配器和交互工作流的首个实现 |

### 2.2 结构性缺口

当前系统仍由多条纵向链路分别处理任务、外部调用、预算和恢复：

- 博客运行只有粗粒度状态，没有租约、阶段水位和崩溃恢复；
- 模型调用嵌在博客 writer 中，选题、生成、审核没有独立调用账本；
- 研究系统已经实现更成熟的租约、`unknown`、预算和熔断，但只服务研究任务；
- MCP 能力注册表面向外部宿主发现和启动，不代表小墨鱼内部可以自动调用该能力；
- GitHub 文章引用、变更雷达证据和未来论文证据尚未统一成稳定跨产品契约；
- 人格模块已可扩展，但工具权限、研究权限和发布权限仍缺少统一策略决策；
- 编辑历史、研究事实、用户互动和运行日志尚未形成类型化记忆边界。

### 2.3 当前 R0 重新命名

现有 R0 改称：

> **V0 自动作者纵向验证版**

它证明 Agent 身份、Key、人格、选题、引用、审核、发布和追问可以形成产品闭环，但不证明通用基座已经完成。

只有当博客工作流迁移到通用持久运行时，并通过崩溃恢复、外部调用水位、证据复用、权限和多实例验收后，才能宣布 **Foundation V1** 完成。

## 3. 架构原则

1. **Agent 是身份，不是业务表前缀**：业务能力通过授权和工作流绑定到 Agent。
2. **模型不直接改变外部状态**：模型只能提出结构化候选，由服务端策略和适配器提交。
3. **工作流显式，循环有界**：不提供不可审计的自由 Agent Loop。
4. **外部调用没有“恰好一次”幻想**：持久化发送水位，区分未发送、已发送、完成与未知。
5. **证据是事实来源，模型输出不是**：所有重要结论可以回到不可变资料版本。
6. **人格不授予权限**：人格影响偏好和表达，权限由治理层决定。
7. **对外能力与内部权限分离**：MCP 可发现不等于小墨鱼可自主执行。
8. **PostgreSQL 是事实来源**：Redis、搜索索引和向量索引均可重建。
9. **先模块化单体，后按压力拆服务**：先冻结边界和数据所有权，不提前微服务化。
10. **增加式迁移，不推倒重来**：保留历史审计和既有接口，以适配器逐步迁移。
11. **默认只读、失败关闭**：新增外部写入和代码执行必须提高风险等级并单独验收。
12. **自动不等于无治理**：不依赖逐篇人工审核，但必须有确定性规则、独立审核和可撤回能力。

## 4. 总体架构

```text
┌────────────────────────────────────────────────────────────┐
│                         产品与宿主                          │
│ Web / Admin / MCP Hosts / API / Workers / Future Clients   │
└─────────────────────────────┬──────────────────────────────┘
                              │
┌─────────────────────────────▼──────────────────────────────┐
│                       Agent Control Plane                   │
│ Identity · Profiles · Grants · Policies · Schedules · UI   │
└───────────────┬──────────────────────────────┬─────────────┘
                │                              │
┌───────────────▼──────────────┐  ┌────────────▼─────────────┐
│ Durable Agent Runtime        │  │ Capability & Policy      │
│ Run · Stage · Lease · Event  │  │ Registry · Grant · Risk  │
│ Action · Outbox · Recovery   │  │ Budget · Confirmation    │
└───────────────┬──────────────┘  └────────────┬─────────────┘
                │                              │
┌───────────────▼──────────────────────────────▼─────────────┐
│                      Execution Plane                       │
│ Provider Gateway · Tool Runtime · Sandbox · Local Node     │
└───────────────┬──────────────────────────────┬─────────────┘
                │                              │
┌───────────────▼──────────────┐  ┌────────────▼─────────────┐
│ Research & Memory Plane      │  │ Output Adapters          │
│ Artifact · Version · Evidence│  │ Blog · Paper · QA        │
│ Claim · Gap · Relations      │  │ Community · Notifications│
└──────────────────────────────┘  └──────────────────────────┘
```

### 4.1 控制面

管理相对低频、需要版本和授权的配置：

- Agent 身份和运营关系；
- 人格与能力配置版本；
- 能力授权；
- Provider 凭据；
- 工作流启停；
- 调度计划；
- 预算和风险策略；
- 管理后台和审计。

### 4.2 数据面

执行高频、可恢复的工作：

- 工作流和阶段领取；
- 模型请求；
- 搜索、抓取、PDF、GitHub 与沙箱工具；
- 研究证据与结论；
- 输出生成、检查和发布；
- 事件与指标。

控制面更新只影响之后创建的新运行。运行创建时冻结相关版本，避免管理员修改配置后悄悄改变已排队任务。

## 5. 领域与数据所有权

| 领域 | 唯一职责 | 不拥有 |
| --- | --- | --- |
| Agent Identity | 身份、状态、运营者、公开身份 | 工作流、研究结论、模型结果 |
| Agent Configuration | 人格与能力模块版本 | 权限授予、外部凭据 |
| Capability Governance | 能力定义、授权、风险、策略 | 具体工具实现和内容正文 |
| Durable Runtime | 运行、阶段、租约、动作、恢复 | 业务证据语义和页面呈现 |
| Provider Gateway | 模型目录、凭据引用、调用水位、用量 | 人格和业务发布决策 |
| Tool Runtime | 工具执行、输入输出摘要、资源边界 | 任意权限提升和直接发布 |
| Research Ledger | 资料、版本、证据、结论、缺口和关系 | Agent 身份与 UI 状态 |
| Memory | 类型化长期状态和检索投影 | 无来源自由文本事实 |
| Output | 草稿、验证、发布、修订和撤回 | 模型调用和工具权限 |
| Observability | 事件、指标、告警和运营视图 | 业务事实的唯一副本 |

一个事实只允许一个领域成为权威来源。其他领域通过 ID 或不可变摘要引用，不能复制后独立修改。

## 6. Agent 身份与配置

### 6.1 身份

沿用 `users.account_type='agent'` 和 `agent_accounts`，但长期需要解决当前能力数组每增加一项都修改数据库约束的问题。

目标是增加关系型授权：

```text
agent_capability_grants
  agent_user_id
  capability_id
  capability_version_range
  grant_status
  policy_profile_id
  granted_by_user_id
  valid_from / valid_until
  created_at / revoked_at
```

现有 `agent_accounts.capabilities` 在迁移期作为兼容投影，不再作为新能力的唯一事实来源。

### 6.2 人格与行为

沿用不可变 `agent_behavior_profiles`，保持：

- `core`：使命、性格、表达风格、目标读者；
- `modules.editorial`：选题与写作；
- `modules.research`：研究偏好和证据态度；
- `modules.paperReading`：论文阅读深度和解释风格；
- `modules.toolUse`：工具选择偏好，不包含授权；
- `modules.interaction`：追问、社区和反馈风格。

每个工作流只读取声明需要的模块。工具权限、最大成本和安全边界不进入人格文案。

### 6.3 执行主体

区分三类主体：

- `human_session`：登录用户请求；
- `agent_runtime`：平台内自主 Agent；
- `agent_execution`：受限外部或本地节点执行主体。

执行主体不能冒充登录用户。每次运行必须同时记录业务 Agent、发起主体、费用承担者和资源所有者，四者不能隐式等同。

## 7. 能力注册与授权

### 7.1 两种能力面

现有 `@gamehub/agent-capabilities` 面向外部 MCP Host，解决“用户让外部 Agent 发现并启动墨鱼工坊内容”。新基座还需要内部运行能力面，解决“小墨鱼能否自主使用某个能力”。

两者可以共享 ID、标题、Schema 和风险标签，但授权不同：

```text
External Capability
  用户通过 ChatGPT/Codex 主动调用

Internal Agent Capability
  小墨鱼在持久工作流中自主调用
```

一个外部公开工具不会因为出现在 MCP 注册表中，就自动获得内部 Agent 授权。

### 7.2 能力契约

```json
{
  "id": "research.paper.read",
  "version": "1.0.0",
  "executionKind": "tool",
  "inputSchemaRef": "paper-read-request-v1",
  "outputSchemaRef": "paper-evidence-package-v1",
  "riskTier": "external-read",
  "sideEffect": "none",
  "retryPolicy": "before-send-only",
  "dataClasses": ["public-paper", "user-document"],
  "requiredScopes": ["research:paper"],
  "budgetClass": "research-medium",
  "adapter": "paper-reader-v1"
}
```

禁止注册 `invoke_anything`、`call_internal_api`、`execute_shell` 等万能能力。能力必须表达稳定用户目标和明确资源边界。

### 7.3 风险等级

| 等级 | 示例 | 自主策略 |
| --- | --- | --- |
| L0 确定性本地转换 | 解析、校验、哈希 | 可自动执行 |
| L1 公共外部只读 | 搜索、公开网页、开放论文 | 有预算和域名策略后自动执行 |
| L2 用户或账号私有只读 | 用户 PDF、私有项目 | 需要对象级授权，不进入公共输出 |
| L3 隔离执行 | 第三方仓库、模型代码 | 仅沙箱、资源上限和专用工作流 |
| L4 外部写入 | 发帖、评论、修改第三方系统 | 不纳入首版自主执行 |
| L5 交易与高影响操作 | 支付、购买、权限管理 | 禁止 Agent 自主执行 |

## 8. 持久工作流运行时

### 8.1 工作流定义

工作流由代码中的不可变 Manifest 定义，数据库保存运行时冻结快照。Manifest 至少包含：

- `workflowKey` 与版本；
- 输入输出 Schema；
- 阶段有向无环图；
- 每个阶段所需能力；
- 可重试策略；
- 最大执行时间；
- 最大模型和工具调用数；
- 发布或外部副作用阶段；
- 补偿和终止策略。

首版不支持任意动态 DAG。只有通过代码评审和契约测试的工作流才能注册。

### 8.2 通用运行对象

建议增加：

```text
agent_runs
agent_run_stages
agent_run_actions
agent_run_events
agent_schedules
agent_runtime_outbox
```

`agent_runs` 冻结：

- Agent、发起者、费用承担者；
- 工作流 Key、版本和摘要；
- 人格版本；
- 能力授权快照；
- 策略版本与预算；
- 输入摘要和幂等键；
- 总体状态和输出引用。

大型正文、PDF 和模型完整响应不进入通用运行行；它们保存在对应领域或受控对象存储中，运行表只保存引用和哈希。

### 8.3 运行状态

```text
queued
  → active
  → waiting
  → checking
  → completed
```

终态：

- `completed`：工作流完成，未必公开发布；
- `rejected`：质量、证据或策略明确拒绝；
- `failed`：确定失败且知道外部结果未产生或已经结算；
- `unknown`：外部动作可能执行，不能自动重发；
- `cancelled`：在安全边界内取消；
- `expired`：未开始或未发送阶段超过有效期。

产品状态如 `published`、`withdrawn` 属于输出领域，不应污染所有通用运行状态。

### 8.4 阶段状态

```text
pending → ready → leased → running → completed
                         ├→ waiting_external
                         ├→ failed
                         ├→ unknown
                         ├→ skipped
                         └→ cancelled
```

每个阶段拥有：

- `stage_key`；
- 输入哈希；
- 状态与尝试次数；
- `attempt_id`；
- `leased_by` 和 `lease_until`；
- 输出引用与哈希；
- 错误；
- 开始、完成与更新时间。

状态更新必须检查 `attempt_id` 和有效租约，过期 Worker 不能覆盖新尝试结果。

### 8.5 租约与恢复

- Worker 领取阶段时原子取得租约；
- 长任务定期续租；
- 未发送外部请求的过期阶段可以安全重新排队；
- 已发送但没有可信回执的阶段进入 `unknown`，不自动重发；
- 纯确定性阶段可以由新尝试重新执行；
- 运行由阶段终态聚合，不依赖进程内全局变量；
- 多 API 和多 Worker 实例必须依赖数据库锁与约束，而不是本机锁。

优先复用现有 `tool_researcher_jobs` 的租约、attempt、过期回收和公平领取经验，不直接复制其专题专用字段。

### 8.6 调度

`agent_schedules` 统一支持：

- 日历时间和时区；
- 间隔；
- 手动运行；
- 事件触发；
- 前序运行完成后触发；
- 最大并发；
- 追赶策略；
- 暂停和下次运行时间。

每天北京时间 10:00 的博客策略成为一个工作流调度配置，不再由博客表独占调度语义。

调度到期只创建具有幂等键的运行，不直接执行模型或发布。

### 8.7 Outbox

创建运行、推进阶段和唤醒 Worker 使用事务 Outbox：

- 业务状态和待投递事件同事务提交；
- 投递器可以重复投递；
- 消费者按事件 ID 幂等；
- Outbox 不是外部调用成功证明；
- 外部调用仍需独立发送水位。

## 9. 外部动作账本

### 9.1 通用动作

`agent_run_actions` 记录所有有成本或外部影响的动作：

- Provider 模型调用；
- 搜索和网页读取；
- PDF/OCR；
- GitHub API；
- 沙箱运行；
- 发布、通知或未来外部写入。

动作状态：

```text
reserved → prepared → sent → completed
                    ├→ failed
                    ├→ unknown
                    └→ skipped
```

### 9.2 发送边界

外部调用前必须原子完成：

- 权限复核；
- 预算预约；
- 熔断检查；
- 动作记录；
- 请求摘要冻结；
- 唯一动作键占用。

刚要发送时写入 `sent_at`。只有可信响应才能进入 `completed` 或确定 `failed`。发送后连接中断、超时或进程退出进入 `unknown`。

### 9.3 重试

允许自动重试的情况：

- 明确尚未发送；
- 动作为确定性本地操作；
- 远端支持并验证了同一幂等键；
- 已取得可信 `not_found` 或未执行证明。

禁止仅根据 HTTP 客户端异常假设远端没有执行。

## 10. Provider Gateway

### 10.1 职责

- 供应商适配；
- 凭据解密与用途绑定；
- 模型目录；
- 结构化输出；
- 请求上限；
- 用量与成本；
- 请求 ID；
- 超时与错误映射；
- 月度预算；
- 熔断与半开探针；
- 调用账本。

业务工作流不得直接构造供应商 HTTP 请求。

### 10.2 凭据

长期凭据对象需要表达：

- Agent；
- Provider；
- 用途范围；
- 密文和密钥版本；
- 指纹和后四位；
- 状态；
- 创建、轮换和撤销者；
- 有效期；
- 最近验证时间。

迁移期继续读取 `agent_provider_secrets`，由 Gateway 适配；不要求立即重写历史密文。

### 10.3 模型选择

工作流声明能力要求，而不是散落硬编码模型名：

```json
{
  "taskClass": "structured-generation",
  "requiresJsonSchema": true,
  "maxInputTokens": 50000,
  "maxOutputTokens": 6000,
  "maxCostMicrousd": 50000,
  "latencyClass": "batch"
}
```

控制面可以将要求解析到具体模型。实际模型 ID、Provider、参数和策略版本冻结在动作记录中。

### 10.4 输出验证

- 模型响应只进入候选结果；
- 必须通过完整 JSON、Schema 和大小校验；
- 引用、资源 ID 和工具名重新映射到服务端已知对象；
- 模型不能提交任意 URL、SQL、文件路径或权限；
- 独立审核使用独立动作，不把写作模型自评当成审核。

## 11. Tool Runtime

### 11.1 适配器

工具适配器实现已注册能力，禁止字符串反射任意内部函数。适配器定义：

- 输入和输出校验；
- 执行主体；
- 网络和文件策略；
- 资源上限；
- 取消和超时；
- 动作水位；
- 日志清洗；
- 结果持久化位置。

### 11.2 执行环境

| 环境 | 用途 | 边界 |
| --- | --- | --- |
| API 内确定性执行 | 哈希、Schema、轻量转换 | 无外网、短时、无用户代码 |
| Server Worker | 搜索、抓取、Provider 调用 | 受控外网、租约、预算 |
| Local Node | 用户机器上的私有或重资源任务 | 账号绑定、租约、结果签名 |
| Sandbox Worker | 第三方代码和不可信解析 | 一次性容器、默认断网、无生产凭据 |
| Client-only UI | 本地 PDF、文档和隐私工具 | 数据默认不上传，结果显式提交 |

### 11.3 沙箱

L3 能力至少要求：

- 固定输入摘要和代码版本；
- 无 Docker socket；
- 无宿主工作区和生产卷；
- 无生产环境变量；
- 只读基础镜像；
- 临时文件系统；
- CPU、内存、磁盘、进程、时间上限；
- 默认断网；
- 输出文件类型和大小白名单；
- 完成后销毁；
- 日志与产物哈希。

## 12. 研究证据内核

### 12.1 统一原语

统一研究内核包含：

- `ResearchTopic`：长期问题和契约；
- `ResearchArtifact`：仓库、网页、论文或文件的稳定身份；
- `ArtifactVersion`：不可变资料版本；
- `EvidenceSpan`：可定位短证据；
- `ResearchClaim`：有限结论；
- `ClaimRevision`：结论修订；
- `ClaimEvidence`：支持、反对或背景；
- `ResearchGap`：未知项；
- `ArtifactRelation`：论文—代码、同类项目、版本和引用关系。

这些是逻辑契约。实施时优先映射现有 `tool_research_*` 表，不新建语义重复账本。

### 12.2 证据作用域

证据必须记录：

- 所有者和账号；
- 来源和资料版本；
- 访问等级；
- 是否允许公共输出；
- 保留策略；
- 提取方法和置信度；
- 内容哈希；
- 创建运行。

共享底层结构不代表跨用户、跨 Agent 或跨专题自动共享证据。复用必须通过权限检查和明确绑定。

### 12.3 博客迁移

当前博客引用已经保存 GitHub URL、访问时间、README 定位和短摘录。迁移时：

- 新运行先把 GitHub 仓库和 README 写成资料版本与证据；
- 文章引用保存 Evidence ID 和展示快照；
- 已发布旧文章不改写；
- 可以离线建立旧 citation 到新 Evidence 的映射，但不伪造当时未保存的信息；
- 文章仍保留冻结引用，研究账本后续更新不能静默改变已发布正文。

## 13. 类型化长期记忆

### 13.1 记忆类型

| 类型 | 来源 | 权威存储 |
| --- | --- | --- |
| Identity Memory | Agent 身份与运营关系 | Agent Identity |
| Persona Memory | 人格和模块版本 | Agent Configuration |
| Research Memory | 资料、证据、结论和缺口 | Research Ledger |
| Editorial Memory | 已写对象、角色、主题、观点和冷却 | Editorial Ledger |
| Interaction Memory | 用户与 Agent 的有界互动 | Conversation/QA Ledger |
| Episodic Memory | 运行、动作、失败和成本 | Durable Runtime |
| Preference Projection | 从合规反馈计算的偏好 | 可重建派生表 |

### 13.2 禁止“万能记忆表”

不建立允许模型自由写入的 `agent_memories(text, embedding)` 作为事实来源。任何长期记忆都必须具有类型、来源、作用域、有效期、权限和撤销方式。

### 13.3 语义索引

全文索引和向量索引仅用于召回候选 ID：

- 可以删除并重建；
- 不保存唯一事实；
- 返回结果后重新执行权限和版本检查；
- 模型只读取有限、已授权的原始记录；
- 索引相似度不能自动合并实体或结论。

## 14. 策略、预算与治理

### 14.1 策略输入

```json
{
  "agentId": "uuid",
  "principal": "agent_runtime",
  "capability": "research.paper.read",
  "resource": {"type": "paper", "owner": "public"},
  "workflow": "paper-guide-v1",
  "trigger": "schedule",
  "riskTier": "external-read",
  "estimatedCost": {"requests": 3, "microUsd": 40000}
}
```

### 14.2 策略输出

```json
{
  "decision": "allow",
  "policyVersion": "agent-policy-v1",
  "limits": {
    "maxProviderCalls": 4,
    "maxToolCalls": 8,
    "maxCostMicrousd": 50000
  },
  "requiredChecks": ["evidence", "independent-review"]
}
```

决策可以是 `allow`、`deny` 或 `requires_human_confirmation`。自主调度只能执行 `allow`；需要确认的动作不能通过人格或模型输出自动升级。

### 14.3 预算

预算分层：

- 每动作；
- 每运行；
- 每工作流；
- 每 Agent 日/月；
- 每账号日/月；
- 全局部署月度上限。

外部请求发送前预约预算，按照预计和实际中的保守较大值结算。`unknown` 保留占用，除非取得可信闭合证明。

### 14.4 熔断

Provider 和外部工具共享可复用的熔断原语，但按供应商和能力隔离：

- 连续可重试失败打开；
- 冷却后只允许单个半开探针；
- 非重试型输入错误不计入供应商故障；
- 探针未知结果重新打开；
- 控制面显示保护状态，不承诺供应商 SLA。

## 15. 输出适配器

### 15.1 通用输出流程

```text
研究或工具结果
  → 产品草稿
  → Schema 校验
  → 证据绑定
  → 产品规则检查
  → 独立审核
  → 发布事务
  → 修订/撤回
```

模型输出不能直接执行发布 SQL。

### 15.2 输出类型

- 博客文章；
- 论文导读；
- 项目对比；
- 研究报告；
- 站内回答；
- 项目/论文卡片；
- 通知；
- 未来社区内容。

每类输出拥有独立 Schema、检查、发布权限和展示组件。不能把博客的中文标题规则直接套到论文标题，也不能把论文证据要求降低为普通推荐文案。

### 15.3 发布权限

发布是 L4 外部写入，但可以由经过专门授权的固定工作流自动完成。授权针对：

- Agent；
- 输出类型；
- 目标站点；
- 工作流版本；
- 必须通过的检查；
- 频率和预算。

它不是通用 `write:anywhere` 权限。

## 16. 交互与追问

交互任务复用运行时和证据，而不是每种文章另写一套调用逻辑。

首要模式：

- `answer-from-frozen-evidence`：根据当前输出和冻结证据回答；
- `continue-research`：创建新的研究工作流；
- `run-tool`：进入工具任务并返回状态；
- `explain-decision`：解释选题、证据和限制，不暴露密钥或系统提示。

同步 HTTP 只负责创建任务、读取状态或返回已经完成的小结果。长任务必须异步。

## 17. 可观测性与运营

### 17.1 运行时间线

后台展示：

- 触发来源；
- 冻结配置；
- 每个阶段状态和耗时；
- 能力和适配器版本；
- 外部动作水位；
- 用量和费用；
- 证据数量与覆盖率；
- 拒绝、失败和未知原因；
- 输出和撤回关系。

### 17.2 关键指标

- 调度器和 Worker 心跳；
- 队列深度和年龄；
- 租约过期和恢复数量；
- `unknown` 动作数量；
- Provider/工具成功率和熔断状态；
- 每 Agent、工作流和能力成本；
- 发布、拒绝、撤回和纠错率；
- 证据覆盖率；
- 重复主题和项目率；
- 提示注入、安全和权限拒绝数量。

### 17.3 日志

日志禁止包含：

- 明文 Key 和 Authorization；
- 用户私有正文；
- 完整 PDF；
- 完整模型输入输出；
- 宿主凭据和沙箱令牌。

使用 ID、哈希、长度、错误码和有限清洗摘要定位问题。

## 18. 安全边界

### 18.1 提示注入

- 所有外部正文、README、论文、工具输出和用户作品都是数据；
- 工具选择来自注册表；
- 参数重新由服务端校验；
- 外部内容不能改变能力授权、预算和系统提示；
- 模型不能生成可执行适配器 ID 或任意 URL 绕过注册表。

### 18.2 多租户

- 每条研究、记忆、任务和证据记录具有资源所有者；
- 查询通过数据库条件和服务层双重隔离；
- 公共资料可以复用内容哈希，但不能复用私有授权；
- Agent 与运营者关系不能推导其他用户数据访问权。

### 18.3 密钥

- 浏览器只在设置时提交明文；
- 服务端加密保存；
- 解密只发生在 Provider Gateway 的实际调用边界；
- 工具和模型输入不包含密钥；
- 沙箱与本地节点不取得生产 Provider Key；
- 轮换和撤销只追加审计。

### 18.4 外部写入

外部写入必须具有：

- 专用能力；
- 对象级授权；
- 明确副作用；
- 幂等键；
- 发送水位；
- 回执；
- 撤回或补偿路径；
- 频率限制。

## 19. 兼容迁移方案

### 19.1 不做大爆炸迁移

保留现有博客、研究和 QA 业务表。新基座先作为兼容层接入，再逐步迁移权威职责。

### 19.2 迁移阶段

#### M0：资产映射与 ADR

- 冻结本文领域边界；
- 为现有表、服务和接口建立所有权矩阵；
- 明确复用、扩展、兼容和退役对象；
- 冻结运行、阶段、动作、能力和策略 Schema；
- 不改线上行为。

#### M1：通用运行时与 Provider Gateway

- 新增通用运行、阶段、动作、事件和 Outbox；
- 封装现有 DeepSeek 调用；
- 加入租约、发送水位、预算和熔断；
- 建立后台时间线；
- 不迁移发布权。

#### M2：博客影子运行

- 同一手动触发创建旧博客运行和新基座影子运行；
- 新基座不调用真实 Provider 或不发布，只验证状态和输入冻结；
- 比较配置、选题输入、费用预算和终态；
- 不双重计费。

#### M3：博客单 Agent 灰度

- 仅小墨鱼切换到新运行时；
- 旧 `agent_blog_runs` 保留兼容投影或外键引用；
- 新工作流完成选题、生成、审核和发布；
- 验证重启、多实例和故障注入；
- 支持快速切回旧调度，但不重发未知动作。

#### M4：研究证据接入

- 新文章来源写入统一研究账本；
- 文章保存 Evidence ID 和冻结展示快照；
- 旧文章保持不变；
- 后台显示证据覆盖率和来源版本。

#### M5：论文工作流

- 论文身份、PDF 和证据适配器；
- 运行在同一通用工作流、Provider、Tool、预算和输出基座上；
- 不增加论文专用任务调度和模型账本。

### 19.3 数据迁移原则

- 历史审计不重写；
- 新表只追加；
- 旧 ID 通过绑定表或外键引用；
- 无法证明的旧数据不回填；
- 迁移和双写必须幂等；
- 切换权威来源前先完成回读与一致性验证；
- 删除旧表属于后续独立决策，不在 Foundation V1 中进行。

## 20. 工作流示例

### 20.1 自动项目文章

```text
schedule
  → discover_candidates
  → resolve_repository_identity
  → acquire_readme_evidence
  → select_topic
  → generate_article
  → deterministic_check
  → independent_review
  → publish_blog
```

### 20.2 论文导读

```text
manual/event/schedule
  → resolve_paper_identity
  → check_access
  → acquire_version
  → parse_layout
  → extract_evidence
  → read_method
  → read_experiments
  → read_limitations
  → generate_paper_guide
  → evidence_check
  → independent_review
  → publish_paper_article
```

### 20.3 用户追问

```text
question
  → bind_publication_revision
  → authorize_evidence_snapshot
  → reserve_quota
  → answer_from_frozen_evidence
  → map_citations
  → persist_receipt
```

长问题若选择“继续研究”，创建新的研究运行，不在问答阶段偷偷联网。

### 20.4 游戏和工具

```text
user_intent
  → search_external_capability_registry
  → policy_decision
  → launch UI or create internal tool run
  → return structured status
```

“打开游戏”和“小墨鱼自主运行项目”属于不同风险和执行路径。

## 21. API 和内部端口

HTTP 不是领域边界本身，但需要稳定端口：

```text
AgentControlService
  getAgent / updateProfile / grantCapability / suspend

AgentRunService
  createRun / getRun / cancelRun / listTimeline

AgentScheduleService
  configure / pause / resume / triggerNow

ProviderGateway
  listModels / validateCredential / reserveAndInvoke

ToolRuntime
  prepare / execute / settle / inspect

ResearchLedger
  resolveArtifact / appendVersion / appendEvidence / reviseClaim

OutputService
  validateDraft / publish / withdraw
```

服务端内部端口接收已认证主体，不接受浏览器传入的角色标志。大型输出通过资源 ID 访问，不直接塞入运行响应。

## 22. 评测与测试

### 22.1 契约测试

- Workflow Manifest 严格 Schema；
- 能力注册唯一、不可变和安全投影；
- 人格模块不包含权限字段；
- 输出 Schema 和证据引用边界；
- 兼容 API 响应。

### 22.2 状态机测试

- 所有合法迁移；
- 非法终态回退；
- 过期租约；
- 旧 attempt 回写；
- 取消、超时和未知；
- 阶段依赖；
- 重复 Outbox 和事件消费。

### 22.3 真实 PostgreSQL 并发测试

- 多 Worker 只领取一次；
- 每 Agent 和全局容量；
- 调度幂等；
- 预算并发竞争；
- Provider 半开单探针；
- 发布事务断线；
- 迁移重复运行；
- API 重启后恢复。

### 22.4 故障注入

在每个关键边界注入中断：

- 创建运行前后；
- 取得租约前后；
- 外部调用发送前、发送后、回执前、回执后；
- 保存模型结果前后；
- 发布事务提交前后；
- Outbox 投递前后；
- Worker 续租和过期期间。

每个故障必须得到确定的可恢复、失败或未知状态，不允许永久活动任务和自动重复收费。

#### 22.4.1 当前实现证据（2026-10-26）

发布事务已经具备显式的 `before-commit` / `after-commit` 故障探针，并按不可变发布回执处理四种结果：

| 故障窗口 | 可验证事实 | 运行时结果 | 自动重试 |
| --- | --- | --- | --- |
| 提交前失败 | 按 Action 查不到发布回执 | Action `failed`，Stage/Run 失败关闭 | 否 |
| 提交后响应丢失 | 按 Action 查到且内容哈希、文章、修订完全一致的回执 | 恢复为成功并标记 `reconciled` | 否 |
| 同一 Action 被两个执行器并发提交 | 行锁串行化发布，后到执行器读取不可变回执 | 一个原始成功、一个幂等重放；仅一条回执和发布事件 | 否 |
| 数据库提交后发布进程立即退出 | 父进程按同一 Action 找到已提交的不可变回执 | 重启后重放恢复为成功；不重复发布 | 否 |
| Worker 租约在发布事务开始前过期 | `workerId + leaseToken + lease_until` 围栏不匹配 | 拒绝写入且不由旧 Worker 结算 Action；恢复器随后关闭或重排 Stage | 否 |
| 失败结算期间并发提交 | 第一次未找到回执、Action 终态冲突、第二次找到匹配回执 | 恢复为成功 | 否 |
| 无法查询提交结果 | 既不能证明回滚，也不能证明提交 | Action/Stage/Run 进入 `uncertain` | 否 |
| 回执与请求不一致 | 幂等键对应的文章、修订或哈希不一致 | `AGENT_BLOG_PUBLICATION_IDEMPOTENCY_CONFLICT` | 否 |

显式 `uncertain` 会把尚处于 `prepared`、`authorized` 或 `reserved` 的相关 Action 一并记为未知，避免出现“Run 未知但 Action 被记作已取消”的审计矛盾。预算和 Provider 调用按最保守水位结算。

隔离 PostgreSQL 验收会执行全部迁移，并实际验证提交前回滚为草稿、提交后响应丢失可恢复、两个独立发布仓储实例争用同一 Action 时仍只提交一次、子进程在 `COMMIT` 后立即退出后由新进程按原幂等键恢复，以及过期 Worker 被租约围栏拒绝且不能改变草稿。所有成功恢复路径都保持一条发布回执和一条发布事件。

这证明了单机隔离数据库上的事务、并发、进程边界和过期调用者围栏语义，但不等于生产容灾已经完成。Foundation V1 仍必须补齐真实连接中断、已经取得数据库锁的长事务跨越租约到期、多主机争用以及生产 canary；隔离事务测试不能替代这些验收。

### 22.5 安全测试

- README/PDF/网页提示注入；
- SSRF、重定向和私网地址；
- 任意工具和 URL 注入；
- 跨账号证据访问；
- 私有文件进入公开输出；
- 沙箱逃逸和资源耗尽；
- 日志和错误中的 Key 泄露；
- 权限和人格混淆。

## 23. Foundation V1 完成标准

只有全部满足才能宣称基座 V1 完成：

1. 小墨鱼博客工作流完全运行在通用 Run/Stage/Action 上；
2. API 或 Worker 在任意阶段重启不会永久卡住 Agent；
3. 已发送但结果未知的外部动作不会自动重发；
4. Provider Key 只由网关在调用边界解密；
5. 模型和工具调用具有独立预算、用量、请求 ID 和终态；
6. 能力注册、授权和工作流需求可以服务端验证；
7. 人格修改不能改变已排队运行或提升权限；
8. GitHub 文章证据进入统一资料版本与证据模型；
9. 已发布文章仍使用冻结引用，不被研究更新静默改变；
10. 管理后台可以看到调度、阶段、动作、费用、错误和输出时间线；
11. 真实 PostgreSQL 多实例、崩溃恢复和故障注入测试通过；
12. 现有博客、追问、MCP 能力和研究接口保持兼容；
13. 能够在不新增任务、预算和 Provider 基础设施的情况下注册论文阅读工作流；
14. 生产灰度、回滚和运行手册完成；
15. 所有目标状态与当前实现状态在文档中明确区分。

## 24. 实施路线

### F0：架构冻结与资产映射

- 完成领域对象、所有权和 Schema；
- 输出当前表到目标对象映射；
- 编写关键 ADR；
- 建立 Foundation 测试矩阵；
- 修订 R0 描述为 V0 纵向验证。

### F1：Durable Runtime

- Run/Stage/Lease/Action/Event/Outbox；
- Worker 公平领取和容量；
- 过期回收与 `unknown`；
- 调度与后台时间线。

### F2：Provider、Tool 与 Policy

- Provider Gateway；
- 凭据适配和模型目录；
- Tool Runtime；
- 能力授权；
- 预算和熔断。

### F3：博客迁移与生产验收

- 影子运行；
- 小墨鱼灰度；
- 统一证据；
- 故障注入；
- 正式切换和旧链路兼容。

### F4：论文能力验证基座

- Paper Adapter；
- PDF/OCR 工具；
- 论文工作流；
- 论文导读输出；
- 证明无需新建平行基础设施。

### F5：隔离执行与更多能力

- 项目沙箱；
- 游戏和课件使用；
- 长期专题研究；
- 高风险外部写入的独立治理。

## 25. F0 实施蓝图

下列工程契约已经沉淀在 [小墨鱼 Agent 基座 F0 实施蓝图](./xiaomoyu-agent-foundation-f0-blueprint.zh-CN.md)，开始写基座代码前仍需完成评审并将草案冻结为 v1：

1. **资产映射表**：现有表、服务、路由、Worker 与目标领域的对应关系；
2. **Workflow Manifest Schema**：工作流、阶段、能力、重试和预算；
3. **Run/Stage/Action SQL 草案**：约束、索引、租约和不可变字段；
4. **Provider Call 协议**：发送水位、回执、用量和未知状态；
5. **Tool Invocation 协议**：风险、执行环境和产物；
6. **Policy Decision Schema**：权限、预算、确认和冻结快照；
7. **Research Mapping ADR**：复用现有 `tool_research_*` 的边界；
8. **博客迁移时序图**：影子、灰度、切换和回滚；
9. **故障矩阵**：每个中断窗口的状态和恢复策略；
10. **Foundation V1 验收计划**：真实 PostgreSQL、多实例和生产 canary。

文档已经覆盖以上十项的首版可实施合同，但“写完文档”不等于 F0 已完成。合同评审、关键 ADR 签字和 Schema v1 冻结后才进入 F1。期间除安全或线上阻断问题外，不继续向旧博客运行器增加新的长期能力。
