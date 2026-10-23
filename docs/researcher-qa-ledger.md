# Researcher QA 独立数据库账本（离线第一阶段）

日期：2026-10-23。工作树 `E:\CODE\Right\.codex-work\researcher-qa-ledger`，分支 `codex/researcher-qa-ledger`，基于平台博客提交 `155fdc66fb34d6101fa045d89e4876496b987afa`。原博客工作树保持不变。此阶段没有 HTTP/app 接线、后台发送器、模型调用、账号 API 或发布操作。

## 内容与边界

- 向前迁移 `0114_researcher_qa_ledger.sql`：专用 budgets/questions/reservations/actions/receipts/seen_requests/events。只新增QA对象，不修改0001–0113；仅以FK引用平台既有用户、设备授权和文章修订。触发器保护绑定、价格、已确认回执、动作状态和审计记录，不复用博客触发器函数。
- `ResearchQaLedger`：预算配置/准入、持久派发意图、显式不重发恢复、受理、许可发放/单次消费、用量对账、状态查询准备及可信闭合后的剩余额度释放。没有外部执行器或网络传输。
- `researcher-qa-protocol/`：已冻结的原v1及control-v1纯协议JS快照；仅剥离类型/更改相对扩展名，原始协议源与本地输出hash在manifest。用量解析只含原reliableUsage纯函数，无ModelGateway/配置/模型运行代码。固定向量随测试保存，运行不依赖Researcher目录或.env。
- 用户问答、人设、AI身份注册、文章/evidence ACL映射真实适配、未受理取消tombstone和付费provider均不在本阶段。`authorizeSnapshot`是必填的可信平台本地数据库权限端口，必须核对当前文章/证据scope与accessEpoch；测试注入返回值不表示生产ACL已实现。不能让请求体或浏览器实现此端口。

## 金额与幂等

预算和价格单位为USD micros十进制整数字符串，不用JS浮点金额。按每次可靠模型usage结合冻结的model/input/cache/output单价上取整计算；这是内部预算计价规则，不等于供应商账单核验。测试价格完全虚构。模型名称必须与该预留价格快照一致；缓存量未提供时按未缓存输入保守计价。预算配置本版不可重置或自动扩额。

在事务内同时建立问题、整题预留、用户/全局占用和审计。subject+idempotencyKey唯一；question/reservation/task/版本绑定不可变。相同问题以新投递ID重复到达，只复用原预留；同键换问题或版本冲突。金额只在此平台账本计算，Researcher仍独立维护token安全账，历史实验消耗与未结算预留不迁移进新表。

回执按question+callIndex、receiptId唯一；provider trace和原始响应hash也防跨题挪用。known不能被改写为unknown或再扣一次；unknown的费用不是0结算，而是保留未确认预留。known如实超出原预留时记录实际消费、停止后续准入/派发，不丢弃回执以凑预算。回执proof必须来自受保护、输入绑定的原调用journal；不能从浏览器拿一份body和hash自证。

发放许可前先登记唯一类型槽与原请求摘要；新投递只能复用仍有效且未消费的许可。原许可过期/已消费后不重新发许可。许可消费和dispatching状态原子提交，只会返回一次shouldSend=true；提交后丢确认，重建连接池也不能再次返回true。

## 释放与恢复

- usage只结算该槽费用，不代表整题完成，不释放剩余预留。
- 平台保存原查询与签名状态，核对单调版本、TaskLink、完整平台分配槽、原始known回执和独立closed journal证明。
- known模型槽必须在DB已有已结算回执且action=known。known读取槽必须先有dispatching/unknown（或已经known）的DB动作，核对可信read proof后在同一事务更新为known，再释放。reserved读取不能凭一个known status跳过消费。此处仅支持已核验且不产生额外费用的来源读取；付费Search/Fetch计价与原始回执适配须后续单独完成。
- neverSent只允许仍reserved、许可已过期且独立journal确认未进入dispatching。任何unknown、漏槽、错对象/证明、not_found都不释放。已受理零调用仍须原TaskLink与可信closed journal。
- release关闭标记、预算释放、防重放记录和审计在同一事务中提交。重复状态只返回原结果，不能重复释放；不根据HTTP失败、重启或原submit过期释放。
- 连接断开时接收错误、回收坏连接，不自动重试事务。before-COMMIT失败全部回滚；after-COMMIT丢确认保留已提交记录，显式查询/同业务对账恢复。
- 派发中的原请求失联只改为uncertain并返回shouldSend=false，没有任何自动发包或“重新起任务”分支。

## 独立真实 PostgreSQL 验证

运行：

```powershell
npm run research:qa:test:db
```

需要本机已存在postgres:17镜像，脚本不自动pull。不读.env或既有DATABASE_URL；创建随机label/名称、随机密码、随机数据库、仅127.0.0.1随机端口的容器，PG数据在tmpfs内。进程只有显式随机QA_LEDGER_TEST_URL和隔离标记才能跑真实DB测试；不复用平台数据库。每个场景再建独立schema，完整数据库先验证114项迁移及第二次应用为0。测试用户/授权/草稿仅是该临时数据库的随机fixture行，没有线上注册、账号或文章发布。

finally先检查容器唯一身份、label和仅tmpfs挂载，再删除这个精确容器；不按通配符删除，不挂已有数据卷。真实数据库测试默认在普通node --test中跳过，不会暗中连DB。

最终真实DB：21个场景/合计22项测试通过。覆盖同键并发、跨用户全球预算竞争、单题/用户额度、许可只消费一次、重复/未知回执、pool重建、真实PG backend终止回滚、提交前后故障、consume/release确认丢失、跨题挪用、超额消费如实保存、撤权、not_found、零调用、漏槽/错闭合proof、价格冻结和DB不可变保护、读取动作状态与释放共同提交。

## 当前限制与下一阶段门槛

已移除QA全局事务锁。只有同一subject+idempotencyKey的新准入在问题行尚不存在时共用一个事务锁；已有任务先锁question，再访问子记录，消费和标记unknown均先查所属question、锁question后重读action。所有多账户锁统一按account_key排序。单题仍串行；全局预算行在涉及额度的操作中仍需短暂串行，这是防超额的必要边界，不代表不同任务查询被全局阻塞。authorizeSnapshot只能读本地数据库，不允许持锁期间调用网络服务。

尚未受理的取消/人工对账操作流程仍是启用真实金额之前的门槛；不能因余额占用不方便而自动清零unknown。实际运行角色、服务密钥、线上配置、计费价格、真实账户/文章ACL与生产迁移均未接入。

更广平台回归中的三个既有失败（courseware-ui-kit两项、knowledge-map一项）已在未修改155fdc66基线对应测试中复现，不修改这些无关功能。新工作树缺少本地workspace依赖的初始失败通过只读复用已有安装修复，没有下载新依赖。

## 首次实现验收（以下为本轮审查前结果）

- 隔离PostgreSQL17：21个场景/合计22项测试通过，0失败；每次运行后精确测试容器均已删除。
- 静态定向：11项，9通过、2个需要独立DB的条件用例按预期跳过、0失败。
- 平台完整离线回归：467项，438通过、26条件跳过、3失败。三项失败为原155fdc66基线上已复现的两项courseware-ui-kit和一项knowledge-map，不属于本次账本改动。没有把此结果描述成全量通过。
- 113个旧迁移与原博客工作树最终逐文件字节一致（对齐了新checkout对0113自动转换的CRLF）；9份Researcher既有业务文件哈希一致。平台基线工作树无tracked改动。
- 平台会话只读复核确认预算、read动作闭合、独立QA审计触发器和恢复边界无剩余本阶段阻断；保留全局串行锁/本地SQL权限端口门槛。
- 付费请求0、线上账号0；未注册HTTP路由、连接现有DB或启用发布。

验证日志（本机临时目录）：researcher-qa-real-db-final.log、researcher-qa-targeted-final.log、researcher-qa-platform-final.log、qa-ledger-baseline-reference.log。

## 2026-10-23 并发与恢复审查

发现并修复三处并发风险：全局锁掩盖consume/action与settle/question的反向锁序；预算检查与更新缺少统一锁序；去掉全局锁后配置预算及不存在的问题行会出现先查后插竞争。现在以question行保护任务状态，同键新准入使用窄范围事务锁，预算先有序锁定再更新，预算配置使用ON CONFLICT DO NOTHING后锁行核对，不能重置额度。冻结协议、114号迁移及之前113号迁移均未改动。迁移runner的独立schema迁移锁保留，它只负责迁移期间串行，不参与运行时问答事务。

独立PostgreSQL17回归覆盖：真实锁等待下其他问题可查询；consume/unknown等待question时不占action锁；跨题并发结算/释放的总额与审计一致；全局/用户额度竞争；同键准入和预算配置竞争；unknown与known同时到达以及旧unknown投递晚到；提交前后失败、PG连接终止、重建连接池后不重派发、不重扣费、不重复释放。两个迁移runner同时启动只执行一次114项迁移；模拟114号迁移末尾失败，表/索引/函数全部回滚后可重新应用。

安全边界不变：unknown或not_found继续占用预留；只有可信闭合状态、完整槽位和原始用量证明才释放。已确认回执不能降级，原投递重复回放可返回旧确认，但不改变当前known状态。事务/派发均不自动重试。全部数据是临时数据库fixture，未操作旧任务/既有数据库，也未接HTTP、真实执行、账户或发布。

日志：researcher-qa-review-db.log、researcher-qa-review-targeted.log（系统临时目录）。

本轮最终结果：独立PG17为30个场景/31项测试全部通过（0跳过），定向离线测试15项中10通过、5项独立数据库门控按预期跳过、0失败。没有重跑无关平台功能；首次全量回归的3项既有基线失败仍见上文。
