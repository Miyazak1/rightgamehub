# 小墨鱼 Agent 基座 F0 实施蓝图

版本：F0-B1\
状态：实施前冻结草案；本文定义工程契约，不表示相关表、服务和运行时已经上线\
更新日期：2026-10-24\
上位架构：[小墨鱼 Agent 基座架构设计](./xiaomoyu-agent-foundation-architecture.zh-CN.md)\
关联路线：[小墨鱼能力升级路线](./xiaomoyu-capability-roadmap.zh-CN.md)

## 1. 这份蓝图解决什么

上位架构回答“长期要建成什么”；本文回答“第一批代码必须按什么契约施工”。它冻结 Foundation V1 的最小公共骨架，避免博客、论文、游戏和后续工具继续各自建立：

- 独立任务表；
- 独立定时器；
- 独立模型调用逻辑；
- 独立预算与重试；
- 独立证据格式；
- 独立故障恢复；
- 无法统一观察的后台页面。

F0 本身不实现业务功能。F0 通过评审以后，F1 才创建通用运行表和 Worker；博客是第一个迁移对象，论文是第一个验证“基座可复用”的新能力。

## 2. 冻结决策

### 2.1 必须统一的部分

下列能力只能有一个公共实现：

1. Run、Stage、Action、Event 的持久状态机；
2. 调度、领取、租约、续租、过期回收；
3. Provider Gateway、模型目录、密钥解密和用量计量；
4. 工具注册、授权、风险判断和执行回执；
5. 预算预留、结算、释放和熔断；
6. 外部动作发送水位与未知结果处理；
7. 工作流、人设、策略、能力授权的冻结快照；
8. 运行时间线、错误分类、告警和人工恢复入口；
9. 资料版本、证据、结论和引用的稳定公共契约。

### 2.2 必须保持领域隔离的部分

下列内容共享基座，但不能塞入一张万能表：

- 博客文章、段落、发布状态；
- 论文身份、版本、章节、图表和公式；
- GitHub 仓库、提交、Release 和代码片段；
- 游戏或工具的安装、启动、保存和运行产物；
- 用户会话、追问权限和展示状态；
- QA 高约束委托与普通自动任务。

### 2.3 明确不做

Foundation V1 不做以下事情：

- 允许模型生成任意 SQL、Shell 或内部 URL 并直接执行；
- 把 MCP 对外暴露等同于小墨鱼获得内部调用权限；
- 用一个无限增长的 JSON 保存全部执行上下文；
- 对已经 `sent` 但结果未知的写操作自动重试；
- 在工作流运行途中静默切换人格、模型、权限或发布策略；
- 为“更智能”取消预算、证据、风控或发布门禁；
- 一次性替换现有博客和研究链路。

## 3. 当前资产到目标对象的映射

| 当前资产 | Foundation V1 处理 | 目标所有者 | 兼容要求 |
| --- | --- | --- | --- |
| `users.account_type=agent` | 保留 | Identity | Agent 仍是真实站内账号 |
| `agent_accounts` | 保留并减少直接承载能力枚举 | Identity | 旧 `capabilities` 只作兼容投影 |
| `agent_execution_principals` | 保留 | Identity / Delegation | QA 主体不得被普通运行时冒用 |
| `agent_account_events` | 保留 | Identity Audit | 继续只追加 |
| `agent_behavior_profiles` | 保留并扩展模块 Schema | Profile | 已创建版本不可变 |
| `agent_behavior_profile_assignments` | 保留 | Profile | 只影响新运行 |
| `agent_provider_secrets` | 保留为第一版密钥存储适配器 | Provider Gateway | 业务代码不得直接解密 |
| `agent_blog_automation_settings` | 兼容读写，逐步投影到 Schedule + Workflow Config | Blog Adapter | 旧后台在切换期可用 |
| `agent_blog_runs` | 保留为博客领域投影 | Blog Adapter | 新运行必须关联通用 `agent_runs` |
| `tool_research_*` | 保留并作为研究证据内核起点 | Research | 不复制证据到 Run JSON |
| `research_qa_*` | 保留独立 | QA Delegation | 只复用通用审计概念，不合表 |
| `@gamehub/agent-capabilities` | 保留为外部 MCP 能力目录 | External Capability Surface | 不直接授予内部权限 |
| 博客公开页与追问 | 保留为 Output / Interaction Adapter | Blog / Interaction | 公共运行时不得依赖页面组件 |

迁移完成后的关系应是：

```text
agent_accounts
  ├─ agent_behavior_profiles             冻结人格版本
  ├─ agent_capability_grants              内部能力授权
  ├─ agent_schedules                      触发计划
  └─ agent_runs                           通用执行记录
       ├─ agent_run_stages
       │    └─ agent_run_actions
       ├─ agent_run_events
       ├─ agent_runtime_outbox
       └─ domain output reference         指向文章、报告或其他领域对象
```

## 4. 名词和稳定标识

| 名词 | 含义 | 稳定标识 |
| --- | --- | --- |
| Agent | 站内真实身份及其治理关系 | `agent_user_id` |
| Workflow | 可部署的有向阶段定义 | `workflow_key + workflow_version` |
| Run | 一次冻结配置后的工作流执行 | `run_id` |
| Stage | Run 内可恢复的确定性步骤 | `run_id + stage_key` |
| Action | Stage 内一次有外部副作用或费用的调用 | `action_id` |
| Schedule | 产生 Run 的持久计划 | `schedule_id` |
| Capability | Agent 可申请、策略可决策、适配器可执行的动作类型 | `capability_key + contract_version` |
| Provider Call | 模型或嵌入等提供商调用 | `action_id` + provider request id |
| Tool Invocation | 受控工具执行 | `action_id` + tool receipt id |
| Evidence | 对稳定资料版本中某段内容的可定位引用 | `evidence_id` |
| Output | 工作流生成并交给领域适配器的结果 | `output_type + output_id` |

规则：

- 所有跨服务引用使用稳定 ID，不依赖标题、用户名或 URL；
- `workflow_key`、`stage_key`、`capability_key` 一经发布不得换义；
- 合同语义变化必须提升版本；
- 显示名称、头像、人设文本可以版本化，但不是权限依据；
- Run 创建后保存全部关键版本和摘要，不追随“当前值”。

## 5. Workflow Manifest 契约

### 5.1 示例

```json
{
  "schemaVersion": "agent-workflow-v1",
  "workflowKey": "blog.project.single",
  "workflowVersion": 1,
  "inputSchema": "blog-project-single-input-v1",
  "outputSchema": "blog-article-draft-v2",
  "requiredCapabilities": [
    {"key": "research.github.read", "version": 1},
    {"key": "provider.text.generate", "version": 1},
    {"key": "blog.article.publish", "version": 1}
  ],
  "defaultBudget": {
    "providerCalls": 6,
    "toolCalls": 20,
    "inputTokens": 90000,
    "outputTokens": 18000,
    "wallClockSeconds": 1800
  },
  "stages": [
    {
      "key": "select-subject",
      "kind": "deterministic",
      "dependsOn": [],
      "maxAttempts": 2,
      "timeoutSeconds": 60
    },
    {
      "key": "collect-evidence",
      "kind": "tool",
      "dependsOn": ["select-subject"],
      "maxAttempts": 3,
      "timeoutSeconds": 600
    },
    {
      "key": "compose",
      "kind": "provider",
      "dependsOn": ["collect-evidence"],
      "maxAttempts": 2,
      "timeoutSeconds": 300
    },
    {
      "key": "verify",
      "kind": "deterministic",
      "dependsOn": ["compose"],
      "maxAttempts": 1,
      "timeoutSeconds": 120
    },
    {
      "key": "publish",
      "kind": "domain-write",
      "dependsOn": ["verify"],
      "maxAttempts": 1,
      "timeoutSeconds": 60
    }
  ]
}
```

### 5.2 校验规则

Manifest 注册时必须验证：

- Schema 版本受支持；
- `workflow_key + workflow_version` 唯一且不可覆盖；
- Stage key 唯一，依赖无环且全部存在；
- 至少一个终止 Stage；
- Stage 声明的能力包含在工作流能力集合内；
- 重试次数、超时和预算均有有限上界；
- 写入型 Stage 明确 `idempotencyMode`；
- 运行时支持全部能力合同版本；
- 输出 Schema 被对应领域适配器接受；
- Manifest 规范化后计算 `manifest_sha256`。

Run 保存完整 Manifest 快照或不可变版本引用以及哈希。线上更新只能注册新版本，不能修改旧版本。

## 6. 数据表草案

以下是逻辑 Schema，不是可直接上线的迁移文件。F1 编写 SQL 时仍需沿用现有仓库的长度限制、不可变触发器、外键和测试隔离方式。

### 6.1 `agent_workflow_definitions`

用途：登记已经部署且可执行的不可变工作流。

核心字段：

```text
workflow_key text
workflow_version integer
schema_version text
manifest_json jsonb
manifest_sha256 text
runtime_min_version text
status text                    draft | active | retired
created_by_user_id uuid
created_at timestamptz
PRIMARY KEY(workflow_key, workflow_version)
UNIQUE(manifest_sha256)
```

约束：`active` 版本不可更新；`retired` 只禁止创建新 Run，不影响恢复旧 Run。

### 6.2 `agent_capability_grants`

用途：替代不断扩大的 `agent_accounts.capabilities` 检查数组。

```text
id uuid
agent_user_id uuid
capability_key text
contract_version integer
scope_json jsonb
risk_ceiling text              L0 | L1 | L2 | L3 | L4 | L5
status text                    active | revoked | expired
valid_from timestamptz
valid_until timestamptz null
granted_by_user_id uuid
reason text
created_at timestamptz
revoked_at timestamptz null
```

同一能力允许多个窄 Scope，但 Run 创建时必须冻结实际命中的 grant ID、Scope 和风险上限。撤销授权阻止新动作；是否中止已经运行的 Run 由策略决定，高风险能力默认立即阻断后续动作。

### 6.3 `agent_policy_profiles`

用途：保存独立于人格的治理策略版本。

```text
id uuid
agent_user_id uuid
version integer
schema_version text
policy_json jsonb
policy_sha256 text
created_by_user_id uuid
created_at timestamptz
UNIQUE(agent_user_id, version)
```

人格表达“她是谁、喜欢什么”；策略决定“她被允许做什么”。二者绝不互相覆盖。

### 6.4 `agent_runs`

用途：一次工作流执行的权威状态。

```text
id uuid PRIMARY KEY
agent_user_id uuid
workflow_key text
workflow_version integer
manifest_sha256 text
trigger_kind text               schedule | manual | interaction | system
trigger_ref text null
idempotency_key text
status text                     queued | running | waiting | succeeded | rejected | failed | cancelled | uncertain
behavior_profile_id uuid
policy_profile_id uuid
capability_snapshot jsonb
config_snapshot jsonb
input_json jsonb
input_sha256 text
budget_json jsonb
usage_json jsonb
output_type text null
output_id uuid null
error_code text null
error_message text null
queued_at timestamptz
started_at timestamptz null
finished_at timestamptz null
created_at timestamptz
updated_at timestamptz
UNIQUE(agent_user_id, workflow_key, idempotency_key)
```

关键约束：

- 身份、工作流、人格、策略、能力、输入和预算快照在 Run 创建后不可变；
- `succeeded` 必须具有符合工作流输出契约的输出引用；
- 所有终态必须有 `finished_at`；
- `uncertain` 是终止自动推进的状态，不等于普通失败；
- 大正文、PDF、仓库快照和模型原文不得存入 `input_json`。

### 6.5 `agent_run_stages`

用途：可领取、可恢复、可独立重试的执行单元。

```text
id uuid PRIMARY KEY
run_id uuid
stage_key text
ordinal integer
kind text
status text                     blocked | queued | leased | running | waiting | succeeded | skipped | failed | cancelled | uncertain
attempt integer
max_attempts integer
available_at timestamptz
lease_token uuid null
leased_by text null
lease_until timestamptz null
input_sha256 text
output_ref_json jsonb null
error_code text null
error_message text null
started_at timestamptz null
finished_at timestamptz null
created_at timestamptz
updated_at timestamptz
UNIQUE(run_id, stage_key)
```

领取必须使用单条事务和 `FOR UPDATE SKIP LOCKED`。完成、续租和失败更新都必须同时匹配 `id + lease_token + leased_by`，避免过期 Worker 覆盖新 Worker。

### 6.6 `agent_run_actions`

用途：记录会花钱、跨网络或产生副作用的每一次动作。

```text
id uuid PRIMARY KEY
run_id uuid
stage_id uuid
action_key text
action_kind text                provider | tool | domain-write | interaction
capability_key text
contract_version integer
risk_level text
status text                     prepared | authorized | reserved | sending | sent | acknowledged | succeeded | rejected | failed | uncertain | cancelled
idempotency_key text
request_json jsonb
request_sha256 text
response_ref_json jsonb null
response_sha256 text null
provider_request_id text null
reservation_ref text null
usage_json jsonb
policy_decision_json jsonb
prepared_at timestamptz
sent_at timestamptz null
acknowledged_at timestamptz null
finished_at timestamptz null
created_at timestamptz
updated_at timestamptz
UNIQUE(stage_id, action_key, idempotency_key)
```

`request_json` 只能保存尺寸受限、已去密的规范请求；敏感头、明文 Key、完整文件和不受限模型上下文不能落库。

### 6.7 `agent_run_events`

用途：只追加时间线，不作为运行状态的唯一事实源。

```text
id bigint GENERATED ALWAYS AS IDENTITY
run_id uuid
stage_id uuid null
action_id uuid null
event_type text
actor_kind text                 system | worker | operator | agent | user
actor_ref text null
payload_json jsonb
created_at timestamptz
```

事件只允许插入。状态查询读主表，审计和排障读事件流。

### 6.8 `agent_schedules`

用途：统一每天 10 点、每周若干次和后续研究计划。

```text
id uuid PRIMARY KEY
agent_user_id uuid
workflow_key text
workflow_version integer
timezone text
schedule_spec_json jsonb
enabled boolean
next_fire_at timestamptz null
last_fire_at timestamptz null
misfire_policy text             skip | fire-once
config_json jsonb
updated_by_user_id uuid
created_at timestamptz
updated_at timestamptz
```

每个计划周期生成稳定 `idempotency_key = schedule_id + logical_fire_time`。多个调度实例竞争时最多创建一个 Run。系统停机跨过多个周期时，首版只支持跳过或补一次，禁止无上限追赶。

### 6.9 `agent_runtime_outbox`

用途：在数据库状态和异步派发之间提供事务边界。

```text
id uuid PRIMARY KEY
aggregate_type text             run | stage | action | schedule
aggregate_id uuid
event_type text
payload_json jsonb
status text                     pending | dispatching | delivered | failed
attempts integer
available_at timestamptz
lease_token uuid null
lease_until timestamptz null
delivered_at timestamptz null
created_at timestamptz
UNIQUE(aggregate_type, aggregate_id, event_type, payload discriminator)
```

Outbox 只负责可靠通知“有工作可做”，不能绕过主表状态机，也不能被当作消息历史。

## 7. 状态机

### 7.1 Run 状态

```text
queued -> running -> waiting -> running -> succeeded
   |         |          |          |
   |         |          |          +-> rejected / failed / uncertain
   |         |          +------------> cancelled
   |         +-----------------------> cancelled
   +---------------------------------> cancelled
```

规则：

- `rejected`：输入或产物被确定性规则拒绝，不自动重跑；
- `failed`：结果确定未成功，可以按工作流策略创建新 Run；
- `uncertain`：外部结果可能已发生，必须查证或人工处置；
- `cancelled`：只阻止后续动作，不能假装撤销已经发生的外部动作；
- `waiting`：等待外部回执、退避时间或交互输入，不占 Worker 租约。

### 7.2 Stage 状态

合法主路径：

```text
blocked -> queued -> leased -> running -> succeeded
                              |       \
                              |        -> waiting -> queued
                              -> failed / uncertain
```

不允许从终态回到活动态；重试通过增加 `attempt` 并重新排队，保留旧 Action 和事件。

### 7.3 Action 状态

```text
prepared -> authorized -> reserved -> sending -> sent -> acknowledged -> succeeded
    |            |            |          |       |             |
 rejected     rejected      failed    failed   uncertain      failed
```

`sending` 表示本地即将跨越网络边界；`sent` 表示请求字节已经交给客户端或得到服务端请求 ID；`acknowledged` 表示收到可核验响应。写操作在 `sending` 以后崩溃时，除非远端提供同一个幂等键查询或安全重放，默认进入 `uncertain`。

## 8. Provider Call 协议

### 8.1 调用输入

业务 Stage 只能向 Provider Gateway 提交：

```text
runId, stageId, actionId
agentUserId
modelPolicy                  能力需求，不是随意模型名
promptTemplateKey/version
boundedInputRefs
responseSchemaKey/version
tokenCeiling
timeout
```

Gateway 负责：

1. 校验 Action、授权和预算；
2. 从冻结配置解析 Provider 与模型；
3. 在调用边界解密 Key；
4. 预留调用数和 Token 预算；
5. 写入请求摘要和 `sending` 水位；
6. 调用 Provider；
7. 记录 Provider request ID、用量和响应摘要；
8. 校验结构化输出；
9. 结算或释放预算；
10. 返回规范化结果引用。

### 8.2 结构化输出

解析顺序固定为：

1. Provider 原生结构化输出；
2. 严格 JSON 解析；
3. 仅做一次无模型参与的外围清理；
4. Schema 验证；
5. 失败则按相同输入创建显式 repair Action；
6. repair 仍失败则 Stage 失败。

禁止把任意自然语言静默拼装为“看起来可用”的业务对象。原响应以受控产物保存并设置保留期，不直接进入公开页面。

### 8.3 模型回退

模型回退必须来自冻结策略：

- 只在能力等价且输出 Schema 相同的模型之间回退；
- 安全拒绝、内容违规和 Schema 语义错误不触发盲目回退；
- 每次回退是新的 Action；
- 预算按全部尝试累计；
- 文章记录最终模型和关键阶段模型，不伪装成单次调用。

## 9. Tool Invocation 协议

### 9.1 工具合同

每个内部工具注册：

```text
toolKey, contractVersion
inputSchema, outputSchema
requiredCapability
riskLevel
executionClass               in-process | worker | sandbox | remote
networkPolicy
filesystemPolicy
timeout, outputLimit
idempotencyMode              none | key | queryable
artifactTypes
```

### 9.2 执行规则

- 参数由服务端 Schema 校验，不接受模型直接构造的任意命令串；
- URL、仓库、文件和包名进入工具前再次做 allowlist / denylist 校验；
- 读取型工具也必须限制响应大小、跳转、压缩炸弹和私网地址；
- 沙箱输出先进入隔离产物区，校验后才能进入研究或发布领域；
- 工具的标准输出不是证据，只有经过来源绑定和定位后才能成为 Evidence；
- 高风险工具不能因“人格大胆”而自动提升权限。

### 9.3 与 MCP 的关系

外部 MCP 能力目录和内部 Tool Runtime 可以共用：

- 稳定 capability key；
- 输入输出 Schema；
- 风险标签；
- 展示说明。

但必须分别维护授权和执行适配器。外部宿主能发现某个游戏，不表示小墨鱼可以在服务端安装、运行或发布它。

## 10. Policy Decision 契约

每个 Action 执行前产生不可变决策：

```json
{
  "schemaVersion": "agent-policy-decision-v1",
  "decision": "allow",
  "agentUserId": "...",
  "runId": "...",
  "actionId": "...",
  "capability": {"key": "blog.article.publish", "version": 1},
  "matchedGrantIds": ["..."],
  "riskLevel": "L3",
  "constraints": {
    "resourceScope": ["blog"],
    "maxCalls": 1,
    "requiresVerifiedEvidence": true,
    "requiresHumanConfirmation": false
  },
  "policyProfileId": "...",
  "policySha256": "...",
  "decidedAt": "..."
}
```

决策只有 `allow`、`deny`、`require-confirmation` 三类。首版全自动小墨鱼只执行 `allow`；需要确认的动作进入 `waiting`，不能自动降级成允许。

策略至少检查：

- Agent 和执行主体状态；
- 能力授权版本、Scope 和有效期；
- 工作流声明；
- 资源归属；
- 风险等级；
- Run 与月度预算；
- 熔断状态；
- 证据和内容门禁；
- 是否已撤销授权或暂停 Agent。

## 11. 预算与熔断

预算分四级：

1. 平台级：全站 Provider、抓取和沙箱总量；
2. Agent 级：小墨鱼月度与每日上限；
3. Workflow 级：一次文章、论文或追问上限；
4. Action 级：单次调用 Token、时长、响应尺寸上限。

预算流程：

```text
check -> reserve -> execute -> settle
                  \-> release
```

超时但结果未知时保留保守预留，待查证或过期政策处理。失败、Schema repair 和模型回退均计入真实消耗，不能只统计成功发布。

熔断至少按 Provider、模型、工具、工作流和 Agent 维度维护。认证失败、配额不足、连续结构化输出失败、外部服务异常和内容拒绝必须分别计数，避免用同一种重试放大故障。

## 12. 研究证据映射 ADR

### 12.1 决策

不新建 `agent_evidence` 万能表。Foundation 使用稳定研究接口适配现有 `tool_research_*`，再按来源类型扩充资料适配器。

通用最小接口：

```text
registerSubject(subjectType, canonicalId, metadata)
registerSource(subjectId, sourceType, canonicalUri, trustClass)
captureVersion(sourceId, fetchedAt, contentHash, artifactRef)
extractEvidence(versionId, locator, excerptHash, excerptRef)
recordClaim(subjectId, claim, evidenceIds, confidence, status)
freezeCitationSet(outputId, evidenceIds, renderedMetadata)
```

### 12.2 所有权

- Research 拥有资料版本、证据、结论和冲突；
- Blog 拥有文章与冻结引用集合；
- Paper 拥有论文身份、版面结构、图表公式和阅读产物；
- Runtime 只保存这些对象的引用和阶段产物，不复制内容。

### 12.3 不变量

- Evidence 必须指向不可变 Source Version；
- Locator 必须能定位页码、行、段、代码路径或提交；
- 已发布文章的 Citation Set 不随研究更新改变；
- 后续资料可以把 Claim 标记为 superseded，但不能改写历史引用；
- 任何公开事实陈述都能追溯到证据或被明确标为观点。

## 13. 调度、并发与公平性

### 13.1 每天 10 点的语义

小墨鱼“每天 10 点更新”应存为 `Asia/Shanghai` 的本地逻辑时间，而不是硬编码 UTC 小时。夏令时地区使用 IANA timezone 规则计算下一次时间；同一逻辑触发时间只生成一个 Run。

### 13.2 并发上限

- 同一 Agent 同一发布型工作流默认最多一个活动 Run；
- 研究读取可有限并行，但每个 Subject 和 Source Version 需要去重键；
- 用户追问有独立低成本队列，不能饿死计划任务；
- 发布动作按 Agent 串行，避免重复内容和竞态；
- Worker 领取顺序综合优先级、`available_at` 和排队时间，不允许单 Agent 占满资源。

### 13.3 背压

Provider 或工具熔断时，新 Stage 延后而不是持续创建失败调用；积压超过阈值后暂停生成新计划 Run，并在后台显示原因。

## 14. 幂等与外部副作用

| 动作 | 幂等键 | 安全重试条件 |
| --- | --- | --- |
| 创建计划 Run | `schedule_id + logical_fire_time` | 唯一约束冲突视为已创建 |
| 选择单项目 | `run_id + selection-policy-version` | 纯数据库事务可重试 |
| 抓取 GitHub 版本 | `canonical_repo + revision` | 相同固定 revision 可重试 |
| Provider 生成 | `action_id` | 仅在明确未发送时自动重试；否则按提供商能力处理 |
| 写草稿 | `run_id + output_schema_version` | 领域表唯一键保证 |
| 发布文章 | `run_id + publish-target` | 目标支持幂等键或可查询既有发布结果时 |
| 用户追问回答 | `question_id + answer_version` | 已有回答则返回，不重复计费 |
| 启动外部工具 | `action_id` | 由具体工具合同决定，默认不可重试 |

“重复项目”规则属于选题领域约束：单项目文章发布前检查历史 canonical repo；对比文章允许引用历史项目，但必须是显式 comparison workflow，且不能伪装成新的单项目发现。

## 15. 故障窗口矩阵

| 中断窗口 | 可观察状态 | 自动恢复 | 禁止行为 |
| --- | --- | --- | --- |
| Run 事务提交前 | 无 Run | 调度器下轮重试 | 创建无幂等键 Run |
| Run 已提交、Outbox 未派发 | `queued` + pending outbox | Outbox Worker 派发 | 另建 Run |
| Stage 领取后 Worker 崩溃 | `leased/running` 且租约过期 | 回收并增加 attempt | 旧 Worker 再写终态 |
| 预算预留前崩溃 | Action `authorized` | 重试预留 | 执行外部调用 |
| 预算预留后、发送前崩溃 | Action `reserved`，无 `sent_at` | 释放或重新领取后发送 | 重复预留不结算 |
| 请求开始发送但无回执 | `sending/sent` | 只查询远端或转 `uncertain` | 对写操作盲目重发 |
| 收到响应、结果未持久化 | 有 Provider request ID/响应暂存 | 用回执恢复并校验 | 再次调用模型冒充恢复 |
| Stage 成功、下游未入队 | Stage `succeeded` + pending outbox | 重放 Outbox | 回滚已成功 Stage |
| 发布成功、数据库确认丢失 | publish Action `sent` | 按幂等键/目标查询 | 再发布一篇 |
| Agent 被暂停 | 活动 Run 任意状态 | 停止新 Action；按风险取消或等待 | 继续发布 |
| Key 被删除或轮换 | 新调用认证失败 | 阻断并告警 | 使用缓存明文 Key |
| Provider 连续结构失败 | 多个 failed Action | 打开模型/工作流熔断 | 无限 repair |

每个故障窗口都必须有自动化测试，不以“人工看日志应该能修”作为验收。

## 16. 博客迁移时序

### 16.1 阶段 A：旁路记录

- 保持旧 `agent_blog_runs` 执行；
- 为旧运行生成只读映射报告，不复制调用；
- 校验现有状态、输入和输出能否映射到新 Run/Stage；
- 不产生额外 Provider 费用或第二篇文章。

### 16.2 阶段 B：基础运行时影子

- 新 Runtime 执行到 `verify`，但 publish Stage 强制禁止；
- 选题可使用同一冻结候选集，防止比较对象漂移；
- 比较阶段结果、引用完整性、成本和耗时；
- 影子输出只在后台可见并有明确标记。

### 16.3 阶段 C：单 Agent canary

- 仅小墨鱼的计划任务切换到 Foundation；
- 同一个逻辑触发时间只允许一套运行器拥有发布权；
- 旧表作为兼容投影，后台和公开页不变；
- 观察至少一个完整调度周期和人工触发、失败、恢复、暂停、Key 轮换。

### 16.4 阶段 D：正式切换

- Foundation 成为唯一新 Run 创建者；
- 旧运行器只处理切换前遗留任务，随后只读；
- 删除旧定时领取入口前确认无活动旧 Run；
- 数据保留，不重写历史运行。

### 16.5 回滚

提议使用配置模式：`legacy`、`shadow`、`canary`、`foundation`。具体名称在实现 ADR 中冻结。

回滚原则：

- 只切换未来 Run 的创建和发布所有权；
- 已发送或未知 Action 先完成查证，不能交给另一运行器重做；
- 已创建 Foundation Run 可以暂停，不转换为旧 Run；
- 回滚不修改已发布文章和冻结引用；
- 每次切换写审计事件并记录操作者。

## 17. 后台控制台最小信息架构

Foundation V1 后台不是“高级日志页”，而是运营和恢复界面。至少包含：

### 17.1 Agent 概览

- 身份、头像、昵称、状态和运营者；
- 当前人格版本、策略版本、能力授权；
- Provider Key 状态，不返回明文；
- 今日/月度预算、熔断和队列积压；
- 下一次计划时间和时区。

### 17.2 Run 时间线

- Trigger、工作流版本和冻结配置；
- 每个 Stage 状态、尝试次数、租约和耗时；
- 每个 Action 的风险、模型/工具、发送水位、用量和错误；
- 证据、草稿、文章或报告引用；
- `uncertain` 的查证和终结操作。

### 17.3 安全操作

- 暂停新 Run；
- 停止后续 Action；
- 对确定未发送的失败 Stage 重新排队；
- 对 `uncertain` 标记“已确认成功”或“已确认失败”，必须填写依据；
- 轮换 Key、撤销能力、打开/关闭自动发布；
- 所有操作写只追加审计。

后台不得提供“把任意 Stage 改成 succeeded”或“删除运行记录”的按钮。

## 18. 模块和代码边界建议

建议按端口隔离，而不是把所有内容塞进 `apps/api/src/agent-service.mjs`：

```text
apps/api/src/agent-runtime/
  run-repository.mjs
  stage-repository.mjs
  action-repository.mjs
  schedule-repository.mjs
  workflow-registry.mjs
  runtime-service.mjs
  runtime-worker.mjs
  outbox-worker.mjs

apps/api/src/agent-policy/
  policy-service.mjs
  budget-service.mjs
  capability-service.mjs

apps/api/src/agent-provider/
  provider-gateway.mjs
  provider-catalog.mjs
  deepseek-adapter.mjs

apps/api/src/agent-tools/
  tool-registry.mjs
  tool-runtime.mjs
  adapters/

apps/api/src/agent-workflows/
  blog-project-single/
  blog-project-compare/
  paper-reading/

apps/api/src/research/
  research-port.mjs
  tool-research-adapter.mjs
```

依赖方向：

```text
workflow definitions
        ↓
runtime application services
        ↓
ports: policy / provider / tool / research / output
        ↓
adapters and repositories
```

Repository 不调用 Provider；Provider Adapter 不修改 Run；工作流不能直接读取密钥；页面路由不能承担恢复逻辑。

## 19. 测试矩阵

### 19.1 单元与契约

- Manifest Schema 和 DAG；
- 所有状态转换的允许/拒绝矩阵；
- Policy 决策和 Scope；
- Provider/Tool 适配器规范化；
- 输出 Schema 与领域适配器；
- 引用冻结与来源定位。

### 19.2 真实 PostgreSQL

- 两个 Worker 竞争同一 Stage；
- 租约过期后旧 Worker 写入被拒绝；
- Schedule 并发只创建一个 Run；
- Outbox 重放不重复创建下游 Stage；
- 预算预留、结算和释放守恒；
- 撤销授权后新 Action 被拒；
- 人格更新不改变已排队 Run；
- 终态和不可变字段受数据库约束保护。

### 19.3 故障注入

在每个事务边界和外部调用水位注入进程退出、超时、连接中断和重复回执，逐项验证第 15 节矩阵。

### 19.4 生产 canary

- 手动 Run；
- 每天 10 点计划 Run；
- 正常文章发布；
- 选题重复被拒且不调用写作模型；
- Provider 结构化输出失败；
- API 和 Worker 分别重启；
- Agent 暂停、恢复和能力撤销；
- Key 轮换；
- 发布响应丢失模拟；
- 追问低成本队列不影响计划任务。

## 20. Foundation V1 验收证据包

宣布 Foundation V1 完成时必须同时提交：

1. 最终 Migration、约束和回滚说明；
2. Workflow Manifest Schema 与至少一个已注册版本；
3. Run/Stage/Action 状态机测试报告；
4. 多实例、租约和 Outbox 的真实 PostgreSQL 测试；
5. Provider Gateway 密钥边界审计；
6. 预算守恒和熔断测试；
7. 第 15 节故障窗口逐项证据；
8. 博客影子运行差异报告；
9. canary 时间线和费用报告；
10. 回滚演练记录；
11. 管理后台截图与操作审计；
12. 现有博客、追问、研究与 MCP 兼容测试；
13. 一个不改动 Runtime 基础表的论文工作流注册演示。

缺少任何一项，只能表述为“Foundation 开发中”，不能表述为通用 Agent 基座已经完成。

## 21. F1 首批施工包

F0 评审通过后按以下顺序施工：

### F1-1：Schema 与状态机

- 工作流定义、Run、Stage、Action、Event、Schedule、Outbox；
- 数据库约束和不可变守卫；
- 纯状态机与 Repository 测试；
- 暂不接 Provider、不发布内容。

### F1-2：Worker 与恢复

- 公平领取、租约、续租、过期回收；
- Outbox 派发；
- 多实例和崩溃注入；
- 后台只读时间线。

### F1-3：Policy、Budget 与 Provider Gateway

- 能力 grant；
- 策略快照；
- 预算预留和结算；
- DeepSeek 适配器；
- 结构化输出和 repair Action。

### F1-4：博客适配与影子运行

- 单项目文章 Manifest；
- 现有研究、写作、校验和发布代码改成适配器；
- 旧 `agent_blog_runs` 兼容投影；
- 影子、canary、正式切换与回滚。

## 22. F0 退出条件

只有满足以下条件，F0 才算完成：

- 本文与上位架构完成评审；
- 名词、状态和领域所有权无冲突；
- 所有现有资产都有保留、迁移、投影或退役结论；
- Manifest、表、Provider、Tool、Policy 合同冻结为 v1；
- 故障矩阵的每个窗口都有预期恢复策略；
- 博客迁移不存在双发布窗口；
- 测试和 canary 证据要求可以由现有工程环境执行；
- 论文能力能复用同一 Run/Stage/Action，而不增加第二套调度、Provider 或预算账本。

这套蓝图的核心约束是：**以后新增能力时，新增的是工作流、工具适配器、研究适配器和输出适配器，而不是再造一套 Agent。**
