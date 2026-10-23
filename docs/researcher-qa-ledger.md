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

## 2026-10-23 本地 HTTP 与问答账本联调

已与平台会话对齐：继续独立分支 `codex/researcher-qa-ledger`，平台基线仍为 `155fdc66`。冻结协议、两份向量、manifest、0114及旧迁移不变。`app.mjs`仅增加import、可选依赖和条件注册三行；`runtime.mjs`不创建或传入该依赖，所以正常服务中没有这些路由。不能通过环境变量开启。注册需显式注入 `mode:simulation-only` 的本地gateway；测试服务器明确监听127.0.0.1。无真实Researcher执行、模型SDK、账号注册或发布入口。

新增文件：`researcher-qa-http-routes.mjs`处理路由/认证/错误；`researcher-qa-local-gateway.mjs`调用已有账本，并提供只到固定loopback地址的一次性HTTP transport。`startQaLoopbackReceiver`仅用于显式本地模拟Researcher；不自动启动。数据库测试夹具提取到`tests/platform/support/researcher-qa-db.cjs`，仍用随机临时数据库/schema，不读.env或旧DB配置。

### 路由与信任边界

| 方向/路由 | 认证与行为 |
| --- | --- |
| POST `/v1/me/research-qa` | 正常平台Bearer，经requireAuth取得actor.userId；body只含文章ID、修订ID、问题、幂等key。可信prepareSubmission/resolveGrant提供固定问题绑定和原授权，必须与actor及输入一致，再交账本准入。 |
| GET `/v1/me/research-qa/:questionId` | 核对本人、当前原grant和文章权限，返回金额/状态摘要；不返回签名token、scope、proof或原始回执。 |
| POST `/v1/me/research-qa/:questionId/reconcile` | 本人及当前权限检查后，保存签名inspect查询；向模拟Researcher发一次请求，核对签名status及独立journal，再交账本处理。不是重发submit或模型。 |
| 冻结v1 accepted、usage；control-v1 authorize、status | 平台仅注册这四种反向动作。独立`x-research-qa-signature`头，拒绝重复/逗号拼接/超长/错签名/过期/错action/错path。签名和绑定最终仍由冻结协议及账本校验。 |
| outbound submit、control inspect | 不注册为平台入站路由；固定127.0.0.1目的地，无env代理、重定向、自动重试。 |

全部本地路由检查底层socket地址，拒绝Origin、浏览器跨站头、转发地址头和未签名query参数，不把X-Forwarded-For当成本地证据。未改trustProxy。请求正文上限64KiB，reconcile为1KiB，禁止额外顶层字段；标签分支/深层正文继续由冻结校验器检查。响应统一no-store。用户Bearer与服务签名互不替代。

`prepareSubmission`与`resolveGrant`是可信服务端端口，测试实现仅覆盖独立fixture用户和文章。生产版的持久scope工厂、真实平台文章/evidence权限映射尚未启用；不能拿浏览器提交的subject/grant/budget构造它们。生产scope工厂还需从DB复用原始绑定，应支持跨进程并发与重启，不能照搬测试中的内存prepared映射。

### 两阶段执行与恢复

- authorize HTTP只创建/复用仍reserved的许可，不提前consume。模拟Researcher验证返回签名，实际准备执行前才调用可信本地`consumeForExecution`端口。该端口不在HTTP路由表；本阶段尚未定义跨进程真实执行的consume适配。
- 同键重复submit复用原预留，均经过幂等claimDelivery；只有仍pending的唯一调用方获得派发权，其他状态不重发。换问题/版本冲突409。新submit在claimDelivery提交后仅发一次，断线转uncertain，不自动重发。
- permit返回前丢响应仍reserved；consume提交后丢确认不能再次得到shouldSend=true。不能用“超时”等同“未发送”或直接释放预留。
- usageProof和closureProof仅从可信、只读、任务绑定的模拟服务journal读取。proof不接受HTTP body字段；closed hash独立从模拟执行记录取得，不回显status里的hash自证。真实journal适配仍是后续接入门槛。
- 原始可靠回执提交前/后故障，通过显式重投同业务回执对账；不重跑模型。可信status不能替代缺失的用量证明；未结算known槽先停止，需先从受保护journal对齐回执再显式reconcile。unknown/not_found继续占用预留，不能自动清零。
- 查询、结算、恢复继续使用既有question行锁和有序预算锁；没有新增全局锁，也没有自动事务重试或后台循环。

### 错误映射与验证

错误在新route模块集中处理，不改全局handler：无/坏Bearer或缺失/无效格式签名401；撤权/身份错绑/无权查看/签名协议拒绝403；输入400、超大413、类型415；用户不存在问题404；预算不足、幂等冲突、确定停止及结果未知均409、retryable:false；已登记派发但无法确认时给QA_HTTP_DELIVERY_UNRESOLVED、reconcileRequired:true和本人的questionId。仅明确401的认证错误归为401；未知数据库/程序异常给通用500、retryable:true，不伪装成登录或业务错误。这里是错误提示，不会触发自动重试。不回显密钥、token、scope、供应商回执或内部错误细节。内部未知question不暴露存在性。

最终独立PG17+本机HTTP：50项全部通过（0跳过）。包括完整签名链路、并发重复提交、跨用户、撤销grant/文章权限、额度不足、permit/consume两阶段断线、unknown/not_found保留预留、原回执提交前后故障及重启恢复、闭合proof伪造、头部/路径/正文边界，另含全部原账本迁移/并发/恢复回归。定向非DB/API基础回归：43项中40通过、3按独立DB门控跳过、0失败。

日志：`researcher-qa-http-db.log`、`researcher-qa-http-targeted.log`（系统临时目录）。所有容器精确核对身份后清除；无旧任务改动、付费请求、线上账户、真实执行或发布。此结果只证明本地HTTP+模拟服务闭环，不表示已接生产平台或真实模型。

平台只读审查后补齐相邻中断窗口：after_admit/before_claim中断可由同key显式续接，保留同一question/reservation/预算，并由唯一pending→dispatching的claim获得者使用原body、原requestId和新的短期签名时间发送；原签名过期也不改变stored claims/digest。反例使用新的重复投递ID并将时钟推进至原签名过期后，仍只远端submit一次。

若after_claim_before_send进程退出，故障点在send的try/catch之外，不假装执行了recoverDelivery。重启后重复submit明确409+QA_HTTP_DELIVERY_UNRESOLVED，只能inspect；可信not_found后GET/reconcile明确unresolved:true、resolution:inspect-only、released:false、held不变，不把dispatching回pending。重复显式inspect各留一条inspection/status_held审计，不新增预留、结算或释放，不产生后台恢复循环。已有远端任务则仍可由签名状态接回accepted。这一未决状态的安全取消/重试需要vNext持久delivery owner/attempt/lease或tombstone，目前不支持；没有用临时全局锁掩盖它，也没有宣称全部失败都能继续执行。

## 2026-10-23 本地 HTTP 网关再次审查

修复两处边界，未改冻结协议或迁移：

1. 先前usage/status在验证回调前就调用可信日志端口。现在以惰性的服务端只读resolver交给账本，在签名、用户/任务/修订绑定、原查询关联和投递重放检查之后才读取；usage还要求槽位已派发，closed status还要求满足闭合前置条件。相同原投递直接返回已提交结果，不再触发日志读取；unknown/not_found不读不需要的证明。原有直接传proof/journal对象的调用保持兼容。
2. 网关在异步端口调用前固定actor与输入快照，给prepareSubmission和resolveGrant分别传副本。get固定已认证subject，refresh固定actor；可信端口或共享actor对象的异步变化不能换掉当前调用的身份、问题或文章输入。

同时收窄路径集合：模拟Researcher receiver只接submit/control inspect，平台callback只接accepted/usage/authorize/status，网关outbound也只允许submit/inspect。底层本机测试sender仅覆盖这两组路径，不再包含未使用的recover/permit路由。所有集合来自原冻结常量，无协议改写。

惰性resolver在单题事务内执行，必须是可信、只读、有界的本地日志读取；禁止网络、模型调用、派发或重入账本。这样不增加一次验证/一次结算之间的数据库竞态，也不引入全局锁。resolver失败会回滚该次用量/状态/预算/审计更新；后续只显式重投原可靠回执或原状态对账，不自动执行模型。

独立测试中的文章授权也补齐完整绑定对照：实际DB修订content hash与可信fixture目录中的整份ArticleBinding同时匹配，包含Researcher文章ID和evidence package hash。此为测试端口加强，不表示生产文章/证据目录已启用。新增错subject、错原grant、错revision、错content hash、错package hash五类反例，均无预留、无远端submit、无模型执行；另验证坏签名不读日志、同投递并发重放只结算一次、用量/闭合日志故障全部回滚后显式恢复。

结果：独立PG17与模拟模型/本机HTTP共61项全部通过（0跳过）；本地HTTP无DB测试8/8通过。定向API/迁移回归另见本轮日志。日志为researcher-qa-http-audit-db.log、researcher-qa-http-audit-static.log、researcher-qa-http-audit-targeted.log（系统临时目录）。旧任务、线上账号、付费请求、真实执行与发布均未涉及。

保留既有安全停止边界：无持久owner证明的dispatching/uncertain加not_found仍保持held，明确unresolved，不回pending、不重发、不释放；安全取消/重试继续留给vNext。本轮没有把该未决状态改成“可自动恢复”。

补充：错误task、未派发用量槽以及closed status的错槽/漏槽均在日志读取前拒绝；冻结的完整release证明校验仍保留，不因前置检查而放宽。完整定向回归45项中42通过、3独立DB门控跳过，0失败。
