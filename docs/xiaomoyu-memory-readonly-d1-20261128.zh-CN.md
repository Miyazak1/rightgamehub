# 小墨鱼统一记忆 D1：本地只读适配

日期：2026-11-28。范围依据：[统一记忆与工具架构的 D1](xiaomoyu-unified-memory-and-tools-architecture-20261128.zh-CN.md)。

本轮实现一个内部统一读取服务，连接既有聊天、GitHub 研究证据、编辑记忆三种权威存储。
旧问答、搜索、编辑选题和工具执行仍使用原来的调用路径；尚未将新服务注入生产上下文，也没有新增 HTTP 或模型工具入口。
后续 D2 可以在通过身份验证的上下文编排中调用它，无须再复制一套记忆数据。

## 模块与接口

| 模块 | 职责 |
| --- | --- |
| [agent-memory-readonly.mjs](../apps/api/src/agent-memory-readonly.mjs) | 固定机器人身份、现有权限校验、读取前后复核、统一返回、来源解释 |
| [agent-memory-readonly-contracts.mjs](../apps/api/src/agent-memory-readonly-contracts.mjs) | 严格类型、限量和来源引用；不可变返回值 |
| [agent-memory-readonly-adapters.mjs](../apps/api/src/agent-memory-readonly-adapters.mjs) | 三个旧数据域的读取和来源关联 |
| [agent-memory-readonly-transaction.mjs](../apps/api/src/agent-memory-readonly-transaction.mjs) | 同一数据快照的只读事务、查询与锁等待时限、回滚和连接释放 |

可信应用代码创建服务，并从已验证请求中提供 access。access 不是模型参数，不能直接由客户端 JSON 冒充。
服务的机器人身份由已有 interactionService 固定，读取参数不能指定其他 agent、owner、表名或 SQL。

```js
import { createAgentMemoryReadOnlyService } from './agent-memory-readonly.mjs';
const memory = createAgentMemoryReadOnlyService({ pool, interactionService });

// origin 来自现有 Web/QQ 可信入口；interactionId 是该请求的已保存消息。
const conversation = await memory.read({ origin, interactionId }, { kind: 'conversation' });
// actor 来自现有管理认证，仍需通过数据库中的运营管理员校验。
const evidence = await memory.read({ actor }, { kind: 'research', use: 'citation', limit: 20 });
const editorial = await memory.read({ actor }, { kind: 'editorial', limit: 200 });
const source = await memory.explain({ actor }, {
  kind: 'research', reference: evidence.records[0].reference,
});
```

唯一公开方法为 `read`、`explain`，没有写入、召回重建、模型调用、重试或任务调度方法。
`explain` 复用相同权限及限量读取路径，只返回单条记录的来源，不重复返回正文。
引用不存在、越权、超出本次窗口或已经不是当前编辑投影时，统一返回不可找到；不会凭引用扩大检索范围。

## 各数据域的兼容和边界

| 数据域 | 当前权限与范围 | 兼容投影 | 来源追溯 |
| --- | --- | --- | --- |
| 聊天 | 原 interactionService 的活动机器人、Web 身份或 QQ 当前白名单；固定同一机器人、渠道、用户、会话；锚点之前最近四条已完成父消息 | `compatibility.history` 保留原顺序、角色、正文和 requestId；附带最早完成的合法子任务回复 | interactionId、子任务 ID、字段、创建时间、runId、输入摘要和实际文本摘要 |
| 研究 | 仅该机器人的现有运营管理员；绑定到成功 GitHub 工具动作、artifact、source/version/evidence；受 allowed_uses 和来源状态限制 | 不改归档器、不写入第二份事实库 | 证据、版本、binding、artifact、toolCall、run、stage、action、固定 revision/locator 与已存摘要 |
| 编辑 | 仅该机器人的现有运营管理员；事件、文章、版本、研究来源和前驱事件须保持所属关系 | `compatibility.snapshot` 调用原 snapshot，保留去重、永久排除与冷却计算 | subject、event、article、revision、研究版本及其摘要、前驱事件、事件 payload 摘要 |

研究/编辑内部记忆本轮不向普通群友或其他管理员开放。聊天读取权沿用旧历史/状态读取语义，
不把“允许查看本人历史”扩成研究写作权限；调用工具仍需现有独立授权与预算检查。
Web 与 QQ 身份不自动合并，不因昵称相同串联记忆，也没有群聊旁观采集。

聊天故意保留一个严格化边界：子任务必须与父消息同机器人、渠道、用户和会话，且是任务类型。
原历史查询只依赖 parent_id；异常跨域关联不能再借此泄漏。有效历史保持兼容，异常关联被排除，旧数据不会被修写。

限量：聊天固定四轮；研究默认 20、最大 50 条证据；编辑默认和最大 200 个主题，保持当前默认选题窗口。
这是有界读取，不承诺完整历史导出。空结果不会生成替代事实或放宽权限。

## 一致性、来源含义和失败处理

- 每次数据读取使用 `REPEATABLE READ READ ONLY`，校验 `transaction_read_only=on`；语句、锁等待和空闲事务均有时限。
- 数据查询只接收仓库内固定 SELECT，参数单独绑定；查询门面拒绝写语句和已知副作用。它不是任意 SQL 的安全解析器，也不对外开放。
- 读取前后重新验证当前权限，撤销后不返回已读快照。此保证截至第二次校验；未来 D2 的生成/发送仍须按架构再次复核，不能把 D1 快照永久缓存成授权凭据。
- 数据域内为一个数据库快照，权限前后校验为独立的新读取；不声称跨数据库、QQ 回执、权限变更之间是一个全局原子快照。
- 返回有 capturedAt、scope、reference、contentSha256、provenance、observation。研究核对原始 quote 摘要及存储间关联，编辑核对主题投影与事件内容；不重新执行原工具。
- artifact、source version 的摘要沿用既有不可变归档和归档时校验；本轮没有重下载远端材料，也不把来源摘要解释成“事实已核验正确”。
- 聊天结果注明 `generated-result-delivery-not-asserted`，统一快照注明 `deliveryReceiptsResolved=false`；不根据 completed 推断 QQ 已发送、已读或任务已成功执行。
- 研究为归档证据，编辑为历史编辑投影，外部文本为数据，不授予指令或工具权限。
- 关联错误、权限不可验证、只读状态错误、查询超时均失败返回；事务回滚，不自动修复、重试或修改旧锁。

## 本地验收

[单元测试](../tests/platform/agent-memory-readonly.test.mjs) 覆盖严格契约、旧聊天格式、读取后撤权、只读事务、失败回滚和越界引用。
[真实 PostgreSQL 测试](../tests/platform/agent-memory-readonly-db.test.cjs) 应用全量现有迁移，使用合成用户/机器人/历史，
通过原 Tool Gateway 和研究归档器生成离线 GitHub 工具证据，再由独立 SELECT-only 数据库角色读取。
不存在 provider 或公网调用，测试准备阶段的写入只发生在该测试的临时数据库。

可重复运行的 [本地验收脚本](../scripts/verify-agent-memory-readonly-local.mjs)：

```powershell
node scripts/verify-agent-memory-readonly-local.mjs --out-dir E:/CodexData/build/Right/agent-server-preflight/20261128/agent-memory-readonly-d1-r2
```

输出目录必须不存在；使用现有镜像及依赖，不拉镜像、不安装依赖。临时 PostgreSQL 不暴露端口、无外部网络，
测试容器只共享该临时数据库的网络命名空间，源码只读挂载；结束时核对任务容器标签后清理本次临时容器。
原有本地和线上服务不在脚本操作范围。

验收覆盖：

1. 聊天四轮/任务回复与旧接口逐项一致，其他用户/会话/渠道/机器人不混入，异常跨域子任务不泄漏。
2. QQ 白名单实时撤销、普通用户伪造 admin、其他机器人的真实管理员、错误 access 形状均被拒绝。
3. 研究逐条追溯成功 artifact、固定来源版本、证据原文摘要；不允许的用途和停用来源不能返回。
4. 编辑旧 snapshot、永久排除和选题冷却保持兼容；事件 payload 被破坏时不返回不一致来源。
5. SELECT-only 角色和只读事务双重拒写；读取组前后 public 下 297 张表的行数与内容指纹一致。
6. 原聊天、编辑及研究契约回归；QQ/发布冻结源码和已有发布物完整性校验。

验收输出含 TAP、结构化结果及被测新增源码摘要。它证明合成本地数据库的兼容和隔离，
不替代线上真实历史数据验收、QQ 收发演练或长期稳定性观察。

本轮不添加数据库迁移，不改既有表、权限、预算、计划、登录、历史、旧锁或旧任务状态；
不注册论文工具，两套论文关闭状态不变；没有娱乐功能、在线发布、服务重启或旧任务重放。
